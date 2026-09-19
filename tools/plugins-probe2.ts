// Probe 2: param shapes for setEnabled (idempotent write), describe, validate.
import { AppServer } from "../src/protocol/client";

async function main() {
  const client = new AppServer({}, { onStderr: (c) => process.stderr.write(c) });
  const ws = { workspace: { workspacePath: process.cwd(), workspaceKey: process.cwd() } };
  const show = async (label: string, method: string, params: unknown) => {
    try {
      const res = await client.request(method, params, 20000);
      const text = JSON.stringify(res, null, 1);
      console.log(`\n=== ${label} (${method}) ===`);
      console.log(text.length > 2500 ? text.slice(0, 2500) + `\n...[truncated ${text.length}]` : text);
    } catch (e) {
      console.log(`\n=== ${label} (${method}) FAILED ===`);
      console.log(String(e).slice(0, 800));
    }
  };
  // Idempotent write: browser-use is enabled:true; set it true again.
  await show("setEnabled idempotent", "plugins/setEnabled", {
    ...ws,
    pluginId: "browser-use@zcode-plugins-official",
    enabled: true,
  });
  await show("describe", "plugins/describe", {
    ...ws,
    pluginId: "browser-use@zcode-plugins-official",
  });
  await show("validate", "plugins/validate", ws);
  // Confirm the list still shows enabled:true (no mutation happened).
  await show("list re-read", "plugins/list", ws);
  client.proc.kill();
  process.exit(0);
}
main();
