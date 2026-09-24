// Probe one-shot: proves the child-session transcript gap: is the child session readable via session/messages?
import { AppServer } from "../src/protocol/client";

async function main() {
  const client = new AppServer({}, { onStderr: () => process.stderr.write("") });
  const child = "sess_subagent_agent_8ab1fd58-37a7-4fe6-a687-4a6aa42c1385";
  const parent = "sess_2783b3a6-25e9-4f88-8c19-e7b42a8d5a08";
  const show = async (label: string, method: string, params: unknown) => {
    try {
      const res = await client.request(method, params, 20000);
      const text = JSON.stringify(res, null, 1);
      console.log(`\n=== ${label} (${method}) ===`);
      console.log(text.length > 3000 ? text.slice(0, 3000) + `\n...[truncated ${text.length} chars]` : text);
    } catch (e) {
      console.log(`\n=== ${label} (${method}) FAILED ===`);
      console.log(String(e));
    }
  };
  await show("child messages", "session/messages", { sessionId: child });
  await show("child read", "session/read", { sessionId: child });
  await show("child in parent subagents", "session/subagents", { sessionId: parent });
  client.proc.kill();
  process.exit(0);
}
main();
