// Startup auth sync — RETIRED AS THE DEFAULT in 2.0.0 (owner 2026-10-25):
// fleet auth replication is ygg-auth's job (--harness zcode|autoclaw) with
// provenance/lineage. This module's pull-and-heal plane survives only behind
// ZCODE_TUI_AUTH_SYNC=1 (one-transition escape hatch). Default behavior is a
// PASSIVE pointer: if a host genuinely lacks auth, say the ygg-auth command
// that fixes it — never copy anything.
//
// Historical context (why the handoff path still matters): the desktop
// (3.12.x) moved sign-in auth to ~/.zcode/v2/ (credentials.json
// safeStorage-style enc:v1 values + a PLAINTEXT provider_config.json whose
// zai-api key is what actually authenticates turns). The TUI hands the
// backend a provider config via ZCODE_PERSONAL_PROVIDER_CONFIG_FILE; in 2.0.0
// that is the LOCAL ~/.zcode/v2/provider_config.json (which ygg-auth's zcode
// harness replicates), with the legacy stored copy only when the legacy plane
// is explicitly on.
//
// Fail-soft everywhere: a sync failure must never block the TUI boot —
// whatever auth the machine already has still works. Secrets never reach
// the log; only sha256 fingerprints do.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, chmodSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";

export const V2_PROVIDER_CONFIG = ".zcode/v2/provider_config.json";
export const CLI_CONFIG = ".zcode/cli/config.json";
export const AUTH_SOURCE_ENV = "ZCODE_TUI_AUTH_SOURCE";
export const LEGACY_SYNC_ENV = "ZCODE_TUI_AUTH_SYNC";
export const DEFAULT_AUTH_SOURCE = "jojo";

/** The backend's provider-config handoff prefers the LOCAL machine settings
 * (replicated by ygg-auth); null when this host has none. */
export function localProviderConfigPath(home = process.env.HOME ?? ""): string | null {
  const p = join(home, V2_PROVIDER_CONFIG);
  return existsSync(p) ? p : null;
}

export interface AuthConfig {
  /** "local" | a host name (the SSOT holder). Fleet default: jojo. */
  source: string;
  syncAtStartup: boolean;
}

export interface SyncedAuth {
  source: string;
  fingerprint: string;
  /** Path of the stored provider config the backend should read. */
  providerConfigPath: string;
  healedMachineSettings: boolean;
}

/** Metadata record; the raw SSOT blob lives beside it, verbatim. */
export interface StoredAuthMeta {
  syncedAt: string;
  source: string;
  fingerprint: string;
}

export interface SyncDeps {
  homeDir?: string;
  configDir?: string;
  /** Overridable for tests and exotic transports. */
  fetchRemote?: (host: string, remotePath: string) => string;
  /** When false, skip machine-settings healing (read-only sync). */
  heal?: boolean;
}

export function configDir(home = process.env.HOME ?? ""): string {
  return join(home, ".config/zcode-tui");
}

export function loadAuthConfig(home = process.env.HOME ?? ""): AuthConfig {
  const envSource = process.env[AUTH_SOURCE_ENV];
  const file = join(configDir(home), "config.json");
  let fromFile: Partial<AuthConfig> = {};
  try {
    const doc = JSON.parse(readFileSync(file, "utf8")) as { auth?: Partial<AuthConfig> } & Partial<AuthConfig>;
    fromFile = doc.auth ?? doc;
  } catch {
    // first boot or unreadable — defaults below
  }
  return {
    source: envSource ?? fromFile.source ?? DEFAULT_AUTH_SOURCE,
    syncAtStartup: fromFile.syncAtStartup ?? true,
  };
}

export function saveAuthConfig(config: AuthConfig, home = process.env.HOME ?? ""): void {
  const dir = configDir(home);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "config.json");
  let merged: Record<string, unknown> = {};
  try {
    merged = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    // fresh config
  }
  merged.auth = config;
  writeFileSync(file, JSON.stringify(merged, null, 2) + "\n");
}

/** Resolved source === this machine (local read, no ssh). */
export function sourceIsLocal(source: string): boolean {
  return source === "local" || source === hostname();
}

function sshFetch(host: string, remotePath: string): string {
  const p = spawnSync(
    "ssh",
    ["-o", "BatchMode=yes", "-o", "ConnectTimeout=3", host, "cat", remotePath],
    { encoding: "utf8", timeout: 8000 },
  );
  if (p.status !== 0 || typeof p.stdout !== "string" || p.stdout.length === 0) {
    throw new Error(`ssh ${host} cat ${remotePath} failed (rc=${p.status})`);
  }
  return p.stdout;
}

function localFetch(home: string, relPath: string): string {
  return readFileSync(join(home, relPath), "utf8");
}

export function fingerprint(raw: string): string {
  return createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

/** The SSOT provider config's api key (first provider rule with one). */
export function extractProviderApiKey(providerConfigJson: string): string | null {
  try {
    const parsed = JSON.parse(providerConfigJson) as {
      config?: { providerConfigRules?: { providerRules?: Array<{ config?: { access?: { type?: string; apiKey?: string } } }> } };
    };
    for (const rule of parsed.config?.providerConfigRules?.providerRules ?? []) {
      const access = rule.config?.access;
      if (access?.type === "api-key" && access.apiKey) return access.apiKey;
    }
  } catch {
    return null;
  }
  return null;
}

function backup(path: string): void {
  copyFileSync(path, `${path}.pre-authsync-${new Date().toISOString().slice(0, 10)}`);
}

/**
 * Heal the LOCAL machine settings from the synced SSOT so the whole zcode
 * stack on this host (desktop, CLI, older TUI-spawned runtimes) carries the
 * fleet auth. Surgical: only the api key field in cli/config.json moves,
 * with a dated backup beside it.
 */
function healMachineSettings(home: string, ssot: string, ssotFp: string): boolean {
  let healed = false;
  const key = extractProviderApiKey(ssot);
  const v2Path = join(home, V2_PROVIDER_CONFIG);
  if (existsSync(v2Path)) {
    if (fingerprint(readFileSync(v2Path, "utf8")) !== ssotFp) {
      backup(v2Path);
      writeFileSync(v2Path, ssot);
      healed = true;
    }
  } else {
    mkdirSync(join(home, ".zcode/v2"), { recursive: true });
    writeFileSync(v2Path, ssot);
    healed = true;
  }
  if (!key) return healed;
  const cliPath = join(home, CLI_CONFIG);
  if (!existsSync(cliPath)) return healed;
  try {
    const cfg = JSON.parse(readFileSync(cliPath, "utf8")) as {
      provider?: { zai?: { options?: { apiKey?: string } } };
    };
    const current = cfg.provider?.zai?.options?.apiKey;
    if (current !== key) {
      backup(cliPath);
      cfg.provider ??= {};
      cfg.provider.zai ??= {};
      cfg.provider.zai.options ??= {};
      cfg.provider.zai.options.apiKey = key;
      writeFileSync(cliPath, JSON.stringify(cfg, null, 2) + "\n");
      healed = true;
    }
  } catch {
    // unreadable cli config — leave it alone
  }
  return healed;
}

/**
 * Sync the auth SSOT into the TUI config dir. 2.0.0: legacy plane — runs ONLY
 * when ZCODE_TUI_AUTH_SYNC=1; otherwise returns null untouched (replication
 * moved to ygg-auth). Callers boot anyway on null.
 */
export function syncAuthAtStartup(deps: SyncDeps = {}): SyncedAuth | null {
  if (process.env[LEGACY_SYNC_ENV] !== "1") return null;
  const home = deps.homeDir ?? process.env.HOME ?? "";
  if (!home) return null;
  const cfg = loadAuthConfig(home);
  if (!cfg.syncAtStartup) return null;
  const cdir = deps.configDir ?? configDir(home);
  const fetch = sourceIsLocal(cfg.source)
    ? (rel: string) => localFetch(home, rel)
    : (rel: string) => (deps.fetchRemote ?? sshFetch)(cfg.source, join("$HOME", rel));

  let raw: string;
  try {
    raw = fetch(V2_PROVIDER_CONFIG);
  } catch {
    return null;
  }
  const fp = fingerprint(raw);
  if (!extractProviderApiKey(raw)) return null;

  mkdirSync(cdir, { recursive: true });
  const storedPath = join(cdir, "auth-provider-config.json");
  const metaPath = join(cdir, "auth.json");
  let storedFp: string | null = null;
  try {
    storedFp = (JSON.parse(readFileSync(metaPath, "utf8")) as StoredAuthMeta).fingerprint ?? null;
  } catch {
    // no stored auth yet
  }
  const firstSync = storedFp !== fp;
  if (firstSync) {
    writeFileSync(storedPath, raw);
    chmodSync(storedPath, 0o600);
    const meta: StoredAuthMeta = { syncedAt: new Date().toISOString(), source: cfg.source, fingerprint: fp };
    writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n");
  }

  let healedMachineSettings = false;
  if (deps.heal ?? true) {
    try {
      healedMachineSettings = healMachineSettings(home, raw, fp);
    } catch {
      healedMachineSettings = false;
    }
  }

  return { source: cfg.source, fingerprint: fp, providerConfigPath: storedPath, healedMachineSettings };
}

// Headless verbs' auth gate. 2.0.0 (owner 2026-10-25): the automatic
// pull-and-heal plane is retired — ygg-auth (--harness zcode|autoclaw) owns
// fleet replication with provenance. Default behavior: a passive pointer that
// speaks ONLY when this host is actually missing an auth file. The legacy
// plane runs verbatim behind ZCODE_TUI_AUTH_SYNC=1 (one-transition hatch).
// Non-blocking by design; failures never stop boot.
export function syncAuthHeadless(): void {
  if (process.env[LEGACY_SYNC_ENV] === "1") {
    try {
      const r = syncAuthAtStartup();
      if (r) console.error(`zcode-tui: auth synced from ${r.source} (fingerprint ${r.fingerprint.slice(0, 8)})`);
    } catch { /* never block */ }
    try {
      const p = syncAutoclawPlan();
      if (p) console.error(`zcode-tui: autoclaw plan synced from ${p.source} (${p.action})`);
    } catch { /* never block */ }
    return;
  }
  try {
    const home = process.env.HOME ?? "";
    if (home && !existsSync(join(home, V2_PROVIDER_CONFIG)))
      console.error("zcode-tui: no zcode auth here — replicate with `ygg-auth.py fetch <writer-host> <slug> --activate --harness zcode` (or ZCODE_TUI_AUTH_SYNC=1 for the retired startup plane)");
    if (home && !existsSync(join(home, AUTOCLAW_PLAN_RELPATH)))
      console.error("zcode-tui: no autoclaw plan here — `ygg-auth.py fetch <writer-host> <slug> --activate --harness autoclaw` (or `zcode-tui autoclaw setup` where the app is signed in)");
  } catch { /* never block */ }
}

// AutoClaw plan replication — LEGACY (2.0.0): ygg-auth --harness autoclaw
// owns this movement now. The newest-wins pull survives only behind
// ZCODE_TUI_AUTH_SYNC=1. Original boundary (2026-10-23): the user's own mined

export const AUTOCLAW_PLAN_RELPATH = ".config/zcode-tui/autoclaw-plan.json";

export interface PlanSyncResult { source: string; action: "pulled" | "local-newer" | "skipped"; reason?: string }

/** Best-effort: pull the SSOT plan file when it exists and is newer than local. (legacy plane — gated) */
export function syncAutoclawPlan(deps: SyncDeps = {}): PlanSyncResult | null {
  if (process.env[LEGACY_SYNC_ENV] !== "1") return null;
  const home = deps.homeDir ?? process.env.HOME ?? "";
  if (!home) return null;
  const cfg = loadAuthConfig(home);
  if (!cfg.syncAtStartup) return null;
  const fetch = sourceIsLocal(cfg.source)
    ? (rel: string) => localFetch(home, rel)
    : (rel: string) => (deps.fetchRemote ?? sshFetch)(cfg.source, join("$HOME", rel));

  let remote: string;
  try {
    remote = fetch(AUTOCLAW_PLAN_RELPATH);
  } catch {
    return { source: cfg.source, action: "skipped", reason: "no plan on the SSOT host yet" };
  }
  const localPath = join(home, AUTOCLAW_PLAN_RELPATH);
  const updatedAt = (raw: string): string => {
    try { return (JSON.parse(raw) as { auth?: { updatedAt?: string } }).auth?.updatedAt ?? ""; } catch { return ""; }
  };
  const remoteStamp = updatedAt(remote);
  if (!remoteStamp) return { source: cfg.source, action: "skipped", reason: "SSOT plan has no auth.updatedAt" };
  let localStamp = "";
  try { localStamp = updatedAt(readFileSync(localPath, "utf8")); } catch { /* no local plan yet */ }
  if (localStamp && localStamp >= remoteStamp) {
    return { source: cfg.source, action: "local-newer" };
  }
  mkdirSync(join(home, ".config", "zcode-tui"), { recursive: true });
  writeFileSync(localPath, remote);
  chmodSync(localPath, 0o600);
  return { source: cfg.source, action: "pulled" };
}
