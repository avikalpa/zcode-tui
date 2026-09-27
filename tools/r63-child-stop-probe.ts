// Probe one-shot (R63 composer-tabs wave): does session/stop accept a CHILD
// session id (the composer overlay's ctrl+d interrupt), and what status
// vocabulary does a stopped child take? Pattern per tools/subagents-probe.ts:
// one proof-scoped subagent ask, poll session/subagents, stop the CHILD
// mid-run, record the verb result + the child's post-stop status + whether
// the parent turn survives. Idempotent-write note: the stop targets the
// probe's own child only; the parent is stopped for cleanup after.
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
    mode: "build",
    persistence: "deferred",
    model: { providerId: "zai", modelId: "GLM-5.3-Flash" },
  }, 45000)) as Record<string, unknown>;
  const sess = res.session as Record<string, unknown> | undefined;
  const sessionId = String(sess?.sessionId ?? "");
  console.log("PARENT", sessionId);
  if (!sessionId) throw new Error("no session");

  await c.request("session/send", {
    sessionId,
    content: "Use the Agent tool exactly once. Spawn one general-purpose subagent whose only task is to count slowly from 1 to 30, waiting two seconds between each number, and then reply with the final count. Wait for it to finish. Then reply with exactly: done",
  }, 45000);
  console.log("SENT ask at", new Date().toISOString());

  const deadline = Date.now() + 240_000;
  let stopped = false;
  let childId: string | null = null;
  let stopResult = "never-stopped";
  let postStop: any = null;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    let snap: any;
    try {
      snap = await c.request("session/subagents", { sessionId });
    } catch (e) {
      console.log("poll failed:", String(e));
      continue;
    }
    const running = (snap?.running ?? []) as any[];
    const ended = ((snap?.ended?.items ?? []) as any[]);
    if (running.length > 0 && !stopped) {
      childId = String(running[0]?.childSessionId ?? "");
      console.log("CHILD running", childId, "title=", JSON.stringify(running[0]?.title ?? ""));
      if (childId) {
        try {
          const out = await c.request("session/stop", { sessionId: childId }, 20000);
          stopResult = "ok:" + JSON.stringify(out ?? {}).slice(0, 300);
        } catch (e) {
          stopResult = "error:" + String(e).slice(0, 400);
        }
        stopped = true;
        console.log("STOP child ->", stopResult);
        await new Promise((r) => setTimeout(r, 4000));
        try {
          postStop = await c.request("session/subagents", { sessionId });
          console.log("POST-STOP snapshot:", JSON.stringify(postStop, null, 1).slice(0, 4000));
        } catch (e) {
          console.log("post-stop poll failed:", String(e));
        }
        break;
      }
    }
    if (ended.length > 0 && !stopped) {
      console.log("child ended naturally before the stop window; vocabulary:",
        JSON.stringify(ended[0]?.status ?? ""));
      break;
    }
  }

  if (stopped && childId) {
    // Settle watch: does the child leave running, and does the PARENT keep
    // going (its Agent tool call result) or unwind?
    const settleDeadline = Date.now() + 90_000;
    while (Date.now() < settleDeadline) {
      await new Promise((r) => setTimeout(r, 4000));
      try {
        const snap = await c.request("session/subagents", { sessionId });
        const running = ((snap?.running ?? []) as any[]).map((x) => x.childSessionId);
        const ended = ((snap?.ended?.items ?? []) as any[]).map((x) => [x.childSessionId, x.status]);
        console.log("SETTLE running=", JSON.stringify(running), "ended=", JSON.stringify(ended));
        if (!running.includes(childId)) break;
      } catch { /* keep polling */ }
    }
    let parentRow: any = null;
    try {
      const rows = (await c.request("session/list", {})) as any;
      const list = rows?.sessions ?? rows?.items ?? (Array.isArray(rows) ? rows : []);
      parentRow = list.find((r: any) => String(r?.sessionId ?? "") === sessionId);
    } catch { }
    console.log("PARENT row:", JSON.stringify(parentRow)?.slice(0, 600));
  }

  try { await c.request("session/stop", { sessionId }); } catch { }
  c.proc.kill();
  process.exit(0);
}
main();
