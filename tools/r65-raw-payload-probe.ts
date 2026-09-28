// Probe one-shot (R65 diagnosis): the RAW session/subagents payload during
// a live child. Sends the r63 long ask to a fresh deferred session, then
// polls session/subagents every 3s printing the payload's shape + counts
// + the running[] items verbatim, until the child ends. Pattern per
// tools/r63-child-stop-probe.ts. Run IN-TREE: bun tools/../this file.
import { AppServer } from "../src/protocol/client";

function onAsk(msg: unknown) {
  return String((msg as any)?.method) === "session/requestRuntimePreferences"
    ? { nativeSearchEnhancementsEnabled: false }
    : {};
}

async function main() {
  const c = new AppServer({}, { onStderr: () => {} });
  c.onAsk(onAsk);
  const ws = { workspacePath: "/tmp/zct-proof-cwd", workspaceKey: "/tmp/zct-proof-cwd" };

  const res = (await c.request("session/create", {
    workspace: ws,
    mode: "yolo",
    persistence: "deferred",
    model: { providerId: "zai", modelId: "GLM-5.3-Flash" },
  }, 45000)) as Record<string, unknown>;
  const sess = res.session as Record<string, unknown> | undefined;
  const sessionId = String(sess?.sessionId ?? "");
  console.log("PARENT", sessionId);
  if (!sessionId) throw new Error("no session");

  await c.request("session/send", {
    sessionId,
    content: "Use the Agent tool exactly once. Spawn one general-purpose subagent whose only task is to count slowly from one to thirty, waiting two seconds between each number, and then reply with the final count. Wait for it to finish. Then reply with exactly: done",
  }, 45000);
  console.log("SENT ask at", new Date().toISOString());

  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    let snap: any;
    try {
      snap = await c.request("session/subagents", { sessionId });
    } catch (e) {
      console.log("poll failed:", String(e).slice(0, 200));
      continue;
    }
    const keys = snap ? Object.keys(snap).join(",") : "null";
    const running = (snap?.running ?? []) as any[];
    const endedN = ((snap?.ended?.items ?? []) as any[]).length;
    const t = new Date().toISOString().slice(11, 19);
    if (running.length > 0) {
      console.log(`${t} keys=[${keys}] running=${running.length} ended=${endedN} ITEM=${JSON.stringify(running[0]).slice(0, 400)}`);
    } else {
      console.log(`${t} keys=[${keys}] running=0 ended=${endedN} rev=${String(snap?.revision).slice(0, 20)}`);
    }
    if (endedN > 0) break;
  }
  try { await c.request("session/stop", { sessionId }); } catch { }
  c.proc.kill();
  process.exit(0);
}
main();
