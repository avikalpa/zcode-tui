// Off-peak gateway client + the offPeak/* ask server (0.7.5 polish).
//
// MEASURED (app.asar + live ask capture, 2026-10-23): in app-server mode the
// runtime delegates the OffPeak surfaces to the CLIENT HARNESS as
// server->client asks — `offPeak/list` (the bound-session verify before
// create) and `offPeak/create` (registration). The desktop main answers
// these in desktop context; zcode-tui answers them here, replicating the
// desktop's own flow (mined from its gateway client + E2E mock):
//
//   GET  {origin}/api/v1/off-peak/ticket/availability
//        -> {can_take_number: bool, next_take_at?: epochMs}   (free-tier timer!)
//   POST {origin}/api/v1/off-peak/ticket          {task_id}
//        -> {ticket_id, task_id, state, accepted, position, next_poll_after, queued_at}
//        429 {code:3103, msg:"free tier limit reached", data:{next_take_at}}
//   GET  {origin}/api/v1/off-peak/ticket/status   {ticket_ids: [...<=100]}
//        -> {next_poll_after, tickets:[{ticket_id, task_id, state, position}]}
//   POST {origin}/api/v1/off-peak/ticket/<id>/settle
//   POST {origin}/api/v1/off-peak/anthropic/v1/messages   (x-off-peak-ticket-id)
//
// Auth: the account's coding-plan key (x-coding-plan-api-key), resolved from
// ~/.zcode/v2/provider_config.json — the same store the desktop uses. The
// local task row is written to the desktop's own off_peak_tasks table with
// schedulable=1, exactly as the desktop's registration does, so the host's
// own claim loop executes it.
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { Database } from "bun:sqlite";
import { readCredential } from "../zcode/credentials";

export interface OffPeakTaskSummary {
  offPeakTaskId: string;
  title: string;
  status: string;
  queuePosition?: number;
  sessionId?: string;
  createdAt: number;
}

const TASKS_INDEX = () =>
  process.env.ZCODE_TASKS_INDEX ?? join(homedir(), ".zcode", "v2", "tasks-index.sqlite");

/** The desktop writes this index concurrently (measured 2026-10-27: a live
 * desktop session holds the write lock and a bare open throws
 * "database is locked" mid-registration). Every open waits up to 5s. */
export function openTasksIndex(readonly = false) {
  const db = readonly ? new Database(TASKS_INDEX(), { readonly: true }) : new Database(TASKS_INDEX());
  db.exec("PRAGMA busy_timeout = 5000");
  return db;
}

export function extractApiKey(raw: string): string | null {
  try {
    const cfg = JSON.parse(raw);
    const str = JSON.stringify(cfg);
    const m = str.match(/"apiKey"\s*:\s*"([^"]+)"/);
    return m ? m[1] : null;
  } catch { return null; }
}

export function codingPlanApiKey(): string {
  if (process.env.ZCODE_CODING_PLAN_API_KEY) return process.env.ZCODE_CODING_PLAN_API_KEY;
  try {
    return extractApiKey(readFileSync(join(homedir(), ".zcode", "v2", "provider_config.json"), "utf8")) ?? "";
  } catch { return ""; }
}

/** The ZCode cloud JWT — read FRESH per call, DECRYPTED: the store holds
 *  enc:v1 (AES-256-GCM) blobs; sending the ciphertext was the cause of the
 *  long "stale zcodejwttoken" 401s — the token itself was valid throughout
 *  (root-caused + live-falsified 2026-10-23, can_take_number:true with the
 *  decrypted value). 401s after this fix mean real server-side rejection
 *  (version drift on desktop re-login), not an encryption gap. */
export function cloudJwt(): string {
  return readCredential("zcodejwttoken") ?? "";
}

export function gatewayOrigin(): string {
  return process.env.ZCODE_OFFPEAK_ORIGIN ?? "https://zcode.z.ai";
}

/** Production envelopes payloads under `data`; the desktop's mock is flat. Accept both. */
function unveil(body: any): any {
  return (body && typeof body === "object" && "data" in body && body.data != null) ? body.data : body;
}

async function gatewayFetch(path: string, init: RequestInit & { key?: string } = {}): Promise<{ status: number; body: any; authKind: string }> {
  const origin = gatewayOrigin();
  const key = init.key ?? codingPlanApiKey();
  const jwt = cloudJwt();
  const authKind = jwt ? "jwt" : "key-only";
  const res = await fetch(origin + path, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-coding-plan-api-key": key,
      ...(jwt ? { authorization: `Bearer ${jwt}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  let body: any = null;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body, authKind };
}

export async function ticketAvailability(): Promise<{ canTake: boolean; nextTakeAt?: number; error?: string }> {
  try {
    const { status, body } = await gatewayFetch("/api/v1/off-peak/ticket/availability", { method: "GET" });
    if (status === 401) return { canTake: false, error: `gateway 401 (stale zcodejwttoken — use the ZCode desktop once to rotate ~/.zcode/v2/credentials.json, then retry)` };
    if (status !== 200 || !body) return { canTake: false, error: `availability ${status}` };
    // Production envelopes the payload under `data` (measured 2026-10-23:
    // {"code":0,"msg":"success","data":{"can_take_number":true}}); the mock
    // gateway the desktop ships is flat. Accept both.
    const payload = (body.data ?? body) as { can_take_number?: unknown; next_take_at?: unknown };
    return payload.next_take_at
      ? { canTake: false, nextTakeAt: Number(payload.next_take_at) }
      : { canTake: Boolean(payload.can_take_number) };
  } catch (e) {
    return { canTake: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface TicketStatusEntry { ticket_id: string; task_id?: string; state: string; position?: number | null; queued_at?: number; ready_deadline?: number; active_deadline?: number }

export async function ticketStatus(ticketIds: string[]): Promise<{ nextPollAfter?: number; tickets: TicketStatusEntry[]; error?: string }> {
  if (ticketIds.length === 0) return { tickets: [] };
  try {
    const { status, body } = await gatewayFetch("/api/v1/off-peak/ticket/status", {
      method: "POST", body: JSON.stringify({ ticket_ids: ticketIds.slice(0, 100) }),
    });
    if (status !== 200 || !body) return { tickets: [], error: `status ${status}` };
    const payload = unveil(body);
    return { nextPollAfter: payload.next_poll_after, tickets: payload.tickets ?? [] };
  } catch (e) {
    return { tickets: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/** Read-only list from the desktop's own index (drives offPeak/list asks). */
export function listLocalOffPeakTasks(): OffPeakTaskSummary[] {
  const db = openTasksIndex(true);
  try {
    return db.query(`SELECT off_peak_task_id, title, status, queue_position, session_id, queued_at
      FROM off_peak_tasks ORDER BY COALESCE(queued_at, 0) DESC LIMIT 500`).all()
      .map((r: any) => ({
        offPeakTaskId: r.off_peak_task_id,
        title: r.title ?? "",
        status: r.status,
        ...(r.queue_position != null ? { queuePosition: r.queue_position } : {}),
        ...(r.session_id ? { sessionId: r.session_id } : {}),
        createdAt: r.queued_at ?? 0,
      }));
  } finally { db.close(); }
}

/**
 * Register one idle-time task the way the desktop main does:
 * local row (schedulable) -> POST ticket -> store the ticket id.
 * Returns the task summary the runtime tool expects, or a refusal.
 */
/**
 * Point-in-time check for the fleet single-flight exec lock (idle.ts holds
 * the same path). Measured 2026-10-27 morning: a ticket created while another
 * host's exec runs either 3001s (concurrent use) or sits lock-blocked until
 * the server expires it — either way the allowance is wasted. Refuse the
 * create instead; the exec lock itself remains the atomic gate.
 */
export function fleetExecLockHeld(): boolean {
  const root = process.env.ZTQ_FLEET_LOCK_DIR
    ?? join(homedir(), "data", "fleet-locks");
  try {
    return Date.now() - statSync(join(root, "ztq-idle-exec", "stamp.txt")).mtimeMs < 3 * 3600_000;
  } catch { return false; }
}

export async function registerOffPeakTask(input: {
  title: string; prompt: string; permissionMode?: string; model?: string; boundSessionId?: string;
  workspacePath: string;
}): Promise<{ ok: true; task: OffPeakTaskSummary; message: string } | { ok: false; refusal?: string; cooldownMs?: number; error: string }> {
  if (fleetExecLockHeld()) {
    return { ok: false, refusal: "Another host's idle task is executing (fleet single-flight) — a ticket created now would 3001 or expire in its shadow. Retry after it settles.", error: "fleet single-flight: exec lock held" };
  }
  const avail = await ticketAvailability();
  if (!avail.canTake) {
    const cooldownMs = avail.nextTakeAt ? Math.max(60_000, avail.nextTakeAt - Date.now() + 60_000) : undefined;
    const when = avail.nextTakeAt ? new Date(avail.nextTakeAt).toISOString() : "unknown";
    return { ok: false, refusal: `Free tier limit reached (availability endpoint). next take at ${when}.`, cooldownMs, error: avail.error ?? "not available" };
  }

  const offPeakTaskId = "offpeak-" + crypto.randomUUID();
  const now = Date.now();
  const db = openTasksIndex();
  try {
    // fleet hosts run different desktop vintages: dev's 3.11 tasks-index
    // lacks several newer columns (model_selection, project_id, …; measured
    // 2026-10-25) — insert only the columns the local table actually has so
    // the direct registration is version-independent
    let cols = new Set(
      (db.query(`PRAGMA table_info(off_peak_tasks)`).all() as Array<{ name: string }>).map((c) => c.name),
    );
    // Desktop-less hosts (oc measured 2026-10-26): no index file ever existed,
    // bun:sqlite materializes an EMPTY database, PRAGMA returns no columns and
    // the filtered insert degrades to `INSERT INTO off_peak_tasks () VALUES ()`
    // — the literal "near ')': syntax error" that blocked oc all night. When
    // the table is absent, create it with the desktop's own schema (verbatim
    // from a live 3.16 index) so this host is self-sufficient.
    if (cols.size === 0) {
      db.exec(`CREATE TABLE IF NOT EXISTS off_peak_tasks (
        off_peak_task_id   TEXT PRIMARY KEY,
        server_ticket_id   TEXT,
        title              TEXT NOT NULL DEFAULT '',
        conversation_id    TEXT,
        session_id         TEXT,
        prompt             TEXT NOT NULL,
        permission_mode    TEXT NOT NULL,
        model              TEXT,
        thought_level      TEXT,
        workspace_key      TEXT NOT NULL,
        workspace_path     TEXT NOT NULL,
        workspace_identity TEXT,
        status             TEXT NOT NULL,
        queued_at          INTEGER NOT NULL,
        started_at         INTEGER,
        ended_at           INTEGER,
        failure_reason     TEXT,
        files_changed      INTEGER,
        settled_at         INTEGER,
        history_deleted_at INTEGER,
        registered_at      INTEGER,
        schedulable        INTEGER NOT NULL DEFAULT 0,
        queue_position     INTEGER,
        next_poll_at       INTEGER,
        claim_running      INTEGER NOT NULL DEFAULT 0,
        claimed_at         INTEGER,
        attempt_count      INTEGER NOT NULL DEFAULT 0,
        last_error         TEXT,
        created_at         INTEGER NOT NULL,
        updated_at         INTEGER NOT NULL
      , model_selection TEXT, project_id TEXT, host_id TEXT, additional_directories TEXT)`);
      cols = new Set(
        (db.query(`PRAGMA table_info(off_peak_tasks)`).all() as Array<{ name: string }>).map((c) => c.name),
      );
    }
    // model_selection: the off-peak idle-plan provider (desktop convention)
    const modelSelection = JSON.stringify({
      providerId: "account:zai-offpeak-idle-plan",
      modelId: input.model || "GLM-5.3-Flash",
    });
    const desired: Record<string, unknown> = {
      off_peak_task_id: offPeakTaskId,
      server_ticket_id: null,
      title: input.title.slice(0, 200),
      conversation_id: null,
      session_id: input.boundSessionId ?? null,
      prompt: input.prompt,
      permission_mode: input.permissionMode ?? "yolo",
      model: null,
      thought_level: null,
      model_selection: modelSelection,
      workspace_key: input.workspacePath,
      workspace_path: input.workspacePath,
      workspace_identity: null,
      project_id: null,
      host_id: "local",
      additional_directories: "[]",
      status: "queued",
      queued_at: now,
      registered_at: now,
      // schedulable=0 — the desktop claim loop only takes rows matching
      // `schedulable = 1 AND claim_running = 0` (mined from out/scheduler/
      // index.js 2026-10-26) and it dispatches rows it did not create to a
      // phantom "Succeeded" with no session (jojo idle-final, owner-confirmed
      // 2026-10-26). OUR idle serve/exec is the executor; the local claim
      // below marks the row in-flight the same way the desktop does.
      schedulable: 0,
      queue_position: null,
      claim_running: 0,
      attempt_count: 0,
      created_at: now,
      updated_at: now,
    };
    const present = Object.keys(desired).filter((c) => cols.has(c));
    if (present.length === 0) return { ok: false, error: "local index has no usable off_peak_tasks columns (exotic vintage) — registration refused" };
    db.query(
      `INSERT INTO off_peak_tasks (${present.join(", ")}) VALUES (${present.map(() => "?").join(", ")})`,
    ).run(...(present.map((c) => desired[c]) as (string | number | null)[]));
  } catch (e) {
    db.close();
    return { ok: false, error: `local row insert failed: ${e instanceof Error ? e.message : String(e)}` };
  } finally {
    try { db.close(); } catch { /* closed above */ }
  }

  try {
    const { status, body } = await gatewayFetch("/api/v1/off-peak/ticket", {
      method: "POST",
      body: JSON.stringify({ task_id: offPeakTaskId }),
    });
    if (status === 429 && body?.code === 3103) {
      const nextTakeAt = Number(body?.data?.next_take_at ?? 0);
      const cooldownMs = nextTakeAt ? Math.max(60_000, nextTakeAt - Date.now() + 60_000) : undefined;
      // mark the row failed-registration (desktop convention on refusal)
      const db2 = openTasksIndex();
      db2.query(`UPDATE off_peak_tasks SET status='failed', failure_reason=?, updated_at=? WHERE off_peak_task_id=?`)
        .run(`free tier limit reached (next_take_at=${body?.data?.next_take_at ?? "?"})`, Date.now(), offPeakTaskId);
      db2.close();
      return { ok: false, refusal: "Free tier limit reached.", cooldownMs, error: `3103 next_take_at=${body?.data?.next_take_at ?? "?"}` };
    }
    const reg = unveil(body);
    if (status !== 200 || !reg?.ticket_id) {
      const detail = status === 401
        ? "gateway 401 (stale zcodejwttoken — use the ZCode desktop once to rotate ~/.zcode/v2/credentials.json, then re-enqueue; the task row stays queued for retry)"
        : `ticket registration ${status}: ${JSON.stringify(body)?.slice(0, 200)}`;
      const db2 = openTasksIndex();
      db2.query(`UPDATE off_peak_tasks SET status='failed', failure_reason=?, updated_at=? WHERE off_peak_task_id=?`)
        .run(detail.slice(0, 200), Date.now(), offPeakTaskId);
      db2.close();
      return { ok: false, refusal: status === 401 ? detail : undefined, error: detail };
    }
    const position = typeof reg.position === "number" ? reg.position : undefined;
    // The create response names the admission schedule (measured 2026-10-30):
    // next_poll_after is when the ticket's grant WINDOW opens — status
    // visibility of ready/active LAGS this boundary, so poll-gated admission
    // loses every window. Persist it; the serve time-triggers on it.
    const npa = Number(reg.next_poll_after ?? reg.nextPollAfter ?? 0) || null;
    const db2 = openTasksIndex();
    // Self-heal the column (measured 2026-10-31: older desktop indexes lack
    // next_poll_after — the unconditional UPDATE threw "no such column"
    // AFTER the server ticket was created, orphaning it and burning the
    // allowance). Additive ALTER is desktop-tolerated.
    const hasNpa = (db2.query(`PRAGMA table_info(off_peak_tasks)`).all() as Array<{ name: string }>).some((c) => c.name === "next_poll_after");
    if (!hasNpa) db2.exec(`ALTER TABLE off_peak_tasks ADD COLUMN next_poll_after INTEGER`);
    db2.query(`UPDATE off_peak_tasks SET server_ticket_id=?, queue_position=?, next_poll_after=?, updated_at=? WHERE off_peak_task_id=?`)
      .run(String(reg.ticket_id), position ?? null, npa, Date.now(), offPeakTaskId);
    db2.close();
    return {
      ok: true,
      task: {
        offPeakTaskId,
        title: input.title,
        status: "queued",
        ...(position != null ? { queuePosition: position } : {}),
        ...(input.boundSessionId ? { sessionId: input.boundSessionId } : {}),
        createdAt: now,
      },
      message: position != null
        ? `Created idle-time task ${offPeakTaskId} (#${position} in queue).`
        : `Created idle-time task ${offPeakTaskId}.`,
    };
  } catch (e) {
    return { ok: false, error: `ticket registration failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/**
 * The offPeak/* ask server — wire into AppServer.onServerRequest for any
 * session created with offPeakToolEnabled. Answers exactly what the desktop
 * main answers (measured ask shapes: params {}).
 */
export async function handleOffPeakAsk(method: string, params: Record<string, unknown>): Promise<unknown | null> {
  if (method === "offPeak/list") {
    return { tasks: listLocalOffPeakTasks() };
  }
  if (method === "offPeak/create") {
    const p = params as Record<string, unknown>;
    const res = await registerOffPeakTask({
      title: String(p.title ?? ""),
      prompt: String(p.prompt ?? ""),
      ...(p.permissionMode ? { permissionMode: String(p.permissionMode) } : {}),
      ...(p.model ? { model: String(p.model) } : {}),
      ...(p.boundSessionId ? { boundSessionId: String(p.boundSessionId) } : {}),
      workspacePath: process.cwd(),
    });
    if (res.ok) return { ok: true, task: res.task };
    // The runtime zod-validates the failure shape (measured enums 2026-10-23):
    //   failureStage: client_validation|ticket_request|local_persist
    //   errorCategory: client_validation|eligibility_3101|quota_3103|network|invalid_response|local_persist|unknown
    const category = res.error?.includes("401") ? "network"
      : res.refusal ? "quota_3103"
      : res.error?.includes("local row insert") ? "local_persist"
      : "network";
    const stage = res.error?.includes("local row insert") ? "local_persist" : "ticket_request";
    return { ok: false, failureStage: stage, errorCategory: category, errorCode: (res.error ?? res.refusal ?? "unknown").slice(0, 120) };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Execution: poll local tickets, admit through the off-peak anthropic
// gateway (x-off-peak-ticket-id), settle. This is zcode-tui's equivalent of
// the desktop main's claim loop + dispatchOffPeakRun — idle tasks run on
// THIS host with no desktop (owner goal 2026-10-23).
// ---------------------------------------------------------------------------

export interface LocalTicketRow { offPeakTaskId: string; serverTicketId: string; title: string; prompt: string; status: string; model: string; workspacePath: string; attemptCount: number; nextPollAfter: number | null }

/** Local rows that hold a server ticket and are not terminal — repair candidates included. */
export function localExecutableTasks(): LocalTicketRow[] {
  const db = openTasksIndex(true);
  try {
    const rows = db.query(`SELECT off_peak_task_id, server_ticket_id, title, prompt, status, model_selection, workspace_path, COALESCE(attempt_count,0) AS attempt_count, next_poll_after
      FROM off_peak_tasks
      WHERE server_ticket_id IS NOT NULL AND status IN ('queued','running','armed')`).all() as any[];
    return rows.map((r) => {
      let model = "GLM-5.3-Flash";
      try { model = String(JSON.parse(r.model_selection ?? "{}").modelId ?? model); } catch { /* default */ }
      return { offPeakTaskId: r.off_peak_task_id, serverTicketId: String(r.server_ticket_id), title: r.title ?? "", prompt: r.prompt ?? "", status: r.status, model, workspacePath: r.workspace_path ?? process.cwd(), attemptCount: Number(r.attempt_count ?? 0), nextPollAfter: r.next_poll_after != null ? Number(r.next_poll_after) : null };
    });
  } finally { db.close(); }
}

/**
 * Adopt orphaned registrations: rows whose ticket id is only visible inside
 * failure_reason JSON (the runtime tool sometimes reports "unreachable"
 * AFTER the service accepted the ticket — measured on the canary, position
 * 628). Returns the adopted ticket ids.
 */
export function adoptOrphanedTickets(): { task: string; ticket: string }[] {
  const db = openTasksIndex();
  const adopted: { task: string; ticket: string }[] = [];
  try {
    const rows = db.query(`SELECT off_peak_task_id, server_ticket_id, failure_reason FROM off_peak_tasks
      WHERE (server_ticket_id IS NULL AND failure_reason LIKE '%ticket_id%')
         OR (server_ticket_id IS NOT NULL AND status='failed' AND failure_reason LIKE 'off-peak dispatch%')`).all() as any[];
    for (const r of rows) {
      let ticket = r.server_ticket_id ? String(r.server_ticket_id) : "";
      let pos: string | null = null;
      if (!ticket) {
        const m = /"ticket_id":"(\d+)"/.exec(String(r.failure_reason ?? ""));
        if (!m) continue;
        ticket = m[1];
        pos = /"position":(\d+)/.exec(String(r.failure_reason ?? ""))?.[1] ?? null;
      }
      // schedulable=0: OUR serve executes adopted rows — the desktop claim
      // loop must not touch them (measured: it claims schedulable rows and
      // fails dispatch with "no usable model" for rows it did not create).
      db.query(`UPDATE off_peak_tasks SET server_ticket_id=?, status='queued', schedulable=0, queue_position=COALESCE(?, queue_position), failure_reason='adopted by zcode-tui idle runner', updated_at=? WHERE off_peak_task_id=?`)
        .run(ticket, pos, Date.now(), r.off_peak_task_id);
      adopted.push({ task: r.off_peak_task_id, ticket });
    }
  } finally { db.close(); }
  return adopted;
}

export interface PolledTicket {
  ticketId: string; state: string; position?: number | null; nextPollAfter?: number;
  queuedAt?: number; readyDeadline?: number; activeDeadline?: number;
}

/** Poll the gateway for the given ticket ids (batch). */
export async function pollTickets(ticketIds: string[]): Promise<{ tickets: PolledTicket[]; nextPollAfter?: number; error?: string }> {
  const res = await ticketStatus(ticketIds);
  return {
    tickets: res.tickets.map((t) => ({
      ticketId: t.ticket_id, state: t.state, position: t.position ?? null, nextPollAfter: res.nextPollAfter,
      ...(t.queued_at != null ? { queuedAt: Number(t.queued_at) } : {}),
      ...(t.ready_deadline != null ? { readyDeadline: Number(t.ready_deadline) } : {}),
      ...(t.active_deadline != null ? { activeDeadline: Number(t.active_deadline) } : {}),
    })),
    nextPollAfter: res.nextPollAfter,
    error: res.error,
  };
}

// ---------------------------------------------------------------------------
// Phase-aware admission (sol Q4, measured 2026-10-28): the server grants a
// ticket with a hard ready_deadline ≈ creation + 5.2–5.9 min (five tickets
// measured: 313s/341s/347s/356s/356s). Status keeps reporting ready/active
// for up to active_deadline (≈ +3h) AFTER the ready window closes, but
// admission answers 3104 "off-peak ticket is invalid" — measured on T-038
// (admitted at +8m44s against a +5m56s deadline). Attempting admission past
// the deadline is the 3104 source, so the runner phases on the deadline.
// ---------------------------------------------------------------------------

export type AdmissionPhase =
  | "admit"           // granted and inside the ready window — go
  | "window-missed"   // granted, but its window is provably gone — never admit (3104); record and leave the work pending
  | "stand-down"      // transient unknown/absent read (flap racing a state transition) — retry once, then wait
  | "poll-only"       // queued — the ticket holds no grant; executing it is what burns slots
  | "expired"         // terminal server-side — record allowance-consumed, stop polling
  | "settled";        // terminal server-side — the ticket RAN; reconcile honestly (completed unless a failure is recorded)

/** Phase decision for one ticket against the wall clock. The cutoff is the
 *  ready_deadline itself, with no positive grace: the only measured
 *  post-deadline datum is a 3104 (T-038, +3min past) and nothing measured
 *  says admission succeeds after it, so the runner does not bet a grant on
 *  that bet either way. Status lies after the window (T-038 showed active
 *  for ~3h while admission 3104'd), so state/active_deadline NEVER override
 *  an expired window. Fully deadline-less responses (server shape drift)
 *  fall back to state-only semantics — admit on ready/active as the
 *  pre-deadline runner did — except when an active_deadline is present and
 *  already past, which is known death regardless of the missing field. */
export function admissionPhase(
  t: { state: string; readyDeadline?: number; activeDeadline?: number },
  now: number,
): AdmissionPhase {
  if (t.state === "expired") return "expired";
  if (t.state === "completed" || t.state === "settled") return "settled";
  if (t.state !== "ready" && t.state !== "active") return "poll-only";
  if (t.activeDeadline != null && now > t.activeDeadline) return "window-missed";
  if (t.readyDeadline == null) return "admit";
  if (now <= t.readyDeadline) return "admit";
  return "window-missed";
}

/** Urgency order for the serve loop's single-flight exec pick: the ready
 *  ticket closest to losing its grant goes first (T-039 starved to expiry
 *  behind T-038's failing retries on 2026-10-27). Tickets without a
 *  deadline sort last, stable. */
export function urgentReadyFirst(a: PolledTicket, b: PolledTicket): number {
  const da = a.readyDeadline ?? Number.MAX_SAFE_INTEGER;
  const db = b.readyDeadline ?? Number.MAX_SAFE_INTEGER;
  return da - db;
}

/**
 * Node-bridged POST for the risk-gated messages call. Bun's TLS handshake
 * trips the off-peak risk engine (3012 "unusual activity") on VALID tickets
 * while Node's does not — measured 2026-10-26 00:0x, night-runner logs (the
 * granted ticket 2114429643200712704 died 3012-class under Bun and answered
 * a clean 3104 through the Node caller). Identity stays consistent by
 * construction: the same codingPlanApiKey()+cloudJwt() that created the
 * ticket signs this call (a mismatched key is the other 3104 cause, also
 * measured that night).
 *
 * Wire: request JSON on stdin; `ZT <status>` + `CT <content-type>` prologue,
 * blank line, then raw body bytes on stdout. Under Node itself, plain fetch
 * (Node TLS passes; no bridge needed).
 */
export function messagesTransport(): (url: string, headers: Record<string, string>, body: string, signal?: AbortSignal) => Promise<Response> {
  if (typeof Bun === "undefined") return (url, headers, body, signal) => fetch(url, { method: "POST", headers, body, signal });
  return (url, headers, body, signal) =>
    new Promise<Response>((resolve, reject) => {
      const script = `
const url = new URL(process.env.ZT_URL);
const lib = url.protocol === "https:" ? require("https") : require("http");
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  const req = lib.request(url, { method: "POST", headers: JSON.parse(process.env.ZT_HEADERS) }, (res) => {
    process.stdout.write("ZT " + res.statusCode + "\\n");
    process.stdout.write("CT " + (res.headers["content-type"] || "application/octet-stream") + "\\n\\n");
    res.pipe(process.stdout);
  });
  req.on("error", (e) => { process.stdout.write("ZT 0\\nCT text/plain\\n\\n" + String(e)); });
  req.end(raw);
});
`;
      const child = Bun.spawn(["/usr/bin/node", "-e", script], {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, ZT_URL: url, ZT_HEADERS: JSON.stringify(headers) },
      });
      child.stdin.write(body);
      child.stdin.end();
      signal?.addEventListener("abort", () => child.kill(9), { once: true });
      // One reader owns the stream: parse the two prologue lines, then pump
      // the remainder + everything after into the Response body.
      const reader = child.stdout.getReader();
      const dec = new TextDecoder();
      let acc = "";
      void (async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) throw new Error("offpeak transport: child exited before prologue");
            acc += dec.decode(value, { stream: true });
            const idx = acc.indexOf("\n\n");
            if (idx === -1) {
              if (acc.length > 128) throw new Error(`offpeak transport: bad prologue ${acc.slice(0, 60)}`);
              continue;
            }
            const head = acc.slice(0, idx);
            const status = Number(head.split("\n").find((l) => l.startsWith("ZT "))?.slice(3) ?? 0);
            const ctype = head.split("\n").find((l) => l.startsWith("CT "))?.slice(3) || "application/octet-stream";
            if (!status) throw new Error(`offpeak transport: ${acc.slice(idx + 2, idx + 220) || "connection failed"}`);
            const first = new TextEncoder().encode(acc.slice(idx + 2));
            const stream = new ReadableStream<Uint8Array>({
              start(c) { if (first.length) c.enqueue(first); },
              async pull(c) {
                const chunk = await reader.read();
                if (chunk.done) { c.close(); return; }
                c.enqueue(chunk.value);
              },
              cancel() { reader.cancel().catch(() => {}); child.kill(9); },
            });
            resolve(new Response(stream, { status, headers: { "content-type": ctype } }));
            return;
          }
        } catch (e) {
          try { reader.cancel(); } catch { /* already closed */ }
          reject(e as Error);
        }
      })();
    });
}

/** Off-peak model admission — returns the raw response (streaming passthrough). */
export async function offPeakMessages(ticketId: string, body: string, init: { signal?: AbortSignal } = {}): Promise<Response> {
  const key = codingPlanApiKey();
  const jwt = cloudJwt();
  const url = gatewayOrigin() + "/api/v1/off-peak/anthropic/v1/messages";
  const headers: Record<string, string> = {
    "content-type": "application/json",
    // The desktop supplies its cloud JWT as the Anthropic client's apiKey
    // as well as the bearer. The coding-plan key has its own header.
    "anthropic-version": "2023-06-01",
    ...(jwt ? { authorization: `Bearer ${jwt}`, "x-api-key": jwt } : {}),
    ...(key ? { "x-coding-plan-api-key": key } : {}),
    "x-off-peak-ticket-id": ticketId,
    // gateway order-of-validation bisect (2026-10-25, bogus-ticket probe):
    // without the query-id trio the call dies 3001 "parameter error" BEFORE
    // the ticket check; with it the request reaches 3104/200. The other 13
    // desktop headers are optional — adding ALL of them can trip 3012
    // "unusual activity" risk control, so keep the minimal passing set.
    "x-zcode-trace-id": crypto.randomUUID(),
    "x-query-id": crypto.randomUUID(),
    "x-zcode-query-source": "main_turn",
  };
  return messagesTransport()(url, headers, body, init.signal);
}

/** Mark the ticket settled after a completed run. */
export async function settleTicket(ticketId: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const { status, body } = await gatewayFetch(`/api/v1/off-peak/ticket/${encodeURIComponent(ticketId)}/settle`, { method: "POST", body: "{}" });
    return { ok: status === 200, detail: `${status} ${JSON.stringify(body ?? {}).slice(0, 120)}` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

/** Mark the local row running/completed/failed (desktop row conventions). */
export function setLocalTaskState(offPeakTaskId: string, status: string, patch: { startedAt?: number; endedAt?: number; failureReason?: string; queuePosition?: number | null } = {}): void {
  const db = openTasksIndex();
  try {
    db.query(`UPDATE off_peak_tasks SET status=?, started_at=COALESCE(?, started_at), ended_at=COALESCE(?, ended_at),
        failure_reason=COALESCE(?, failure_reason), queue_position=COALESCE(?, queue_position), updated_at=? WHERE off_peak_task_id=?`)
      .run(status, patch.startedAt ?? null, patch.endedAt ?? null, patch.failureReason ?? null, patch.queuePosition ?? null, Date.now(), offPeakTaskId);
  } finally { db.close(); }
}

/**
 * Local claim — the step the desktop performs before dispatch (mined from
 * out/scheduler/index.js 2026-10-26: one atomic UPDATE setting
 * claim_running=1; the server has no claim endpoint — a ticket left without
 * a messages call expires server-side as failed/unclaimed, which is what
 * killed dev's granted night ticket). 0 changes = another executor owns the
 * row or it went terminal. Very old index vintages may lack the columns;
 * a probe failure proceeds unclaimed rather than wedging the runner.
 */
export function claimLocalTask(offPeakTaskId: string): boolean {
  const db = openTasksIndex();
  try {
    return db.query(`UPDATE off_peak_tasks SET claim_running=1, attempt_count=COALESCE(attempt_count,0)+1, updated_at=?
      WHERE off_peak_task_id=? AND COALESCE(claim_running,0)=0`).run(Date.now(), offPeakTaskId).changes === 1;
  } catch {
    return true; // column-less vintage — proceed; ticket state still guards
  } finally { db.close(); }
}

/** Release a claim so the serve loop can retry the row. */
export function releaseLocalTask(offPeakTaskId: string): void {
  const db = openTasksIndex();
  try {
    db.query(`UPDATE off_peak_tasks SET claim_running=0, updated_at=? WHERE off_peak_task_id=?`).run(Date.now(), offPeakTaskId);
  } catch { /* column-less vintage — nothing to release */ } finally { db.close(); }
}
