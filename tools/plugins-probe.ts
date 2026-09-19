// Read-only live probe of the plugins verb family (0.6.34 recon).
// Lives in tools/ of the campaign worktree; run with bun from the worktree root.
import { AppServer } from "../src/protocol/client";

async function main() {
  const client = new AppServer({}, {
    onStderr: (c) => process.stderr.write(c),
  });
  const ws = { workspace: { workspacePath: process.cwd(), workspaceKey: process.cwd() } };
  const show = async (label: string, method: string, params: unknown) => {
    try {
      const res = await client.request(method, params, 20000);
      const text = JSON.stringify(res, null, 1);
      console.log(`\n=== ${label} (${method}) ===`);
      console.log(text.length > 5000 ? text.slice(0, 5000) + `\n...[truncated ${text.length} chars]` : text);
    } catch (e) {
      console.log(`\n=== ${label} (${method}) FAILED ===`);
      console.log(String(e));
    }
  };
  await show("list", "plugins/list", ws);
  await show("overview", "plugins/overview", ws);
  client.proc.kill();
  process.exit(0);
}
main();
