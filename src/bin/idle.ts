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
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { Database } from "bun:sqlite";
import { AppServer } from "../protocol/client";
import { parseCooldownMs } from "../queue/core";

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
  const db = new Database(TASKS_INDEX(), { readonly: true });
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

  let sawToolResult = "";
  let refusal = "";
  let lastToolError = "";
  let lastEventAt = Date.now();
  let turnEnded = false;
  let sessionId = "";
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
    await sv.request("session/subscribe", { sessionId, deliveryKind: "desktop-continuous", includeSnapshot: true }, 20000);
    if (values.warmup) {
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
      "Call the OffPeakCreate tool NOW with EXACTLY these arguments:",
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
          const db = new Database(TASKS_INDEX(), { readonly: true });
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

const { values } = parseArgs({
  allowPositionals: true,
  options: {
    json: { type: "boolean", default: false },
    "prompt-file": { type: "string" },
    workspace: { type: "string" },
    title: { type: "string" },
    model: { type: "string" },
    "permission-mode": { type: "string" },
    warmup: { type: "boolean", default: false },
    resume: { type: "string", default: "" },
    out: { type: "string" },
  },
});
const sub = String(process.argv[2] ?? "");
if (import.meta.main) {
  if (sub === "list") cmdList(Boolean(values.json));
  else if (sub === "create") await cmdCreate(values as Record<string, string | boolean | undefined>);
  else {
    console.error("usage: zcode-tui idle <list|create> [...]");
    console.error("  list [--json]");
    console.error("  create --prompt-file F [--workspace W] [--title T] [--model M]");
    console.error("         [--permission-mode yolo|build|edit|plan|guarded] [--json]");
    console.error("         (permission-mode defaults to yolo - full access, owner directive 2026-10-23)");
    process.exit(2);
  }
}
