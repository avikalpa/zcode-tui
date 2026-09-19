// One-shot: what does session/usage (and workspace/readState) carry re: plan quota?
import { AppServer } from "../src/protocol/client";
async function main() {
  const client = new AppServer({}, { onStderr: () => process.stderr.write("") });
  client.onAsk((msg) => String((msg as any).method) === "session/requestRuntimePreferences" ? { nativeSearchEnhancementsEnabled: false } : {});
  const ws = { workspacePath: "/tmp/zct-proof-cwd", workspaceKey: "/tmp/zct-proof-cwd" };
  const res = (await client.request("session/create", {
    workspace: ws, mode: "build", persistence: "deferred",
    model: { providerId: "zai", modelId: "GLM-5.3-Flash" },
  }, 45000)) as Record<string, unknown>;
  const sess = res.session as Record<string, unknown> | undefined;
  const id = String(sess?.sessionId ?? (sess as any)?.id ?? "");
  const usage = await client.request("session/usage", { sessionId: id }, 45000).catch((e) => String(e).slice(0, 200));
  console.log("=== session/usage ===");
  console.log(JSON.stringify(usage, null, 1).slice(0, 2200));
  const rs = await client.request("workspace/readState", { workspace: { workspacePath: "/tmp/zct-proof-cwd", workspaceKey: "/tmp/zct-proof-cwd" } }, 45000).catch((e) => String(e).slice(0, 200));
  console.log("=== workspace/readState (quota-ish keys) ===");
  console.log(JSON.stringify(rs, null, 1).slice(0, 2200));
  process.exit(0);
}
void main();
