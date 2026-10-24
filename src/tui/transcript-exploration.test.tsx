import { describe, expect, test } from "bun:test";
import { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppServer } from "../protocol/client";
import { App } from "./app";
import { createModelPreferenceRepository } from "./session/model-preference";

// Reference exploration grouping (pinned v2ref): consecutive read/glob/grep
// tool parts collapse into ONE InlineToolRow — `→ Explored — 2 reads, 1
// search` when settled, spinner + `Exploring — …` (text.default) while any
// part runs — and ctrl+o (this binding's keyboard substitute for the
// reference click-to-expand) shows the individual rows beneath the header.

async function transcript(width = 100) {
  const dir = mkdtempSync(join(tmpdir(), "zc-expl-"));
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
    <App client={client} preferences={preferences} resumeId="fixture-expl" onQuit={() => {}} />,
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
  const call = (toolName: string, id: string, input: Record<string, unknown>) =>
    pushEvent({ type: "tool_call", toolName, toolCallId: id, input });
  const result = (id: string) => pushEvent({ type: "result", toolCallId: id, result: { content: "ok" } });
  return { ...setup, keys, call, result, pushEvent, cleanup: () => { setup.renderer.destroy(); rmSync(dir, { recursive: true, force: true }); } };
}

describe("production transcript exploration grouping", () => {
  test("a settled run collapses into one Explored row and hides individual rows", async () => {
    const s = await transcript();
    try {
      await s.keys([..."run the fixture", "\r"]);
      await s.call("Read", "c1", { file_path: "/tmp/fixture-a.ts" });
      await s.call("Read", "c2", { file_path: "/tmp/fixture-b.ts" });
      await s.call("Grep", "c3", { pattern: "fixture" });
      await s.result("c1"); await s.result("c2"); await s.result("c3");
      const frame = await s.waitForFrame((f) => f.includes("Explored — 2 reads, 1 search"));
      expect(frame).not.toContain("Read /tmp/fixture-a.ts");
      expect(frame).not.toContain("Searching content");
    } finally { s.cleanup(); }
  });

  test("a running run shows the Exploring label instead of per-tool pending lines", async () => {
    const s = await transcript();
    try {
      await s.keys([..."run the fixture", "\r"]);
      await s.call("Read", "c1", { file_path: "/tmp/fixture-a.ts" });
      await s.call("Read", "c2", { file_path: "/tmp/fixture-b.ts" });
      const frame = await s.waitForFrame((f) => f.includes("Exploring — 2 reads"));
      expect(frame).not.toContain("Reading file");
      expect(frame).toContain("▪ Exploring — 2 reads");
    } finally { s.cleanup(); }
  });

  test("ctrl+o expands the group back into its individual rows under the header", async () => {
    const s = await transcript();
    try {
      await s.keys([..."run the fixture", "\r"]);
      await s.call("Read", "c1", { file_path: "/tmp/fixture-a.ts" });
      await s.call("Grep", "c2", { pattern: "fixture" });
      await s.result("c1"); await s.result("c2");
      await s.waitForFrame((f) => f.includes("Explored — 1 read, 1 search"));
      await s.keys(["\x0f"]);
      const frame = await s.waitForFrame((f) => f.includes("Read /tmp/fixture-a.ts"));
      expect(frame).toContain("Explored — 1 read, 1 search");
      expect(frame).toContain("Read /tmp/fixture-a.ts");
    } finally { s.cleanup(); }
  });

  test("a reply between runs splits the exploration into two groups", async () => {
    const s = await transcript();
    try {
      await s.keys([..."run the fixture", "\r"]);
      await s.call("Read", "c1", { file_path: "/tmp/fixture-a.ts" });
      await s.result("c1");
      await s.pushEvent({ content: "First looks fine.", stopReason: "end_turn" });
      await s.call("Grep", "c2", { pattern: "fixture" });
      await s.result("c2");
      const frame = await s.waitForFrame(
        (f) => f.includes("Explored — 1 read") && f.includes("Explored — 1 search") && f.includes("First looks fine."),
      );
      const lines = frame.split("\n");
      const readRow = lines.findIndex((l) => l.includes("Explored — 1 read"));
      const textRow = lines.findIndex((l) => l.includes("First looks fine."));
      const searchRow = lines.findIndex((l) => l.includes("Explored — 1 search"));
      expect(readRow).toBeLessThan(textRow);
      expect(textRow).toBeLessThan(searchRow);
    } finally { s.cleanup(); }
  });

  test("non-exploration tools never group", async () => {
    const s = await transcript();
    try {
      await s.keys([..."run the fixture", "\r"]);
      await s.call("Write", "c1", { file_path: "/tmp/fixture-a.ts" });
      await s.call("Write", "c2", { file_path: "/tmp/fixture-b.ts" });
      const frame = await s.waitForFrame((f) => (f.match(/Preparing write/g) ?? []).length === 2);
      expect(frame).not.toContain("Exploring");
    } finally { s.cleanup(); }
  });

  test("a live turn after a settled group still streams (isTail reaches past a group)", async () => {
    const s = await transcript();
    try {
      await s.keys([..."run the fixture", "\r"]);
      await s.call("Read", "c1", { file_path: "/tmp/fixture-a.ts" });
      await s.call("Read", "c2", { file_path: "/tmp/fixture-b.ts" });
      await s.result("c1"); await s.result("c2");
      await s.pushEvent({ type: "reasoning_delta", delta: "checking the fixtures now" });
      // The collapsed thinking label is the streaming tell: live is
      // `▪ Thinking`, done is `+ Thought`. isTail must survive the group.
      const frame = await s.waitForFrame((f) => f.includes("Thinking") || f.includes("Thought"));
      expect(frame).toContain("▪ Thinking");
      expect(frame).not.toContain("+ Thought");
    } finally { s.cleanup(); }
  });
});
