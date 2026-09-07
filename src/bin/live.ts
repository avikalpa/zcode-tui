// Live end-to-end: create session → subscribe → send tiny prompt →
// capture the push stream → stop. Proves the full TUI loop over the real
// app-server with the shared store/identity.
// Usage: bun run probe:live -- [--content "..."] [--collectMs 45000]
import { parseArgs } from "node:util";
import { AppServer } from "../protocol/client";

const { values } = parseArgs({
  options: {
    content: { type: "string", default: "Reply with exactly: TUI-LINK-OK (nothing else)." },
    collectMs: { type: "string", default: "45000" },
  },
});

const WORKSPACE = {
  workspacePath: "/home/pi/.zcode/workspace/default",
  workspaceKey: "/home/pi/.zcode/workspace/default",
};

const events: { method: string; kind?: string; ms: number; summary: string }[] = [];
const t0 = Date.now();
let sessionId = "";

const sv = new AppServer({
  onNotification: (m) => {
    const method = String(m.method);
    // Summarize without dumping full text.
    let kind: string | undefined;
    let summary = "";
    const params = m.params as Record<string, unknown> | undefined;
    if (method === "session/event") {
      const payload = (params?.payload ?? {}) as Record<string, unknown>;
      kind = String(payload.type ?? payload.kind ?? "untyped");
      const keys = Object.keys(payload).filter((k) => k !== "type" && k !== "kind");
      summary = `keys=[${keys.join(",")}]=${JSON.stringify(payload).slice(0, 160)}`;
    } else if (method === "v4/telemetry/event") {
      kind = String(params?.kind);
      const ch = params?.channel ? `/${String(params.channel)}` : "";
      summary = `${kind}${ch} seq=${params?.eventSeq}`;
    } else if (method === "state.updated") {
      kind = "state.updated";
      summary = JSON.stringify(params).slice(0, 120);
    } else {
      summary = JSON.stringify(m).slice(0, 150);
    }
    events.push({ method, kind, ms: Date.now() - t0, summary });
    if (events.length % 25 === 0) console.error(`... ${events.length} pushes, ${Date.now() - t0}ms`);
  },
  onServerRequest: (m) => {
    const method = String(m.method);
    events.push({ method: `<<${method}`, ms: Date.now() - t0, summary: JSON.stringify(m.params).slice(0, 120) });
    if (method === "session/requestRuntimePreferences") {
      sv.respond(m.id as string, { nativeSearchEnhancementsEnabled: false });
    } else if (method === "interaction/requestPermission") {
      // Deny tools during the probe.
      sv.respond(m.id as string, { decision: "deny" });
    } else if (method === "interaction/requestUserInput") {
      sv.respond(m.id as string, { cancelled: true });
    } else {
      console.error(`[server-req] NO SHAPE for ${method}`);
      sv.respond(m.id as string, {});
    }
  },
}, { onStderr: (c) => process.stderr.write(c.slice(0, 300)) });

async function main() {
  const created = await sv.request("session/create", {
    workspace: WORKSPACE,
    mode: "build",
    persistence: "immediate",
  }) as Record<string, unknown>;
  const createdSession = (created.session ?? created) as Record<string, unknown>;
  sessionId = String(createdSession.sessionId);
  console.log(`created ${sessionId}`);

  const sub = await sv.request("session/subscribe", {
    sessionId,
    deliveryKind: "desktop-continuous",
    includeSnapshot: true,
  });
  console.log(`subscribed: ${JSON.stringify(sub).slice(0, 160)}`);

  const sent = await sv.request("session/send", {
    sessionId,
    content: values.content,
  });
  console.log(`send ack: ${JSON.stringify(sent).slice(0, 200)}`);

  await new Promise((r) => setTimeout(r, Number(values.collectMs)));

  // Digest the captured stream.
  const byKind: Record<string, number> = {};
  for (const e of events) {
    const k = e.kind ?? e.method;
    byKind[k] = (byKind[k] ?? 0) + 1;
  }
  console.log(`\n=== STREAM DIGEST (${events.length} events in ${Date.now() - t0}ms) ===`);
  for (const [k, n] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) console.log(`${n}\t${k}`);
  console.log("\n=== FIRST 12 ===");
  for (const e of events.slice(0, 12)) console.log(`+${String(e.ms).padStart(6)}ms ${e.method} ${e.kind ?? ""} ${e.summary}`);
  console.log("\n=== LAST 6 ===");
  for (const e of events.slice(-6)) console.log(`+${String(e.ms).padStart(6)}ms ${e.method} ${e.kind ?? ""} ${e.summary}`);

  try { await sv.request("session/stop", { sessionId }); } catch { /* maybe already done */ }
  await sv.close();
}

main().catch(async (e) => {
  console.error(`FATAL: ${e instanceof Error ? e.message : e}`);
  try { if (sessionId) await sv.request("session/stop", { sessionId }); } catch { /* noop */ }
  await sv.close();
  process.exit(1);
});
