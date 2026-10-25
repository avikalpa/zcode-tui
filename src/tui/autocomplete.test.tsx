// Composer autocomplete popup interaction laws (reference Autocomplete +
// keybind layer, b084acc55e): the empty-state popup owns return/tab/arrows
// even at zero matches, mid-text slashes are not triggers, and the row
// window reveals at the edges instead of recentering. Real keystrokes; char
// frames do not establish live pixels.
import { describe, expect, test } from "bun:test";
import { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppServer } from "../protocol/client";
import { App } from "./app";
import { createModelPreferenceRepository } from "./session/model-preference";
import { resetPromptHistoryForTests } from "./session/prompt-history";

describe("popup interaction (reference keybind-layer laws)", () => {
  const harness = async () => {
    const dir = mkdtempSync(join(tmpdir(), "zc-autocomplete-"));
    process.env.ZCODE_TUI_STATE_DIR = dir;
    resetPromptHistoryForTests();
    const preferences = createModelPreferenceRepository(join(dir, "model-pref.json"));
    const sent: { content?: string }[] = [];
    let push = (_event: Record<string, unknown>) => {};
    const client = {
      request: async (method: string, params: Record<string, unknown>) => {
        if (method === "session/list") return { sessions: [] };
        if (method === "session/resume") return { session: { status: "idle" }, messages: [] };
        if (method === "session/send") {
          sent.push({ content: params.content as string });
          return {};
        }
        return {};
      },
      onPush: (fn: typeof push) => { push = fn; },
      onAsk: () => {}, onBackendLost: () => {},
    } as unknown as AppServer;
    const setup = await testRender(
      <App client={client} preferences={preferences} resumeId="fixture-autocomplete" onQuit={() => {}} />,
      { width: 100, height: 30 },
    );
    return {
      setup,
      sent,
      cleanup: () => {
        setup.renderer.destroy();
        delete process.env.ZCODE_TUI_STATE_DIR;
        resetPromptHistoryForTests();
        rmSync(dir, { recursive: true, force: true });
      },
    };
  };

  test("unmatched slash token shows the empty message and swallows return until escape", async () => {
    const { setup, sent, cleanup } = await harness();
    try {
      await setup.waitForFrame((f) => f.includes("Ask anything") && f.includes("Build"));
      await act(async () => { await setup.mockInput.pressKeys([..." /nosuch".trim().split("")]); });
      // The burst coalescer flushes on a real 8ms timer; give it wall clock.
      await act(async () => { await new Promise((r) => setTimeout(r, 15)); });
      await setup.waitForFrame((f) => f.includes("No matching commands"), { maxPasses: 40 });
      await act(async () => { await setup.mockInput.pressKeys(["\r"]); });
      await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
      await setup.renderOnce();
      // The popup layer owns return at zero matches — the prompt is not sent
      // and the draft survives.
      expect(sent).toHaveLength(0);
      expect(setup.captureCharFrame()).toContain("/nosuch");
      // Escape drops the layer; the next return submits the raw draft. The
      // gap lets the key parser expire its Alt-prefix window so "\x1b" is a
      // lone escape, not Alt+Return.
      await act(async () => { await setup.mockInput.pressKeys(["\x1b"]); await new Promise((r) => setTimeout(r, 20)); });
      await act(async () => { await setup.mockInput.pressKeys(["\r"]); });
      await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
      await setup.renderOnce();
      expect(sent).toHaveLength(1);
      expect(sent[0]?.content).toBe("/nosuch");
    } finally {
      cleanup();
    }
  });

  test("mid-text slash never opens the popup; the draft submits as a prompt", async () => {
    const { setup, sent, cleanup } = await harness();
    try {
      await setup.waitForFrame((f) => f.includes("Ask anything") && f.includes("Build"));
      await act(async () => { await setup.mockInput.pressKeys([..."run bin/ses"]); });
      await setup.waitForFrame((f) => f.includes("run bin/ses"));
      // "ses" after a non-whitespace "/" is not a trigger — no command rows.
      expect(setup.captureCharFrame()).not.toContain("browse and resume conversations");
      await act(async () => { await setup.mockInput.pressKeys(["\r"]); });
      await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
      await setup.renderOnce();
      expect(sent).toHaveLength(1);
      expect(sent[0]?.content).toBe("run bin/ses");
    } finally {
      cleanup();
    }
  });

  test("the row window reveals at the edges and wraps, never recenters", async () => {
    const { setup, cleanup } = await harness();
    try {
      await setup.waitForFrame((f) => f.includes("Ask anything") && f.includes("Build"));
      await act(async () => { await setup.mockInput.pressKeys(["/"]); });
      await act(async () => { await new Promise((r) => setTimeout(r, 15)); });
      await setup.waitForFrame((f) => f.includes("┃ /agents"), { maxPasses: 40 });
      // Six downs land on item 6 with the window still at the top — the
      // reference scrolls only when the selection reaches the window edge.
      await act(async () => {
        await setup.mockInput.pressKeys(["\x1b[B", "\x1b[B", "\x1b[B", "\x1b[B", "\x1b[B", "\x1b[B"]);
      });
      await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
      await setup.renderOnce();
      expect(setup.captureCharFrame()).toContain("┃ /agents");
      // Seven ups from item 6 wrap past the top to the last row and the
      // window jumps with it.
      await act(async () => {
        await setup.mockInput.pressKeys(["\x1b[A", "\x1b[A", "\x1b[A", "\x1b[A", "\x1b[A", "\x1b[A", "\x1b[A"]);
      });
      await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
      await setup.renderOnce();
      const frame = setup.captureCharFrame();
      expect(frame).toContain("/quit");
      expect(frame).not.toContain("┃ /agents");
    } finally {
      cleanup();
    }
  });
});
