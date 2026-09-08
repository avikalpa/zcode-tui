// Headless acceptance: the REAL App against the REAL app-server through
// OpenTUI's test renderer. Polls frames and prints the first settled one.
// (waitForFrame exists but polling shows the status line converging.)
import { testRender } from "@opentui/react/test-utils";
import { AppServer } from "../protocol/client";

const client = new AppServer({
  onServerRequest: (m) => {
    if (m.method === "session/requestRuntimePreferences") {
      client.respond(m.id as string, { nativeSearchEnhancementsEnabled: false });
    } else {
      client.respond(m.id as string, {});
    }
  },
});

const { App } = await import("./app");
const setup = await testRender(
  <App client={client} onQuit={() => process.exit(0)} />,
  { width: 100, height: 26 },
);

let last = "";
for (let i = 0; i < 12; i += 1) {
  await new Promise((r) => setTimeout(r, 1000));
  last = setup.captureCharFrame();
  if (/\d+ sessions/.test(last) && !last.includes("connecting")) break;
}
console.log(last);
await client.close();
process.exit(0);
