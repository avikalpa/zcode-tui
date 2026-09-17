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

const AppModule = await import("./app");

describe("zcode-tui OpenCode-shaped shell", () => {
  test("opens the sessions picker from the front-page slash command", async () => {
    const setup = await testRender(
      <App client={fakeClient()} onQuit={() => {}} />,
      { width: 100, height: 30 },
    );

    // The reference home has no subtitle block: logo, composer, hints.
    const home = await setup.waitForFrame(
      (frame) => frame.includes("Ask anything") && frame.includes("shift+tab"),
      { maxPasses: 20 },
    );

    // Send the complete keystroke burst without a render turn between the
    // printable bytes and Enter. This is the timing that exposed stale React
    // state in the first implementation.
    await setup.mockInput.pressKeys([..."/sessions", "\r"]);
    const picker = await setup.waitForFrame(
      (frame) => frame.includes("Sessions") && frame.includes("Checking sessions list"),
      { maxPasses: 20 },
    );
    expect(picker).toContain("Fri Sep 04 2026");
    setup.renderer.destroy();
  });
});



describe("session transcript reconstruction", () => {
  test("partsToTurns: reasoning becomes thinking, tools become tool rows, text stays body", () => {
    const { partsToTurns } = AppModule;
    const turns = partsToTurns({
      info: { role: "assistant", id: "msg_1", model: { modelId: "GLM-5.3-Flash" } },
      parts: [
        { type: "reasoning", text: "let me check the file first" },
        { type: "text", text: "Here is what I found." },
        { type: "tool", callID: "call_1", tool: "Bash", state: { status: "completed", input: { command: "ls /tmp" }, output: "file.txt\n" } },
        { type: "tool", callID: "call_2", tool: "Write", state: { status: "error", input: { file_path: "/tmp/x.py" } } },
      ],
    });
    expect(turns.length).toBe(3);
    expect(turns[0].role).toBe("assistant");
    expect(turns[0].text).toBe("Here is what I found.");
    expect(turns[0].thinking).toBe("let me check the file first");
    expect(turns[1].role).toBe("tool");
    expect(turns[1].toolName).toBe("Bash");
    expect(turns[1].text).toBe("ls /tmp");
    expect(turns[1].toolOk).toBe(true);
    expect(turns[2].toolOk).toBe(false);
    expect(turns[2].text).toBe("/tmp/x.py");
  });

  test("breakLongTokens splits only unbreakable runs, leaves prose alone", async () => {
    const { breakLongTokens } = AppModule;
    const prose = "hello world this is fine";
    expect(breakLongTokens(prose, 24)).toBe(prose);
    const wall = "x".repeat(80);
    const broken = breakLongTokens(wall, 24);
    for (const line of broken.split("\n")) expect(line.length).toBeLessThanOrEqual(24);
    expect(broken.split("\n").join("")).toBe(wall);
    const url = "see https://example.com/" + "a".repeat(60) + " end";
    const b2 = breakLongTokens(url, 30);
    expect(b2).toContain("see https://example.com/");
    expect(b2.split("\n").every((l) => l.length <= 60)).toBe(true);
  });
});
