// Probe one-shot (R65): raw protocol path — create yolo session, send the
// long ask, then report the PARENT's own turn state every 5s (session/list
// row + the Agent tool part state from session/messages). If the parent
// shows interrupted here too, the interrupt is HOST-side, not TUI-side.
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
  console.log("SENT", new Date().toISOString().slice(11, 19));

  for (let i = 0; i < 18; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const t = new Date().toISOString().slice(11, 19);
    try {
      const rows: any = await c.request("session/list", {});
      const list = rows?.sessions ?? rows?.items ?? (Array.isArray(rows) ? rows : []);
      const me = list.find((r: any) => String(r?.sessionId) === sessionId);
      let parts = "";
      try {
        const msgs: any = await c.request("session/messages", { sessionId });
        const items = msgs?.messages ?? msgs?.items ?? [];
        const last = items[items.length - 1];
        parts = JSON.stringify(last).slice(0, 220);
      } catch (e) {
        parts = "messages-failed: " + String(e).slice(0, 80);
      }
      console.log(`${t} row=${JSON.stringify({ status: me?.status, mode: me?.mode, title: me?.title })} last=${parts}`);
    } catch (e) {
      console.log(`${t} poll failed: ${String(e).slice(0, 120)}`);
    }
  }
  c.proc.kill();
  process.exit(0);
}
main();
