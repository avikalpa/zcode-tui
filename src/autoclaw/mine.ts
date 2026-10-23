// Runtime mining of the user's own AutoClaw installation.
//
// SEPARATION BOUNDARY (owner 2026-10-23): this file ships a PROCEDURE, not
// data. Every constant it produces is read out of the AutoClaw app the user
// installed and authenticated on their own machine (bundle text, userData
// files, their keyring) and written to the user's autoclaw-plan.json. Nothing
// here encodes AutoClaw identity, endpoints or credentials in the repo.
//
// Measured against AutoClaw 2.0.3 (zwork) appimage layout, 2026-10-23:
//   <appimage runtime>/resources/app/dist/main.cjs   — bundle with the
//     managed-plane modules (zwork-managed-request-headers.ts etc.)
//   ~/.config/<App>-<variant>/channel.json           — {"channel":"official"}
//   ~/.config/<App>-<variant>/device/device-id.json  — {"deviceId": uuid}
//   ~/.config/<App>-<variant>/accounts/<sha>/account-credentials.enc — v11
//     safeStorage blob {accessToken, refreshToken, revision, updatedAt}
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createDecipheriv, pbkdf2Sync } from "node:crypto";
import type { AutoclawPlan, PlanClient } from "./plan";

export interface MineOptions {
  appDir?: string;
  configDir?: string;
  home?: string;
  now?: () => Date;
}

interface MinedBundle {
  identity: { appId: string; appKey: string; product: string };
  channelDefault: string;
  proxyPath: string;
  modelConfigPath: string;
  origins: { release: string; overseas: string };
  refresh: { path: string; fallbackPath: string };
  version: string;
  piVersion: string;
}

/** Newest-first scan of the appimage runtime stamps (same shape as the pi discovery). */
export function findAutoClawAppDir(home = homedir()): string | null {
  if (process.env.AUTOCLAW_APP_DIR && existsSync(join(process.env.AUTOCLAW_APP_DIR, "dist", "main.cjs"))) {
    return process.env.AUTOCLAW_APP_DIR;
  }
  const runtimeRoot = join(home, ".appimages", "runtime");
  try {
    const stamps = readdirSync(runtimeRoot)
      .filter((f) => statSync(join(runtimeRoot, f)).isDirectory())
      .sort()
      .reverse();
    for (const s of stamps) {
      const dir = join(runtimeRoot, s, "resources", "app");
      if (existsSync(join(dir, "dist", "main.cjs"))) return dir;
    }
  } catch { /* no runtime tree */ }
  return null;
}

/** The userData dir: newest ~/.config dir matching autoclaw that carries device/device-id.json. */
export function findAutoClawConfigDir(home = homedir()): string | null {
  if (process.env.AUTOCLAW_CONFIG_DIR && existsSync(join(process.env.AUTOCLAW_CONFIG_DIR, "device", "device-id.json"))) {
    return process.env.AUTOCLAW_CONFIG_DIR;
  }
  try {
    const candidates = readdirSync(join(home, ".config"))
      .filter((d) => /autoclaw/i.test(d))
      .map((d) => join(home, ".config", d))
      .filter((d) => existsSync(join(d, "device", "device-id.json")))
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
    return candidates[0] ?? null;
  } catch {
    return null;
  }
}

export function mineBundle(appDir: string): MinedBundle {
  const bundle = readFileSync(join(appDir, "dist", "main.cjs"), "utf8");

  const identityM = bundle.match(/appId:\s*"(\d+)"\s*,\s*appKey:\s*"([0-9a-f]{32})"\s*,\s*product:\s*"([a-z0-9-]+)"/);
  if (!identityM) throw new Error("mine: app identity object not found in the user's bundle (layout changed?)");

  const channelM = bundle.match(/ZWORK_DEFAULT_DISTRIBUTION_CHANNEL\s*=\s*"([a-z-]+)"/);
  const proxyM = bundle.match(/"(\/autoclaw-proxy\/proxy\/autoclaw)"/);
  const modelConfigM = bundle.match(/"(\/autoclaw-proxy\/proxy\/autoclaw-model-config)"/);
  if (!proxyM || !modelConfigM) throw new Error("mine: managed proxy paths not found in the user's bundle");

  const originsBlock = bundle.match(/HTTP_ORIGIN_BY_ENVIRONMENT\s*=\s*\{([^}]+)\}/);
  if (!originsBlock) throw new Error("mine: gateway origin table not found in the user's bundle");
  const releaseM = originsBlock[1].match(/release:\s*"(https:\/\/[^"]+)"/);
  const overseasM = originsBlock[1].match(/overseas_release:\s*"(https:\/\/[^"]+)"/);
  if (!releaseM || !overseasM) throw new Error("mine: gateway origins not found in the user's bundle");

  const refreshM = bundle.match(/"(\/userapi\/v1\/refresh)"/);
  const refreshFallbackM = bundle.match(/"(\/userapi\/v1\/agent-refresh)"/);
  if (!refreshM || !refreshFallbackM) throw new Error("mine: token refresh paths not found in the user's bundle");

  let version = "0.0.0";
  let piVersion = "";
  try {
    const pkg = JSON.parse(readFileSync(join(appDir, "package.json"), "utf8")) as { version?: string; dependencies?: Record<string, string> };
    version = String(pkg.version ?? version);
    piVersion = String(pkg.dependencies?.["@earendil-works/pi-coding-agent"] ?? "");
  } catch { /* keep defaults */ }

  return {
    identity: { appId: identityM[1], appKey: identityM[2], product: identityM[3] },
    channelDefault: channelM?.[1] ?? "official",
    proxyPath: proxyM[1],
    modelConfigPath: modelConfigM[1],
    origins: { release: releaseM[1], overseas: overseasM[1] },
    refresh: { path: refreshM[1], fallbackPath: refreshFallbackM[1] },
    version,
    piVersion,
  };
}

/**
 * The safeStorage key lives in the user's keyring (Electron's os_crypt entry).
 * Python+secretstorage enumerates it properly; secret-tool is the fallback.
 * Both are user-machine tools — zcode-tui installs neither.
 */
export function readKeyringSafeStorageKey(): Buffer | null {
  const py = spawnSync("python3", ["-c", PY_KEYRING_SNIPPET], { encoding: "buffer", timeout: 10_000 });
  if (py.status === 0 && py.stdout.length > 0) return Buffer.from(py.stdout);
  const st = spawnSync("secret-tool", ["lookup", "application", "chromium", "xdg:schema", "chrome_libsecret_os_crypt_password_v2"], { encoding: "buffer", timeout: 10_000 });
  if (st.status === 0 && st.stdout.length > 0) return Buffer.from(st.stdout);
  return null;
}

const PY_KEYRING_SNIPPET = `
import sys
try:
    import secretstorage
    conn = secretstorage.dbus_init()
    coll = secretstorage.get_default_collection(conn)
    for item in coll.get_all_items():
        if "Safe Storage" in item.get_label():
            sys.stdout.buffer.write(item.get_secret())
            break
except Exception:
    pass
`;

/** Decrypt an Electron/Chromium v10/v11 safeStorage blob (public os_crypt format). */
export function decryptSafeStorage(blob: Buffer, key: Buffer): string {
  const prefix = blob.subarray(0, 3).toString("latin1");
  if (prefix !== "v11" && prefix !== "v10") throw new Error(`mine: unexpected safeStorage prefix ${JSON.stringify(prefix)}`);
  const decipher = createDecipheriv("aes-128-cbc", key.subarray(0, 16), Buffer.alloc(16, 0x20));
  const plain = Buffer.concat([decipher.update(blob.subarray(3)), decipher.final()]); // autoPadding strips PKCS7
  if (plain.length === 0) throw new Error("mine: empty safeStorage payload");
  return plain.toString("utf8");
}

interface EncryptedCredential {
  accessToken: string;
  refreshToken: string;
  revision?: number;
  updatedAt?: string;
}

export function decryptCredentials(configDir: string): EncryptedCredential {
  const accountsDir = join(configDir, "accounts");
  if (!existsSync(accountsDir)) throw new Error("mine: no accounts/ dir in the user's AutoClaw config (not logged in?)");
  const encs: string[] = [];
  for (const acct of readdirSync(accountsDir)) {
    const p = join(accountsDir, acct, "account-credentials.enc");
    if (existsSync(p)) encs.push(p);
  }
  if (encs.length === 0) throw new Error("mine: no account-credentials.enc found (not logged in?)");
  encs.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  const key = readKeyringSafeStorageKey();
  if (!key) throw new Error("mine: no keyring 'Safe Storage' secret reachable (is a keyring daemon running? is the user's keyring unlocked?)");
  const pw = pbkdf2Sync(key, Buffer.from("saltysalt"), 1, 16, "sha1");
  const parsed = JSON.parse(decryptSafeStorage(readFileSync(encs[0]), pw)) as EncryptedCredential;
  if (!parsed.accessToken || !parsed.refreshToken) throw new Error("mine: credential blob missing tokens");
  return parsed;
}

function readDeviceId(configDir: string): string {
  try {
    const doc = JSON.parse(readFileSync(join(configDir, "device", "device-id.json"), "utf8")) as { deviceId?: string };
    if (doc.deviceId) return doc.deviceId;
  } catch { /* fallthrough */ }
  throw new Error("mine: device-id.json unreadable in the user's AutoClaw config");
}

function readChannel(configDir: string, fallback: string): string {
  try {
    const doc = JSON.parse(readFileSync(join(configDir, "channel.json"), "utf8")) as { channel?: string };
    if (doc.channel) return doc.channel;
  } catch { /* fallthrough */ }
  return fallback;
}

/** Build the complete plan from the user's own installation. Throws with honest reasons. */
export function minePlan(opts: MineOptions = {}): AutoclawPlan {
  const home = opts.home ?? homedir();
  const appDir = opts.appDir ?? findAutoClawAppDir(home);
  if (!appDir) throw new Error("mine: AutoClaw app not found on this machine (install/run the official app once, or set AUTOCLAW_APP_DIR)");
  const configDirPath = opts.configDir ?? findAutoClawConfigDir(home);
  if (!configDirPath) throw new Error("mine: AutoClaw config dir not found (launch the official app once, or set AUTOCLAW_CONFIG_DIR)");

  const bundle = mineBundle(appDir);
  const cred = decryptCredentials(configDirPath);
  const channel = readChannel(configDirPath, bundle.channelDefault);
  const overseas = /oversea/i.test(configDirPath);
  const client: PlanClient = {
    version: bundle.version,
    lang: "en-US",
    channel,
    traceSource: `${bundle.identity.product}-desktop`,
  };
  return {
    schemaVersion: 1,
    minedFrom: appDir,
    minedAt: (opts.now ?? (() => new Date()))().toISOString(),
    identity: bundle.identity,
    endpoint: {
      base: overseas ? bundle.origins.overseas : bundle.origins.release,
      proxyPath: bundle.proxyPath,
      modelConfigPath: bundle.modelConfigPath,
    },
    auth: {
      accessToken: cred.accessToken,
      refreshToken: cred.refreshToken,
      deviceId: readDeviceId(configDirPath),
      updatedAt: cred.updatedAt ?? new Date().toISOString(),
    },
    refresh: { path: bundle.refresh.path, fallbackPath: bundle.refresh.fallbackPath, sourceId: bundle.identity.product },
    client,
    pi: bundle.piVersion ? { version: bundle.piVersion } : undefined,
  };
}
