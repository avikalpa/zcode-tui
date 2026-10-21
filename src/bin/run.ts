// zt-run — headless zcode-tui worker (fleet dream/compose runner).
// One session, one brief, auto-allows its own workspace tools, captures the
// stream, exits. Credentials ride the SAME ~/.zcode stores as the desktop.
//
// Usage:
//   bun tools/zcode-tui-run.ts --content-file BRIEF.md --workspace DIR \
//     [--plane zai|autoclaw] [--model ID] [--collect-ms 900000]
//     [--quiet-sec 120] [--out /tmp/zt-transcript.json]
// Plan notes (owner 2026-10-21): zai-plane rides the ~/.zcode default model
// (Z.AI Coding Plan); autoclaw-plane passes --model through to session/create
// (catalog ids via workspace/readState — v2 will auto-pick).
import { parseArgs } from "node:util";
import { readFileSync, writeFileSync } from "node:fs";
import { AppServer } from "../protocol/client";

const { values } = parseArgs({
  options: {
    "content-file": { type: "string" },
    workspace: { type: "string", default: "/tmp" },
    plane: { type: "string", default: "zai" },
    model: { type: "string", default: "" },
    "collect-ms": { type: "string", default: "900000" },
    "quiet-sec": { type: "string", default: "150" },
    out: { type: "string", default: "/tmp/zt-run-transcript.json" },
  },
});

const content = readFileSync(String(values["content-file"]), "utf8");
const t0 = Date.now();
const events: any[] = [];
let lastEvent = 0;
let sessionId = "";

const sv = new AppServer({
  onNotification: (m: any) => {
    const method = String(m.method);
    let kind = "";
    let summary = "";
    if (method === "session/event") {
      const p = (m.params?.payload ?? {}) as Record<string, unknown>;
      kind = String(p.type ?? p.kind ?? "untyped");
      summary = JSON.stringify(p).slice(0, 140);
    } else {
      summary = JSON.stringify(m).slice(0, 120);
    }
    events.push({ method, kind, ms: Date.now() - t0, summary });
    lastEvent = Date.now();
  },
  onServerRequest: (m: any) => {
    const method = String(m.method);
    if (method === "interaction/requestPermission") {
      // The worker needs its workspace tools (read brief, write response).
      sv.respond(m.id as string, { decision: "allow" });
    } else if (method === "interaction/requestUserInput") {
      sv.respond(m.id as string, { cancelled: true });
    } else if (method === "session/requestRuntimePreferences") {
      sv.respond(m.id as string, { nativeSearchEnhancementsEnabled: false });
    } else {
      sv.respond(m.id as string, {});
    }
  },
}, { onStderr: (c: string) => process.stderr.write(c.slice(0, 200)) });

async function main() {
  const createParams: any = {
    workspace: { workspacePath: values.workspace, workspaceKey: values.workspace },
    mode: "build",
    persistence: "immediate",
  };
  if (values.model) createParams.model = values.model;
  const created = (await sv.request("session/create", createParams)) as any;
  sessionId = String((created.session ?? created).sessionId);
  console.log(`zt-run: session ${sessionId} plane=${values.plane} model=${values.model || "(config default)"}`);
  await sv.request("session/subscribe", { sessionId, deliveryKind: "desktop-continuous", includeSnapshot: true });
  await sv.request("session/send", { sessionId, content });

  const maxMs = Number(values["collect-ms"]);
  const quietMs = Number(values["quiet-sec"]) * 1000;
  while (Date.now() - t0 < maxMs) {
    await new Promise((r) => setTimeout(r, 5000));
    if (events.length > 0 && Date.now() - lastEvent > quietMs) break; // turn settled
  }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
  writeFileSync(
    String(values.out),
    JSON.stringify({ sessionId, plane: values.plane, model: values.model, elapsedSec: elapsed, events }, null, 1),
  );
  console.log(`zt-run: done ${events.length} events in ${elapsed}s -> ${values.out}`);
  try { await sv.request("session/stop", { sessionId }); } catch { /* maybe ended */ }
  await sv.close();
}

main().catch(async (e) => {
  console.error(`FATAL: ${e instanceof Error ? e.message : e}`);
  try { if (sessionId) await sv.request("session/stop", { sessionId }); } catch { /* noop */ }
  await sv.close();
  process.exit(1);
});
