import { describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import type { AppServer } from "../protocol/client";
import { App } from "./app";

function fakeClient() {
  const sessions = [
    { sessionId: "sess_fixture_one", title: "Checking sessions list", status: "idle", mode: "build", updatedAt: Date.parse("2026-09-04T12:00:00Z") },
    { sessionId: "sess_fixture_two", title: "Fixing the composer", status: "idle", mode: "build", updatedAt: Date.parse("2026-09-03T12:00:00Z") },
  ];
  const client = {
    request: async (method: string) => {
      if (method === "session/list") return { sessions };
      if (method === "workspace/readState") return { modelCatalog: { available: [] } };
      return {};
    },
    onBackendLost: () => {},
    onAsk: () => {},
    onPush: () => {},
    respawn: () => {},
  } as unknown as AppServer;
  return client;
}

describe("zcode-tui OpenCode-shaped shell", () => {
  test("opens the sessions picker from the front-page slash command", async () => {
    const setup = await testRender(
      <App client={fakeClient()} onQuit={() => {}} />,
      { width: 100, height: 30 },
    );

    const home = await setup.waitForFrame(
      (frame) => frame.includes("zcodetui") && frame.includes("Ask anything"),
      { maxPasses: 20 },
    );
    expect(home).toContain("/sessions");

    // Send the complete keystroke burst without a render turn between the
    // printable bytes and Enter. This is the timing that exposed stale React
    // state in the first implementation.
    await setup.mockInput.pressKeys([..."/sessions", "\r"]);
    const picker = await setup.waitForFrame(
      (frame) => frame.includes("Sessions for zcode-tui") && frame.includes("Checking sessions list"),
      { maxPasses: 20 },
    );
    expect(picker).toContain("Fri Sep 04 2026");
    expect(picker).toContain("pin/unpin ctrl+f");
    setup.renderer.destroy();
  });
});
