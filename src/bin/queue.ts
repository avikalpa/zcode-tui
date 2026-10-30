// zcode-tui queue — the fleet worker queue (owner directive 2026-10-22).
// Native in-repo dispatcher: enqueue/list/status/serve. Fault tolerance:
// per-task attempt cap 3, refusal-cooldown parsing ("...in X hr Y min" →
// schedule), 30/60/120s+jitter backoff, one in-flight dispatch per route,
// terminal states never retried. State is SQLite (WAL) in a zcode-tui-owned
// dir — crash-safe; serve reclaims stale runs on boot.
//
//   zcode-tui queue enqueue --prompt-file F --workspace W --route R
//                           [--title T] [--model M] [--priority N]
//   zcode-tui queue list [--json]
//   zcode-tui queue status [--json]
//   zcode-tui queue serve [--poll-ms N] [--routes A,B] [--dry-run]
//
// Route policy (peak window Mon-Fri 11:30-15:30 IST blocks zai-coding-plan
// and autoclaw) mirrors tools/zai_peak_window.py — see src/queue/core.ts.
import { parseArgs } from "node:util";
import { mkdirSync, appendFileSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync, openSync, writeSync, closeSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Database } from "bun:sqlite";
import {
  ROUTES, ROUTE_NAMES, TERMINAL_STATUSES,
  isPeak, minutesToPeak, minutesToPeakEnd, maxRunMinutes,
  classifyFailure, sha256, SCHEMA_SQL, rmTask,
  type RouteName, type TaskRow,
  holdTask, rerouteTask, revokeTask,
} from "../queue/core";
import { autoclawPiCli, autoclawCredential, UNATTENDED_PREAMBLE } from "./autoclaw";
import { planExists } from "../autoclaw/plan";
import { syncAuthHeadless } from "../auth/sync";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BUN = process.env.BUN_INSTALL ? join(process.env.BUN_INSTALL, "bin", "bun") : join(homedir(), ".bun", "bin", "bun");
const MODULE_SHA256 = (() => {
  try { return sha256(readFileSync(fileURLToPath(import.meta.url), "utf8")); }
  catch { return null; } // compiled payloads need their own build identity
})();

function processStart(pid: number): string | null {
  try {
    const text = readFileSync(`/proc/${pid}/stat`, "utf8");
    const token = text.slice(text.lastIndexOf(")") + 2).trim().split(/\s+/)[19];
    return /^\d+$/.test(token ?? "") ? token! : null;
  } catch { return null; }
}

export function queueRuntimeIdentity(raw: string | null, pid: number | null, alive: boolean,
                                    readStart: (pid: number) => string | null = processStart) {
  try {
    const value = raw ? JSON.parse(raw) : null;
    if (alive && value?.schema_version === 1 && value.pid === pid && value.start_token
        && value.start_token === readStart(value.pid)
        && typeof value.launch_id === "string" && /^[a-f0-9-]{36}$/.test(value.launch_id)
        && (value.source_sha256 === null || typeof value.source_sha256 === "string"
          && /^[a-f0-9]{64}$/.test(value.source_sha256))) return value as {
            source_sha256: string | null; launch_id: string; pid: number; start_token: string };
  } catch { /* malformed, foreign or legacy state remains unknown */ }
  return null;
}

export function defaultStateDir(): string {
  return process.env.ZCODE_TUI_QUEUE_DIR ?? join(homedir(), ".local", "state", "zcode-tui", "queue");
}

export function openDb(stateDir: string): Database {
  mkdirSync(stateDir, { recursive: true });
  const db = new Database(join(stateDir, "queue.sqlite3"));
  // Measured fault 2026-10-25: the serve's meta heartbeat threw SQLITE_BUSY
  // (uncaught) while an orchestrator CLI writer held the write lock — the
  // serve died and left dispatches unsupervised. WAL still serializes
  // writers; every connection must WAIT politely instead of dying.
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec(SCHEMA_SQL);
  // Forward migrations for DBs created before a column existed.
  const columns = () => new Set((db.query(`PRAGMA table_info(tasks)`).all() as { name: string }[]).map((c) => c.name));
  const cols = columns();
  if (!cols.has("expect_file") || !cols.has("dispatch_id")) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const current = columns(); // another CLI may have migrated while we waited
      if (!current.has("expect_file")) db.exec(`ALTER TABLE tasks ADD COLUMN expect_file TEXT NOT NULL DEFAULT ''`);
      if (!current.has("dispatch_id")) db.exec(`ALTER TABLE tasks ADD COLUMN dispatch_id TEXT NOT NULL DEFAULT ''`);
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); db.close(); throw error; }
  }
  return db;
}

const newId = (): string =>
  "ztq-" + crypto.randomUUID();

function nowMs(): number { return Date.now(); }

function fmtAgo(ms: number): string {
  const s = Math.max(0, Math.round((nowMs() - ms) / 1000));
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}
function fmtIn(ms: number): string {
  const s = Math.max(0, Math.round((ms - nowMs()) / 1000));
  if (s < 90) return `in ${s}s`;
  if (s < 5400) return `in ${Math.round(s / 60)}m`;
  return `in ${Math.round(s / 3600)}h`;
}

// ---------------------------------------------------------------------------
// enqueue / list / status
// ---------------------------------------------------------------------------

export function cmdEnqueue(db: Database, v: Record<string, string | boolean | undefined>) {
  const route = String(v.route ?? "") as RouteName;
  if (!ROUTE_NAMES.includes(route)) {
    console.error(`queue: unknown route '${route}' (known: ${ROUTE_NAMES.join(", ")})`);
    process.exit(2);
  }
  const pf = String(v["prompt-file"] ?? "");
  if (!pf) { console.error("queue: --prompt-file is required"); process.exit(2); }
  const prompt = readFileSync(pf, "utf8");
  if (!prompt.trim()) { console.error("queue: prompt file is empty"); process.exit(2); }
  const workspace = v.workspace ? String(v.workspace) : process.cwd();
  const now = nowMs();
  let eligibleAt = now;
  if (v["eligible-at"]) {
    const raw = String(v["eligible-at"]);
    const asNum = Number(raw);
    eligibleAt = raw.trim() !== "" && Number.isFinite(asNum) ? asNum : Date.parse(raw);
    if (!Number.isFinite(eligibleAt)) {
      console.error(`queue: --eligible-at '${raw}' is not a timestamp (epoch-ms or ISO-8601)`);
      process.exit(2);
    }
  }
  const t: TaskRow = {
    id: newId(), route,
    title: v.title ? String(v.title) : prompt.trim().split("\n")[0].slice(0, 72),
    prompt, prompt_file: pf, prompt_sha256: sha256(prompt),
    workspace, model: v.model ? String(v.model) : "",
    priority: v.priority ? Number(v.priority) : 100,
    status: "queued", attempts: 0, max_attempts: v["max-attempts"] ? Number(v["max-attempts"]) : 3,
    next_eligible_at: eligibleAt, created_at: now, updated_at: now,
    started_at: null, finished_at: null, last_error: "", last_exit: null,
    run_log: "", result_ref: "",
    expect_file: v["expect-file"] ? String(v["expect-file"]) : "",
  };
  if (ROUTES[route] && !ROUTES[route].available) {
    console.error(`queue: NOTE — route '${route}' is config-ready but NOT dispatchable today: ${ROUTES[route].unavailableReason}`);
    console.error("queue: task enqueued anyway; serve will hold it until the route becomes available.");
  }
  db.query(`INSERT INTO tasks (id,route,title,prompt,prompt_file,prompt_sha256,workspace,model,priority,status,
    attempts,max_attempts,next_eligible_at,created_at,updated_at,started_at,finished_at,last_error,last_exit,run_log,result_ref,expect_file)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(t.id, t.route, t.title, t.prompt, t.prompt_file, t.prompt_sha256, t.workspace, t.model, t.priority, t.status,
      t.attempts, t.max_attempts, t.next_eligible_at, t.created_at, t.updated_at, t.started_at, t.finished_at,
      t.last_error, t.last_exit, t.run_log, t.result_ref, t.expect_file);
  const pos = positionOf(db, t.id);
  console.log(`queued ${t.id} route=${route} position=${pos} attempts_cap=${t.max_attempts}${eligibleAt !== now ? ` eligible_at=${new Date(eligibleAt).toISOString()}` : ""}`);
  // Admission honesty (sol DD verdict 4, 2026-10-27): the managed routes
  // enforce the desktop's per-route taskTimeoutMin (zai-coding-plan = 60min,
  // mined from its route config) — a known healthy-dream killer. Surface the
  // cap at admission so long work is routed deliberately; the raise/override
  // decision itself stays owner-gated in the ledger.
  if (route === "zai-coding-plan") {
    console.error("queue: NOTE — route 'zai-coding-plan' caps task runtime at 60min (desktop taskTimeoutMin); longer work belongs on the idle route or must be split.");
  }
  if (v.json) console.log(JSON.stringify({ id: t.id, route, position: pos }));
}

function pendingTasks(db: Database): TaskRow[] {
  return db.query(`SELECT * FROM tasks WHERE status IN ('queued','retry_wait','cooldown_wait','running')
    ORDER BY priority, created_at`).all() as unknown as TaskRow[];
}

function positionOf(db: Database, id: string): number {
  const pend = pendingTasks(db);
  const i = pend.findIndex((t) => t.id === id);
  return i < 0 ? 0 : i + 1;
}

function cmdList(db: Database, json: boolean) {
  const rows = db.query(`SELECT * FROM tasks ORDER BY created_at DESC LIMIT 500`).all() as unknown as TaskRow[];
  const pend = pendingTasks(db);
  const posMap = new Map(pend.map((t, i) => [t.id, i + 1]));
  if (json) {
    console.log(JSON.stringify(rows.map((t) => ({ ...t, prompt: t.prompt.slice(0, 120), position: posMap.get(t.id) ?? null })), null, 1));
    return;
  }
  if (rows.length === 0) { console.log("queue: empty"); return; }
  const w = { id: 40, route: 16, st: 19, pos: 4, att: 5, next: 12 };
  console.log(`${"id".padEnd(w.id)}${"route".padEnd(w.route)}${"status".padEnd(w.st)}pos att ${"eligible".padEnd(w.next)}title`);
  for (const t of rows) {
    const next = posMap.has(t.id)
      ? (t.status === "running" ? "running" : t.next_eligible_at > nowMs() ? fmtIn(t.next_eligible_at) : "now")
      : (["review_pending", "retained_partial", "submitted"].includes(t.status)
          ? "held" : TERMINAL_STATUSES.includes(t.status) ? "—" : "?");
    console.log(`${t.id.padEnd(w.id)}${t.route.padEnd(w.route)}${t.status.padEnd(w.st)}${String(posMap.get(t.id) ?? "-").padStart(w.pos)} ${String(t.attempts).padStart(w.att)} ${next.padEnd(w.next)}${t.title.slice(0, 48)}`);
  }
}

function cmdStatus(db: Database, json: boolean, stateDir: string) {
  const beat = db.query(`SELECT v FROM meta WHERE k='serve_beat'`).get() as { v: string } | null;
  const pid = db.query(`SELECT v FROM meta WHERE k='serve_pid'`).get() as { v: string } | null;
  let serveAlive = false;
  if (pid) {
    try { process.kill(Number(pid.v), 0); serveAlive = Date.now() - Number(beat?.v ?? 0) < 90_000; } catch { serveAlive = false; }
  }
  const identityRow = db.query("SELECT v FROM meta WHERE k='serve_identity'").get() as { v: string } | null;
  const identity = queueRuntimeIdentity(identityRow?.v ?? null, pid ? Number(pid.v) : null, serveAlive);
  const byRoute: Record<string, unknown> = {};
  for (const r of ROUTE_NAMES) {
    const counts: Record<string, number> = {};
    for (const row of db.query(`SELECT status, COUNT(*) n FROM tasks WHERE route=? GROUP BY status`).all(r) as { status: string; n: number }[])
      counts[row.status] = row.n;
    const rs = db.query(`SELECT cooldown_until, cooldown_reason FROM route_state WHERE route=?`).get(r) as { cooldown_until: number; cooldown_reason: string } | null;
    const def = ROUTES[r as RouteName];
    byRoute[r] = {
      counts,
      peak: isPeak(r as RouteName) ? "BLOCKED (peak)" : def.peakGated ? "clear" : "n/a",
      minutes_to_peak: def.peakGated ? minutesToPeak() : null,
      max_run_min: def.peakGated ? maxRunMinutes(r as RouteName) : null,
      cooldown_until: rs && rs.cooldown_until > nowMs() ? new Date(rs.cooldown_until).toISOString() : null,
      cooldown_reason: rs?.cooldown_reason ?? "",
      available: def.available,
      unavailable_reason: def.unavailableReason ?? null,
    };
  }
  const status = {
    serve: { alive: serveAlive, pid: pid ? Number(pid.v) : null, last_beat: beat ? fmtAgo(Number(beat.v)) : null,
      source_sha256: identity?.source_sha256 ?? null, launch_id: identity?.launch_id ?? null,
      identity_quality: identity?.source_sha256 ? "process-bound-startup-file" : "unknown", state_dir: stateDir },
    routes: byRoute,
  };
  if (json) { console.log(JSON.stringify(status, null, 1)); return; }
  console.log(`serve: ${serveAlive ? `ALIVE (pid ${pid?.v ?? "?"}, beat ${beat ? fmtAgo(Number(beat.v)) : "?"})` : "not running"}  state: ${stateDir}`);
  console.log(`source: ${identity?.source_sha256 ?? "UNKNOWN (no current process-bound source receipt)"}`);
  if (isPeak("zai-coding-plan")) console.log(`PEAK WINDOW ACTIVE — zai-coding-plan/autoclaw blocked for ${minutesToPeakEnd()}m`);
  for (const r of ROUTE_NAMES) {
    const x = byRoute[r] as Record<string, { completed?: number; failed?: number; queued?: number; running?: number; retry_wait?: number; cooldown_wait?: number }>;
    const c = x.counts;
    const done = Object.entries(c ?? {}).map(([k, n]) => `${k}=${n}`).join(" ") || "no tasks";
    console.log(`${r.padEnd(17)} ${String(x.available ? "" : "UNAVAILABLE ").padEnd(12)}${x.peak ?? ""} ${String(x.cooldown_until ?? "").padEnd(0)} ${done}`);
  }
}

// ---------------------------------------------------------------------------
// serve — the dispatcher
// ---------------------------------------------------------------------------

export interface SpawnFn {
  (cmd: string[], opts: { cwd: string; stdin?: string; timeoutMs: number; logFile: string; onSpawn?: (kill: () => void) => void }):
    Promise<{ code: number | null; signal: string | null; stdout: string; stderr: string; timedOut: boolean }>;
}

export const realSpawn: SpawnFn = (cmd, { cwd, stdin, timeoutMs, logFile, onSpawn }) =>
  new Promise((resolve) => {
    // detached: kills go to the whole process group — a killed bun/codex
    // leaves the spawned runtime (electron app-server) alive otherwise, and
    // the session keeps burning quota with nobody watching it.
    const p = spawn(cmd[0], cmd.slice(1), { cwd, detached: true, env: { ...process.env, PATH: `${join(homedir(), ".bun", "bin")}:${join(homedir(), ".yggterm", "ynpm", "bin")}:${process.env.PATH ?? ""}` } });
    let out = "", err = "", killed = false, settled = false;
    let hardTimer: NodeJS.Timeout | undefined;
    const cap = 262_144;
    p.stdout.on("data", (d: Buffer) => { if (out.length < cap) out += d.toString(); });
    p.stderr.on("data", (d: Buffer) => { if (err.length < cap) err += d.toString(); });
    const killGroup = (sig: NodeJS.Signals) => {
      try { process.kill(-p.pid!, sig); } catch { try { p.kill(sig); } catch { /* already gone */ } }
    };
    onSpawn?.(() => killGroup("SIGTERM"));
    const finish = (code: number | null, signal: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (hardTimer) clearTimeout(hardTimer);
      const full = `--- stdout ---\n${out}\n--- stderr ---\n${err}\n`;
      try { writeFileSync(logFile, full); } catch { /* log best-effort */ }
      resolve({ code, signal, stdout: out, stderr: err, timedOut: killed });
    };
    const timer = setTimeout(() => {
      killed = true;
      killGroup("SIGTERM");
      // 15s grace for a clean stop, then the group dies hard.
      hardTimer = setTimeout(() => killGroup("SIGKILL"), 15_000);
    }, timeoutMs);
    if (stdin !== undefined) p.stdin.end(stdin); else p.stdin.end();
    p.on("close", (code, signal) => finish(code, signal));
    p.on("error", (e) => {
      err += `\n--- spawn error ---\n${String(e)}`;
      finish(null, null);
    });
    // BUG-001 (measured: the mackvm stall): grandchildren that outlive the
    // direct child keep the stdio pipes open, 'close' never fires, and the
    // dispatch promise hangs forever. This backstop guarantees resolution.
    setTimeout(() => finish(killed ? null : p.exitCode, killed ? "SIGKILL" : null), timeoutMs + 45_000);
  });

function writePromptFile(stateDir: string, task: TaskRow): string {
  const f = join(stateDir, "runs", `${task.id}-a${task.attempts + 1}.md`);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, task.prompt);
  return f;
}

/** Build the dispatch command for a task. Remote routes ride ssh (dev→jojo). */
export function buildCommand(
  task: TaskRow,
  ctx: { repo: string; stateDir: string; promptFile: string; runLog: string; budgetMin: number },
): { cmd: string[]; cwd: string; stdin?: string } {
  const bun = BUN;
  switch (task.route) {
    case "zai-coding-plan": {
      // 15-min default collect window cut every real working session
      // mid-edit (measured: the parity dreamer never survived past 15min).
      // 90 min of collection; --max-run-min still bounds consumption.
      const cmd = [bun, join(ctx.repo, "src/bin/run.ts"),
        "--content-file", ctx.promptFile, "--workspace", task.workspace, "--out", ctx.runLog, "--unattended",
        "--collect-ms", "5400000"];
      // Owner law 2026-10-24: GLM-5.3 FULL is start-plan-only — regular
      // coding-plan dreams run GLM-5.3-Flash at max reasoning. Big dreams
      // that earn the full model pass an explicit --model ref.
      const model = task.model
        || JSON.stringify({ modelId: "GLM-5.3-Flash", providerId: "zai-api", options: { reasoningLevel: "max" } });
      cmd.push("--model", model);
      if (ctx.budgetMin > 0) cmd.push("--max-run-min", String(ctx.budgetMin));
      return { cmd, cwd: ctx.repo };
    }
    case "zai-offpeak": {
      // Runs against jojo (ticket + row land in jojo's task index; jojo's
      // desktop/runtime executes queued tickets). Prompt rides stdin.
      // Keepalives: a bare rc=255 (dropped ssh) killed a live attempt once.
      const inner = [
        `cd ${ctx.repo} && ${bun} run src/bin/idle.ts create`,
        // --direct registers the ticket with the gateway ourselves: the
        // OffPeakCreate schema moved between zcode 3.11 and 3.16 (dev
        // FATALed 2026-10-25) and the driver session burns ~600k tokens
        "--direct", "--prompt-file", "-", "--out", ctx.runLog, "--json",
        "--workspace", task.workspace,
      ];
      if (task.title) inner.push("--title", JSON.stringify(task.title.slice(0, 120)));
      const offpeakModel = task.model || ROUTES["zai-offpeak"].defaultModel;
      if (offpeakModel) inner.push("--model", JSON.stringify(offpeakModel));
      const cmd = [
        "ssh",
        "-o", "ServerAliveInterval=15",
        "-o", "ServerAliveCountMax=4",
        "-o", "ConnectTimeout=10",
        ROUTES["zai-offpeak"].remoteHost!,
        inner.join(" "),
      ];
      return { cmd, cwd: ctx.repo, stdin: task.prompt };
    }
    case "opencode-free": {
      const model = task.model || ROUTES["opencode-free"].defaultModel!;
      return {
        cmd: ["opencode", "run", "--model", model, "-"],
        cwd: task.workspace, stdin: task.prompt,
      };
    }
    case "autoclaw": {
      // Managed plane first: with the user's plan file present (mined by
      // `autoclaw setup`, replicated by auth sync) the route runs LOCALLY on
      // any host — signing proxy + pi, no desktop host involved.
      if (planExists()) {
        const local = [
          bun, join(ctx.repo, "src/bin/autoclaw.ts"), "run",
          "--content-file", "-", "--out", ctx.runLog,
          // Local spawn: no shell — raw values (JSON.stringify here baked
          // literal quotes into argv and ENOENT'd every cwd; G4).
          "--workspace", task.workspace,
        ];
        // route default applies here too — the legacy branch below already
        // did; a bare dispatch silently ran the catalog's first model
        // (zai_auto) instead of the pinned GLM-5.3-Flash (measured 2026-10-25,
        // dev serve) — the same config-default fault class core.ts documents
        const localModel = task.model || ROUTES["autoclaw"].defaultModel;
        if (localModel) local.push("--model", localModel);
        return { cmd: local, cwd: task.workspace, stdin: `${UNATTENDED_PREAMBLE}\n\n${task.prompt}` };
      }
      // Legacy fallback: pi CLI inside the appimage runtime on the desktop
      // host; rides ssh like the idle route. Credential must be provisioned
      // (see zcode-tui autoclaw doctor).
      const inner = [
        `cd ${ctx.repo} && ${bun} run src/bin/autoclaw.ts run`,
        "--content-file", "-", "--out", ctx.runLog,
        "--workspace", JSON.stringify(task.workspace),
      ];
      const autoclawModel = task.model || ROUTES["autoclaw"].defaultModel;
      if (autoclawModel) inner.push("--model", JSON.stringify(autoclawModel));
      const cmd = [
        "ssh",
        "-o", "ServerAliveInterval=15",
        "-o", "ServerAliveCountMax=4",
        "-o", "ConnectTimeout=10",
        "jojo",
        inner.join(" "),
      ];
      return { cmd, cwd: ctx.repo, stdin: `${UNATTENDED_PREAMBLE}\n\n${task.prompt}` };
    }
    case "codex": {
      const cmd = ["codex", "exec", "--skip-git-repo-check", "--dangerously-bypass-approvals-and-sandbox", "-C", task.workspace];
      if (task.model) cmd.push("-m", task.model);
      cmd.push(task.prompt);
      return { cmd, cwd: task.workspace };
    }
    default:
      throw new Error(`route ${task.route} is not dispatchable`);
  }
}

interface ServeOpts {
  pollMs: number;
  metricsMs: number;
  routes: RouteName[];
  stateDir: string;
  dryRun: boolean;
  spawnFn?: SpawnFn;
  now?: () => number;
  log?: (line: string) => void;
}

export class QueueServer {
  private db: Database;
  private opts: ServeOpts;
  private spawnFn: SpawnFn;
  private now: () => number;
  private log: (line: string) => void;
  private active = new Set<string>(); // route names with an in-memory dispatch
  private spawnKills = new Map<string, Map<string, () => void>>(); // taskId -> (attemptId -> kill)
  private dispatchIds = new Map<string, string>();
  private lastSweep = 0;
  private peakLogged = new Map<string, boolean>(); // throttle peak-block logs
  private stopping = false;

  constructor(db: Database, opts: ServeOpts) {
    this.db = db;
    this.opts = opts;
    this.spawnFn = opts.spawnFn ?? realSpawn;
    this.now = opts.now ?? Date.now;
    this.log = opts.log ?? ((l) => console.log(l));
  }

  metricsPath(): string { return join(this.opts.stateDir, "metrics.jsonl"); }

  private metric(entry: Record<string, unknown>) {
    appendFileSync(this.metricsPath(), JSON.stringify({ t: this.now(), ...entry }) + "\n");
  }


  /** Fresh worker heartbeat (< 5min) means a DETACHED collector survived the
   *  serve crash and is actively working — measured double-dispatch fault
   *  2026-10-25: reclaim requeued a live parity dreamer (fresh hb) and the
   *  respawn wrote the same workspace concurrently with the survivor. */
  private hbFresh(taskId: string): boolean {
    try {
      const files = readdirSync(join(this.opts.stateDir, "runs")).filter((f) => f.startsWith(taskId) && f.endsWith(".hb"));
      let newest = 0;
      for (const f of files) {
        const st = statSync(join(this.opts.stateDir, "runs", f));
        if (st.mtimeMs > newest) newest = st.mtimeMs;
      }
      return newest > 0 && this.now() - newest < 5 * 60_000;
    } catch { return false; }
  }

  /** Adopt a finished orphan: read the newest transcript's terminal outcome
   *  and map it to row status. Null when still running/unknown. */
  private adoptOrphanOutcome(taskId: string, dispatchId = ""): string | null {
    try {
      const files = readdirSync(join(this.opts.stateDir, "runs")).filter((f) =>
        f.startsWith(taskId) && f.endsWith(".json.log")
        && (!dispatchId || f.includes(`-${dispatchId}.`)));
      let newestPath = "", newestMs = 0;
      for (const f of files) {
        const st = statSync(join(this.opts.stateDir, "runs", f));
        if (st.mtimeMs > newestMs) { newestMs = st.mtimeMs; newestPath = join(this.opts.stateDir, "runs", f); }
      }
      if (!newestPath) return null;
      const txt = readFileSync(newestPath, "utf8").slice(-4000);
      const m = /"outcome"\s*:\s*"(settled|budget|cut-midtool|failed)"/.exec(txt);
      if (!m) return null;
      return m[1];
    } catch { return null; }
  }

  /** Boot recovery: a serve crash leaves status='running' rows behind. */
  reclaimStale() {
    const staleAfter = 15 * 60_000;
    const rows = this.db.query(`SELECT * FROM tasks WHERE status='running'`).all() as unknown as TaskRow[];
    for (const t of rows) {
      if (this.now() - t.updated_at < staleAfter) continue;
      if (this.hbFresh(t.id)) {
        this.log(`reclaim ${t.id}: skipped — detached collector still heartbeating`);
        continue;
      }
      const attempts = t.attempts;
      const final = attempts >= t.max_attempts;
      const outcome = this.adoptOrphanOutcome(t.id, t.dispatch_id);
      if (outcome === "settled" || outcome === "budget" || outcome === "cut-midtool") {
        this.retainOrphan(t, outcome);
        continue;
      }
      if (!this.updateRunning(t, `UPDATE tasks SET status=?, last_error=?, updated_at=? WHERE id=?`,
        [final ? "failed" : "queued", `reclaimed after serve crash (attempt ${attempts} had started)`, this.now(), t.id])) continue;
      this.log(`reclaim ${t.id}: ${final ? "failed (cap)" : "requeued"} after crash`);
    }
  }

  private heartbeat() {
    // A liveness beat must never kill the server: contention resolves in
    // milliseconds and a skipped beat is invisible (the lock/pid rows still
    // identify this serve), whereas an uncaught SQLITE_BUSY took the whole
    // dispatch loop down (measured 2026-10-25).
    try {
      const n = this.now();
      this.db.query(`INSERT INTO meta (k,v) VALUES ('serve_beat',?)
        ON CONFLICT(k) DO UPDATE SET v=excluded.v`).run(String(n));
      this.db.query(`INSERT INTO meta (k,v) VALUES ('serve_pid',?)
        ON CONFLICT(k) DO UPDATE SET v=excluded.v`).run(String(process.pid));
    } catch (e) {
      this.log(`heartbeat skipped (db busy): ${e instanceof Error ? e.message : e}`);
    }
  }

  /** BUG-001 sweeper — runs IN the serve loop (the old reclaimStale fired
   *  only at boot, so a serve that ran for days never reaped anything):
   *  1. crash leftovers: 'running' rows with no live dispatch after 15min
   *  2. stalled live dispatches: zt workers touch <out>.hb every 60s;
   *     30min of heartbeat silence = a hung session — SIGTERM the group and
   *     let the stalled-classifier requeue it honestly. */
  sweep() {
    if (this.now() - this.lastSweep < 60_000) return;
    this.lastSweep = this.now();
    const rows = this.db.query(`SELECT * FROM tasks WHERE status='running'`).all() as unknown as TaskRow[];
    for (const t of rows) {
      if (this.spawnKills.has(t.id)) continue; // live dispatch, watched below
      if (this.now() - t.updated_at < 15 * 60_000) continue;
      if (this.hbFresh(t.id)) continue; // detached survivor — hb-stale rule governs it later
      const attempts = t.attempts;
      const final = attempts >= t.max_attempts;
      const outcome = this.adoptOrphanOutcome(t.id, t.dispatch_id);
      if (outcome === "settled" || outcome === "budget" || outcome === "cut-midtool") {
        this.retainOrphan(t, outcome);
        continue;
      }
      if (!this.updateRunning(t, `UPDATE tasks SET status=?, last_error=?, updated_at=? WHERE id=?`,
        [final ? "failed" : "queued", `reclaimed: 'running' row with no live dispatch (serve crash or lost spawn)`, this.now(), t.id])) continue;
      this.log(`reclaim ${t.id}: ${final ? "failed (cap)" : "requeued"} — orphaned running row`);
    }
    for (const [taskId, killFns] of this.spawnKills) {
      const row = this.db.query(`SELECT status, route FROM tasks WHERE id=?`).get(taskId) as { status: string; route: string } | null;
      if (!row || row.status !== "running") continue;
      if (row.route !== "zai-coding-plan" && row.route !== "zai-offpeak" && row.route !== "autoclaw") continue; // no hb convention
      // hb files are <task>-a<N>.json.log.hb (run.ts --out = the runLog)
      let newest = 0;
      try {
        const files = readdirSync(join(this.opts.stateDir, "runs")).filter((f) => f.startsWith(taskId) && f.endsWith(".hb"));
        for (const f of files) {
          const st = statSync(join(this.opts.stateDir, "runs", f));
          if (st.mtimeMs > newest) newest = st.mtimeMs;
        }
      } catch { /* runs dir missing */ }
      if (newest && this.now() - newest > 30 * 60_000) {
        this.log(`stall ${taskId}: no worker heartbeat for 30m — SIGTERM (sweeper)`);
        for (const kill of killFns.values()) { try { kill(); } catch { /* noop */ } }
      }
    }
  }

  private snapshotMetric() {
    const routes: Record<string, unknown> = {};
    let totalPending = 0;
    for (const r of this.opts.routes) {
      const counts: Record<string, number> = {};
      for (const row of this.db.query(`SELECT status, COUNT(*) n FROM tasks WHERE route=? GROUP BY status`).all(r) as { status: string; n: number }[])
        counts[row.status] = row.n;
      const rs = this.db.query(`SELECT cooldown_until FROM route_state WHERE route=?`).get(r) as { cooldown_until: number } | null;
      const pending = (counts.queued ?? 0) + (counts.retry_wait ?? 0) + (counts.cooldown_wait ?? 0);
      totalPending += pending;
      routes[r] = { ...counts, cooldown_until: rs?.cooldown_until && rs.cooldown_until > this.now() ? rs.cooldown_until : null };
    }
    this.metric({ ev: "tick", total_pending: totalPending, routes });
  }

  /** Pick + dispatch at most one task per route (one in-flight per route). */
  async tick(): Promise<number> {
    let dispatched = 0;
    for (const route of this.opts.routes) {
      const def = ROUTES[route];
      if (!def.available) continue;
      if (this.active.has(route)) continue;
      const running = this.db.query(`SELECT COUNT(*) n FROM tasks WHERE route=? AND status='running'`).get() as { n: number };
      if (running.n > 0) continue;
      const rs = this.db.query(`SELECT cooldown_until FROM route_state WHERE route=?`).get(route) as { cooldown_until: number } | null;
      if (rs && rs.cooldown_until > this.now()) continue;
      const nowDate = new Date(this.now());
      if (def.peakGated && isPeak(route, nowDate)) {
        if (!this.peakLogged.get(route)) {
          this.log(`${route}: peak window — blocked ${minutesToPeakEnd(nowDate)}m`);
          this.peakLogged.set(route, true);
        }
        continue;
      }
      this.peakLogged.set(route, false);
      const task = this.db.query(`SELECT * FROM tasks WHERE route=? AND status IN ('queued','retry_wait','cooldown_wait')
        AND next_eligible_at<=? ORDER BY priority, created_at LIMIT 1`).get(route, this.now()) as unknown as TaskRow | null;
      if (!task) continue;
      const budgetMin = def.peakGated ? maxRunMinutes(route, nowDate) : 0;
      if (def.peakGated && budgetMin === 0) {
        this.log(`${route}: ${minutesToPeak(nowDate)}m to peak — below useful-run floor, deferring ${task.id}`);
        continue;
      }
      const pos = positionOf(this.db, task.id);
      if (this.opts.dryRun) {
        this.log(`dry-run: would dispatch ${task.id} pos=${pos} route=${route}`);
        dispatched++;
        continue;
      }
      dispatched++;
      this.active.add(route);
      void this.dispatch(task, budgetMin, pos).finally(() => this.active.delete(route));
    }
    return dispatched;
  }

  private async dispatch(task: TaskRow, budgetMin: number, pos: number) {
    const n0 = this.now();
    const attempts = task.attempts + 1;
    const dispatchId = crypto.randomUUID();
    const claim = this.db.query(`UPDATE tasks SET status='running', attempts=?, started_at=COALESCE(started_at,?), updated_at=?, dispatch_id=?
      WHERE id=? AND route=? AND attempts=? AND status IN ('queued','retry_wait','cooldown_wait') AND next_eligible_at<=?`)
      .run(attempts, n0, n0, dispatchId, task.id, task.route, task.attempts, n0);
    if (claim.changes !== 1) { this.log(`dispatch ${task.id}: claim changed; retained current owner state`); return; }
    task = { ...task, dispatch_id: dispatchId };
    this.dispatchIds.set(task.id, dispatchId);
    this.metric({ ev: "dispatch", event_id: dispatchId, dispatch_id: dispatchId,
      id: task.id, route: task.route, pos, attempt: attempts });
    this.log(`dispatch ${task.id} route=${task.route} pos=${pos} attempt=${attempts}${budgetMin ? ` budget=${budgetMin}m` : ""}`);

    const runLog = join(this.opts.stateDir, "runs", `${task.id}-a${attempts}-${dispatchId}.json.log`);
    mkdirSync(dirname(runLog), { recursive: true });
    const promptFile = writePromptFile(this.opts.stateDir, { ...task, attempts: attempts - 1 });
    const killFns = new Map<string, () => void>();
    this.spawnKills.set(task.id, killFns);
    let cmd: string[], cwd: string, stdin: string | undefined;
    try {
      ({ cmd, cwd, stdin } = buildCommand(task, { repo: REPO, stateDir: this.opts.stateDir, promptFile, runLog, budgetMin }));
    } catch (e) {
      this.spawnKills.delete(task.id);
      this.dispatchIds.delete(task.id);
      this.finish(task, attempts, "failed", null, String(e), "", runLog);
      return;
    }
    const def = ROUTES[task.route];
    const timeoutMs = def.taskTimeoutMin * 60_000 + 120_000;
    let res: Awaited<ReturnType<SpawnFn>>;
    try {
      res = await this.spawnFn(cmd, {
        cwd, stdin, timeoutMs, logFile: join(this.opts.stateDir, "runs", `${task.id}-a${attempts}-${dispatchId}.out`),
        onSpawn: (kill) => killFns.set(task.id, kill),
      });
    } catch (e) {
      res = { code: null, signal: null, stdout: "", stderr: String(e), timedOut: false };
    }
    this.spawnKills.delete(task.id);
    this.dispatchIds.delete(task.id);
    const durMs = this.now() - n0;
    const tail = `${res.stdout}\n${res.stderr}`.slice(-8192);

    // BUG-001 (nuclear class, owner 2026-10-24): a killed/timed-out dispatch
    // is a STALL, not a terminal verdict — requeue it honestly so the work
    // resumes instead of dying mid-flight or being billed as failed.
    if (res.timedOut || res.signal === "SIGTERM" || res.signal === "SIGKILL") {
      const final = attempts >= task.max_attempts;
      if (final) {
        if (!this.finish(task, attempts, "failed", res.code, `stalled: killed after timeout (attempt ${attempts}/${task.max_attempts})`, "", runLog)) return;
        this.metric({ ev: "done", id: task.id, route: task.route, rc: res.code, outcome: "failed-stalled", dur_ms: durMs });
        this.log(`fail ${task.id}: stalled past timeout at attempt cap`);
      } else {
        if (!this.updateRunning(task, `UPDATE tasks SET status='retry_wait', next_eligible_at=?, last_error='stalled: killed after timeout (will resume)', last_exit=?, updated_at=? WHERE id=?`,
          [this.now() + 60_000, res.code, this.now(), task.id])) return;
        this.metric({ ev: "done", id: task.id, route: task.route, rc: res.code, outcome: "stalled-requeue", dur_ms: durMs });
        this.log(`stall ${task.id}: killed after timeout — requeued (attempt ${attempts}/${task.max_attempts})`);
      }
      return;
    }

    // Transport settlement and ticket submission are not work acceptance.
    let resultRef = "";
    if (task.route === "zai-offpeak") {
      const m = res.stdout.match(/ZT-IDLE-CREATE (\{[^\n]*\})/);
      if (m) {
        try {
          const marker = JSON.parse(m[1]);
          if (marker?.ok === true && typeof marker.offPeakTaskId === "string"
              && marker.offPeakTaskId.length > 0 && marker.offPeakTaskId.length <= 512
              && !/[\r\n\0]/.test(marker.offPeakTaskId)) resultRef = marker.offPeakTaskId;
        } catch { /* unverified submission, keep empty */ }
      }
    } else if (task.route === "zai-coding-plan") {
      const m = res.stdout.match(/session (sess_[A-Za-z0-9-]+)/);
      if (m) resultRef = m[1];
    }

    const expectOk = !task.expect_file || existsSync(task.expect_file);
    if (res.code === 0 && (task.route === "zai-offpeak" ? !!resultRef : expectOk)) {
      const state = task.route === "zai-offpeak" ? "submitted" : "review_pending";
      if (!this.finish(task, attempts, state, res.code,
        state === "submitted" ? "remote ticket accepted; work outcome and independent acceptance unknown"
          : "transport yielded; independent current-subject acceptance required", resultRef, runLog)) return;
      this.metric({ ev: "done", phase: "transport_yield", work_accepted: false,
        id: task.id, route: task.route, rc: res.code, outcome: state, dur_ms: durMs });
      this.log(`yield ${task.id} ${state} in ${Math.round(durMs / 1000)}s${resultRef ? ` (${resultRef})` : ""}`);
      return;
    }

    // run.ts exit 5 = cut-midtool: the turn was cut while a tool call was
    // in flight (session left resumable). Defer LONG (45min) — a tight
    // re-dispatch would start a fresh session and redo the work (measured:
    // the exit-4 conflation cycled big dreams every 5 minutes).
    if (res.code === 5) {
      if (!this.updateRunning(task, `UPDATE tasks SET status='retry_wait', attempts=attempts-1, next_eligible_at=?, last_error='cut-midtool: session left resumable; fresh attempt deferred', last_exit=?, updated_at=? WHERE id=?`,
        [this.now() + 45 * 60_000, res.code, this.now(), task.id])) return;
      this.metric({ ev: "done", id: task.id, route: task.route, rc: res.code, outcome: "cut-midtool-defer", dur_ms: durMs });
      this.log(`defer ${task.id}: cut mid-tool; fresh attempt eligible in 45m`);
      return;
    }

    // run.ts exit 4 = budget stop at the peak boundary — working as
    // designed: defer to after peak, do not burn an attempt.
    if (res.code === def.budgetStopExit) {
      const afterPeak = (this.now() + (minutesToPeakEnd(new Date(this.now())) * 60_000)) + 5 * 60_000;
      if (!this.updateRunning(task, `UPDATE tasks SET status='retry_wait', attempts=attempts-1, next_eligible_at=?, last_error='budget stop at peak boundary', last_exit=?, updated_at=? WHERE id=?`,
        [afterPeak, res.code, this.now(), task.id])) return;
      this.metric({ ev: "done", id: task.id, route: task.route, rc: res.code, outcome: "budget-defer", dur_ms: durMs });
      this.log(`defer ${task.id}: peak budget stop; eligible after ${new Date(afterPeak).toISOString()}`);
      return;
    }

    const plan = classifyFailure(tail, attempts, task.max_attempts, this.now());
    if (plan.kind === "cooldown" && plan.cooldownMs) {
      const applied = this.db.transaction(() => {
        if (!this.updateRunning(task, `UPDATE tasks SET status='cooldown_wait', attempts=attempts-1, next_eligible_at=?, last_error=?, last_exit=?, updated_at=? WHERE id=?`,
          [plan.next_eligible_at ?? this.now(), `cooldown: ${tail.slice(-300).replace(/\s+/g, " ")}`, res.code, this.now(), task.id])) return false;
        this.db.query(`INSERT INTO route_state (route,cooldown_until,cooldown_reason) VALUES (?,?,?)
          ON CONFLICT(route) DO UPDATE SET cooldown_until=excluded.cooldown_until, cooldown_reason=excluded.cooldown_reason`)
          .run(task.route, this.now() + plan.cooldownMs! + 60_000, tail.slice(-200).replace(/\s+/g, " "));
        return true;
      })();
      if (!applied) return;
      this.metric({ ev: "done", id: task.id, route: task.route, rc: res.code, outcome: "cooldown", dur_ms: durMs, cooldown_ms: plan.cooldownMs });
      this.log(`cooldown ${task.id}: refusal parsed (+${Math.round(plan.cooldownMs / 60000)}m), route ${task.route} parked until ${new Date(this.now() + plan.cooldownMs + 60_000).toISOString()}`);
      return;
    }
    if (plan.kind === "auth") {
      if (!this.finish(task, attempts, "failed", res.code, `auth/config (terminal): ${tail.slice(-400).replace(/\s+/g, " ")}`, "", runLog)) return;
      this.metric({ ev: "done", id: task.id, route: task.route, rc: res.code, outcome: "failed-auth", dur_ms: durMs });
      this.log(`fail ${task.id}: deterministic auth/config error — terminal`);
      return;
    }
    if (plan.kind === "terminal-cap") {
      if (!this.finish(task, attempts, "failed", res.code, `attempt cap reached: ${tail.slice(-400).replace(/\s+/g, " ")}`, resultRef, runLog)) return;
      this.metric({ ev: "done", id: task.id, route: task.route, rc: res.code, outcome: "failed-cap", dur_ms: durMs });
      this.log(`fail ${task.id}: attempt cap ${task.max_attempts} — terminal`);
      return;
    }
    // retry ladder
    if (!this.updateRunning(task, `UPDATE tasks SET status='retry_wait', next_eligible_at=?, last_error=?, last_exit=?, updated_at=? WHERE id=?`,
      [plan.next_eligible_at ?? this.now(), tail.slice(-300).replace(/\s+/g, " "), res.code, this.now(), task.id])) return;
    this.metric({ ev: "done", id: task.id, route: task.route, rc: res.code, outcome: "retry", dur_ms: durMs, next_eligible_in_ms: (plan.next_eligible_at ?? 0) - this.now() });
    this.log(`retry ${task.id}: attempt ${attempts} failed (rc=${res.code}); next eligible ${fmtIn(plan.next_eligible_at ?? this.now())}`);
  }

  private updateRunning(task: Pick<TaskRow, "id" | "dispatch_id">,
                        sql: string, values: Array<string | number | null>): boolean {
    const update = this.db.query(sql + " AND status='running' AND dispatch_id=?")
      .run(...values, task.dispatch_id ?? "");
    if (update.changes === 1) return true;
    this.log(`retain ${task.id}: ownership changed; task state and evidence preserved`);
    return false;
  }

  private retainOrphan(task: TaskRow, outcome: string) {
    const status = outcome === "settled" ? "review_pending" : "retained_partial";
    if (this.updateRunning(task, `UPDATE tasks SET status=?, finished_at=NULL, last_error=?, updated_at=? WHERE id=?`,
      [status, `unverified orphan transport outcome=${outcome}; work retained, independent acceptance absent`, this.now(), task.id]))
      this.log(`reclaim ${task.id}: ${status}; orphan ${outcome} is not acceptance`);
  }

  private finish(task: TaskRow, _attempts: number, status: "review_pending" | "submitted" | "failed", rc: number | null, err: string, ref: string, runLog: string): boolean {
    return this.updateRunning(task, `UPDATE tasks SET status=?, finished_at=?, updated_at=?, last_error=?, last_exit=?, result_ref=?, run_log=? WHERE id=?`,
      [status, status === "failed" ? this.now() : null, this.now(), err, rc, ref, runLog, task.id]);
  }

  async serve() {
    this.db.query("INSERT INTO meta(k,v) VALUES('serve_identity',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v")
      .run(JSON.stringify({ schema_version: 1, pid: process.pid, start_token: processStart(process.pid),
        launch_id: crypto.randomUUID(), source_sha256: MODULE_SHA256 }));
    this.log(`zcode-tui queue serve — state ${this.opts.stateDir} routes=${this.opts.routes.join(",")} poll=${this.opts.pollMs}ms${this.opts.dryRun ? " DRY-RUN" : ""}`);
    this.reclaimStale();
    let lastMetric = 0;
    while (!this.stopping) {
      this.heartbeat();
      this.sweep();
      if (this.now() - lastMetric >= this.opts.metricsMs) {
        this.snapshotMetric();
        lastMetric = this.now();
      }
      try {
        await this.tick();
      } catch (e) {
        this.log(`tick error (non-fatal): ${e instanceof Error ? e.message : String(e)}`);
      }
      await new Promise((r) => setTimeout(r, this.opts.pollMs));
    }
  }

  /** SIGTERM path: kill live worker groups, then DEFER their rows back to
   *  queued (attempts not consumed) so a restart resumes the work instead of
   *  leaving 'running' zombies for the 15-minute reaper. */
  shutdown() {
    this.stopping = true;
    for (const [taskId, killFns] of this.spawnKills) {
      for (const kill of killFns.values()) { try { kill(); } catch { /* noop */ } }
      if (this.updateRunning({ id: taskId, dispatch_id: this.dispatchIds.get(taskId) ?? "" },
        `UPDATE tasks SET status='queued', attempts=MAX(attempts-1,0), updated_at=? WHERE id=?`, [this.now(), taskId]))
        this.log(`shutdown: ${taskId} killed + deferred back to queued`);
    }
  }

  stop() { this.stopping = true; }
}

// ---------------------------------------------------------------------------

export async function main() {
  // Read-only inventory must not refresh unrelated native authentication.
  if (process.argv[2] === "serve") syncAuthHeadless();
  // The autoclaw route is dispatchable only when the harness AND a
  // provisioned plan credential exist on this host (measured honestly).
  if (planExists() || (autoclawPiCli() && autoclawCredential())) {
    ROUTES.autoclaw.available = true;
    ROUTES.autoclaw.unavailableReason = undefined;
  }
  const { values } = parseArgs({
    allowPositionals: true,
    options: {
      route: { type: "string" },
      "prompt-file": { type: "string" },
      workspace: { type: "string" },
      title: { type: "string" },
      model: { type: "string" },
      priority: { type: "string" },
      "max-attempts": { type: "string" },
      json: { type: "boolean", default: false },
      "poll-ms": { type: "string", default: "10000" },
      "metrics-ms": { type: "string", default: "30000" },
      routes: { type: "string", default: "" },
      "state-dir": { type: "string", default: "" },
      "expect-file": { type: "string", default: "" },
      "eligible-at": { type: "string" },
      "dry-run": { type: "boolean", default: false },
      to: { type: "string" },
      "until-min": { type: "string" },
      reason: { type: "string" },
    },
  });
  const sub = String(process.argv[2] ?? "");
  const stateDir = values["state-dir"] ? String(values["state-dir"]) : defaultStateDir();
  const db = openDb(stateDir);
  switch (sub) {
    case "enqueue": {
      if (!values.route || !values["prompt-file"]) {
        console.error("usage: zcode-tui queue enqueue --prompt-file F --workspace W --route R [--title T --model M --priority N --max-attempts N --eligible-at TS --expect-file F]");
        process.exit(2);
      }
      cmdEnqueue(db, values as Record<string, string | boolean | undefined>);
      break;
    }
    case "rm": {
      const id = String(process.argv[3] ?? "");
      if (!id) { console.error("usage: zcode-tui queue rm <task-id> [--json]"); process.exit(2); }
      const r = rmTask(db, id);
      if (values.json) console.log(JSON.stringify(r.ok ? { id: r.id, status: r.status } : { id: r.id, status: r.status, refused: r.reason }));
      if (r.ok) { if (!values.json) console.log(`cancelled ${r.id} (status=cancelled)`); break; }
      console.error(r.reason === "unknown"
        ? `queue: unknown task id '${r.id}'`
        : `queue: refuse — task '${r.id}' is ${r.reason} (status=${r.status}); only queued/retry_wait/cooldown_wait tasks can be cancelled`);
      process.exit(r.reason === "unknown" ? 2 : 1);
    }
    case "reroute": {
      const id = String(process.argv[3] ?? "");
      const to = String(values.to ?? "");
      if (!id || !to) { console.error("usage: zcode-tui queue reroute <task-id> --to <route> [--json]"); process.exit(2); }
      const r = rerouteTask(db, id, to);
      if (values.json) console.log(JSON.stringify(r.ok ? { id: r.id, status: r.status, route: to } : { id: r.id, refused: r.reason }));
      else console.log(r.ok ? `rerouted ${r.id} -> ${to} (queued, attempts reset)` : `refuse: ${r.reason}`);
      if (!r.ok) process.exit(1);
      break;
    }
    case "hold": {
      const id = String(process.argv[3] ?? "");
      const mins = Number(values["until-min"] ?? "60");
      if (!id || !Number.isFinite(mins) || mins <= 0) { console.error("usage: zcode-tui queue hold <task-id> --until-min N [--json]"); process.exit(2); }
      const r = holdTask(db, id, Date.now() + mins * 60_000);
      if (values.json) console.log(JSON.stringify(r.ok ? { id: r.id, held_until_min: mins } : { id: r.id, refused: r.reason }));
      else console.log(r.ok ? `held ${r.id} for ${mins}m` : `refuse: ${r.reason}`);
      if (!r.ok) process.exit(1);
      break;
    }
    case "revoke": {
      const id = String(process.argv[3] ?? "");
      const why = String(values.reason ?? "false completion");
      if (!id) { console.error("usage: zcode-tui queue revoke <task-id> --reason R [--json]"); process.exit(2); }
      const r = revokeTask(db, id, why);
      if (values.json) console.log(JSON.stringify(r.ok ? { id: r.id, status: r.status } : { id: r.id, refused: r.reason }));
      else console.log(r.ok ? `revoked ${r.id}: ${why} — requeued with attempts reset` : `refuse: ${r.reason}`);
      if (!r.ok) process.exit(1);
      break;
    }
    case "list":
    case "ls": cmdList(db, Boolean(values.json)); break; // `ls` = the easy daily verb (owner, 2026-10-25)
    case "status": cmdStatus(db, Boolean(values.json), stateDir); break;
    case "serve": {
      // BUG-001 (measured: the transcript truncation + double dispatch): two
      // serve loops on one state dir dispatch the same task twice and race
      // on the same run logs. The lockfile makes the second instance refuse.
      const lockPath = join(stateDir, "serve.lock");
      try {
        const fd = openSync(lockPath, "wx");
        writeSync(fd, String(process.pid));
        closeSync(fd);
      } catch {
        let holder = 0;
        try { holder = parseInt(readFileSync(lockPath, "utf8").trim(), 10) || 0; } catch { /* stale empty lock */ }
        let alive = false;
        if (holder) { try { process.kill(holder, 0); alive = true; } catch { alive = false; } }
        if (alive) {
          console.error(`queue serve: another serve (pid ${holder}) holds ${lockPath} — refusing double dispatch`);
          process.exit(3);
        }
        console.warn(`queue serve: stealing stale lock (holder pid ${holder || "?"} is gone)`);
        writeFileSync(lockPath, String(process.pid));
      }

      const routes = (values.routes ? String(values.routes).split(",") : ROUTE_NAMES as unknown as string[])
        .map((r) => String(r).trim()).filter((r) => ROUTE_NAMES.includes(r as RouteName)) as RouteName[];
      const srv = new QueueServer(db, {
        pollMs: Math.max(1000, Number(values["poll-ms"])),
        metricsMs: Math.max(5000, Number(values["metrics-ms"])),
        routes: routes.length ? routes : ROUTE_NAMES,
        stateDir, dryRun: Boolean(values["dry-run"]),
      });
      // Measured fault 2026-10-25: an unconditional unlink let a SLOW
      // shutting-down serve delete the lock AFTER a replacement serve had
      // already taken it — the fleet then ran two serves (double dispatch)
      // with no lock at all. Only remove the lock if it still names US.
      const removeLockIfOurs = () => {
        try {
          if (parseInt(readFileSync(lockPath, "utf8").trim(), 10) === process.pid) unlinkSync(lockPath);
        } catch { /* gone or unreadable — fine */ }
      };
      const shutdown = () => {
        srv.shutdown();
        removeLockIfOurs();
      };
      process.on("SIGTERM", shutdown);
      process.on("SIGINT", shutdown);
      process.on("exit", removeLockIfOurs);
      await srv.serve();
      break;
    }
    default:
      console.error("usage: zcode-tui queue <enqueue|list|rm|status|serve> [...]");
      console.error("  enqueue --prompt-file F --workspace W --route R [--title T --model M --priority N]");
      console.error(`  routes: ${ROUTE_NAMES.join(", ")}`);
      process.exit(2);
  }
  db.close();
}

if (import.meta.main) await main();
