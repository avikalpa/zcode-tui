// Probe one-shot: populates session/subagents via one proof-scoped subagent ask: populate session/subagents via one proof-scoped subagent ask.
// Pattern per tools/usage-probe.ts: onAsk answers the runtime-preferences
// handshake, deferred persistence, proof-scoped cwd.
import { AppServer } from "../src/protocol/client";

async function main() {
  const client = new AppServer({}, { onStderr: () => process.stderr.write("") });
  client.onAsk((msg) =>
    String((msg as any).method) === "session/requestRuntimePreferences"
      ? { nativeSearchEnhancementsEnabled: false }
      : {},
  );
  const ws = { workspacePath: "/tmp/zct-proof-cwd", workspaceKey: "/tmp/zct-proof-cwd" };

  const res = (await client.request("session/create", {
    workspace: ws,
    mode: "build",
    persistence: "deferred",
    model: { providerId: "zai", modelId: "GLM-5.3-Flash" },
  }, 45000)) as Record<string, unknown>;
  const sess = res.session as Record<string, unknown> | undefined;
  const sessionId = String(sess?.sessionId ?? "");
  console.log("created", sessionId);
  if (!sessionId) throw new Error("no session");

  await client.request("session/send", {
    sessionId,
    content: "Use the Agent tool exactly once. Spawn one general-purpose subagent whose only task is to reply with the single word ok. Wait for it to finish. Then reply with exactly: done",
  }, 45000);
  console.log("sent ask at", new Date().toISOString());

  const seen = new Set<string>();
  const deadline = Date.now() + 240_000;
  let snap: any = null;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    try {
      snap = await client.request("session/subagents", { sessionId });
    } catch (e) {
      console.log("poll failed:", String(e));
      continue;
    }
    const runningCount = (snap.running ?? []).length;
    const endedTotal = snap.ended?.total ?? 0;
    const key = `${runningCount}/${endedTotal}`;
    if (runningCount > 0 && !seen.has("running-" + key)) {
      seen.add("running-" + key);
      console.log(`\n=== MID-RUN snapshot (running=${runningCount}) ===`);
      console.log(JSON.stringify(snap, null, 1).slice(0, 8000));
    }
    if (endedTotal >= 1) {
      console.log(`\n=== FINAL snapshot (ended total=${endedTotal}) ===`);
      console.log(JSON.stringify(snap, null, 1).slice(0, 10000));
      break;
    }
  }
  if ((snap?.ended?.total ?? 0) < 1) console.log("TIMEOUT without an ended subagent");

  try { await client.request("session/stop", { sessionId }); } catch {}
  client.proc.kill();
  process.exit(0);
}
main();
