// zt-run — headless one-session worker: create a session on the packaged
// runtime, send ONE brief, auto-allow its own workspace tools, collect until
// the turn settles (quiet window) or the cap, dump the event transcript.
//
// 0.7.1 (owner directive + sol consult 2026-10-22): classified
// continue-steer under provider server pressure — model/transport errors
// and error-tailed silence get up to --continues "Continue" steers on the
// SAME session (30/60/120s+jitter backoff); auth/quota/permission/cancel
// are STOP outcomes (no blind replay of possibly-completed work).
// --max-run-min enforces a consumption budget (peak-window guard feeds it);
// outcome in the transcript is honest: settled | budget | no-events.
import { parseArgs } from "node:util";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { AppServer } from "../protocol/client";
import { syncAuthHeadless } from "../auth/sync";
import { startHeartbeat } from "../queue/heartbeat";

export const DEFAULT_PROVIDER = "zai-api"; // the ONLY providerId the registry resolves (measured 2026-10-24)
const QUOTA_REFUSAL = /quota|3103|coding_plan|entitle|insufficient|plan_required|exceeded/i;

export interface ModelRef { modelId: string; providerId: string; options?: { reasoningLevel?: string } }

/** Build the session/create model ref. Owner law (2026-10-24): MAX thinking
 *  on every plan — options.reasoningLevel is MANDATORY for zai-api models
 *  ("Reasoning level is required for zai-api/GLM-5.3-Flash", measured). */
export function buildModelRef(model: string, provider: string): ModelRef {
  let ref: ModelRef;
  try {
    ref = JSON.parse(model) as ModelRef;
    if (!ref || typeof ref !== "object" || !ref.modelId || !ref.providerId) throw new Error("bad ref");
  } catch {
    ref = { modelId: model, providerId: provider || DEFAULT_PROVIDER };
  }
  ref.options ??= {};
  ref.options.reasoningLevel ??= "max";
  return ref;
}

/** GLM-5.3 full is a start-plan-only model (owner law 2026-10-24): when the
 *  plan bucket refuses (quota/entitlement), fall over to GLM-5.3-Flash max —
 *  never run full on the regular coding plan. */
export function fallbackOnQuotaRefusal(ref: ModelRef, errText: string): ModelRef | null {
  if (!QUOTA_REFUSAL.test(errText)) return null;
  if (ref.modelId.toLowerCase() === "glm-5.3") {
    return { modelId: "GLM-5.3-Flash", providerId: ref.providerId, options: { reasoningLevel: "max" } };
  }
  return null;
}

/** The reasoning level rides DIFFERENT keys per runtime version (measured
 *  2026-10-24): jojo 3.16.x takes model.options.reasoningLevel, dev's older
 *  runtime takes model.variant — both reject the other shape with a strict
 *  "Unrecognized key". Try each shape; every failure here is pre-turn and
 *  free. Bare (no level) is the last resort, then session/setThoughtLevel
 *  fixes the effort post-create. */
export function modelRefShapes(ref: ModelRef): Record<string, unknown>[] {
  const level = ref.options?.reasoningLevel ?? "max";
  const base = { providerId: ref.providerId, modelId: ref.modelId };
  return [
    { ...base, options: { reasoningLevel: level } },
    { ...base, variant: level },
    base,
  ];
}

/** Parse the runtime's own "Unsupported model: X. Available models: a, b, c"
 *  listing and resolve the wanted modelId (case-insensitive, exact case
 *  preferred) to a concrete {providerId, modelId}. The fleet's runtimes
 *  disagree on provider ids too (jojo: zai-api, dev: zai — measured), so the
 *  error text is the portable source of truth. */
export function matchAvailableModel(errText: string, modelId: string): ModelRef | null {
  const m = errText.match(/Available models:\s*([^\n]+)/);
  if (!m) return null;
  const entries = m[1].split(",").map((s) => s.trim().replace(/[.,;]+$/, "")).filter((s) => s.includes("/"));
  const want = modelId.toLowerCase();
  const exact = entries.find((e) => e.split("/")[1] === modelId);
  const ci = entries.find((e) => e.split("/")[1]?.toLowerCase() === want);
  const hit = exact ?? ci;
  if (!hit) return null;
  const [providerId, resolved] = hit.split("/");
  return { modelId: resolved, providerId, options: { reasoningLevel: "max" } };
}

/** Create the session trying every model-ref shape the fleet's runtimes
 *  speak (see modelRefShapes). With no ref, one bare attempt. */
async function createSession(
  sv: AppServer,
  createParams: Record<string, unknown>,
  ref: ModelRef | null,
): Promise<Record<string, unknown>> {
  if (!ref) return (await sv.request("session/create", createParams, 30000)) as Record<string, unknown>;
  let wanted = ref;
  for (let attempt = 0; attempt < 6; attempt++) {
    let lastErr: unknown = null;
    let handled = false;
    for (const shape of modelRefShapes(wanted)) {
      try {
        return (await sv.request("session/create", { ...createParams, model: shape }, 30000)) as Record<string, unknown>;
      } catch (e) {
        lastErr = e;
        const msg = String(e instanceof Error ? e.message : e);
        if (/Unsupported model/i.test(msg)) {
          const alt = matchAvailableModel(msg, wanted.modelId);
          if (alt) {
            console.log(`zt-run: model ref re-pointed by registry: ${wanted.providerId}/${wanted.modelId} -> ${alt.providerId}/${alt.modelId}`);
            wanted = alt;
            handled = true;
            break; // retry shapes against the re-pointed ref
          }
          throw e; // wanted model genuinely absent from this runtime
        }
        if (!/Unrecognized key|Invalid params|Reasoning level/i.test(msg)) throw e; // real failure: stop
        // shape rejected pre-turn — try the next shape
      }
    }
    if (!handled) throw lastErr;
  }
  throw new Error("createSession: model-ref negotiation did not converge");
}

const { values } = parseArgs({
  strict: false, // imported as a module by other verbs: foreign argv must not throw
  options: {
    "content-file": { type: "string" },
    workspace: { type: "string", default: process.cwd() },
    model: { type: "string", default: "" },
    provider: { type: "string", default: DEFAULT_PROVIDER },
    "collect-ms": { type: "string", default: "900000" },
    "quiet-sec": { type: "string", default: "150" },
    "tool-quiet-sec": { type: "string", default: "600" },
    out: { type: "string", default: "/tmp/zt-run-transcript.json" },
    "max-events": { type: "string", default: "20000" },
    "max-run-min": { type: "string", default: "0" },
    continues: { type: "string", default: "3" },
    // --resilient: for planes that drop connections midway (AutoClaw-class,
    // owner 2026-10-23): 5 steers instead of 3 and transport-drop errors are
    // explicitly steer-class (they already avoid the STOP list).
    resilient: { type: "boolean", default: false },
    // --unattended: prepend the fleet unattended preamble (no questions, no
    // plan mode, verify before done) — default for automated runs.
    unattended: { type: "boolean", default: false },
  },
});

if (import.meta.main && !values["content-file"]) {
  console.error("zt-run: --content-file is required");
  process.exit(1);
}
const rawBrief = import.meta.main ? readFileSync(String(values["content-file"] ?? ""), "utf8") : "";
const content = import.meta.main && values.unattended
  ? `You are running UNATTENDED (no human will answer).\n- Do not ask questions, do not request confirmation, do not enter plan mode; choose the sensible default and proceed to implement immediately.\n- Never declare work done that you have not executed: run the checks the task implies and read the real output.\n- Before your final summary, re-read the original task once and check each requirement against what you delivered, then stop.\n\n${rawBrief}`
  : rawBrief;
const t0 = Date.now();
const events: { method: string; kind: string; ms: number; summary: string }[] = [];
let lastEvent = 0;
let sessionId = "";
let transportError = "";
let continuesUsed = 0;
let sawProgressAfterLastError = false;
let lastErrorKind = "";
let lastErrorText = "";
let toolInFlight = 0;
let stopHb: (() => void) | null = null;
let ref: ModelRef | null = null;
const STOP_KINDS = ["auth", "quota", "permission", "insufficient", "cancelled", "canceled", "forbidden"];
const TRANSPORT_DROP = /fetch failed|socket hang up|econnreset|econnrefused|terminated|aborted|connection (closed|error|dropped)|network|timeout/i;
const deadlineMs = Number(values["max-run-min"]) > 0
  ? Date.now() + Number(values["max-run-min"]) * 60_000
  : 0;
const backoffMs = (n: number) => (30 * 2 ** n + Math.floor(Math.random() * 10)) * 1000;

const sv = new AppServer({
  onNotification: (m: Record<string, unknown>) => {
    const method = String(m.method);
    let kind = "";
    let summary = "";
    if (method === "session/event") {
      const p = ((m.params as Record<string, unknown>)?.payload ?? {}) as Record<string, unknown>;
      kind = String(p.type ?? p.kind ?? "untyped");
      summary = JSON.stringify(p).slice(0, 140);
    } else {
      summary = JSON.stringify(m).slice(0, 120);
    }
    events.push({ method, kind, ms: Date.now() - t0, summary });
    lastEvent = Date.now();
    // Tool-in-flight tracking (trial finding #5, T-036): a long tool call
    // (measured: a 300s `timeout 300 tb mail fetch`) streams nothing and the
    // quiet window killed a LIVE session, which the queue then billed as
    // completed. Progress events carry toolCallId while a tool runs.
    if (method === "session/event" && summary.includes("toolCallId")) {
      toolInFlight = Date.now();
    } else if (kind === "agent_end" || kind === "turn_end" || kind === "message_end" || kind === "idle") {
      toolInFlight = 0;
    }
    if (kind.includes("error")) {
      const low = summary.toLowerCase();
      if (STOP_KINDS.some((k) => low.includes(k))) {
        transportError = summary; // stop-class: report, never steer
      } else {
        lastErrorKind = kind;
        lastErrorText = summary;
        sawProgressAfterLastError = false;
      }
    } else if (kind === "text_delta" || kind.includes("tool")) {
      sawProgressAfterLastError = true;
    }
  },
  onServerRequest: (m: Record<string, unknown>) => {
    const method = String(m.method);
    const id = String(m.id);
    if (method === "interaction/requestPermission") {
      sv.respond(id, { decision: "allow" });
    } else if (method === "interaction/requestUserInput") {
      sv.respond(id, { cancelled: true });
    } else if (method === "session/requestRuntimePreferences") {
      sv.respond(id, { nativeSearchEnhancementsEnabled: false });
    } else {
      sv.respond(id, {});
    }
  },
}, {
  onStderr: (c: string) => {
    process.stderr.write(c.slice(0, 200));
    if (c.includes("zcode-builtin") || c.includes("app-server exited")) {
      transportError = c.trim().slice(-200);
    }
  },
});

function writeTranscript(outcome: string) {
  stopHb?.();
  stopHb = null;
  const elapsedSec = Number(((Date.now() - t0) / 1000).toFixed(1));
  const outPath = String(values.out ?? "");
  mkdirSync(dirname(outPath), { recursive: true }); // --out parent may not exist on a fresh host
  writeFileSync(outPath, JSON.stringify({
    sessionId,
    model: ref ? `${ref.providerId}/${ref.modelId}@${ref.options?.reasoningLevel}` : "(config default)",
    outcome,
    continuesUsed,
    lastErrorKind,
    elapsedSec,
    eventCount: events.length,
    events,
  }, null, 1));
  console.log(`zt-run: ${outcome} - ${events.length} events in ${elapsedSec}s, continues=${continuesUsed} -> ${outPath}`);
}

async function main() {
  syncAuthHeadless();
  // Owner law: MAX thinking on every zcode-tui session. The model ref is
  // {providerId, modelId, options:{reasoningLevel}} — reasoningLevel is
  // REQUIRED by the registry for zai-api models. NOTE: no top-level
  // `options` key on session/create — the schema is strict and rejects it
  // ("Unrecognized key: options" killed every 82a1b43 dispatch instantly).
  ref = values.model ? buildModelRef(String(values.model), String(values.provider)) : null;
  const createParams: Record<string, unknown> = {
    workspace: { workspacePath: values.workspace, workspaceKey: values.workspace },
    mode: "build",
    persistence: "immediate",
  };
  let created: Record<string, unknown>;
  try {
    created = await createSession(sv, createParams, ref);
  } catch (e) {
    const errText = String(e instanceof Error ? e.message : e);
    // GLM-5.3 full is start-plan-only: a plan-bucket refusal falls over to
    // Flash max (owner law 2026-10-24) on a FRESH session — the original
    // create never opened a billable turn.
    const alt = ref ? fallbackOnQuotaRefusal(ref, errText) : null;
    if (!alt) throw e;
    console.log(`zt-run: plan refusal on ${ref!.modelId} — auto-switching to ${alt.modelId} (max): ${errText.slice(0, 120)}`);
    ref = alt;
    created = await createSession(sv, createParams, alt);
  }
  const sAny = (created.session ?? created) as unknown;
  sessionId = typeof sAny === "string"
    ? sAny
    : String((sAny as Record<string, unknown>)?.sessionId
      ?? Object.values(sAny ?? {}).find((v) => typeof v === "string" && String(v).startsWith("sess_"))
      ?? "");
  console.log(`zt-run: session ${sessionId} model=${ref ? `${ref.providerId}/${ref.modelId}@${ref.options?.reasoningLevel}` : "(config default)"}`);
  // Liveness for the queue's stall sweeper (BUG-001): touch <out>.hb every 60s.
  stopHb = startHeartbeat(`${String(values.out ?? "")}.hb`);
  await sv.request("session/subscribe", { sessionId, deliveryKind: "desktop-continuous", includeSnapshot: true });
  await sv.request("session/send", { sessionId, content });

  const maxMs = Number(values["collect-ms"]);
  const quietMs = Number(values["quiet-sec"]) * 1000;
  const toolQuietMs = Math.max(quietMs, Number(values["tool-quiet-sec"] ?? "600") * 1000);
  const maxEvents = Number(values["max-events"]);
  const maxContinues = Number(values["continues"]);
  while (Date.now() - t0 < maxMs && events.length < maxEvents) {
    if (deadlineMs && Date.now() > deadlineMs) {
      console.log(`zt-run: run budget exhausted (max-run-min ${values["max-run-min"]}) - stopping`);
      try { await sv.request("session/stop", { sessionId }); } catch { /* maybe ended */ }
      writeTranscript("budget");
      await sv.close();
      process.exit(4);
    }
    await new Promise((r) => setTimeout(r, 5000));
    // While a tool call is in flight, silence is EXPECTED (long ssh/build
    // calls): extend the window instead of cutting a live session.
    const effectiveQuiet = toolInFlight > 0 ? Math.max(quietMs, toolQuietMs) : quietMs;
    const silent = events.length > 0 && Date.now() - lastEvent > effectiveQuiet;
    if (!silent) continue;
    if (transportError) break; // stop-class failure: report honestly
    if (continuesUsed < maxContinues) {
      const wait = backoffMs(continuesUsed);
      const drop = TRANSPORT_DROP.test(`${transportError} ${lastErrorText}`);
      console.log(`zt-run: ${drop ? "resilient " : ""}continue-steer #${continuesUsed + 1} after ${Math.round(wait / 1000)}s (lastError=${lastErrorKind || "silence"}${drop ? " transport drop" : ""})`);
      await new Promise((r) => setTimeout(r, wait));
      await sv.request("session/send", { sessionId, content: "Continue from where you stopped. Complete the task fully." });
      continuesUsed++;
      lastEvent = Date.now();
      continue;
    }
    break; // settled (or continue budget exhausted)
  }
  if (toolInFlight > 0) {
    // NEVER kill a live tool call and bill it as done: leave the session
    // alive (resumable in the TUI / by the next continue), report honestly.
    writeTranscript("cut-midtool");
    await sv.close();
    console.log(`zt-run: cut while tool call in flight (silent >${Math.round(toolQuietMs / 1000)}s) — session ${sessionId} left RUNNING for resume/steer`);
    process.exit(4);
  }
  writeTranscript("settled");
  try { await sv.request("session/stop", { sessionId }); } catch { /* maybe ended */ }
  await sv.close();
  if (events.length === 0 && transportError) {
    console.error(`zt-run: no events captured; backend said: ${transportError}`);
    process.exit(1);
  }
}

if (import.meta.main) main().catch(async (e) => {
  console.error(`FATAL: ${e instanceof Error ? e.message : e}`);
  stopHb?.();
  stopHb = null;
  try { if (sessionId) await sv.request("session/stop", { sessionId }); } catch { /* noop */ }
  await sv.close();
  process.exit(1);
});
