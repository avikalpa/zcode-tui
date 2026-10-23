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

/** The ZCode cloud JWT — read FRESH per call: the desktop rotates
 *  credentials.json on activity, so a stale 401 self-heals when the owner
 *  next uses the desktop (measured rotation 2026-10-22 15:06 IST). */
export function cloudJwt(): string {
  try {
    const creds = JSON.parse(readFileSync(join(homedir(), ".zcode", "v2", "credentials.json"), "utf8"));
    return typeof creds["zcodejwttoken"] === "string" ? creds["zcodejwttoken"] : "";
  } catch { return ""; }
}

export function gatewayOrigin(): string {
  return process.env.ZCODE_OFFPEAK_ORIGIN ?? "https://zcode.z.ai";
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
    return body.next_take_at
      ? { canTake: false, nextTakeAt: Number(body.next_take_at) }
      : { canTake: Boolean(body.can_take_number) };
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
    return { nextPollAfter: body.next_poll_after, tickets: body.tickets ?? [] };
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
    if (status !== 200 || !body?.ticket_id) {
      const detail = status === 401
        ? "gateway 401 (stale zcodejwttoken — use the ZCode desktop once to rotate ~/.zcode/v2/credentials.json, then re-enqueue; the task row stays queued for retry)"
        : `ticket registration ${status}: ${JSON.stringify(body)?.slice(0, 200)}`;
      const db2 = new Database(TASKS_INDEX());
      db2.query(`UPDATE off_peak_tasks SET status='failed', failure_reason=?, updated_at=? WHERE off_peak_task_id=?`)
        .run(detail.slice(0, 200), Date.now(), offPeakTaskId);
      db2.close();
      return { ok: false, refusal: status === 401 ? detail : undefined, error: detail };
    }
    const position = typeof body.position === "number" ? body.position : undefined;
    const db2 = new Database(TASKS_INDEX());
    db2.query(`UPDATE off_peak_tasks SET server_ticket_id=?, queue_position=?, updated_at=? WHERE off_peak_task_id=?`)
      .run(String(body.ticket_id), position ?? null, Date.now(), offPeakTaskId);
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
    return { ok: false, failureStage: "remote", errorCategory: res.refusal ? "limit" : "network", errorCode: res.refusal ? "free_tier_limit" : res.error, error: res.error };
  }
  return null;
}
