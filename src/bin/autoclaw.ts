// zcode-tui autoclaw — drive the AutoClaw plan headlessly (unofficial client).
//
// SEPARATION BOUNDARY (owner 2026-10-23, spec §12): zcode-tui ships NO logins
// and NO AutoClaw/ZCode code. The user authenticates the official apps on
// their own machine; `zcode-tui autoclaw setup` MINES the plan wiring and
// credentials from that installation into the user's autoclaw-plan.json, and
// the auth-sync plane replicates that user-owned file across the fleet. This
// module embeds only procedure.
//
// Two run paths:
//   managed (plan file present): local signing proxy (src/autoclaw/proxy.ts)
//     + the pi coding agent pointed at it. pi comes from the user's own
//     AutoClaw install when present, else an explicitly user-invoked vendor
//     install of the public @earendil-works/pi-coding-agent package (owner
//     approved 2026-10-23) into the user's own data dir.
//   legacy (no plan): ssh to the desktop host and exec its pi CLI with a
//     provisioned apiKey (pre-managed behavior, kept for degradation).
//
//   zcode-tui autoclaw setup [--app-dir D] [--config-dir D] [--vendor]
//   zcode-tui autoclaw proxy [--port N] [--host H]
//   zcode-tui autoclaw credential <status|refresh>
//   zcode-tui autoclaw run --content-file F [--workspace W] [--model M] [--out O] [--vendor]
//   zcode-tui autoclaw doctor [--json]
import { parseArgs } from "node:util";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { readPlan, writePlan, planFingerprint, PLAN_FILE, type AutoclawPlan } from "../autoclaw/plan";
import { minePlan } from "../autoclaw/mine";
import { refreshCredential, fetchModelCatalog } from "../autoclaw/gateway";
import { startManagedProxy } from "../autoclaw/proxy";
import { startHeartbeat } from "../queue/heartbeat";

let stopHb: (() => void) | null = null;

export const UNATTENDED_PREAMBLE = `You are running UNATTENDED (no human will answer).
- Do not ask questions, do not request confirmation, do not enter plan mode; choose the sensible default and proceed to implement immediately.
- Never declare work done that you have not executed: run the checks the task implies and read the real output.
- Do not break what already works; if existing tests passed before your change, they must pass after it.
- Before your final summary, re-read the original task once and check each requirement against what you delivered, then stop.
- Write deliverables to their final path as soon as a check passes; state honestly what remains if you must stop early.`;

export function autoclawPiCli(): string | null {
  const override = process.env.AUTOCLAW_PI_CLI;
  if (override) return existsSync(override) ? override : null;
  const runtimeRoot = join(homedir(), ".appimages", "runtime");
  try {
    const stamps = readdirStamps(runtimeRoot);
    for (const s of stamps) {
      const cli = join(runtimeRoot, s,
        "resources", "app", "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js");
      if (existsSync(cli)) return cli;
    }
  } catch { /* no runtime dir */ }
  return vendoredPiCli();
}

/** The user-invoked vendor install (public npm package in the user's data dir). */
export function vendoredPiCli(home = homedir()): string | null {
  const cli = join(home, ".local", "share", "zcode-tui", "vendor", "pi",
    "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js");
  return existsSync(cli) ? cli : null;
}

/**
 * Optional vendor path (owner approved 2026-10-23): install the PUBLIC pi
 * package into the user's own data dir, pinned to the version the user's own
 * AutoClaw app ships. Explicit, never implicit — zcode-tui installs nothing
 * on its own.
 */
export function vendorPi(plan: AutoclawPlan, home = homedir()): { ok: boolean; detail: string } {
  const dir = join(home, ".local", "share", "zcode-tui", "vendor", "pi");
  mkdirSync(dir, { recursive: true });
  const pkg = join(dir, "package.json");
  if (!existsSync(pkg)) writeFileSync(pkg, JSON.stringify({ name: "zcode-tui-vendor-pi", private: true }, null, 2) + "\n");
  const version = plan.pi?.version ? `@${plan.pi.version}` : "";
  // process.execPath IS bun here (all zcode-tui bins run under bun) — dev's
  // non-interactive PATH has no bare `bun` (measured 2026-10-23).
  const p = Bun.spawnSync([process.execPath, "add", `@earendil-works/pi-coding-agent${version}`], {
    cwd: dir, stdout: "pipe", stderr: "pipe",
  });
  const cli = vendoredPiCli(home);
  if (p.exitCode === 0 && cli) return { ok: true, detail: `vendored pi${version ? ` ${plan.pi?.version}` : " (latest)"} at ${dir}` };
  return { ok: false, detail: `bun add failed rc=${p.exitCode}: ${new TextDecoder().decode(p.stderr).slice(-300)}` };
}

export function autoclawCredential(): string {
  if (process.env.AUTOCLAW_API_KEY) return process.env.AUTOCLAW_API_KEY;
  try {
    const auth = JSON.parse(readFileSync(join(homedir(), ".config", "zcode-tui", "auth.json"), "utf8"));
    const key = auth?.providers?.autoclaw?.apiKey;
    return typeof key === "string" && key ? key : "";
  } catch { return ""; }
}

function readdirStamps(dir: string): string[] {
  const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
  return readdirSync(dir).filter((f) => statSync(join(dir, f)).isDirectory()).sort().reverse();
}

const PI_AGENT_DIR = () => join(process.env.HOME ?? homedir(), ".local", "state", "zcode-tui", "pi-agent");
const CATALOG_CACHE = () => join(process.env.HOME ?? homedir(), ".local", "state", "zcode-tui", "autoclaw-model-catalog.json");

// Mined from the AutoClaw 2.0.3 runtime (docs/spec-zcode-feature-carryforward.md
// §12; zai_auto is UI-only and 406s on the managed plane, so it is excluded).
// The live catalog fetch is plan-capacity-gated (810001/406 at peak), so
// worker runs fall back to these known ids instead of refusing.
const FALLBACK_MODELS = ["zaicoding_glm-5.3", "zai_glm-5.3-flash", "zai_auto-fast"];
export function resolveManagedModel(explicit: string, models: { id: string }[]): string {
  return explicit || models[0]?.id || FALLBACK_MODELS[0];
}

async function cmdSetup(v: Record<string, string | boolean | undefined>): Promise<number> {
  let plan = readPlan();
  if (!plan || v["app-dir"] || v["config-dir"]) {
    try {
      plan = minePlan({
        appDir: v["app-dir"] ? String(v["app-dir"]) : undefined,
        configDir: v["config-dir"] ? String(v["config-dir"]) : undefined,
      });
      writePlan(plan);
    } catch (e) {
      if (!plan) { console.error(`setup failed: ${(e as Error).message}`); return 1; }
      console.error(`setup: mining skipped on this host (${(e as Error).message.split(" — ")[0]}) — using the synced plan`);
    }
  }
  console.log(`setup: plan ready -> ${PLAN_FILE}`);
  console.log(`  endpoint: ${plan.endpoint.base} (mined from ${plan.minedFrom})`);
    console.log(`  credential: updatedAt ${plan.auth.updatedAt}, deviceId ${plan.auth.deviceId.slice(0, 8)}…`);
    const cat = await fetchModelCatalog(plan);
    if (cat.ok) {
      mkdirSync(dirname(CATALOG_CACHE()), { recursive: true });
      writeFileSync(CATALOG_CACHE(), JSON.stringify({ fetchedAt: new Date().toISOString(), models: cat.models }, null, 2) + "\n");
    console.log(`  catalog: ${cat.models.map((m) => m.id).join(", ")}`);
  } else {
      console.log(`  catalog: unavailable (${typeof cat.failure === "string" ? cat.failure : cat.failure.kind}) — cached copy, explicit --model, or the builtin fallback ids still work`);
  }
  if (autoclawPiCli()) {
    console.log(`  pi harness: ${autoclawPiCli()}`);
  } else if (v.vendor) {
    console.log(`  vendor: ${vendorPi(plan).detail}`);
  } else {
    console.log(`  pi harness: not found on this host — rerun with --vendor to install the public @earendil-works/pi-coding-agent package (pinned to your app's pi ${plan.pi?.version ?? "latest"})`);
  }
  return 0;
}

async function cmdProxy(v: Record<string, string | boolean | undefined>): Promise<number> {
  const plan = readPlan();
  if (!plan) { console.error("proxy: no plan file (run `zcode-tui autoclaw setup` on the machine with your AutoClaw app)"); return 1; }
  const proxy = await startManagedProxy(plan, {
    port: v.port ? Number(v.port) : 8731,
    hostname: v.host ? String(v.host) : "127.0.0.1",
  });
  console.log(`proxy: http://${proxy.hostname}:${proxy.port} -> ${plan.endpoint.base}${plan.endpoint.proxyPath} (ctrl-c to stop)`);
  const shutdown = () => { proxy.stop(); process.exit(0); };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  await new Promise(() => { /* serve until signal */ });
  return 0;
}

async function cmdCredential(sub: string): Promise<number> {
  const plan = readPlan();
  if (!plan) { console.error(`credential: no plan file at ${PLAN_FILE}`); return 1; }
  if (sub === "refresh") {
    const r = await refreshCredential(plan);
    if (r.ok) { console.log("credential: refreshed + persisted"); return 0; }
    console.error(`credential: refresh failed (${r.failureClass}): ${r.detail}`);
    return 1;
  }
  const ageH = Math.round((Date.now() - Date.parse(plan.auth.updatedAt)) / 360_000) / 10;
  console.log(`plan:        ${PLAN_FILE}`);
  console.log(`fingerprint: ${planFingerprint(plan)}`);
  console.log(`endpoint:    ${plan.endpoint.base}${plan.endpoint.proxyPath}`);
  console.log(`credential:  updatedAt ${plan.auth.updatedAt} (~${ageH}h old)`);
  console.log(`minedFrom:   ${plan.minedFrom} at ${plan.minedAt}`);
  return 0;
}

function doctor(json: boolean): number {
  const cli = autoclawPiCli();
  const plan = readPlan();
  const legacyCred = autoclawCredential();
  const state = {
    plan: plan
      ? { found: true, file: PLAN_FILE, fingerprint: planFingerprint(plan), endpoint: `${plan.endpoint.base}${plan.endpoint.proxyPath}`, credentialUpdatedAt: plan.auth.updatedAt, minedFrom: plan.minedFrom }
      : { found: false, hint: "run `zcode-tui autoclaw setup` on the machine with your authenticated AutoClaw app; fleet hosts receive it via auth sync" },
    harness: cli ? { found: true, piCli: cli } : { found: false, hint: "no appimage pi and no vendor install — `zcode-tui autoclaw setup --vendor` (public package, user-invoked)" },
    legacyCredential: { provisioned: Boolean(legacyCred) },
  };
  if (json) { console.log(JSON.stringify(state, null, 1)); return plan ? 0 : 1; }
  console.log(`plan:       ${plan ? `FOUND (${planFingerprint(plan)}) -> ${plan.endpoint.base}` : "MISSING — run `zcode-tui autoclaw setup` where your AutoClaw app is authenticated"}`);
  console.log(`harness:    ${cli ? `FOUND ${cli}` : "NOT FOUND (setup --vendor installs the public pi package)"}`);
  console.log(`legacyKey:  ${legacyCred ? "provisioned" : "absent (fine when the plan file exists)"}`);
  return plan && cli ? 0 : 1;
}

async function readStdin(): Promise<string> {
  return new Promise<string>((r) => { let s = ""; process.stdin.on("data", (d) => s += d); process.stdin.on("end", () => r(s)); });
}

/** Write the isolated pi agent dir (PI_CODING_AGENT_DIR) pointing at the local proxy. */
function writePiProviderConfig(port: number, models: { id: string; contextWindow: number; maxTokens: number; reasoning: boolean }[], defaultModel: string): string {
  const dir = PI_AGENT_DIR();
  mkdirSync(dir, { recursive: true });
  const cfg = {
    providers: {
      autoclaw: {
        name: "AutoClaw (managed by zcode-tui)",
        // pi's openai-completions client appends /chat/completions to the
        // baseUrl, so /v1 lives here — landing on the proxy's allowlisted path
        baseUrl: `http://127.0.0.1:${port}/v1`,
        apiKey: "managed-by-zcode-tui",
        // the managed plane speaks openai-completions (desktop model_connections
        // protocol field, live-measured 2026-10-25); anthropic-messages 401s there
        api: "openai-completions",
        models: models.map((m) => ({
          id: m.id,
          name: m.id,
          reasoning: m.reasoning,
          contextWindow: m.contextWindow || 262_144,
          maxTokens: m.maxTokens || 32_768,
        })),
      },
    },
    defaultModel,
  };
  writeFileSync(join(dir, "models.json"), JSON.stringify(cfg, null, 2) + "\n");
  return dir;
}

async function runManaged(plan: AutoclawPlan, brief: string, workspace: string, model: string, out: string): Promise<number> {
  const proxy = await startManagedProxy(plan, { port: 0 });
  try {
    let models: { id: string; contextWindow: number; maxTokens: number; reasoning: boolean }[] = [];
    const cat = await fetchModelCatalog(plan);
    if (cat.ok) {
      models = cat.models;
      mkdirSync(dirname(CATALOG_CACHE()), { recursive: true });
      writeFileSync(CATALOG_CACHE(), JSON.stringify({ fetchedAt: new Date().toISOString(), models }, null, 2) + "\n");
    } else {
      try { models = (JSON.parse(readFileSync(CATALOG_CACHE(), "utf8")) as { models: typeof models }).models ?? []; } catch { /* none */ }
    }
    if (model && !models.some((m) => m.id === model)) {
      models = [{ id: model, contextWindow: 262_144, maxTokens: 32_768, reasoning: true }, ...models];
    }
    const defaultModel = resolveManagedModel(model, models);
    if (models.length === 0) {
      // pi registers a provider through its models array: an empty one makes
      // --provider autoclaw fail with "Unknown provider" even though the
      // default id is set. Seed the mined ids so the config is self-consistent.
      models = FALLBACK_MODELS.map((id) => ({ id, contextWindow: 262_144, maxTokens: 32_768, reasoning: true })); // owner law: max thinking
      console.error(`autoclaw run: catalog unavailable (live fetch failed, no cache) — seeding fallback ids, default ${defaultModel}`);
    }
    const agentDir = writePiProviderConfig(proxy.port, models, defaultModel);

    const cli = autoclawPiCli();
    if (!cli) { console.error("autoclaw run: pi harness not found — `zcode-tui autoclaw setup --vendor` (public package) or install the official app"); return 1; }
    const args = [
      cli, "--print", "--mode", "json",
      "--provider", "autoclaw",
      "--model", defaultModel,
      "--append-system-prompt", UNATTENDED_PREAMBLE,
      brief,
    ];
    const { spawn } = await import("node:child_process");
    const t0 = Date.now();
    stopHb = startHeartbeat(`${out}.hb`);
const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
      const p = spawn(process.execPath, args, {
        cwd: workspace,
        env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "", stderr = "";
      const cap = 8 << 20;
      p.stdout.on("data", (d: Buffer) => { if (stdout.length < cap) stdout += d.toString(); });
      p.stderr.on("data", (d: Buffer) => { if (stderr.length < cap) stderr += d.toString(); });
      const timer = setTimeout(() => p.kill("SIGKILL"), 45 * 60_000);
      // Without this, a failed spawn (ENOENT etc.) never fires "close" and
      // the executor hangs forever on a child that does not exist (trial
      // zombie, 2026-10-23): fail honestly instead.
      let done = false;
      const finish = (code: number | null, note?: string) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve({ code, stdout, stderr: note ? `${stderr}\n${note}` : stderr });
      };
      p.on("error", (e: Error) => finish(null, `spawn error: ${e.message}`));
      p.on("close", (code) => finish(code));
    });
  stopHb?.();
  stopHb = null;
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify({ cli, agentDir, proxyPort: proxy.port, workspace, model: defaultModel, elapsedSec: (Date.now() - t0) / 1000, rc: result.code, stdout: result.stdout.slice(-200_000), stderr: result.stderr.slice(-20_000) }, null, 1));
    console.log(`autoclaw run: rc=${result.code} in ${Math.round((Date.now() - t0) / 1000)}s -> ${out}`);
    if (result.code === 0 && piEventStreamHasError(result.stdout)) {
      // pi --print exits 0 even when the provider errored (measured
      // 2026-10-23: stopReason "error", "406 status code (no body)", zero
      // tokens, rc 0) — a zero-work run must never ride home as completed.
      const m = result.stdout.match(/"errorMessage":"([^"]{0,200})"/);
      console.error(`autoclaw run: provider error inside pi event stream${m ? `: ${m[1]}` : ""}`);
      return 1;
    }
    return result.code === 0 ? 0 : 1;
  } finally {
    proxy.stop();
  }
}

/** True when the pi --mode json event stream carries a provider error turn. */
export function piEventStreamHasError(stdout: string): boolean {
  return /"stopReason"\s*:\s*"error"/.test(stdout);
}

async function runBrief(v: Record<string, string | boolean | undefined>): Promise<number> {
  const pf = String(v["content-file"] ?? "");
  if (!pf) { console.error("autoclaw run: --content-file is required (- reads stdin)"); return 2; }
  const brief = pf === "-" ? await readStdin() : readFileSync(pf, "utf8");
  const workspace = v.workspace ? String(v.workspace) : process.cwd();
  const model = v.model ? String(v.model) : "";
  const out = v.out ? String(v.out) : "/tmp/zt-autoclaw-run.json";

  const plan = readPlan();
  if (plan) return runManaged(plan, brief, workspace, model, out);

  // Legacy path: desktop-host pi CLI + provisioned plan apiKey (pre-managed).
  const cli = autoclawPiCli();
  if (!cli) { console.error("autoclaw run: harness not found (see `zcode-tui autoclaw doctor`)"); return 1; }
  const key = autoclawCredential();
  if (!key) { console.error("autoclaw run: no plan file and no legacy credential (see `zcode-tui autoclaw doctor`)"); return 3; }
  const { spawn } = await import("node:child_process");
  const args = [
    cli, "--print", "--mode", "json",
    "--provider", "autoclaw",
    "--append-system-prompt", UNATTENDED_PREAMBLE,
    "-C", workspace,
  ];
  if (model) args.push("--model", model);
  args.push(brief);
  const t0 = Date.now();
  stopHb = startHeartbeat(`${out}.hb`);
const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    const p = spawn(process.execPath, args, {
      cwd: workspace,
      env: { ...process.env, AUTOCLAW_API_KEY: key },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "", stderr = "";
    const cap = 8 << 20;
    p.stdout.on("data", (d: Buffer) => { if (stdout.length < cap) stdout += d.toString(); });
    p.stderr.on("data", (d: Buffer) => { if (stderr.length < cap) stderr += d.toString(); });
    const timer = setTimeout(() => p.kill("SIGKILL"), 45 * 60_000);
    p.on("close", (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
  stopHb?.();
  stopHb = null;
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ cli, workspace, model, elapsedSec: (Date.now() - t0) / 1000, rc: result.code, stdout: result.stdout.slice(-200_000), stderr: result.stderr.slice(-20_000) }, null, 1));
  console.log(`autoclaw run: rc=${result.code} in ${Math.round((Date.now() - t0) / 1000)}s -> ${out}`);
  return result.code === 0 ? 0 : 1;
}

export async function main(): Promise<void> {
  // parseArgs at entry time, never module level: module-level parsing throws
  // on other verbs' argv when this module is imported (queue.ts did that;
  // production bug caught by the 1.0.0 trial run, 2026-10-23) and the
  // compiled binary's verb router imports it the same way.
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      "content-file": { type: "string" },
      workspace: { type: "string" },
      model: { type: "string" },
      out: { type: "string" },
      json: { type: "boolean", default: false },
      "app-dir": { type: "string" },
      "config-dir": { type: "string" },
      vendor: { type: "boolean", default: false },
      port: { type: "string" },
      host: { type: "string" },
    },
  });
  const sub = String(positionals[0] ?? "");
  const v = values as Record<string, string | boolean | undefined>;
  if (sub === "doctor") process.exit(doctor(Boolean(values.json)));
  else if (sub === "run") process.exit(await runBrief(v));
  else if (sub === "setup") process.exit(await cmdSetup(v));
  else if (sub === "proxy") process.exit(await cmdProxy(v));
  else if (sub === "credential") process.exit(await cmdCredential(String(positionals[1] ?? "status")));
  else {
    console.error("usage: zcode-tui autoclaw <setup|proxy|credential|doctor|run> [...]");
    console.error("  setup [--app-dir D] [--config-dir D] [--vendor]  mine the plan from your own AutoClaw install");
    console.error("  proxy [--port N] [--host H]                       serve the local signing gateway");
    console.error("  credential <status|refresh>                        plan credential state / rotation");
    console.error("  doctor [--json]                                    plan + harness state");
    console.error("  run --content-file F [--workspace W] [--model M] [--out O]");
    process.exit(2);
  }
}

if (import.meta.main) {
  void main();
}
