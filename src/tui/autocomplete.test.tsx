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
  const harness = async (dims = { width: 100, height: 30 }) => {
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
      dims,
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
      await setup.waitForFrame((f) => f.includes("Build ·"));
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
      await setup.waitForFrame((f) => f.includes("Build ·"));
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
      await setup.waitForFrame((f) => f.includes("Build ·"));
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

  // The reference caps the popup at the anchor's absolute y when open —
  // height = min(10, count, max(1, anchor.y)) — autocomplete.tsx 849-854 —
  // and the reveal window rides the clamped height (moveTo/syncSelectionWindow
  // limit: Math.min(height(), options().length)). At 100x14 the home prompt
  // container top sits at row 8 (spacers collapse: 3 gap + 4 logo + 1 gap),
  // so an uncapped popup would push its top two rows off screen.
  test("the popup caps at the space above its anchor; the window follows the cap", async () => {
    const { setup, cleanup } = await harness({ width: 100, height: 14 });
    try {
      await setup.waitForFrame((f) => f.includes("Build ·"));
      await act(async () => { await setup.mockInput.pressKeys(["/"]); });
      // The clamp is measured after the renderer lays the anchor out — the
      // sample lands on the first render outside the act scope (the reference
      // reads the same value through its 50ms position poll), so settle
      // outside act and then force the frame.
      await new Promise((r) => setTimeout(r, 120));
      await setup.renderOnce();
      const popupRows = (f: string) => f.split("\n").filter((l) => (l.match(/┃/g) ?? []).length >= 2);
      const open = popupRows(setup.captureCharFrame());
      // Exactly the anchor's 8 rows — item 0 visible, nothing clipped.
      expect(open.length).toBe(8);
      expect(open[0]).toContain("┃ /agents");
      expect(setup.captureCharFrame()).not.toContain("┃ /timeline");
      // Nine downs pass the cap; eight ups come back above the window top —
      // the window pulls down with the selection so row 1 is on screen.
      await act(async () => {
        await setup.mockInput.pressKeys([
          "\x1b[B", "\x1b[B", "\x1b[B", "\x1b[B", "\x1b[B", "\x1b[B", "\x1b[B", "\x1b[B", "\x1b[B",
        ]);
      });
      await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
      await act(async () => {
        await setup.mockInput.pressKeys([
          "\x1b[A", "\x1b[A", "\x1b[A", "\x1b[A", "\x1b[A", "\x1b[A", "\x1b[A", "\x1b[A",
        ]);
      });
      await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
      await setup.renderOnce();
      const after = popupRows(setup.captureCharFrame());
      expect(after.length).toBe(8);
      expect(after[0]).toContain("┃ /sessions");
      expect(setup.captureCharFrame()).not.toContain("┃ /timeline");
    } finally {
      cleanup();
    }
  });
});
