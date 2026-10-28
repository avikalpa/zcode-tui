// zcode-tui idle — ZCode Idle-time tasks, client-side (unofficial).
//
//   zcode-tui idle list [--json]        read-only view of off_peak_tasks
//                                       (queue positions, statuses — parity
//                                       with the ZCode Automations panel)
//   zcode-tui idle create --prompt-file F [--workspace W] [--title T]
//                          [--model M] [--json]
//                                       create ONE idle-time task by driving
//                                       the runtime's own OffPeakCreate tool
//                                       in a session created with
//                                       offPeakToolEnabled:true (measured in
//                                       the packaged bundle, 2026-10-22).
//
// Carry-forward law: client, never reimplementation — we speak the same
// protocol the desktop speaks; server cooldowns and refusals surface as-is.
import { parseArgs } from "node:util";
import { readFileSync, writeFileSync, mkdirSync, statSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir, hostname } from "node:os";
import { AppServer } from "../protocol/client";
import { startHeartbeat } from "../queue/heartbeat";
import { parseCooldownMs } from "../queue/core";
import { handleOffPeakAsk, ticketAvailability,
  localExecutableTasks,
  adoptOrphanedTickets,
  pollTickets,
  offPeakMessages,
  settleTicket,
  setLocalTaskState,
  claimLocalTask,
  releaseLocalTask,
  registerOffPeakTask,
  openTasksIndex,
  admissionPhase,
  urgentReadyFirst} from "../queue/offpeak-gateway";
import { autoclawPiCli, UNATTENDED_PREAMBLE, piEventStreamHasError } from "./autoclaw";
import { syncAuthHeadless } from "../auth/sync";

const TASKS_INDEX = () =>
  process.env.ZCODE_TASKS_INDEX ?? join(homedir(), ".zcode", "v2", "tasks-index.sqlite");

// ---------------------------------------------------------------------------
// list — READ-ONLY against the desktop-owned index (never written here)
// ---------------------------------------------------------------------------

interface OffPeakRow {
  off_peak_task_id: string; server_ticket_id: string | null; title: string;
  session_id: string | null; prompt: string; status: string;
  queued_at: number | null; started_at: number | null; ended_at: number | null;
  queue_position: number | null; failure_reason: string | null;
  attempt_count: number | null; model_selection: string | null;
}

function cmdList(json: boolean) {
  const db = openTasksIndex(true);
  const rows = db.query(`SELECT off_peak_task_id, server_ticket_id, title, session_id, prompt, status,
    queued_at, started_at, ended_at, queue_position, failure_reason, attempt_count, model_selection
    FROM off_peak_tasks ORDER BY COALESCE(queued_at, 0) DESC`).all() as unknown as OffPeakRow[];
  db.close();
  if (json) {
    console.log(JSON.stringify(rows.map((r) => ({ ...r, prompt: r.prompt.slice(0, 200) })), null, 1));
    return;
  }
  if (rows.length === 0) { console.log("idle: no off-peak tasks in this host's index"); return; }
  const iso = (n: number | null) => (n ? new Date(n).toISOString().slice(5, 16).replace("T", " ") : "—");
  console.log(`${"ticket".padEnd(20)}${"status".padEnd(11)}${"pos".padEnd(4)}${"queued".padEnd(13)}${"ended".padEnd(13)}title`);
  for (const r of rows) {
    console.log(`${String(r.server_ticket_id ?? "—").padEnd(20)}${r.status.padEnd(11)}${String(r.queue_position ?? "—").padEnd(4)}${iso(r.queued_at).padEnd(13)}${iso(r.ended_at).padEnd(13)}${r.title.slice(0, 52)}`);
  }
  console.log(`\n(${rows.length} tasks; statuses: ${[...new Set(rows.map((r) => r.status))].join(", ")})`);
}

// ---------------------------------------------------------------------------
// create — drive the runtime's OffPeakCreate tool in a fresh session
// ---------------------------------------------------------------------------

async function cmdCreate(v: Record<string, string | boolean | undefined>) {
  syncAuthHeadless();
  const pf = String(v["prompt-file"] ?? "");
  if (!pf) { console.error("idle create: --prompt-file is required (- reads stdin)"); process.exit(2); }
  const prompt = pf === "-" ? await new Promise<string>((r) => { let s = ""; process.stdin.on("data", (d) => s += d); process.stdin.on("end", () => r(s)); }) : readFileSync(pf, "utf8");
  if (!prompt.trim()) { console.error("idle create: prompt is empty"); process.exit(2); }
  const title = v.title ? String(v.title) : prompt.trim().split("\n")[0].slice(0, 72);
  const workspace = v.workspace ? String(v.workspace) : process.cwd();
  const out = v.out ? String(v.out) : "/tmp/zt-idle-create-transcript.json";
  const modelArg = v.model ? String(v.model) : "";
  // Owner directive 2026-10-23: idle dreamers run FULL ACCESS by default
  // (yolo); every other mode is an explicit opt-down via --permission-mode.
  const permissionMode = v["permission-mode"] ? String(v["permission-mode"]) : "yolo";
  const PERMITTED = ["build", "edit", "plan", "yolo", "guarded"];
  if (!PERMITTED.includes(permissionMode)) {
    console.error(`idle create: --permission-mode must be one of ${PERMITTED.join(", ")}`);
    process.exit(2);
  }

  // --direct: register the ticket ourselves (local row + gateway POST) with
  // no CLI session — version-independent (the OffPeakCreate schema moved
  // between zcode 3.11 and 3.16; dev FATALed on it 2026-10-25) and ~0 tokens
  // instead of the ~600k the OffPeakCreate driver spends.
  if (v.direct) {
    const reg = await registerOffPeakTask({
      title, prompt, permissionMode,
      ...(modelArg ? { model: modelArg } : {}),
      workspacePath: workspace,
    });
    const summary = reg.ok
      ? { ok: true, offPeakTaskId: reg.task.offPeakTaskId, serverTicketId: null, title, workspace, queuePosition: reg.task.queuePosition ?? null, mode: "direct" }
      : { ok: false, error: reg.error, refusal: reg.refusal, cooldownMs: reg.cooldownMs, mode: "direct" };
    if (v.json) console.log("ZT-IDLE-CREATE " + JSON.stringify(summary));
    console.error(reg.ok ? `idle create: ${reg.message} (direct)` : `idle create FAILED: ${reg.error}${reg.refusal ? ` — ${reg.refusal}` : ""}`);
    if (v.out) writeFileSync(String(v.out), JSON.stringify(summary, null, 1) + "\n");
    process.exit(reg.ok ? 0 : 1);
  }

  let sawToolResult = "";
  let refusal = "";
  let lastToolError = "";
  let lastEventAt = Date.now();
  let turnEnded = false;
  let sessionId = "";
  let stopHb: (() => void) | null = null;
  const events: { ms: number; kind: string; summary: string }[] = [];

  const sv = new AppServer({
    onNotification: (m) => {
      const method = String(m.method);
      if (method !== "session/event") return;
      const p = ((m.params as Record<string, unknown>)?.payload ?? {}) as Record<string, unknown>;
      const kind = String(p.type ?? p.kind ?? "untyped");
      const text = JSON.stringify(p);
      lastEventAt = Date.now();
      events.push({ ms: Date.now(), kind, summary: text.slice(0, 200) });
      if (text.includes("offPeakTaskId") || text.includes("Created idle-time task")) sawToolResult = text.slice(0, 4000);
      if (/free tier|limit reached|can create another task/i.test(text)) refusal = text.slice(0, 800);
      // Extract the error MESSAGE (not the JSON preamble) so the queue's
      // classifier can pattern-match service-transient refusals in the tail.
      const errMsg = (p.error as Record<string, unknown> | undefined)?.message;
      if (typeof errMsg === "string" && errMsg) lastToolError = errMsg.slice(0, 400);
      if (kind === "result") turnEnded = true;
    },
    onServerRequest: (m) => {
      const method = String(m.method), id = String(m.id);
      if (method === "interaction/requestPermission") sv.respond(id, { decision: "allow" });
      else if (method === "interaction/requestUserInput") sv.respond(id, { cancelled: true });
      else if (method === "session/requestRuntimePreferences") sv.respond(id, { nativeSearchEnhancementsEnabled: false });
      else if (method === "offPeak/list" || method === "offPeak/create") {
        // We ARE the desktop-main equivalent in app-server mode (measured
        // 2026-10-23): answer the OffPeak surfaces from the local index +
        // the cloud ticket gateway, exactly as the desktop does.
        handleOffPeakAsk(method, (m.params as Record<string, unknown>) ?? {})
          .then((reply) => sv.respond(id, reply ?? {}))
          .catch((e) => {
            console.error(`idle create: offPeak ask ${method} failed: ${e instanceof Error ? e.message : e}`);
            sv.respond(id, method === "offPeak/create"
              ? { ok: false, failureStage: "remote", errorCategory: "network", errorCode: "ask_failed", error: String(e) }
              : {});
          });
      }
      else sv.respond(id, {});
    },
  }, { onStderr: (c) => process.stderr.write(c.slice(0, 200)) });

  try {
    const resumeArg = v.resume ? String(v.resume) : "";
    if (resumeArg) {
      // Probe shape (owner 2026-10-23): resume a long-completed session —
      // its server-side state is stable, so the ticket service's
      // "verify this session has no pending idle task" lookup can resolve.
      sessionId = resumeArg;
    } else {
      const createParams: Record<string, unknown> = {
        workspace: { workspacePath: workspace, workspaceKey: workspace },
        mode: "build",
        persistence: "immediate",
        offPeakToolEnabled: true, // measured in the bundle: opts the OffPeakCreate tool into the session
      };
      if (modelArg) {
        try { createParams.model = JSON.parse(modelArg); } catch { createParams.model = { modelId: modelArg, providerId: "zai" }; }
      }
      const created = (await sv.request("session/create", createParams, 30000)) as Record<string, unknown>;
      const sAny = (created.session ?? created) as unknown;
      sessionId = typeof sAny === "string" ? sAny : String((sAny as Record<string, unknown>)?.sessionId ?? "");
    }
    console.error(`idle create: session ${sessionId}`);
    if (resumeArg) {
      await sv.request("session/resume", { sessionId }, 30000);
      // offPeakToolEnabled is create-time; resumed sessions restore the
      // original config — re-arm the tool explicitly (session/update
      // schema carries offPeakToolEnabled, mined from the bundle).
      try {
        await sv.request("session/update", { sessionId, offPeakToolEnabled: true }, 15000);
        console.error("idle create: session/update offPeakToolEnabled=true");
      } catch (e) {
        console.error(`idle create: session/update rejected (${e instanceof Error ? e.message : e})`);
      }
    }
    await sv.request("session/subscribe", { sessionId, deliveryKind: "desktop-continuous", includeSnapshot: true }, 20000);
    // Liveness for the queue's stall sweeper (BUG-001).
    stopHb = startHeartbeat(`${out}.hb`);
    if (v.warmup) {
      // Turn 1: a trivial exchange so the session exists server-side with
      // real history before it asks for an idle-time ticket.
      turnEnded = false;
      await sv.request("session/send", { sessionId, content: "Reply with exactly: OK" });
      const w0 = Date.now();
      while (Date.now() - w0 < 180_000) {
        await new Promise((r) => setTimeout(r, 3000));
        if (turnEnded && Date.now() - lastEventAt > 8_000) break;
      }
      console.error(`idle create: warm-up turn settled (${Date.now() - w0}ms, turnEnded=${turnEnded})`);
    }
    const brief = [
      "You are being driven programmatically by zcode-tui (fleet worker).",
      "Call the tool EXACTLY named OffPeakCreate NOW (never CronCreate, never any other create/schedule tool).",
      "If OffPeakCreate is not in your tool list, reply with exactly OFFPEAK-MISSING and stop.",
      "Arguments:",
      `- title: ${JSON.stringify(title.slice(0, 120))}`,
      "- prompt: the text between <prompt> markers below, verbatim, unmodified:",
      `<prompt>\n${prompt}\n</prompt>`,
      `- permissionMode: ${JSON.stringify(permissionMode)}`,
      "Do not ask questions. Do not create any other task or automation.",
      "When the tool returns, output its message verbatim and stop.",
    ].join("\n");
    await sv.request("session/send", { sessionId, content: brief });

    const t0 = Date.now();
    while (Date.now() - t0 < 600_000) {
      await new Promise((r) => setTimeout(r, 5000));
      if (sawToolResult || refusal) {
        // let the turn finish printing, then settle
        if (Date.now() - lastEventAt > 45_000) break;
      } else if (Date.now() - lastEventAt > 150_000) break; // nothing happened — settle
    }
    try { await sv.request("session/stop", { sessionId }); } catch { /* already ended */ }

    stopHb?.();
    stopHb = null;
    mkdirSync(dirname(out), { recursive: true }); // --out parent may not exist on a fresh host
    writeFileSync(out, JSON.stringify({ sessionId, title, sawToolResult, refusal, events }, null, 1));

    if (sawToolResult) {
      const idm = sawToolResult.match(/"offPeakTaskId"\s*:\s*"([^"]+)"/);
      const posm = sawToolResult.match(/"queuePosition"\s*:\s*(\d+)/);
      const offPeakTaskId = idm?.[1] ?? "";
      const queuePosition = posm ? Number(posm[1]) : null;
      // Verify the ticket landed in this host's task index (server_ticket_id).
      let ticket: string | null = null;
      for (let i = 0; i < 6 && !ticket; i++) {
        try {
          const db = openTasksIndex(true);
          const row = db.query(`SELECT server_ticket_id FROM off_peak_tasks WHERE off_peak_task_id=?`).get(offPeakTaskId) as { server_ticket_id: string | null } | null;
          db.close();
          ticket = row?.server_ticket_id ?? null;
        } catch { /* index not present on this host */ }
        if (!ticket) await new Promise((r) => setTimeout(r, 3000));
      }
      const payload = { ok: true, sessionId, offPeakTaskId, queuePosition, serverTicketId: ticket, permissionMode };
      console.log(`ZT-IDLE-CREATE ${JSON.stringify(payload)}`);
      console.log(`idle create: task ${offPeakTaskId}${queuePosition ? ` (#${queuePosition} in queue)` : ""} mode=${permissionMode}${ticket ? ` ticket ${ticket}` : " (ticket not yet visible in local index)"} -> ${out}`);
      if (v.json) console.log(JSON.stringify(payload));
      await sv.close();
      return;
    }
    if (refusal) {
      const cd = parseCooldownMs(refusal);
      console.error(`idle create: REFUSED by server: ${refusal.replace(/\\n/g, " ").slice(0, 400)}`);
      console.error(`idle create: cooldown parsed: ${cd !== null ? Math.round(cd / 60000) + " min" : "none"}`);
      await sv.close();
      process.exit(3); // queue serve parses the cooldown from this output
    }
    console.error(`idle create: no OffPeakCreate result observed (tool unavailable or turn empty) — transcript: ${out}`);
    // Surface the last tool error message verbatim: the queue's classifier
    // reads this tail (service-transient refusals park the route, not the task).
    if (lastToolError) console.error(`idle create: last tool error: ${lastToolError}`);
    await sv.close();
    process.exit(4);
  } catch (e) {
    console.error(`idle create FATAL: ${e instanceof Error ? e.message : String(e)}`);
    try { if (sessionId) await sv.request("session/stop", { sessionId }); } catch { /* noop */ }
    await sv.close();
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------

async function cmdPoll(json: boolean) {
  const adopted = adoptOrphanedTickets();
  for (const a of adopted) console.error(`idle poll: adopted orphaned registration ${a.task} -> ticket ${a.ticket}`);
  const rows = localExecutableTasks();
  if (rows.length === 0) { if (json) console.log(JSON.stringify({ tickets: [] })); else console.log("idle poll: no live tickets"); return 0; }
  const res = await pollTickets(rows.map((r) => r.serverTicketId));
  const byTicket = new Map(res.tickets.map((t) => [t.ticketId, t]));
  const out: Record<string, unknown>[] = [];
  for (const r of rows) {
    const t = byTicket.get(r.serverTicketId);
    const state = t?.state ?? "unknown";
    if (state === "running") setLocalTaskState(r.offPeakTaskId, "running", { startedAt: Date.now() });
    // Honesty (measured 2026-10-27): the server settles tickets on its own —
    // expiry after failed usage, deadline paths — and "settled" does NOT mean
    // the work succeeded. Map settled->completed only when the row carries no
    // failure; otherwise keep the failure visible.
    if (state === "completed" || state === "settled") {
      const db2 = openTasksIndex(true);
      const fr = (db2.query(`SELECT failure_reason FROM off_peak_tasks WHERE off_peak_task_id=?`).get(r.offPeakTaskId) as { failure_reason: string | null } | null)?.failure_reason ?? null;
      db2.close();
      setLocalTaskState(r.offPeakTaskId, fr ? "failed" : "completed", { endedAt: Date.now(), ...(fr ? { failureReason: `ticket settled server-side after failure: ${fr.slice(0, 120)}` } : {}) });
    }
    // Expired / window-missed rows are terminal locally too (allowance
    // consumed) — leaving them queued made the serve poll dead tickets
    // forever (1110+ polls of one expired id, measured 2026-10-27/28) and
    // hid that the WORK is still pending. The failure reason says both.
    const phase = t ? admissionPhase(t, Date.now()) : "stand-down";
    if (state === "expired" || phase === "window-missed") {
      const why = state === "expired"
        ? "ticket expired server-side — allowance consumed, work NOT done (pending)"
        : `grant window missed (ready_deadline ${t?.readyDeadline != null ? new Date(t.readyDeadline).toISOString() : "?"} +60s grace) — allowance consumed, work NOT done (pending)`;
      setLocalTaskState(r.offPeakTaskId, "failed", { endedAt: Date.now(), failureReason: why });
    }
    if (typeof t?.position === "number") setLocalTaskState(r.offPeakTaskId, r.status === "running" ? "running" : "queued", { queuePosition: t.position });
    out.push({ task: r.offPeakTaskId, ticket: r.serverTicketId, title: r.title.slice(0, 60), state, ...(t?.position != null ? { position: t.position } : {}), ...(t?.readyDeadline != null ? { readyDeadline: t.readyDeadline } : {}) });
  }
  if (json) console.log(JSON.stringify({ tickets: out, error: res.error }, null, 1));
  else for (const o of out) console.log(`idle poll: ${o.ticket} ${o.state}${o.position != null ? ` #${o.position}` : ""}${o.readyDeadline != null ? ` rd=${new Date(Number(o.readyDeadline)).toISOString()}` : ""} — ${o.title}`);
  return 0;
}

// Fleet single-flight admission (sol DD verdict 3, 2026-10-27): the local
// claim_running only coordinates workers sharing ONE index — three hosts hold
// three databases, and nothing server-side serializes granted tickets we can
// see. The fleet-shared dataset gives us a portable mkdir lock: one idle exec
// account-wide at a time, stale stamp stealable after 3h (crash tolerance).
const FLEET_LOCK_ROOT = () =>
  process.env.ZTQ_FLEET_LOCK_DIR ?? join(homedir(), "data", "fleet-locks");

function acquireFleetExecLock(ticket: string): boolean {
  const root = join(FLEET_LOCK_ROOT(), "ztq-idle-exec");
  try {
    mkdirSync(FLEET_LOCK_ROOT(), { recursive: true });
    try {
      mkdirSync(root); // atomic: exists => held
    } catch {
      try {
        if (Date.now() - statSync(join(root, "stamp.txt")).mtimeMs < 3 * 3600_000) return false;
        rmSync(root, { recursive: true, force: true });
        mkdirSync(root);
      } catch { return false; }
    }
    writeFileSync(join(root, "stamp.txt"), `${ticket} ${hostname()} ${process.pid} ${Date.now()}\n`);
    return true;
  } catch {
    return true; // lock plane unavailable — fail open; ticket state still guards
  }
}

function releaseFleetExecLock(): void {
  try { rmSync(join(FLEET_LOCK_ROOT(), "ztq-idle-exec"), { recursive: true, force: true }); } catch { /* absent */ }
}

function honestRc0(code: number | null, providerError: boolean): boolean {
  return code === 0 && !providerError;
}

async function cmdExec(v: Record<string, string | boolean | undefined>): Promise<number> {
  adoptOrphanedTickets();
  const rows = localExecutableTasks();
  const taskSel = v.task ? String(v.task) : "";
  const ticketSel = v.ticket ? String(v.ticket) : "";
  let row = rows.find((r) => r.offPeakTaskId === taskSel || r.serverTicketId === ticketSel);
  if (!row && !taskSel && !ticketSel && rows.length > 0) row = rows[0];
  if (!row) { console.error("idle exec: no live ticket row matches (run `zcode-tui idle poll`)"); return 2; }

  // Phase-aware pre-check (sol Q4): one poll, then ONE retry when the read
  // came back empty/unknown — 6 of 7 pre-checks on 2026-10-27 raced a
  // transient read flap (unknown rate ~1.4% on quiet polls) and stood down
  // while a REAL grant expired. After that, the server's own deadlines
  // decide: admission past ready_deadline+grace is the measured 3104 source
  // (T-038 admitted +8m44s against a +5m56s window) and is refused here.
  let st = await pollTickets([row.serverTicketId]);
  let pt = st.tickets[0];
  if (!pt) {
    await new Promise((r) => setTimeout(r, 4000));
    st = await pollTickets([row.serverTicketId]);
    pt = st.tickets[0];
  }
  const state = pt?.state ?? "unknown";
  const phase = pt ? admissionPhase(pt, Date.now()) : "stand-down";
  if (phase === "expired") {
    setLocalTaskState(row.offPeakTaskId, "failed", { endedAt: Date.now(), failureReason: "ticket expired server-side — allowance consumed, work NOT done (pending)" });
    console.log(`idle exec: ticket ${row.serverTicketId} expired — allowance consumed, work left pending`);
    return 4;
  }
  if (phase === "window-missed") {
    setLocalTaskState(row.offPeakTaskId, "failed", { endedAt: Date.now(), failureReason: `grant window missed (ready_deadline ${pt?.readyDeadline != null ? new Date(pt.readyDeadline).toISOString() : "?"} +60s grace) — allowance consumed, work NOT done (pending)` });
    console.log(`idle exec: ticket ${row.serverTicketId} state=${state} past its ready window — admission here is the 3104 source; work left pending`);
    return 4;
  }
  if (phase !== "admit") {
    console.log(`idle exec: ticket ${row.serverTicketId} state=${state}${pt?.position != null ? ` #${pt.position}` : ""} (phase=${phase}; poll again later)`);
    return 3;
  }

  const model = v.model ? String(v.model) : row.model;
  const workspace = v.workspace ? String(v.workspace) : row.workspacePath;
  const out = v.out ? String(v.out) : `/tmp/zt-idle-exec-${row.serverTicketId}.json`;
  const cli = autoclawPiCli();
  if (!cli) { console.error("idle exec: pi harness not found (appimage or `--vendor` install)"); return 2; }
  // Claim only after every precondition passed (measured 2026-10-26: a claim
  // taken before the harness check wedged the row claimed on an early bail —
  // oc's first READY ticket stalled one tick). From here on, every exit path
  // below either completes, fails terminally, or releases explicitly.
  if (!claimLocalTask(row.offPeakTaskId)) {
    console.error(`idle exec: row ${row.offPeakTaskId} already claimed (claim_running=1) — another executor owns it`);
    return 2;
  }
  if (!acquireFleetExecLock(row.serverTicketId)) {
    releaseLocalTask(row.offPeakTaskId);
    console.error("idle exec: fleet single-flight — another host holds the exec lock; row left queued for the next tick");
    return 3;
  }

  // Local admission proxy: forwards /v1/messages to the off-peak anthropic
  // gateway with the ticket header; retries 429 not-ready on the gateway's
  // own retry-after up to a bound; 3102 passes through (dead ticket).
  const target = row;
  const wire: Array<{ at: number; status: number; bodyHead: string; respHead: string; repaired?: boolean }> = [];
  const proxy = Bun.serve({
    hostname: "127.0.0.1", port: 0, idleTimeout: 255,
    async fetch(req): Promise<Response> {
      const url = new URL(req.url);
      if (url.pathname === "/healthz") return Response.json({ ok: true, ticket: target.serverTicketId });
      const body = new Uint8Array(await req.arrayBuffer());
      let payload = new TextDecoder().decode(body);
      for (let attempt = 0; attempt < 60; attempt++) {
        // The desktop's successful off-peak bodies carry metadata +
        // tool_choice + output_config (mined from its model-io rollouts);
        // without them the gateway 3001s ("parameter error") even on
        // otherwise-clean bodies. Shape ours to match.
        try {
          const doc = JSON.parse(payload) as Record<string, unknown>;
          doc.metadata ??= { user_id: "zcode-tui-worker" };
          doc.tool_choice ??= { type: "auto" };
          doc.output_config ??= { effort: "max" }; // owner law: MAX thinking on all plans
          payload = JSON.stringify(doc);
        } catch { /* non-JSON body — forward as-is */ }
        let res = await offPeakMessages(target.serverTicketId, payload);
        // Gateway 3001 "parameter error": one repair attempt with a normalized
        // body (lowercased model id, no stream field) — the canary falsifier
        // died here 2026-10-23 with zero diagnostics; never again silently.
        if (res.status === 400 && /"code"\s*:\s*3001/.test(await res.clone().text()) && !wire.some((w) => w.repaired)) {
          try {
            const doc = JSON.parse(payload) as Record<string, unknown>;
            if (typeof doc.model === "string") doc.model = doc.model.toLowerCase();
            delete doc.stream;
            payload = JSON.stringify(doc);
            wire.push({ at: Date.now(), status: 400, bodyHead: payload.slice(0, 300), respHead: "3001 -> repair retry", repaired: true });
            res = await offPeakMessages(target.serverTicketId, payload);
          } catch { /* unparseable body — pass the original through */ }
        }
        if (res.status === 429) {
          const retryAfter = Number(res.headers.get("retry-after") ?? "5");
          await new Promise((r) => setTimeout(r, Math.min(30, Math.max(2, retryAfter)) * 1000));
          continue;
        }
        if (res.status !== 200) {
          wire.push({ at: Date.now(), status: res.status, bodyHead: payload.slice(0, 4000), respHead: (await res.clone().text()).slice(0, 400) });
        }
        return new Response(res.body, { status: res.status, headers: { "content-type": res.headers.get("content-type") ?? "application/json" } });
      }
      return Response.json({ error: "admission_retry_exhausted" }, { status: 429 });
    },
  });

  try {
    const dir = join(process.env.HOME ?? homedir(), ".local", "state", "zcode-tui", "idle-agent");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "models.json"), JSON.stringify({
      providers: { offpeak: {
        name: "Z.AI off-peak idle plan (managed by zcode-tui)",
        baseUrl: `http://127.0.0.1:${proxy.port}`,
        apiKey: "managed-by-zcode-tui",
        api: "anthropic-messages",
        // reasoning:false — pi then omits the `thinking` field, which the
        // off-peak gateway rejects with 3001 parameter error (measured:
        // canary/T-037/canary-retry all died on it, 2026-10-23).
        // Owner law: MAX thinking everywhere. reasoning:true makes pi emit the
        // thinking field; the proxy pairs it with output_config effort:max.
        models: [{ id: model, name: model, reasoning: true, contextWindow: 262_144, maxTokens: 32_768 }],
      } },
    }, null, 2) + "\n");
    setLocalTaskState(row.offPeakTaskId, "running", { startedAt: Date.now() });
    const { spawn } = await import("node:child_process");
    // Runtime pin (measured 2026-10-27): when the serve runs from a compiled
    // binary, process.execPath is THAT binary — after a mv-deploy it reads
    // "(deleted)" and every spawn dies ENOENT in 0.04s while polling keeps
    // working (the phantom-completed class, jojo). The stable JS runtime is
    // the host's own bun; fall back to self only when it is absent.
    const selfBin = process.execPath;
    const stableBun = join(homedir(), ".bun", "bin", "bun");
    const jsRuntime = existsSync(stableBun) && !selfBin.endsWith("/bun") ? stableBun : selfBin;
    const t0 = Date.now();
    const args = [cli, "--print", "--mode", "json", "--provider", "offpeak", "--model", model,
      "--append-system-prompt", UNATTENDED_PREAMBLE, row.prompt];
    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
      const p = spawn(jsRuntime, args, { cwd: workspace, env: { ...process.env, PI_CODING_AGENT_DIR: dir }, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "", stderr = "";
      const cap = 8 << 20;
      p.stdout.on("data", (d: Buffer) => { if (stdout.length < cap) stdout += d.toString(); });
      p.stderr.on("data", (d: Buffer) => { if (stderr.length < cap) stderr += d.toString(); });
      // Deadline is task-configurable (sol DD verdict 2, 2026-10-27): a
      // fixed 120min SIGKILL is incompatible with admitting arbitrary BIG
      // tasks. --max-minutes / ZTQ_IDLE_MAX_MINUTES, policy-bounded 5..600.
      const maxMinutes = Math.max(5, Math.min(600, Number(v["max-minutes"] ?? process.env.ZTQ_IDLE_MAX_MINUTES ?? 120)));
      const timer = setTimeout(() => p.kill("SIGKILL"), maxMinutes * 60_000);
      // Fail honestly on a failed spawn instead of hanging on a child that
      // never started (same zombie class as autoclaw.ts, 2026-10-23).
      let done = false;
      const finish = (code: number | null, note?: string) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve({ code, stdout, stderr: note ? `${stderr}
${note}` : stderr });
      };
      p.on("error", (e: Error) => finish(null, `spawn error: ${e.message}`));
      p.on("close", (code) => finish(code));
    });
    mkdirSync(dirname(out), { recursive: true });
    // pi --print exits 0 even on provider errors (measured 2026-10-23:
    // stopReason "error" + zero tokens) — a zero-work turn must never ride
    // home as completed, and the settle below must not mask it.
    const providerError = result.code === 0 && piEventStreamHasError(result.stdout);
    const errMatch = result.stdout.match(/"errorMessage":"([^"]{0,300})"/);
    writeFileSync(out, JSON.stringify({ ticket: row.serverTicketId, task: row.offPeakTaskId, model, workspace, elapsedSec: (Date.now() - t0) / 1000, rc: result.code, providerError, providerErrorMessage: providerError ? errMatch?.[1] : undefined, wire, stdout: result.stdout.slice(-200_000), stderr: result.stderr.slice(-20_000) }, null, 1));
    // Honesty: do NOT settle a provider-errored turn immediately — the
    // settle releases the slot and the desktop marks it Succeeded (settled
    // semantics), and it burned a bisect slot mid-experiment. Settle only on
    // honest success or a dead ticket; provider errors leave the ticket for
    // the deadline/expire path so the failure stays inspectable.
    // sol xhigh v6 (2026-10-27): settlement proves nothing beyond its
    // demonstrated contract — settling a killed run invents completion.
    // Settle ONLY on honest rc=0; interruptions record cleanup_pending and
    // leave the ticket for its documented expiry/cancel path.
    const killed = result.code === null;
    const settle = honestRc0(result.code, providerError)
      ? await settleTicket(row.serverTicketId)
      : { ok: false, detail: killed ? "skipped (killed — cleanup_pending)" : "skipped (failed run — ticket left unsettled)" };
    const honestRc = providerError ? 1 : (result.code ?? 1);
    // Failure classification (D2 rework 2026-10-26): a dead ticket (3102
    // passes through by contract; 3104 = bogus/expired — both measured that
    // night) is terminal, everything else is retryable — the ticket is
    // still granted server-side and a fresh messages call may simply pass
    // (the Bun-TLS 3012 class). Bound: attempt_count reaches 3 -> failed.
    // sol xhigh v1: 3102 "wrong off-peak ticket" must not auto-mean "expired"
    // — record ticket_rejected and stop the attempt; only 3104 (bogus/unknown
    // ticket) is authoritative enough to end the lifecycle locally, and even
    // then the reason names the code. Rejected admission is preserved.
    const rejected3102 = wire.some((w) => /\b3102\b/.test(w.respHead)) || /"code"\s*:\s*3102/.test(errMatch?.[1] ?? "");
    const deadTicket = wire.some((w) => /\b3104\b/.test(w.respHead)) || /"code"\s*:\s*3104/.test(errMatch?.[1] ?? "");
    if (honestRc === 0) {
      setLocalTaskState(row.offPeakTaskId, "completed", { endedAt: Date.now() });
    } else if (deadTicket || row.attemptCount >= 3) {
      const why = deadTicket ? "ticket_rejected: 3104 unknown ticket" : `attempts exhausted (${row.attemptCount + 1})`;
      setLocalTaskState(row.offPeakTaskId, "failed", { endedAt: Date.now(), failureReason: `${why}${rejected3102 ? " [+3102 rejected: not interpreted as expiry]" : ""}${providerError ? ` provider error: ${errMatch?.[1] ?? "unknown"}` : ` pi rc=${result.code}`}`.slice(0, 200) });
    } else if (killed) {
      // cleanup_pending: the ticket's remote state is unknown — reconcile
      // before re-admitting; never requeue blindly into a possible live run.
      setLocalTaskState(row.offPeakTaskId, "cleanup_pending", { failureReason: `killed at cap (rc=null) — remote cleanup unconfirmed; reconcile before re-exec` });
      releaseLocalTask(row.offPeakTaskId);
    } else {
      // Retryable: back to queued, release the claim, keep started_at/ended_at
      // untouched — the serve loop re-claims on its next tick.
      setLocalTaskState(row.offPeakTaskId, "queued", { failureReason: `attempt ${row.attemptCount + 1} retryable${providerError ? `: ${errMatch?.[1] ?? "unknown"}` : ` pi rc=${result.code}`}`.slice(0, 200) });
      releaseLocalTask(row.offPeakTaskId);
    }
    console.log(`idle exec: rc=${honestRc}${providerError ? " (provider error inside pi stream)" : ""} attempt=${row.attemptCount + 1}${honestRc !== 0 ? (deadTicket ? " dead-ticket" : row.attemptCount >= 3 ? " attempts-exhausted" : " retryable(requeued)") : ""} in ${Math.round((Date.now() - t0) / 1000)}s, settle=${settle.ok ? "ok" : settle.detail} -> ${out}`);
    return honestRc === 0 ? 0 : 1;
  } finally {
    proxy.stop(true);
    releaseFleetExecLock();
  }
}

async function cmdServe(v: Record<string, string | boolean | undefined>): Promise<number> {
  const pollS = Math.max(30, Number(v["poll-s"] ?? 120));
  console.log(`idle serve: polling every ${pollS}s (ctrl-c to stop)`);
  for (;;) {
    try {
      await cmdPoll(false);
      const live = localExecutableTasks();
      if (live.length > 0) {
        const st = await pollTickets(live.map((r) => r.serverTicketId));
        // Single-flight stays (one exec account-wide), but the PICK is
        // urgent-first: the ready ticket closest to losing its grant goes
        // now. First-ready-only starves siblings — T-039's grant expired
        // behind T-038's failing retries (measured 2026-10-27).
        const readyTicket = st.tickets
          .filter((t) => admissionPhase(t, Date.now()) === "admit")
          .sort(urgentReadyFirst)[0];
        if (readyTicket) {
          console.log(`idle serve: ticket ${readyTicket.ticketId} is ${readyTicket.state} — executing`);
          await cmdExec({ ticket: readyTicket.ticketId });
        }
      }
    } catch (e) {
      console.error(`idle serve: tick failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    await new Promise((r) => setTimeout(r, pollS * 1000));
  }
}

// ---------------------------------------------------------------------------

async function cmdQuota(json: boolean) {
  const a = await ticketAvailability();
  const payload: Record<string, unknown> = a.nextTakeAt
    ? { canCreateNow: false, resetsAt: new Date(a.nextTakeAt).toISOString(), resetsInMin: Math.max(0, Math.round((a.nextTakeAt - Date.now()) / 60000)) }
    : { canCreateNow: a.canTake };
  if (a.error) payload.error = a.error;
  if (json) { console.log(JSON.stringify(payload, null, 1)); return; }
  console.log(`idle quota: ${payload.canCreateNow === true ? "CAN CREATE NOW" : `cooldown — resets at ${payload.resetsAt} (in ${payload.resetsInMin}m)`}${a.error ? ` [${a.error}]` : ""}`);
}

export async function main(): Promise<void> {
  // parseArgs at entry time, never module level: import-time parsing throws
  // on another verb's argv when this module is imported (production bug
  // class caught by the 1.0.0 trial run, 2026-10-23; the compiled binary's
  // verb router imports it the same way).
  const { values } = parseArgs({
    allowPositionals: true,
    options: {
      json: { type: "boolean", default: false },
      "prompt-file": { type: "string" },
      workspace: { type: "string" },
      title: { type: "string" },
      model: { type: "string" },
      "permission-mode": { type: "string" },
      direct: { type: "boolean", default: false },
      task: { type: "string" },
      ticket: { type: "string" },
      "poll-s": { type: "string" },
      "max-minutes": { type: "string" },
      warmup: { type: "boolean", default: false },
      resume: { type: "string", default: "" },
      out: { type: "string" },
    },
  });
  const sub = String(process.argv[2] ?? "");
  if (sub === "list") cmdList(Boolean(values.json));
  else if (sub === "quota") await cmdQuota(Boolean(values.json));
  else if (sub === "create") await cmdCreate(values as Record<string, string | boolean | undefined>);
  else if (sub === "poll") process.exit(await cmdPoll(Boolean(values.json)));
  else if (sub === "exec") process.exit(await cmdExec(values as Record<string, string | boolean | undefined>));
  else if (sub === "serve") process.exit(await cmdServe(values as Record<string, string | boolean | undefined>));
  else {
    console.error("usage: zcode-tui idle <list|quota|create> [...]");
    console.error("  list [--json]");
    console.error("  quota [--json]    # availability + free-tier reset time (gateway)");
    console.error("  create --prompt-file F [--workspace W] [--title T] [--model M]");
    console.error("         [--permission-mode yolo|build|edit|plan|guarded] [--json]");
    console.error("         (permission-mode defaults to yolo - full access, owner directive 2026-10-23)");
    console.error("  poll [--json]     # refresh ticket states for local rows (+ orphan adoption)");
    console.error("  exec [--task T | --ticket N] [--model M] [--workspace W] [--out O] [--max-minutes N]");
    console.error("                    # execute a READY ticket through the off-peak gateway (pi agent)");
    console.error("  serve [--poll-s N] # poll + execute loop (the desktop claim loop, on this host)");
    process.exit(2);
  }
}

if (import.meta.main) {
  void main();
}
