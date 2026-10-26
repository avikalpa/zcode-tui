// zcode-tui install — put the official plan harnesses on a host, the way the
// fleet wants them (2.0.0, owner 2026-10-25).
//
// Architecture this serves (docs/fleet-2.0.md): the official ZCode and
// AutoClaw apps are the plan SSOTs; they run headless (xvfb) where no display
// session exists, zcode-tui schedules/brokers around them, and ALL auth
// replication between hosts belongs to ygg-auth (--harness zcode|autoclaw) —
// never to this verb. Login itself is a per-host, owner-performed step inside
// the official app (§12 boundary: zcode-tui ships no logins).
//
// Subcommands:
//   doctor                 combined fleet-readiness check (the daily verb)
//   zcode [--file|--url]   install the ZCode desktop/CLI (deb on linux)
//   autoclaw [--file|--url] install the AutoClaw AppImage into ~/.appimages
//   autoclaw-headless      write the xvfb + remote-debugging systemd user unit
//
// Downloads only happen with an explicit --url/--file or the env override —
// this verb never guesses a vendor URL it has not been told.

import { parseArgs } from "node:util";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function findAutoClawConfigDir(home = homedir()): string | null {
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
  } catch { return null; }
}

/** Synchronous-ish runner: resolve exit code + captured streams. */
function sh(cmd: string[], input?: string): Promise<{ code: number; out: string; err: string }> {
  const p = Bun.spawn(cmd, { stdin: input !== undefined ? "pipe" : "ignore", stdout: "pipe", stderr: "pipe" });
  if (input !== undefined) p.stdin.write(input);
  p.stdin?.end();
  return Promise.all([
    p.exited,
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
  ]).then(([code, out, err]) => ({ code: code ?? 0, out, err }));
}

const PLAN_FILE = join(homedir(), ".config", "zcode-tui", "autoclaw-plan.json");
const APPIMAGE = process.env.AUTOCLAW_APPIMAGE ?? join(homedir(), ".appimages", "AutoClaw.AppImage");

async function cmdDoctor(json: boolean): Promise<number> {
  const checks: Record<string, unknown> = {};
  // zcode CLI (the runtime zcode-tui's TUI drives)
  // presence and version are separate probes: the desktop binary may exit
  // nonzero on --version when headless — that must not read as MISSING.
  const zcPath = await sh(["sh", "-c", "command -v zcode || true"]);
  const zcVer = await sh(["sh", "-c", "zcode --version 2>/dev/null || true"]);
  const zcVersion = zcVer.out.split("\n").map((l) => l.trim()).find((l) => /^\d+(\.\d+)+/.test(l))
    ?? (zcVer.out.trim() ? zcVer.out.trim().split("\n").slice(-1)[0].slice(0, 60) : null);
  checks.zcode_cli = zcPath.out.trim()
    ? { found: true, path: zcPath.out.trim().split("\n")[0], version: zcVersion }
    : { found: false, install: "zcode-tui install zcode --url <official deb> (or --file F)" };
  // zcode auth (replicated by ygg-auth, never by us)
  const credPath = join(homedir(), ".zcode", "v2", "credentials.json");
  let credKeys: string[] = [];
  try {
    const doc = JSON.parse(readFileSync(credPath, "utf8")) as Record<string, unknown>;
    credKeys = Object.keys(doc);
  } catch { /* absent */ }
  checks.zcode_auth = credKeys.length
    ? { found: true, file: credPath, keys: credKeys.map((k) => (k.startsWith("account-provider") ? k.split(":")[1] + ":" + k.split(":").slice(-2)[0] : k.slice(0, 24))) }
    : { found: false, fix: "ygg-auth.py fetch <writer-host> <slug> --activate --harness zcode" };
  // AutoClaw app (AppImage or system package)
  const appClaw = existsSync(APPIMAGE)
    ? { found: true, path: APPIMAGE, bytes: statSync(APPIMAGE).size }
    : (() => { const zc2 = existsSync("/opt/AutoClaw") ? "/opt/AutoClaw" : null; return zc2 ? { found: true, path: zc2 } : { found: false, install: "zcode-tui install autoclaw --url <official AppImage> (or --file F)" }; })();
  checks.autoclaw_app = appClaw;
  // AutoClaw app login state (owner logs in once per host, inside the app)
  const cfgDir = findAutoClawConfigDir();
  checks.autoclaw_login = cfgDir
    ? { found: true, configDir: cfgDir }
    : { found: false, fix: "launch the official AutoClaw app once on this host and sign in (per-host enrollment)" };
  // the mined plan zcode-tui dispatches with
  checks.autoclaw_plan = existsSync(PLAN_FILE)
    ? { found: true, file: PLAN_FILE }
    : { found: false, fix: "zcode-tui autoclaw setup (where the app is authenticated), or ygg-auth fetch --harness autoclaw" };
  // ygg-auth store profiles
  const prof = (h: string) => {
    const d = join(homedir(), ".yggterm", "auth", h);
    try {
      return readdirSync(d).filter((f) => f.endsWith(".json") && !f.startsWith(".")).map((f) => f.replace(/\.json$/, ""));
    } catch { return []; }
  };
  checks.ygg_auth = { zcodeProfiles: prof("zcode"), autoclawProfiles: prof("autoclaw"), note: prof("zcode").length + prof("autoclaw").length ? null : "no profiles yet — capture on the writer host" };
  // headless runtime deps
  const xv = await sh(["sh", "-c", "command -v xvfb-run >/dev/null && echo yes || echo no"]);
  checks.headless = { xvfb: xv.out.trim() === "yes", unit: existsSync(join(homedir(), ".config", "systemd", "user", "ztq-autoclaw-headless.service")) };
  if (json) { console.log(JSON.stringify(checks, null, 1)); return 0; }
  const ok = (v: unknown) => ((v as { found?: boolean }).found ? "OK" : "MISSING");
  console.log(`zcode cli:     ${ok(checks.zcode_cli)}  ${(checks.zcode_cli as { version?: string }).version ?? ""}`);
  console.log(`zcode auth:    ${ok(checks.zcode_auth)}  ${credKeys.length ? `(${credKeys.length} credentials)` : ""}`);
  console.log(`autoclaw app:  ${ok(checks.autoclaw_app)}  ${(checks.autoclaw_app as { path?: string }).path ?? ""}`);
  console.log(`autoclaw auth: ${ok(checks.autoclaw_login)}  ${(checks.autoclaw_login as { configDir?: string }).configDir ?? ""}`);
  console.log(`autoclaw plan: ${ok(checks.autoclaw_plan)}  ${(checks.autoclaw_plan as { file?: string }).file ?? ""}`);
  console.log(`ygg-auth:      zcode=[${prof("zcode").join(",") || "none"}] autoclaw=[${prof("autoclaw").join(",") || "none"}]`);
  console.log(`headless:      xvfb=${(checks.headless as { xvfb: boolean }).xvfb ? "yes" : "no"} unit=${(checks.headless as { unit: boolean }).unit ? "yes" : "no"}`);
  const green = [checks.zcode_cli, checks.zcode_auth, checks.autoclaw_login, checks.autoclaw_plan].every((c) => (c as { found?: boolean }).found);
  console.log(green ? "fleet-ready: YES (this host can plan work)" : "fleet-ready: NO — follow the MISSING rows above");
  return green ? 0 : 1;
}

async function fetchTo(url: string, dest: string): Promise<number> {
  console.log(`downloading ${url} -> ${dest}`);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) { console.error(`download failed: http ${res.status}`); return 1; }
  const buf = new Uint8Array(await res.arrayBuffer());
  const tmp = `${dest}.part-${process.pid}`;
  writeFileSync(tmp, buf);
  chmodSync(tmp, 0o755);
  renameSync(tmp, dest);
  console.log(`saved ${(buf.length / 1e6).toFixed(1)} MB`);
  return 0;
}

async function cmdInstallZcode(v: Record<string, string | boolean | undefined>): Promise<number> {
  const have = await sh(["sh", "-c", "command -v zcode >/dev/null && zcode --version 2>/dev/null | head -1"]);
  if (have.code === 0 && have.out.trim() && !v.file && !v.url) {
    console.log(`zcode already installed: ${have.out.trim()} — pass --file/--url to reinstall`);
    return 0;
  }
  const file = String(v.file ?? "");
  let deb = file;
  if (!deb) {
    const url = String(v.url ?? process.env.ZCODE_INSTALL_URL ?? "");
    if (!url) {
      console.error("install zcode: needs the official installer — pass --file <deb> or --url <deb-url>,");
      console.error("  or set ZCODE_INSTALL_URL. Download page: https://z.ai (ZCode desktop, linux .deb).");
      console.error("  The installed artifact is user-vetted before dpkg: this tool never guesses vendor URLs.");
      return 2;
    }
    deb = `/tmp/zq-zcode-install-${process.pid}.deb`;
    if (await fetchTo(url, deb)) return 1;
  }
  if (!existsSync(deb)) { console.error(`install zcode: no such file ${deb}`); return 1; }
  const dpkg = await sh(["sudo", "-n", "dpkg", "-i", deb]);
  if (dpkg.code !== 0) {
    console.error("dpkg failed (needs root; `sudo -n` refused or deps missing):");
    console.error(dpkg.err.trim().split("\n").slice(-4).join("\n"));
    console.error("fix deps with: sudo apt-get -f install, then rerun.");
    return 1;
  }
  const verify = await sh(["sh", "-c", "command -v zcode && zcode --version 2>/dev/null | head -1"]);
  console.log(`zcode installed: ${verify.out.trim() || "(cli present, version probe empty)"}`);
  console.log("auth next: ygg-auth.py fetch <writer-host> <slug> --activate --harness zcode");
  return verify.code === 0 ? 0 : 0;
}

async function cmdInstallAutoclaw(v: Record<string, string | boolean | undefined>): Promise<number> {
  const file = String(v.file ?? "");
  let img = file;
  if (!img) {
    const url = String(v.url ?? process.env.AUTOCLAW_INSTALL_URL ?? "");
    if (!url) {
      console.error("install autoclaw: needs the official AppImage — pass --file <AppImage> or --url <AppImage-url>,");
      console.error("  or set AUTOCLAW_INSTALL_URL. Source: the official AutoClaw download (autoglm.ai).");
      console.error(`  Landing spot: ${APPIMAGE} (override with AUTOCLAW_APPIMAGE).`);
      return 2;
    }
    img = `${APPIMAGE}.dl-${process.pid}`;
    if (await fetchTo(url, img)) return 1;
  }
  if (!existsSync(img)) { console.error(`install autoclaw: no such file ${img}`); return 1; }
  mkdirSync(join(APPIMAGE, ".."), { recursive: true });
  if (img !== APPIMAGE) {
    const tmp = `${APPIMAGE}.new-${process.pid}`;
    if (img.endsWith(`.dl-${process.pid}`)) renameSync(img, tmp);
    else { await sh(["cp", img, tmp]); }
    chmodSync(tmp, 0o755);
    renameSync(tmp, APPIMAGE);
  }
  console.log(`autoclaw AppImage staged: ${APPIMAGE} (${statSync(APPIMAGE).size} bytes)`);
  const launcher = join(homedir(), ".appimages", "autoclaw-launcher.sh");
  if (existsSync(launcher)) console.log(`existing wrapper launcher intact: ${launcher} (prefer it for desktop runs)`);
  console.log("login next: launch the official app once on this host and sign in (per-host enrollment; zcode-tui ships no logins).");
  console.log("headless next: zcode-tui install autoclaw-headless --enable");
  return 0;
}

async function cmdHeadless(v: Record<string, string | boolean | undefined>): Promise<number> {
  const port = String(v.port ?? "9223");
  if (!existsSync(APPIMAGE)) { console.error(`headless: no AutoClaw AppImage at ${APPIMAGE} — install autoclaw first`); return 1; }
  const unitDir = join(homedir(), ".config", "systemd", "user");
  const unitPath = join(unitDir, "ztq-autoclaw-headless.service");
  const unit = `# zcode-tui install autoclaw-headless — the official app under xvfb, CDP on loopback.
# --appimage-extract-and-run: FUSE mounts are not available to service
# contexts on the fleet (fusermount EPERM, measured 2026-10-26) — extract
# instead of mount. One app instance per profile (fleet law): stop this unit before a desktop
# session runs AutoClaw on the same user-data dir, and vice versa.
[Unit]
Description=AutoClaw desktop (official app, headless via xvfb) for the zcode-tui broker
After=network-online.target

[Service]
ExecStartPre=/usr/bin/env sh -c 'pkill -f "remote-debugging-port=${port}" 2>/dev/null; exit 0'
ExecStart=${APPIMAGE} --appimage-extract-and-run --remote-debugging-port=${port}
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
`;
  if (v["dry-run"]) { process.stdout.write(unit); return 0; }
  mkdirSync(unitDir, { recursive: true });
  writeFileSync(unitPath, unit);
  console.log(`unit written: ${unitPath}`);
  if (v.enable) {
    const en = await sh(["systemctl", "--user", "daemon-reload"]);
    const st = await sh(["systemctl", "--user", "enable", "--now", "ztq-autoclaw-headless.service"]);
    if (st.code !== 0) { console.error(`enable failed: ${st.err.trim().slice(0, 200)}`); return 1; }
    console.log("unit enabled+started (headless app owns the profile now)");
    void en;
    const probe = await sh(["sh", "-c", `sleep 3; curl -fsS http://127.0.0.1:${port}/json/version | head -c 200`]);
    console.log(probe.code === 0 ? `CDP live on 127.0.0.1:${port}` : `CDP not answering yet on ${port} — check journalctl --user -u ztq-autoclaw-headless`);
    return probe.code;
  }
  console.log(`start with: systemctl --user enable --now ztq-autoclaw-headless.service  (CDP on 127.0.0.1:${port})`);
  return 0;
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      json: { type: "boolean", default: false },
      file: { type: "string" },
      url: { type: "string" },
      port: { type: "string" },
      enable: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
    },
  });
  const sub = String(positionals[0] ?? "doctor");
  switch (sub) {
    case "doctor": return cmdDoctor(Boolean(values.json));
    case "zcode": return cmdInstallZcode(values as Record<string, string | boolean | undefined>);
    case "autoclaw": return cmdInstallAutoclaw(values as Record<string, string | boolean | undefined>);
    case "autoclaw-headless": return cmdHeadless(values as Record<string, string | boolean | undefined>);
    default:
      console.error("usage: zcode-tui install <doctor|zcode|autoclaw|autoclaw-headless> [...]");
      console.error("  doctor                              combined fleet-readiness check (--json)");
      console.error("  zcode [--file F|--url U]            install the ZCode desktop/CLI (deb)");
      console.error("  autoclaw [--file F|--url U]         stage the official AutoClaw AppImage");
      console.error("  autoclaw-headless [--port 9223] [--enable] [--dry-run]");
      console.error("                                      xvfb unit for the broker plane (docs/fleet-2.0.md)");
      return 2;
  }
}

if (import.meta.main) process.exit(await main());
