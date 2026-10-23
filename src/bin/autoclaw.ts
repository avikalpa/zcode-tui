// zcode-tui autoclaw — drive the AutoClaw harness headlessly (unofficial).
//
// AutoClaw (Zhipu, appimage "zwork") is a desktop shell over the pi coding
// agent (@earendil-works/pi-coding-agent — measured in the 2.0.3 runtime,
// 2026-10-23). The bundled pi CLI is fully headless: `--print`, `--mode
// json`, `--append-system-prompt`. The desktop keeps the AutoClaw-plan
// credential in its encrypted store (account-credentials.enc / credentials.enc
// via safeStorage) with NO measured export path — so headless runs need the
// owner to provision a plan API key once:
//   ~/.config/zcode-tui/auth.json  {"providers":{"autoclaw":{"apiKey":"..."}}}
//   (or env AUTOCLAW_API_KEY)
// Until then this verb fails honestly — it never touches the encrypted store.
//
//   zcode-tui autoclaw run --content-file F [--workspace W] [--model M] [--out O]
//   zcode-tui autoclaw doctor   # harness found? credential provisioned?
//
// The desktop also carries Zhipu's own "Gated Run" unattended protocol
// (four system-prompt blocks: budget discipline, turn economy, verification
// protocol, unattended work). We prepend a fleet-authored equivalent to every
// automated brief — prompt engineering cannot be confirmed to suppress the
// plan-confirmation and mid-run questions, but the interaction handlers plus
// this preamble are the levers we have (owner 2026-10-23).
import { parseArgs } from "node:util";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

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
  return null;
}

function readdirStamps(dir: string): string[] {
  const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
  return readdirSync(dir).filter((f) => statSync(join(dir, f)).isDirectory()).sort().reverse();
}

export function autoclawCredential(): string {
  if (process.env.AUTOCLAW_API_KEY) return process.env.AUTOCLAW_API_KEY;
  try {
    const auth = JSON.parse(readFileSync(join(homedir(), ".config", "zcode-tui", "auth.json"), "utf8"));
    const key = auth?.providers?.autoclaw?.apiKey;
    return typeof key === "string" && key ? key : "";
  } catch { return ""; }
}

function doctor(json: boolean): number {
  const cli = autoclawPiCli();
  const cred = autoclawCredential() ? "provisioned" : "MISSING (owner must provision a plan api key into ~/.config/zcode-tui/auth.json providers.autoclaw.apiKey)";
  const state = {
    harness: cli ? { found: true, piCli: cli } : { found: false, hint: "no ~/.appimages/runtime/<stamp> tree (run the AutoClaw desktop once on this host, or set AUTOCLAW_PI_CLI)" },
    credential: { provisioned: Boolean(autoclawCredential()), note: cred },
    planNotes: "AutoClaw Credits plan is a separate wallet from the Z.AI Coding Plan (one auth account, two harnesses — owner 2026-10-23). The desktop holds the plan credential encrypted (safeStorage); there is no measured export path.",
  };
  if (json) { console.log(JSON.stringify(state, null, 1)); return cli ? 0 : 1; }
  console.log(`harness:   ${cli ? `FOUND ${cli}` : "NOT FOUND"}`);
  console.log(`credential: ${state.credential.provisioned ? "provisioned" : cred}`);
  console.log(`plan: ${state.planNotes}`);
  return cli && state.credential.provisioned ? 0 : 1;
}

async function runBrief(v: Record<string, string | boolean | undefined>): Promise<number> {
  const pf = String(v["content-file"] ?? "");
  if (!pf) { console.error("autoclaw run: --content-file is required (- reads stdin)"); return 2; }
  const brief = pf === "-"
    ? await new Promise<string>((r) => { let s = ""; process.stdin.on("data", (d) => s += d); process.stdin.on("end", () => r(s)); })
    : readFileSync(pf, "utf8");
  const cli = autoclawPiCli();
  if (!cli) { console.error("autoclaw run: harness not found (see `zcode-tui autoclaw doctor`)"); return 1; }
  const key = autoclawCredential();
  if (!key) { console.error("autoclaw run: no plan credential provisioned (see `zcode-tui autoclaw doctor`)"); return 3; }
  const workspace = v.workspace ? String(v.workspace) : process.cwd();
  const model = v.model ? String(v.model) : "";
  const out = v.out ? String(v.out) : "/tmp/zt-autoclaw-run.json";
  // The bundled pi CLI rides the appimage's own bun/node — run it with the
  // same runtime the desktop uses (Electron's node via ELECTRON_RUN_AS_NODE
  // is what the appimage ships; plain node >= 20 also works for pi).
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
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ cli, workspace, model, elapsedSec: (Date.now() - t0) / 1000, rc: result.code, stdout: result.stdout.slice(-200_000), stderr: result.stderr.slice(-20_000) }, null, 1));
  console.log(`autoclaw run: rc=${result.code} in ${Math.round((Date.now() - t0) / 1000)}s -> ${out}`);
  return result.code === 0 ? 0 : 1;
}

if (import.meta.main) {
  // parseArgs INSIDE the guard: module-level parsing throws on other
  // verbs' argv when queue.ts imports this module (production bug caught
  // by the 1.0.0 trial run, 2026-10-23).
  const { values } = parseArgs({
    allowPositionals: true,
    options: {
      "content-file": { type: "string" },
      workspace: { type: "string" },
      model: { type: "string" },
      out: { type: "string" },
      json: { type: "boolean", default: false },
    },
  });
  const sub = String(process.argv[2] ?? "");
  if (sub === "doctor") process.exit(doctor(Boolean(values.json)));
  else if (sub === "run") process.exit(await runBrief(values as Record<string, string | boolean | undefined>));
  else {
    console.error("usage: zcode-tui autoclaw <doctor|run> [...]");
    console.error("  doctor [--json]   harness + credential state");
    console.error("  run --content-file F [--workspace W] [--model M] [--out O]");
    process.exit(2);
  }
}
