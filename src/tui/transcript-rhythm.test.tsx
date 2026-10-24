import { describe, expect, test } from "bun:test";
import { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppServer } from "../protocol/client";
import { App } from "./app";
import { createModelPreferenceRepository } from "./session/model-preference";

// Reference vertical rhythm (routes/session/index.tsx + message-parts.tsx,
// pinned v2ref): the SessionRowView wrapper carries the single marginTop 1
// between rows and the content boxes add none — BlockToolContent keeps only
// its border paddings, InlineToolRow only paddingLeft 3, and the assistant
// footer is its own row, so exactly one blank line separates it from the last
// content row.
async function transcript(width = 100) {
  const dir = mkdtempSync(join(tmpdir(), "zc-rhythm-"));
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
    <App client={client} preferences={preferences} resumeId="fixture-rhythm" onQuit={() => {}} />,
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

function blanksBetween(frame: string, from: string, to: string): { blanks: number; distance: number } {
  const lines = frame.split("\n");
  const start = lines.findIndex((l) => l.includes(from));
  if (start < 0) throw new Error(`frame lacks ${JSON.stringify(from)}:\n${frame}`);
  const end = lines.findIndex((l, i) => i > start && l.includes(to));
  if (end < 0) throw new Error(`frame lacks ${JSON.stringify(to)} below ${JSON.stringify(from)}:\n${frame}`);
  return {
    blanks: lines.slice(start + 1, end).filter((l) => l.trim() === "").length,
    distance: end - start,
  };
}

describe("production transcript vertical rhythm", () => {
  test("a block tool keeps exactly one blank row above and below the border box", async () => {
    const s = await transcript();
    try {
      await s.keys([..."run the fixture", "\r"]);
      await s.pushEvent({ type: "tool_call", toolName: "Bash", toolCallId: "call_rhythm", input: { command: "ls /tmp" } });
      await s.pushEvent({ content: "Fixture done.", stopReason: "end_turn" });
      const frame = await s.waitForFrame((f) => f.includes("ls /tmp") && f.includes("Fixture done."));
      const above = blanksBetween(frame, "run the fixture", "ls /tmp");
      expect(above).toEqual({ blanks: 1, distance: 4 });
      const below = blanksBetween(frame, "ls /tmp", "Fixture done.");
      expect(below).toEqual({ blanks: 1, distance: 3 });
    } finally { s.cleanup(); }
  });

  test("a pending inline tool row keeps exactly one blank row above it", async () => {
    const s = await transcript();
    try {
      await s.keys([..."run the fixture", "\r"]);
      await s.pushEvent({ type: "tool_call", toolName: "Write", toolCallId: "call_inline", input: { file_path: "/tmp/fixture.txt" } });
      const frame = await s.waitForFrame((f) => f.includes("Preparing write"));
      expect(blanksBetween(frame, "run the fixture", "Preparing write")).toEqual({ blanks: 1, distance: 3 });
    } finally { s.cleanup(); }
  });

  test("the completed-turn footer sits one blank row below the reply", async () => {
    const s = await transcript();
    try {
      await s.keys([..."run the fixture", "\r"]);
      await s.pushEvent({ content: "Fixture done.", stopReason: "end_turn" });
      const frame = await s.waitForFrame((f) => f.includes("Fixture done.") && f.includes("Build"));
      expect(blanksBetween(frame, "Fixture done.", "Build")).toEqual({ blanks: 1, distance: 2 });
    } finally { s.cleanup(); }
  });
});
