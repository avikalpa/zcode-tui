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
import { mkdirSync, appendFileSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Database } from "bun:sqlite";
import {
  ROUTES, ROUTE_NAMES, TERMINAL_STATUSES,
  isPeak, minutesToPeak, minutesToPeakEnd, maxRunMinutes,
  classifyFailure, sha256, SCHEMA_SQL,
  type RouteName, type TaskRow,
} from "../queue/core";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BUN = process.env.BUN_INSTALL ? join(process.env.BUN_INSTALL, "bin", "bun") : join(homedir(), ".bun", "bin", "bun");

export function defaultStateDir(): string {
  return process.env.ZCODE_TUI_QUEUE_DIR ?? join(homedir(), ".local", "state", "zcode-tui", "queue");
}

export function openDb(stateDir: string): Database {
  mkdirSync(stateDir, { recursive: true });
  const db = new Database(join(stateDir, "queue.sqlite3"));
  db.exec(SCHEMA_SQL);
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

function cmdEnqueue(db: Database, v: Record<string, string | boolean | undefined>) {
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
  const t: TaskRow = {
    id: newId(), route,
    title: v.title ? String(v.title) : prompt.trim().split("\n")[0].slice(0, 72),
    prompt, prompt_file: pf, prompt_sha256: sha256(prompt),
    workspace, model: v.model ? String(v.model) : "",
    priority: v.priority ? Number(v.priority) : 100,
    status: "queued", attempts: 0, max_attempts: v["max-attempts"] ? Number(v["max-attempts"]) : 3,
    next_eligible_at: now, created_at: now, updated_at: now,
    started_at: null, finished_at: null, last_error: "", last_exit: null,
    run_log: "", result_ref: "",
  };
  if (ROUTES[route] && !ROUTES[route].available) {
    console.error(`queue: NOTE — route '${route}' is config-ready but NOT dispatchable today: ${ROUTES[route].unavailableReason}`);
    console.error("queue: task enqueued anyway; serve will hold it until the route becomes available.");
  }
  db.query(`INSERT INTO tasks (id,route,title,prompt,prompt_file,prompt_sha256,workspace,model,priority,status,
    attempts,max_attempts,next_eligible_at,created_at,updated_at,started_at,finished_at,last_error,last_exit,run_log,result_ref)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(t.id, t.route, t.title, t.prompt, t.prompt_file, t.prompt_sha256, t.workspace, t.model, t.priority, t.status,
      t.attempts, t.max_attempts, t.next_eligible_at, t.created_at, t.updated_at, t.started_at, t.finished_at,
      t.last_error, t.last_exit, t.run_log, t.result_ref);
  const pos = positionOf(db, t.id);
  console.log(`queued ${t.id} route=${route} position=${pos} attempts_cap=${t.max_attempts}`);
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
  const w = { id: 40, route: 16, st: 13, pos: 4, att: 5, next: 12 };
  console.log(`${"id".padEnd(w.id)}${"route".padEnd(w.route)}${"status".padEnd(w.st)}pos att ${"eligible".padEnd(w.next)}title`);
  for (const t of rows) {
    const next = posMap.has(t.id)
      ? (t.status === "running" ? "running" : t.next_eligible_at > nowMs() ? fmtIn(t.next_eligible_at) : "now")
      : (TERMINAL_STATUSES.includes(t.status) ? "—" : "?");
    console.log(`${t.id.padEnd(w.id)}${t.route.padEnd(w.route)}${t.status.padEnd(w.st)}${String(posMap.get(t.id) ?? "-").padStart(w.pos)} ${String(t.attempts).padStart(w.att)} ${next.padEnd(w.next)}${t.title.slice(0, 48)}`);
  }
}

function cmdStatus(db: Database, json: boolean, stateDir: string) {
  const beat = db.query(`SELECT v FROM meta WHERE k='serve_beat'`).get() as { v: string } | null;
  const pid = db.query(`SELECT v FROM meta WHERE k='serve_pid'`).get() as { v: string } | null;
  let serveAlive = false;
  if (pid) {
    try { process.kill(Number(pid.v), 0); serveAlive = Date.now() - Number(beat?.v ?? 0) < 90_000; } catch { serveAlive = false; }
  }  const byRoute: Record<string, unknown> = {};
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
    serve: { alive: serveAlive, pid: pid ? Number(pid.v) : null, last_beat: beat ? fmtAgo(Number(beat.v)) : null, state_dir: stateDir },
    routes: byRoute,
  };
  if (json) { console.log(JSON.stringify(status, null, 1)); return; }
  console.log(`serve: ${serveAlive ? `ALIVE (pid ${pid?.v ?? "?"}, beat ${beat ? fmtAgo(Number(beat.v)) : "?"})` : "not running"}  state: ${stateDir}`);
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
  (cmd: string[], opts: { cwd: string; stdin?: string; timeoutMs: number; logFile: string }):
    Promise<{ code: number | null; signal: string | null; stdout: string; stderr: string; timedOut: boolean }>;
}

export const realSpawn: SpawnFn = (cmd, { cwd, stdin, timeoutMs, logFile }) =>
  new Promise((resolve) => {
    const p = spawn(cmd[0], cmd.slice(1), { cwd, env: { ...process.env, PATH: `${join(homedir(), ".bun", "bin")}:${join(homedir(), ".yggterm", "ynpm", "bin")}:${process.env.PATH ?? ""}` } });
    let out = "", err = "", killed = false;
    const cap = 262_144;
    p.stdout.on("data", (d: Buffer) => { if (out.length < cap) out += d.toString(); });
    p.stderr.on("data", (d: Buffer) => { if (err.length < cap) err += d.toString(); });
    const timer = setTimeout(() => { killed = true; p.kill("SIGKILL"); }, timeoutMs);
    if (stdin !== undefined) p.stdin.end(stdin); else p.stdin.end();
    p.on("close", (code, signal) => {
      clearTimeout(timer);
      const full = `--- stdout ---\n${out}\n--- stderr ---\n${err}\n`;
      try { writeFileSync(logFile, full); } catch { /* log best-effort */ }
      resolve({ code, signal, stdout: out, stderr: err, timedOut: killed });
    });
    p.on("error", (e) => {
      clearTimeout(timer);
      const full = `--- spawn error ---\n${String(e)}\n`;
      try { writeFileSync(logFile, full); } catch { /* log best-effort */ }
      resolve({ code: null, signal: null, stdout: "", stderr: String(e), timedOut: false });
    });
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
      const cmd = [bun, join(ctx.repo, "src/bin/run.ts"),
        "--content-file", ctx.promptFile, "--workspace", task.workspace, "--out", ctx.runLog];
      if (task.model) cmd.push("--model", task.model);
      if (ctx.budgetMin > 0) cmd.push("--max-run-min", String(ctx.budgetMin));
      return { cmd, cwd: ctx.repo };
    }
    case "zai-offpeak": {
      // Runs against jojo (ticket + row land in jojo's task index; jojo's
      // desktop/runtime executes queued tickets). Prompt rides stdin.
      // Keepalives: a bare rc=255 (dropped ssh) killed a live attempt once.
      const inner = [
        `cd ${ctx.repo} && ${bun} run src/bin/idle.ts create`,
        "--prompt-file", "-", "--out", ctx.runLog, "--json",
        "--workspace", task.workspace,
      ];
      if (task.title) inner.push("--title", JSON.stringify(task.title.slice(0, 120)));
      if (task.model) inner.push("--model", JSON.stringify(task.model));
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

  /** Boot recovery: a serve crash leaves status='running' rows behind. */
  reclaimStale() {
    const staleAfter = 15 * 60_000;
    const rows = this.db.query(`SELECT * FROM tasks WHERE status='running'`).all() as unknown as TaskRow[];
    for (const t of rows) {
      if (this.now() - t.updated_at < staleAfter) continue;
      const attempts = t.attempts;
      const final = attempts >= t.max_attempts;
      this.db.query(`UPDATE tasks SET status=?, last_error=?, updated_at=? WHERE id=?`)
        .run(final ? "failed" : "queued",
          `reclaimed after serve crash (attempt ${attempts} had started)`, this.now(), t.id);
      this.log(`reclaim ${t.id}: ${final ? "failed (cap)" : "requeued"} after crash`);
    }
  }

  private heartbeat() {
    const n = this.now();
    this.db.query(`INSERT INTO meta (k,v) VALUES ('serve_beat',?)
      ON CONFLICT(k) DO UPDATE SET v=excluded.v`).run(String(n));
    this.db.query(`INSERT INTO meta (k,v) VALUES ('serve_pid',?)
      ON CONFLICT(k) DO UPDATE SET v=excluded.v`).run(String(process.pid));
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
    this.db.query(`UPDATE tasks SET status='running', attempts=?, started_at=COALESCE(started_at,?), updated_at=? WHERE id=?`)
      .run(attempts, n0, n0, task.id);
    this.metric({ ev: "dispatch", id: task.id, route: task.route, pos, attempt: attempts });
    this.log(`dispatch ${task.id} route=${task.route} pos=${pos} attempt=${attempts}${budgetMin ? ` budget=${budgetMin}m` : ""}`);

    const runLog = join(this.opts.stateDir, "runs", `${task.id}-a${attempts}.json.log`);
    mkdirSync(dirname(runLog), { recursive: true });
    const promptFile = writePromptFile(this.opts.stateDir, { ...task, attempts: attempts - 1 });
    let cmd: string[], cwd: string, stdin: string | undefined;
    try {
      ({ cmd, cwd, stdin } = buildCommand(task, { repo: REPO, stateDir: this.opts.stateDir, promptFile, runLog, budgetMin }));
    } catch (e) {
      this.finish(task.id, attempts, "failed", null, String(e), "", runLog);
      return;
    }
    const def = ROUTES[task.route];
    const timeoutMs = def.taskTimeoutMin * 60_000 + 120_000;
    let res: Awaited<ReturnType<SpawnFn>>;
    try {
      res = await this.spawnFn(cmd, { cwd, stdin, timeoutMs, logFile: join(this.opts.stateDir, "runs", `${task.id}-a${attempts}.out`) });
    } catch (e) {
      res = { code: null, signal: null, stdout: "", stderr: String(e), timedOut: false };
    }
    const durMs = this.now() - n0;
    const tail = `${res.stdout}\n${res.stderr}`.slice(-8192);

    // Honest success check: exit 0 AND (for idle-create) the marker line.
    let resultRef = "";
    if (task.route === "zai-offpeak") {
      const m = res.stdout.match(/ZT-IDLE-CREATE (\{[^\n]*\})/);
      if (m) { try { resultRef = (JSON.parse(m[1]) as { offPeakTaskId?: string }).offPeakTaskId ?? ""; } catch { /* keep "" */ } }
    } else if (task.route === "zai-coding-plan") {
      const m = res.stdout.match(/session (sess_[A-Za-z0-9-]+)/);
      if (m) resultRef = m[1];
    }

    if (res.code === 0 && (task.route !== "zai-offpeak" || resultRef)) {
      this.finish(task.id, attempts, "completed", res.code, "", resultRef, runLog);
      this.metric({ ev: "done", id: task.id, route: task.route, rc: res.code, outcome: "completed", dur_ms: durMs });
      this.log(`done ${task.id} completed in ${Math.round(durMs / 1000)}s${resultRef ? ` (${resultRef})` : ""}`);
      return;
    }

    // run.ts exit 4 = budget stop at the peak boundary — working as
    // designed: defer to after peak, do not burn an attempt.
    if (res.code === def.budgetStopExit) {
      const afterPeak = (this.now() + (minutesToPeakEnd(new Date(this.now())) * 60_000)) + 5 * 60_000;
      this.db.query(`UPDATE tasks SET status='retry_wait', attempts=attempts-1, next_eligible_at=?, last_error='budget stop at peak boundary', last_exit=?, updated_at=? WHERE id=?`)
        .run(afterPeak, res.code, this.now(), task.id);
      this.metric({ ev: "done", id: task.id, route: task.route, rc: res.code, outcome: "budget-defer", dur_ms: durMs });
      this.log(`defer ${task.id}: peak budget stop; eligible after ${new Date(afterPeak).toISOString()}`);
      return;
    }

    const plan = classifyFailure(tail, attempts, task.max_attempts, this.now());
    if (plan.kind === "cooldown" && plan.cooldownMs) {
      this.db.query(`INSERT INTO route_state (route,cooldown_until,cooldown_reason) VALUES (?,?,?)
        ON CONFLICT(route) DO UPDATE SET cooldown_until=excluded.cooldown_until, cooldown_reason=excluded.cooldown_reason`)
        .run(task.route, this.now() + plan.cooldownMs + 60_000, tail.slice(-200).replace(/\s+/g, " "));
      this.db.query(`UPDATE tasks SET status='cooldown_wait', attempts=attempts-1, next_eligible_at=?, last_error=?, last_exit=?, updated_at=? WHERE id=?`)
        .run(plan.next_eligible_at ?? this.now(), `cooldown: ${tail.slice(-300).replace(/\s+/g, " ")}`, res.code, this.now(), task.id);
      this.metric({ ev: "done", id: task.id, route: task.route, rc: res.code, outcome: "cooldown", dur_ms: durMs, cooldown_ms: plan.cooldownMs });
      this.log(`cooldown ${task.id}: refusal parsed (+${Math.round(plan.cooldownMs / 60000)}m), route ${task.route} parked until ${new Date(this.now() + plan.cooldownMs + 60_000).toISOString()}`);
      return;
    }
    if (plan.kind === "auth") {
      this.finish(task.id, attempts, "failed", res.code, `auth/config (terminal): ${tail.slice(-400).replace(/\s+/g, " ")}`, "", runLog);
      this.metric({ ev: "done", id: task.id, route: task.route, rc: res.code, outcome: "failed-auth", dur_ms: durMs });
      this.log(`fail ${task.id}: deterministic auth/config error — terminal`);
      return;
    }
    if (plan.kind === "terminal-cap") {
      this.finish(task.id, attempts, "failed", res.code, `attempt cap reached: ${tail.slice(-400).replace(/\s+/g, " ")}`, resultRef, runLog);
      this.metric({ ev: "done", id: task.id, route: task.route, rc: res.code, outcome: "failed-cap", dur_ms: durMs });
      this.log(`fail ${task.id}: attempt cap ${task.max_attempts} — terminal`);
      return;
    }
    // retry ladder
    this.db.query(`UPDATE tasks SET status='retry_wait', next_eligible_at=?, last_error=?, last_exit=?, updated_at=? WHERE id=?`)
      .run(plan.next_eligible_at ?? this.now(), tail.slice(-300).replace(/\s+/g, " "), res.code, this.now(), task.id);
    this.metric({ ev: "done", id: task.id, route: task.route, rc: res.code, outcome: "retry", dur_ms: durMs, next_eligible_in_ms: (plan.next_eligible_at ?? 0) - this.now() });
    this.log(`retry ${task.id}: attempt ${attempts} failed (rc=${res.code}); next eligible ${fmtIn(plan.next_eligible_at ?? this.now())}`);
  }

  private finish(id: string, _attempts: number, status: "completed" | "failed", rc: number | null, err: string, ref: string, runLog: string) {
    this.db.query(`UPDATE tasks SET status=?, finished_at=?, updated_at=?, last_error=?, last_exit=?, result_ref=?, run_log=? WHERE id=?`)
      .run(status, this.now(), this.now(), err, rc, ref, runLog, id);
  }

  async serve() {
    this.log(`zcode-tui queue serve — state ${this.opts.stateDir} routes=${this.opts.routes.join(",")} poll=${this.opts.pollMs}ms${this.opts.dryRun ? " DRY-RUN" : ""}`);
    this.reclaimStale();
    let lastMetric = 0;
    while (!this.stopping) {
      this.heartbeat();
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

  stop() { this.stopping = true; }
}

// ---------------------------------------------------------------------------

async function main() {
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
      "dry-run": { type: "boolean", default: false },
    },
  });
  const sub = String(process.argv[2] ?? "");
  const stateDir = values["state-dir"] ? String(values["state-dir"]) : defaultStateDir();
  const db = openDb(stateDir);
  switch (sub) {
    case "enqueue": {
      if (!values.route || !values["prompt-file"]) {
        console.error("usage: zcode-tui queue enqueue --prompt-file F --workspace W --route R [--title T --model M --priority N --max-attempts N]");
        process.exit(2);
      }
      cmdEnqueue(db, values as Record<string, string | boolean | undefined>);
      break;
    }
    case "list": cmdList(db, Boolean(values.json)); break;
    case "status": cmdStatus(db, Boolean(values.json), stateDir); break;
    case "serve": {
      const routes = (values.routes ? String(values.routes).split(",") : ROUTE_NAMES as unknown as string[])
        .map((r) => String(r).trim()).filter((r) => ROUTE_NAMES.includes(r as RouteName)) as RouteName[];
      const srv = new QueueServer(db, {
        pollMs: Math.max(1000, Number(values["poll-ms"])),
        metricsMs: Math.max(5000, Number(values["metrics-ms"])),
        routes: routes.length ? routes : ROUTE_NAMES,
        stateDir, dryRun: Boolean(values["dry-run"]),
      });
      const shutdown = () => { srv.stop(); };
      process.on("SIGTERM", shutdown);
      process.on("SIGINT", shutdown);
      await srv.serve();
      break;
    }
    default:
      console.error("usage: zcode-tui queue <enqueue|list|status|serve> [...]");
      console.error("  enqueue --prompt-file F --workspace W --route R [--title T --model M --priority N]");
      console.error(`  routes: ${ROUTE_NAMES.join(", ")}`);
      process.exit(2);
  }
  db.close();
}

if (import.meta.main) await main();
