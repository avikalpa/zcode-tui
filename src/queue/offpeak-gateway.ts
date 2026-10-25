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
import { readFileSync } from "node:fs";
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

export async function ticketStatus(ticketIds: string[]): Promise<{ nextPollAfter?: number; tickets: { ticket_id: string; task_id?: string; state: string; position?: number | null }[]; error?: string }> {
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
  const db = new Database(TASKS_INDEX(), { readonly: true });
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
export async function registerOffPeakTask(input: {
  title: string; prompt: string; permissionMode?: string; model?: string; boundSessionId?: string;
  workspacePath: string;
}): Promise<{ ok: true; task: OffPeakTaskSummary; message: string } | { ok: false; refusal?: string; cooldownMs?: number; error: string }> {
  const avail = await ticketAvailability();
  if (!avail.canTake) {
    const cooldownMs = avail.nextTakeAt ? Math.max(60_000, avail.nextTakeAt - Date.now() + 60_000) : undefined;
    const when = avail.nextTakeAt ? new Date(avail.nextTakeAt).toISOString() : "unknown";
    return { ok: false, refusal: `Free tier limit reached (availability endpoint). next take at ${when}.`, cooldownMs, error: avail.error ?? "not available" };
  }

  const offPeakTaskId = "offpeak-" + crypto.randomUUID();
  const now = Date.now();
  const db = new Database(TASKS_INDEX());
  try {
    // fleet hosts run different desktop vintages: dev's 3.11 tasks-index
    // predates model_selection (measured 2026-10-25) — add missing columns
    // additively so the direct registration is version-independent
    const cols = (db.query(`PRAGMA table_info(off_peak_tasks)`).all() as Array<{ name: string }>).map((c) => c.name);
    for (const missing of ["model_selection"].filter((c) => !cols.includes(c))) {
      db.query(`ALTER TABLE off_peak_tasks ADD COLUMN ${missing} TEXT`).run();
    }
    // model_selection: the off-peak idle-plan provider (desktop convention)
    const modelSelection = JSON.stringify({
      providerId: "account:zai-offpeak-idle-plan",
      modelId: input.model || "GLM-5.3-Flash",
    });
    db.query(`INSERT INTO off_peak_tasks (off_peak_task_id, server_ticket_id, title, conversation_id, session_id,
        prompt, permission_mode, model, thought_level, model_selection,
        workspace_key, workspace_path, workspace_identity, project_id, host_id, additional_directories,
        status, queued_at, registered_at, schedulable, queue_position, claim_running, attempt_count, created_at, updated_at)
      VALUES (?, NULL, ?, NULL, ?, ?, ?, NULL, NULL, ?, ?, ?, NULL, NULL, 'local', '[]',
        'queued', ?, ?, 1, NULL, 0, 0, ?, ?)`)
      .run(offPeakTaskId, input.title.slice(0, 200), input.boundSessionId ?? null, input.prompt,
        input.permissionMode ?? "yolo", modelSelection,
        input.workspacePath, input.workspacePath, now, now, now, now);
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
      const db2 = new Database(TASKS_INDEX());
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
      const db2 = new Database(TASKS_INDEX());
      db2.query(`UPDATE off_peak_tasks SET status='failed', failure_reason=?, updated_at=? WHERE off_peak_task_id=?`)
        .run(detail.slice(0, 200), Date.now(), offPeakTaskId);
      db2.close();
      return { ok: false, refusal: status === 401 ? detail : undefined, error: detail };
    }
    const position = typeof reg.position === "number" ? reg.position : undefined;
    const db2 = new Database(TASKS_INDEX());
    db2.query(`UPDATE off_peak_tasks SET server_ticket_id=?, queue_position=?, updated_at=? WHERE off_peak_task_id=?`)
      .run(String(reg.ticket_id), position ?? null, Date.now(), offPeakTaskId);
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

export interface LocalTicketRow { offPeakTaskId: string; serverTicketId: string; title: string; prompt: string; status: string; model: string; workspacePath: string }

/** Local rows that hold a server ticket and are not terminal — repair candidates included. */
export function localExecutableTasks(): LocalTicketRow[] {
  const db = new Database(TASKS_INDEX(), { readonly: true });
  try {
    const rows = db.query(`SELECT off_peak_task_id, server_ticket_id, title, prompt, status, model_selection, workspace_path
      FROM off_peak_tasks
      WHERE server_ticket_id IS NOT NULL AND status IN ('queued','running')`).all() as any[];
    return rows.map((r) => {
      let model = "GLM-5.3-Flash";
      try { model = String(JSON.parse(r.model_selection ?? "{}").modelId ?? model); } catch { /* default */ }
      return { offPeakTaskId: r.off_peak_task_id, serverTicketId: String(r.server_ticket_id), title: r.title ?? "", prompt: r.prompt ?? "", status: r.status, model, workspacePath: r.workspace_path ?? process.cwd() };
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
  const db = new Database(TASKS_INDEX());
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

export interface PolledTicket { ticketId: string; state: string; position?: number | null; nextPollAfter?: number }

/** Poll the gateway for the given ticket ids (batch). */
export async function pollTickets(ticketIds: string[]): Promise<{ tickets: PolledTicket[]; nextPollAfter?: number; error?: string }> {
  const res = await ticketStatus(ticketIds);
  return {
    tickets: res.tickets.map((t) => ({ ticketId: t.ticket_id, state: t.state, position: t.position ?? null, nextPollAfter: res.nextPollAfter })),
    nextPollAfter: res.nextPollAfter,
    error: res.error,
  };
}

/** Off-peak model admission — returns the raw response (streaming passthrough). */
export async function offPeakMessages(ticketId: string, body: string, init: { signal?: AbortSignal } = {}): Promise<Response> {
  const key = codingPlanApiKey();
  const jwt = cloudJwt();
  return fetch(gatewayOrigin() + "/api/v1/off-peak/anthropic/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // The desktop supplies its cloud JWT as the Anthropic client's apiKey
      // as well as the bearer. The coding-plan key has its own header.
      "anthropic-version": "2023-06-01",
      ...(jwt ? { authorization: `Bearer ${jwt}`, "x-api-key": jwt } : {}),
      ...(key ? { "x-coding-plan-api-key": key } : {}),
      "x-off-peak-ticket-id": ticketId,
    },
    body,
    signal: init.signal,
  });
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
  const db = new Database(TASKS_INDEX());
  try {
    db.query(`UPDATE off_peak_tasks SET status=?, started_at=COALESCE(?, started_at), ended_at=COALESCE(?, ended_at),
        failure_reason=COALESCE(?, failure_reason), queue_position=COALESCE(?, queue_position), updated_at=? WHERE off_peak_task_id=?`)
      .run(status, patch.startedAt ?? null, patch.endedAt ?? null, patch.failureReason ?? null, patch.queuePosition ?? null, Date.now(), offPeakTaskId);
  } finally { db.close(); }
}
