import { describe, expect, test } from "bun:test";
import { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import type { AppServer } from "../protocol/client";
import { App } from "./app";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createModelPreferenceRepository } from "./session/model-preference";

function fakeClient(onResume?: (id: string) => void, mcpUnavailable = false, withMcp = false) {
  const sessions = [
    { sessionId: "sess_fixture_one", title: "Checking sessions list", status: "idle", mode: "build", updatedAt: Date.parse("2026-09-04T12:00:00Z") },
    { sessionId: "sess_fixture_two", title: "Fixing the composer", status: "idle", mode: "build", updatedAt: Date.parse("2026-09-03T12:00:00Z") },
  ];
  const client = {
    request: async (method: string, params?: { sessionId?: string }) => {
      if (method === "session/list") return { sessions };
      if (method === "mcp/list" && withMcp) return { statuses: { fixture: { status: "connected" } } };
      if (method === "mcp/list" && mcpUnavailable) throw new Error("Synthetic MCP request failure");
      if (method === "session/resume") {
        onResume?.(params?.sessionId ?? "");
        return { session: { status: "idle" }, messages: [] };
      }
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
  test("clicking the toast close affordance dismisses an actual App notification", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zc-toast-"));
    const setup = await testRender(<App client={fakeClient()} onQuit={() => {}}
      preferences={createModelPreferenceRepository(join(dir, "state.json"))} />, { width: 100, height: 30 });
    try {
      await setup.waitForFrame((f) => f.includes("Ask anything"));
      await act(async () => { await setup.mockInput.pressKeys([..."/thinking", "\r"]); });
      const frame = await setup.waitForFrame((f) => f.includes("thinking →"));
      const lines = frame.split("\n"); const y = lines.findIndex((line) => line.includes("thinking →"));
      const x = lines[y].lastIndexOf("x");
      expect(x).toBeGreaterThan(0);
      await act(async () => { await setup.mockMouse.click(x, y); });
      expect(await setup.waitForFrame((f) => !f.includes("thinking →"))).not.toContain("thinking →");
    } finally { setup.renderer.destroy(); rmSync(dir, { recursive: true, force: true }); }
  });
  test("home MCP count and shortcuts fit on the same footer row", async () => {
    const setup = await testRender(<App client={fakeClient(undefined, false, true)} onQuit={() => {}} />, { width: 100, height: 30 });
    try {
      const frame = await setup.waitForFrame((f) => f.includes("1 MCP"));
      const status = frame.split("\n").find((line) => line.includes("1 MCP"));
      expect(status).toContain("ctrl+p commands");
      expect(status).toContain("shift+tab agents");
    } finally { setup.renderer.destroy(); }
  });
  test("status preserves an MCP request failure as unavailable", async () => {
    const setup = await testRender(<App client={fakeClient(undefined, true)} onQuit={() => {}} />, { width: 100, height: 40 });
    try {
      await setup.waitForFrame((f) => f.includes("Ask anything"));
      await act(async () => { await setup.mockInput.pressKeys([..."/status", "\r"]); });
      const frame = await setup.waitForFrame((f) => f.includes("MCP servers unavailable"));
      expect(frame).not.toContain("No MCP servers");
      expect(frame).toContain("Status");
    } finally { setup.renderer.destroy(); }
  });
  test("session search plus Enter resumes the filtered row in one burst", async () => {
    const resumed: string[] = [];
    const setup = await testRender(<App client={fakeClient((id) => resumed.push(id))} onQuit={() => {}} />, { width: 100, height: 30 });
    try {
      await setup.waitForFrame((f) => f.includes("Ask anything"));
      await act(async () => { await setup.mockInput.pressKeys([..."/sessions", "\r"]); });
      await setup.waitForFrame((f) => f.includes("Checking sessions list"));
      await act(async () => { await setup.mockInput.pressKeys([..."Fixing", "\r"]); });
      expect(resumed).toEqual(["sess_fixture_two"]);
      await setup.waitForFrame((f) => f.includes("Ask anything") && !f.includes("Search"));
    } finally { setup.renderer.destroy(); }
  });
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

describe("submit route copies opencode v2 (no refusal path)", () => {
  test("exact command names route as commands; unknowns and paths are messages", async () => {
    const { submitRoute } = AppModule;
    expect(submitRoute("/sessions")).toBe("command");
    expect(submitRoute("/home/pi/.yggterm/clipboard/x.png I can see UX issues")).toBe("message");
    expect(submitRoute("/asdf")).toBe("message");
    expect(submitRoute("/two words")).toBe("message");
    expect(submitRoute("plain text")).toBe("message");
  });
});
