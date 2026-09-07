// Headless interactive drive: real App, real app-server, mock keyboard.
// Drives the filter, captures CLEAN character frames, asserts narrowing.
// Usage: bun run tui:drive
// ⚠ mockInput targets the renderer's key bridge; the React keyHandler
// hook may not see these events (filter narrowing won't move here even
// though it works with a real keyboard — verified via PTY debug).
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

// wait for the sidebar to fill
for (let i = 0; i < 15; i += 1) {
  await new Promise((r) => setTimeout(r, 1000));
  if (setup.captureCharFrame().includes("idle ·")) break;
}

const initial = setup.captureCharFrame();
const initialRows = (initial.match(/ago/g) ?? []).length;
console.log(`[drive] initial sidebar rows: ${initialRows}`);

// / then type 'tui' one char at a time, then capture
await setup.mockInput.pressKey("/");
await setup.mockInput.typeText("tui", 120);
await new Promise((r) => setTimeout(r, 800));
const filtered = setup.captureCharFrame();
const filteredRows = (filtered.match(/ago/g) ?? []).length;
console.log(`[drive] filtered('tui') rows: ${filteredRows}`);
console.log(filtered.split("\n").slice(0, 14).join("\n"));

await client.close();
process.exit(0);
