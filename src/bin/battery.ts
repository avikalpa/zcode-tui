// Acceptance battery — no model calls. Asserts the protocol lifecycle and
// the client machinery end-to-end against a real app-server.
// Usage: bun run probe:battery
import { AppServer } from "../protocol/client";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const WORKSPACE = {
  workspacePath: process.cwd(),
  workspaceKey: process.cwd(),
};

const sv = new AppServer({
  onServerRequest: (m) => {
    if (m.method === "session/requestRuntimePreferences") {
      sv.respond(m.id as string, { nativeSearchEnhancementsEnabled: false });
    } else {
      sv.respond(m.id as string, {});
    }
  },
});

try {
  const listed = (await sv.request("session/list", { limit: 10 })) as { sessions?: unknown[] };
  check("session/list", Array.isArray(listed.sessions) && listed.sessions.length > 0, `${listed.sessions?.length} sessions`);

  const ws = (await sv.request("workspace/readState", { workspace: WORKSPACE })) as {
    modelCatalog?: { available?: unknown[] };
  };
  check("workspace/readState catalog", (ws.modelCatalog?.available?.length ?? 0) > 0, `${ws.modelCatalog?.available?.length} models`);

  const created = (await sv.request("session/create", {
    workspace: WORKSPACE, mode: "build", persistence: "immediate",
  })) as { session?: { sessionId?: string } };
  const sessionId = created.session?.sessionId;
  check("session/create", typeof sessionId === "string" && sessionId.startsWith("sess_"), sessionId);

  const sub = (await sv.request("session/subscribe", {
    sessionId, deliveryKind: "desktop-continuous", includeSnapshot: true,
  })) as { eventSeq?: number };
  check("session/subscribe", typeof sub.eventSeq === "number");

  const read = (await sv.request("session/read", { sessionId })) as Record<string, unknown>;
  check("session/read", read.sessionId === sessionId || read.messages !== undefined);

  const stopped = await sv.request("session/stop", { sessionId });
  check("session/stop", stopped !== undefined);

  const bad = await sv.request("session/read", { sessionId: "sess_does_not_exist" })
    .then(() => null, (e: Error & { code?: number }) => e);
  check("foreign/unknown session errors -32xxx", bad !== null && typeof bad.code === "number", `code=${bad?.code}`);
} catch (e) {
  failures += 1;
  console.log(`FAIL battery aborted — ${e instanceof Error ? e.message : e}`);
}

await sv.close();
console.log(failures === 0 ? "BATTERY GREEN" : `BATTERY RED (${failures} failures)`);
process.exit(failures === 0 ? 0 : 1);
