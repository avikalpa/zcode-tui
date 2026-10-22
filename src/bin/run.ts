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

const { values } = parseArgs({
  options: {
    "content-file": { type: "string" },
    workspace: { type: "string", default: process.cwd() },
    model: { type: "string", default: "" },
    provider: { type: "string", default: "zai" },
    "collect-ms": { type: "string", default: "900000" },
    "quiet-sec": { type: "string", default: "150" },
    out: { type: "string", default: "/tmp/zt-run-transcript.json" },
    "max-events": { type: "string", default: "20000" },
    "max-run-min": { type: "string", default: "0" },
    continues: { type: "string", default: "3" },
  },
});

if (!values["content-file"]) {
  console.error("zt-run: --content-file is required");
  process.exit(1);
}
const content = readFileSync(String(values["content-file"]), "utf8");
const t0 = Date.now();
const events: { method: string; kind: string; ms: number; summary: string }[] = [];
let lastEvent = 0;
let sessionId = "";
let transportError = "";
let continuesUsed = 0;
let sawProgressAfterLastError = false;
let lastErrorKind = "";
const STOP_KINDS = ["auth", "quota", "permission", "insufficient", "cancelled", "canceled", "forbidden"];
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

function writeTranscript(outcome: string) {
  const elapsedSec = Number(((Date.now() - t0) / 1000).toFixed(1));
  const outPath = String(values.out);
  mkdirSync(dirname(outPath), { recursive: true }); // --out parent may not exist on a fresh host
  writeFileSync(outPath, JSON.stringify({
    sessionId,
    model: values.model || "(config default)",
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
  const createParams: Record<string, unknown> = {
    workspace: { workspacePath: values.workspace, workspaceKey: values.workspace },
    mode: "build",
    persistence: "immediate",
  };
  if (values.model) {
    // 0.7.2: session/create takes an OBJECT ref {modelId, providerId};
    // a string id is mapped with the --provider route (default zai).
    try {
      createParams.model = JSON.parse(values.model);
    } catch {
      createParams.model = { modelId: values.model, providerId: values.provider || "zai" };
    }
  }
  const created = (await sv.request("session/create", createParams, 30000)) as Record<string, unknown>;
  const sAny = (created.session ?? created) as unknown;
  sessionId = typeof sAny === "string"
    ? sAny
    : String((sAny as Record<string, unknown>)?.sessionId
      ?? Object.values(sAny ?? {}).find((v) => typeof v === "string" && String(v).startsWith("sess_"))
      ?? "");
  console.log(`zt-run: session ${sessionId} model=${values.model || "(config default)"}`);
  await sv.request("session/subscribe", { sessionId, deliveryKind: "desktop-continuous", includeSnapshot: true });
  await sv.request("session/send", { sessionId, content });

  const maxMs = Number(values["collect-ms"]);
  const quietMs = Number(values["quiet-sec"]) * 1000;
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
    const silent = events.length > 0 && Date.now() - lastEvent > quietMs;
    if (!silent) continue;
    if (transportError) break; // stop-class failure: report honestly
    if (continuesUsed < maxContinues) {
      const wait = backoffMs(continuesUsed);
      console.log(`zt-run: continue-steer #${continuesUsed + 1} after ${Math.round(wait / 1000)}s (lastError=${lastErrorKind || "silence"})`);
      await new Promise((r) => setTimeout(r, wait));
      await sv.request("session/send", { sessionId, content: "Continue from where you stopped. Complete the task fully." });
      continuesUsed++;
      lastEvent = Date.now();
      continue;
    }
    break; // settled (or continue budget exhausted)
  }
  writeTranscript("settled");
  try { await sv.request("session/stop", { sessionId }); } catch { /* maybe ended */ }
  await sv.close();
  if (events.length === 0 && transportError) {
    console.error(`zt-run: no events captured; backend said: ${transportError}`);
    process.exit(1);
  }
}

main().catch(async (e) => {
  console.error(`FATAL: ${e instanceof Error ? e.message : e}`);
  try { if (sessionId) await sv.request("session/stop", { sessionId }); } catch { /* noop */ }
  await sv.close();
  process.exit(1);
});
