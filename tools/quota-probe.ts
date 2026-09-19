// One-shot: usage/stats shape (plan quota hunt).
import { AppServer } from "../src/protocol/client";
async function main() {
  const client = new AppServer({}, { onStderr: () => {} });
  client.onAsk((msg) => String((msg as any).method) === "session/requestRuntimePreferences" ? { nativeSearchEnhancementsEnabled: false } : {});
  const ws = { workspace: { workspacePath: "/tmp/zct-proof-cwd", workspaceKey: "/tmp/zct-proof-cwd" } };
  for (const [label, params] of [["usage/stats 7d", { range: "7d" }], ["usage/stats all", { range: "all" }]] as const) {
    const r = await client.request("usage/stats", params as Record<string, unknown>, 45000).catch((e) => String(e).slice(0, 300));
    console.log(`=== ${label} ===`);
    console.log(JSON.stringify(r, null, 1).slice(0, 2600));
  }
  process.exit(0);
}
void main();
