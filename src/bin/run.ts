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
// outcome records quiet settlement, limits, and failures separately.
import { parseArgs } from "node:util";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { AppServer } from "../protocol/client";
import { syncAuthHeadless } from "../auth/sync";
import { startHeartbeat } from "../queue/heartbeat";

export const DEFAULT_PROVIDER = "zai-api"; // measured alias: older runtimes use zai

export interface ModelRef { modelId: string; providerId: string; options?: { reasoningLevel?: string } }

/** Build the session/create model ref. Owner law (2026-10-24): MAX thinking
 *  on capable models — options.reasoningLevel is required on some runtimes
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

/** No proven StartPlan grant is available to this transport. Never migrate a
 * requested funding route or full model onto the coding plan. */
export function assertFundingRoute(ref: ModelRef): void {
  if (ref.modelId.toLowerCase() === "glm-5.3" || /start[\s_-]*plan/i.test(ref.providerId)) {
    throw new Error("StartPlan route/grant is unverified; full_allowed=false; refusing session/send");
  }
}

export function fallbackOnQuotaRefusal(_ref: ModelRef, _errText: string): ModelRef | null {
  return null; // quota refusal never authorizes a different model/funding route
}

export function sameProvider(a: string, b: string): boolean {
  const canonical = (p: string) => p === "zai-api" ? "zai" : p;
  return canonical(a) === canonical(b);
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
 *  error text only authorizes exact-provider matching or the measured alias. */
export function matchAvailableModel(errText: string, modelId: string, providerId: string = DEFAULT_PROVIDER): ModelRef | null {
  const m = errText.match(/Available models:\s*([^\n]+)/);
  if (!m) return null;
  const entries = m[1].split(",").map((s) => s.trim().replace(/[.,;]+$/, "")).filter((s) => s.includes("/") && sameProvider(s.split("/")[0], providerId));
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
export interface RunClient { request(method: string, params: Record<string, unknown>, timeout?: number): Promise<unknown> }

export async function createSession(
  sv: RunClient,
  createParams: Record<string, unknown>,
  ref: ModelRef | null,
): Promise<Record<string, unknown>> {
  if (!ref) return (await sv.request("session/create", createParams, 30000)) as Record<string, unknown>;
  assertFundingRoute(ref);
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
          const alt = matchAvailableModel(msg, wanted.modelId, wanted.providerId);
          if (alt) {
            console.log(`zt-run: model ref re-pointed by registry: ${wanted.providerId}/${wanted.modelId} -> ${alt.providerId}/${alt.modelId}`);
            wanted = { ...alt, options: wanted.options };
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

type Snapshot = {
  session?: { model?: ModelRef };
  settings?: {
    model?: { current?: ModelRef };
    thoughtLevel?: { current?: string; available?: { value: string }[]; enabled?: boolean };
  };
};

export function actualSelection(snapshot: Snapshot): ModelRef {
  const actual = snapshot.settings?.model?.current ?? snapshot.session?.model;
  if (!actual?.modelId || !actual?.providerId) throw new Error("Native model/provider readback missing");
  return { modelId: actual.modelId, providerId: actual.providerId,
    options: { reasoningLevel: snapshot.settings?.thoughtLevel?.current ?? "unverified" } };
}

export function chooseEffort(snapshot: Snapshot, requested?: string): string | null {
  const thought = snapshot.settings?.thoughtLevel;
  const levels = thought?.available?.map((l) => l.value.toLowerCase()) ?? [];
  if (requested) {
    const level = requested.toLowerCase();
    if (!levels.includes(level)) throw new Error(`Requested effort ${level} is unsupported or unverified`);
    return level;
  }
  if (levels.includes("max")) return "max";
  const current = thought?.current?.toLowerCase();
  if (current && levels.includes(current)) return current;
  if (thought?.enabled === false) return null;
  throw new Error("Native effort metadata is ambiguous; refusing session/send");
}

/** Setter acknowledgement is insufficient: read the native selection before any send. */
export async function configureSession(sv: RunClient, sessionId: string, created: Snapshot,
  wanted: ModelRef | null, requestedEffort?: string): Promise<ModelRef> {
  const initial = actualSelection(created);
  assertFundingRoute(initial);
  if (wanted && (!sameProvider(wanted.providerId, initial.providerId)
    || wanted.modelId.toLowerCase() !== initial.modelId.toLowerCase())) {
    throw new Error("Native model/provider differs from requested route; refusing session/send");
  }
  const level = chooseEffort(created, requestedEffort);
  if (level) await sv.request("session/setThoughtLevel", { sessionId, thoughtLevel: level });
  const read = await sv.request("session/read", { sessionId }) as Snapshot;
  const actual = actualSelection(read);
  assertFundingRoute(actual);
  if (!sameProvider(initial.providerId, actual.providerId) || initial.modelId !== actual.modelId
    || (level && actual.options?.reasoningLevel?.toLowerCase() !== level)) {
    throw new Error("Native model/provider/effort readback mismatch; refusing session/send");
  }
  return actual;
}

export type RunOutcome = "settled" | "budget" | "collection-limit" | "event-limit" | "cut-midtool" | "no-events" | "error";
export function collectionDecision(s: { now: number; started: number; deadline: number; maxMs: number;
  count: number; maxEvents: number; lastEvent: number; quietMs: number; toolQuietMs: number;
  toolInFlight: boolean; error: boolean }): RunOutcome | null {
  if (s.error) return "error";
  if (s.deadline && s.now >= s.deadline) return "budget";
  if (s.now - s.started >= s.maxMs) return s.count ? "collection-limit" : "no-events";
  if (s.count >= s.maxEvents) return "event-limit";
  if (s.count && s.now - s.lastEvent > (s.toolInFlight ? s.toolQuietMs : s.quietMs)) {
    return s.toolInFlight ? "cut-midtool" : "settled";
  }
  return null;
}
export function outcomeExitCode(outcome: RunOutcome): number {
  return ({ settled: 0, budget: 4, "collection-limit": 6, "event-limit": 6,
    "cut-midtool": 5, "no-events": 1, error: 1 })[outcome];
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
let toolInFlight = 0;
let stopHb: (() => void) | null = null;
let ref: ModelRef | null = null;
let selected: ModelRef | null = null;
const STOP_KINDS = ["auth", "quota", "permission", "insufficient", "cancelled", "canceled", "forbidden"];
const deadlineMs = Number(values["max-run-min"]) > 0
  ? t0 + Number(values["max-run-min"]) * 60_000
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
    // Measured fault (ztq-f9e681c4 / ztq-47a45b7e, 2026-10-25): telemetry
    // mirrors out-numbered session events 19k vs ~700 and hit the max-events
    // cap at ~12min, exiting the collector mid-generation; the sticky tool
    // flag then misbilled the healthy session as cut-midtool. Telemetry
    // updates liveness (lastEvent) but is NOT mirrored into the transcript
    // and does NOT count toward the cap.
    lastEvent = Date.now();
    if (method !== "session/event") return;
    events.push({ method, kind, ms: Date.now() - t0, summary });
    // Tool-in-flight tracking (trial finding #5, T-036): a long tool call
    // (measured: a 300s `timeout 300 tb mail fetch`) streams nothing and the
    // quiet window killed a LIVE session, which the queue then billed as
    // completed. SET only on a tool START — measured 2026-10-25: a
    // tool_result also carries toolCallId, and with the clear-list missing
    // the runtime's actual end kinds the flag stuck through the next model
    // turn, turning a settled session into a phantom cut-midtool.
    const kindLow = kind.toLowerCase();
    if (summary.includes("toolCallId") && kindLow.includes("tool") && !kindLow.includes("result")) {
      toolInFlight = Date.now();
    } else if (/end|stop|complete|idle/.test(kindLow)) {
      toolInFlight = 0;
    }
    if (kind.includes("error")) {
      const low = summary.toLowerCase();
      if (STOP_KINDS.some((k) => low.includes(k))) {
        transportError = summary; // stop-class: report, never steer
      } else {
        lastErrorKind = kind;
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

function writeTranscript(outcome: RunOutcome) {
  stopHb?.();
  stopHb = null;
  const elapsedSec = Number(((Date.now() - t0) / 1000).toFixed(1));
  const outPath = String(values.out ?? "");
  mkdirSync(dirname(outPath), { recursive: true }); // --out parent may not exist on a fresh host
  writeFileSync(outPath, JSON.stringify({
    sessionId,
    model: selected ? `${selected.providerId}/${selected.modelId}@${selected.options?.reasoningLevel}` : "unverified",
    requestedModel: ref,
    selectedModel: selected,
    completionVerified: false, // quiet is transport settlement, not editor/task acceptance
    processLiveness: "unverified", // closing this app-server does not prove a surviving worker
    transportError,
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
  const created = await createSession(sv, createParams, ref);
  const sAny = (created.session ?? created) as unknown;
  sessionId = typeof sAny === "string"
    ? sAny
    : String((sAny as Record<string, unknown>)?.sessionId
      ?? Object.values(sAny ?? {}).find((v) => typeof v === "string" && String(v).startsWith("sess_"))
      ?? "");
  if (!sessionId) throw new Error("Native session id missing");
  let requestedEffort: string | undefined;
  try { requestedEffort = JSON.parse(String(values.model)).options?.reasoningLevel; } catch { /* plain model id: use catalog */ }
  selected = await configureSession(sv, sessionId, created, ref, requestedEffort);
  console.log(`zt-run: session ${sessionId} model=${selected.providerId}/${selected.modelId}@${selected.options?.reasoningLevel}`);
  // Liveness for the queue's stall sweeper (BUG-001): touch <out>.hb every 60s.
  stopHb = startHeartbeat(`${String(values.out ?? "")}.hb`);
  await sv.request("session/subscribe", { sessionId, deliveryKind: "desktop-continuous", includeSnapshot: true });
  await sv.request("session/send", { sessionId, content });

  const maxMs = Number(values["collect-ms"]);
  const quietMs = Number(values["quiet-sec"]) * 1000;
  const toolQuietMs = Math.max(quietMs, Number(values["tool-quiet-sec"] ?? "600") * 1000);
  const maxEvents = Number(values["max-events"]);
  const maxContinues = Number(values["continues"]);
  const decision = () => collectionDecision({ now: Date.now(), started: t0, deadline: deadlineMs,
    maxMs, count: events.length, maxEvents, lastEvent, quietMs, toolQuietMs,
    toolInFlight: toolInFlight > 0, error: !!transportError });
  let outcome: RunOutcome;
  while (true) {
    const stop = decision();
    if (!stop) { await new Promise((r) => setTimeout(r, 5000)); continue; }
    if ((stop === "settled" || stop === "cut-midtool") && continuesUsed < maxContinues) {
      const wait = backoffMs(continuesUsed);
      console.log(`zt-run: continue-steer #${continuesUsed + 1} after ${Math.round(wait / 1000)}s (lastError=${lastErrorKind || "silence"})`);
      await new Promise((r) => setTimeout(r, wait));
      const afterWait = decision();
      if (afterWait && afterWait !== "settled" && afterWait !== "cut-midtool") { outcome = afterWait; break; }
      if (!afterWait) continue; // progress arrived while waiting
      await sv.request("session/send", { sessionId, content: "Continue from where you stopped. Complete the task fully." });
      continuesUsed++;
      lastEvent = Date.now();
      continue;
    }
    outcome = stop === "settled" && lastErrorKind && !sawProgressAfterLastError ? "error" : stop;
    break;
  }
  writeTranscript(outcome);
  try { await sv.request("session/stop", { sessionId }); } catch { /* liveness remains unverified */ }
  await sv.close();
  process.exitCode = outcomeExitCode(outcome);
}

if (import.meta.main) main().catch(async (e) => {
  console.error(`FATAL: ${e instanceof Error ? e.message : e}`);
  transportError = String(e instanceof Error ? e.message : e);
  writeTranscript("error");
  try { if (sessionId) await sv.request("session/stop", { sessionId }); } catch { /* noop */ }
  await sv.close();
  process.exit(1);
});
