import { describe, expect, test } from "bun:test";
import { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppServer } from "../protocol/client";
import { App } from "./app";
import { createModelPreferenceRepository } from "./session/model-preference";

// Composer chrome laws (component/prompt/index.tsx, pinned v2ref): the
// session-route <Prompt> takes NO placeholders prop (only home carries the
// quoted list), the left edge is the SplitBorder `┃` with the strip below
// opening on its `╹` corner before the ▀ rule, and the footer hint strip is
// one space-between row with gap 2 — two cells between the hint texts.

async function session() {
  const dir = mkdtempSync(join(tmpdir(), "zc-chrome-"));
  const preferences = createModelPreferenceRepository(join(dir, "state.json"));
  let push = (_event: Record<string, unknown>) => {};
  const client = {
    request: async (method: string) => {
      if (method === "session/list") return { sessions: [] };
      if (method === "session/resume") return { session: { status: "idle" }, messages: [] };
      return {};
    },
    onPush: (fn: typeof push) => { push = fn; },
    onAsk: () => {}, onBackendLost: () => {},
  } as unknown as AppServer;
  const setup = await testRender(
    <App client={client} preferences={preferences} resumeId="fixture-chrome" onQuit={() => {}} />,
    { width: 100, height: 30 },
  );
  await setup.waitForFrame((f) => f.includes("Build ·"));
  return { ...setup, cleanup: () => { setup.renderer.destroy(); rmSync(dir, { recursive: true, force: true }); } };
}

describe("composer chrome reference laws", () => {
  test("a session composer renders no placeholder", async () => {
    const s = await session();
    try {
      const frame = s.captureCharFrame();
      expect(frame).not.toContain("Ask anything");
    } finally { s.cleanup(); }
  });

  test("the composer edge is the ┃ wall and the strip opens on ╹ before the ▀ rule", async () => {
    const s = await session();
    try {
      const frame = s.captureCharFrame();
      expect(frame).not.toContain("▌");
      const lines = frame.split("\n");
      // Wall rows are bare ┃ at the session pad column (index 2).
      expect(lines.some((l) => l.startsWith("  ┃") && !l.slice(3).trim())).toBe(true);
      // The strip row: ╹ at the wall column, ▀ continuing to the right
      // edge, directly under the last wall row.
      const strip = lines.findIndex((l) => l.startsWith("  ╹▀"));
      expect(strip).toBeGreaterThan(-1);
      expect(lines[strip - 1].startsWith("  ┃")).toBe(true);
    } finally { s.cleanup(); }
  });

  test("footer hints separate with exactly two cells", async () => {
    const s = await session();
    try {
      const frame = s.captureCharFrame();
      expect(frame).toContain("shift+tab agents  ctrl+p commands");
      expect(frame).not.toContain("shift+tab agents   ctrl+p commands");
    } finally { s.cleanup(); }
  });

  test("the home composer still carries the quoted placeholder list with one space", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zc-chrome-home-"));
    const preferences = createModelPreferenceRepository(join(dir, "state.json"));
    let push = (_event: Record<string, unknown>) => {};
    const client = {
      request: async () => ({}),
      onPush: (fn: typeof push) => { push = fn; },
      onAsk: () => {}, onBackendLost: () => {},
    } as unknown as AppServer;
    const setup = await testRender(<App client={client} preferences={preferences} onQuit={() => {}} />, { width: 100, height: 30 });
    try {
      const frame = await setup.waitForFrame((f) => f.includes("Ask anything"));
      expect(frame).toMatch(/Ask anything… "(?:What is the tech stack|How do I run|Find where auth|Explain this repo|Fix the failing)/);
      expect(frame).not.toContain("Ask anything…  \"");
    } finally {
      setup.renderer.destroy();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20000);
});
