import { AppServer } from "../src/protocol/client";
async function main() {
  const client = new AppServer({}, { onStderr: () => {} });
  client.onAsk(() => ({}));
  const res = (await client.request("session/create", {
    workspace: { workspacePath: "/tmp/zct-proof-cwd", workspaceKey: "/tmp/zct-proof-cwd" },
    mode: "build",
    persistence: "deferred",
    model: { providerId: "zai", modelId: "GLM-5.3-Flash" },
  }, 45000)) as Record<string, unknown>;
  const sess = res.session as Record<string, unknown> | undefined;
  const id = String(sess?.sessionId ?? (sess as any)?.id ?? "?");
  console.log("created deferred:", id);
  const list = (await client.request("session/list", { limit: 100 }, 45000)) as { sessions?: any[] };
  const rows = list.sessions ?? [];
  const mine = rows.filter((r) => String(r.sessionId ?? r.id) === id);
  console.log("deferred session visible in session/list:", mine.length > 0 ? "YES (pollutes)" : "NO (clean)");
  await client.request("session/close", { sessionId: id }, 30000).catch((e) => console.log("close:", String(e).slice(0, 80)));
  process.exit(0);
}
void main();
