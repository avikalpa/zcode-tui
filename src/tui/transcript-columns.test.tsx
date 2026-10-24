import { describe, expect, test } from "bun:test";
import { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppServer } from "../protocol/client";
import { App } from "./app";
import { createModelPreferenceRepository } from "./session/model-preference";

// Reference geometry (routes/session/index.tsx + message-parts.tsx, pinned
// v2ref): the session column pads 2 horizontally (1 below 44 columns), every
// block then speaks from column 5 — the user rule sits at column 2 and its
// text starts 1(border)+2(padding) later, exactly where assistant markdown
// (paddingLeft 3) and inline tool rows (paddingLeft 3) begin.
async function transcript(width = 100) {
  const dir = mkdtempSync(join(tmpdir(), "zc-transcript-"));
  const preferences = createModelPreferenceRepository(join(dir, "state.json"));
  let push = (_event: Record<string, unknown>) => {};
  const client = {
    request: async (method: string, params: Record<string, unknown>) => {
      if (method === "session/list") return { sessions: [] };
      if (method === "session/resume") return { session: { status: "idle" }, messages: [] };
      return {};
    },
    onPush: (fn: typeof push) => { push = fn; },
    onAsk: () => {}, onBackendLost: () => {},
  } as unknown as AppServer;
  const setup = await testRender(
    <App client={client} preferences={preferences} resumeId="fixture-transcript" onQuit={() => {}} />,
    { width, height: 30 },
  );
  await setup.waitForFrame((f) => f.includes("Ask anything"));
  const keys = async (values: string[]) => {
    await act(async () => { await setup.mockInput.pressKeys(values); });
    await setup.renderOnce();
  };
  const pushEvent = async (payload: Record<string, unknown>) => {
    await act(async () => { push({ method: "session/event", params: { payload } }); });
    await setup.renderOnce();
  };
  return { ...setup, keys, pushEvent,
    cleanup: () => { setup.renderer.destroy(); rmSync(dir, { recursive: true, force: true }); },
  };
}

function lineOf(frame: string, needle: string): string {
  const line = frame.split("\n").find((l) => l.includes(needle));
  if (line === undefined) throw new Error(`frame lacks ${JSON.stringify(needle)}:\n${frame}`);
  return line;
}

describe("production transcript reference columns", () => {
  test("user turn draws the reference left rule and assistant text shares its column", async () => {
    const s = await transcript();
    try {
      await s.keys([..."fixture user prompt", "\r"]);
      await s.pushEvent({ content: "Fixture reply text.", stopReason: "end_turn" });
      const frame = await setup_frame(s);
      const userLine = lineOf(frame, "fixture user prompt");
      expect(userLine.indexOf("┃")).toBe(2);
      expect(userLine.indexOf("fixture user prompt")).toBe(5);
      const replyLine = lineOf(frame, "Fixture reply");
      expect(replyLine.indexOf("Fixture reply")).toBe(5);
    } finally { s.cleanup(); }
  });

  test("live tool rows speak from the same column as the assistant body", async () => {
    const s = await transcript();
    try {
      await s.keys([..."run the fixture", "\r"]);
      await s.pushEvent({ type: "tool_call", toolName: "Bash", toolCallId: "call_fixture", input: { command: "ls /tmp" } });
      await s.pushEvent({ content: "Fixture done.", stopReason: "end_turn" });
      const frame = await setup_frame(s);
      const toolLine = lineOf(frame, "ls /tmp");
      expect(toolLine.indexOf("ls /tmp")).toBe(5);
      const replyLine = lineOf(frame, "Fixture done.");
      expect(replyLine.indexOf("Fixture done.")).toBe(5);
    } finally { s.cleanup(); }
  });
});

async function setup_frame(s: Awaited<ReturnType<typeof transcript>>): Promise<string> {
  return s.waitForFrame((f) => f.includes("fixture user prompt") || f.includes("run the fixture"));
}
