// Queued-prompt expansion (reference submitInner queue delivery): the
// reference expands tracked paste folds BEFORE the delivery split, so a
// prompt queued mid-turn sends the full text and records its folded
// composer form in history. Our pump used to send the folded label
// literally — the host never saw the pasted content.
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

const FOLDED = "line one\nline two\nline three";
const LABEL = "[Pasted ~3 lines]";

describe("production queued-prompt expansion interaction", () => {
  test("a prompt queued mid-turn sends the paste expansion and recalls folded", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zc-queue-expansion-"));
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
      <App client={client} preferences={preferences} resumeId="fixture-queue-expansion" onQuit={() => {}} />,
      { width: 100, height: 30 },
    );
    const endTurn = async () => {
      await act(async () => { push({ method: "state.updated", params: { patch: { status: "idle" } } }); await new Promise((r) => setTimeout(r, 10)); });
      await setup.renderOnce();
    };
    try {
      await setup.waitForFrame((f) => f.includes("Ask anything") && f.includes("Build"));
      await act(async () => { await setup.mockInput.pressKeys([..."first", "\r"]); });
      await setup.renderOnce();
      expect(sent.at(-1)?.content).toBe("first");
      await act(async () => { await setup.mockInput.pasteBracketedText(FOLDED); });
      await setup.waitForFrame((f) => f.includes(LABEL));
      await act(async () => { await setup.mockInput.pressKeys([..."queued note "]); });
      await act(async () => { await setup.mockInput.pressKeys(["\r"]); });
      await setup.renderOnce();
      // The queued row is visible, the composer is clear, and the live turn
      // is still running — the pump must hold until idle.
      expect(sent).toHaveLength(1);
      await endTurn();
      await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
      await setup.renderOnce();
      expect(sent).toHaveLength(2);
      // The host sees the expansion — the fold label never reaches it.
      expect(sent[1]?.content).toBe(`${FOLDED} queued note`);
      expect(sent[1]?.content).not.toContain(LABEL);
      await endTurn();
      await act(async () => { await setup.mockInput.pressKeys(["\x1b[A"]); });
      // History records the folded composer form: Up restores the label,
      // not a flat expansion. The draft row is the only line carrying the
      // label — the transcript above shows the queued turn's flat echo.
      const recalled = await setup.waitForFrame((f) => f.includes(LABEL));
      const draftRow = recalled.split("\n").find((line) => line.includes(LABEL));
      expect(draftRow).toContain("queued note");
      expect(draftRow).not.toContain("line two");
    } finally {
      setup.renderer.destroy();
      delete process.env.ZCODE_TUI_STATE_DIR;
      resetPromptHistoryForTests();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
