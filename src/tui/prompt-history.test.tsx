// Attachment-rich prompt history (reference prompt/history.tsx): a
// submission with parts records its folded composer form, so Up recall
// restores the folds and the attachment tray — the resubmit re-expands and
// re-uploads — and the rich entries persist across a restart through the
// sidecar jsonl. These tests drive the real App with real fs attachment
// resolution; the upload family is stubbed at the client boundary.
import { describe, expect, test } from "bun:test";
import { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppServer } from "../protocol/client";
import { App } from "./app";
import { createModelPreferenceRepository } from "./session/model-preference";
import { resetPromptHistoryForTests } from "./session/prompt-history";

const FOLDED = "line one\nline two\nline three";
const LABEL = "[Pasted ~3 lines]";

function harness(stateDir: string, extra?: { sessions?: unknown[] }) {
  const preferences = createModelPreferenceRepository(join(stateDir, "model-pref.json"));
  const sent: { content?: string; attachments?: { fileName: string; mime: string; bytes: number }[] }[] = [];
  const uploads: { method: string; totalBytes?: number; mime?: string }[] = [];
  let push = (_event: Record<string, unknown>) => {};
  const client = {
    request: async (method: string, params: Record<string, unknown>) => {
      if (method === "session/list") return { sessions: extra?.sessions ?? [] };
      if (method === "session/resume") return { session: { status: "idle" }, messages: [] };
      if (method === "session/send") {
        sent.push({ content: params.content as string, attachments: params.attachments as never });
        return {};
      }
      if (method === "v4/attachment/begin") uploads.push({ method, totalBytes: params.totalBytes as number, mime: params.mime as string });
      if (method === "v4/attachment/chunk") uploads.push({ method });
      if (method === "v4/attachment/commit") {
        uploads.push({ method });
        return { ref: "zcode-artifact://fixture" };
      }
      return {};
    },
    onPush: (fn: typeof push) => { push = fn; },
    onAsk: () => {}, onBackendLost: () => {},
  } as unknown as AppServer;
  return { client, sent, uploads, mount: () => testRender(
    <App client={client} preferences={preferences} resumeId="fixture-prompt-history" onQuit={() => {}} />,
    { width: 100, height: 30 },
  ), endTurn: async (setup: Awaited<ReturnType<typeof testRender>>) => {
    await act(async () => { push({ method: "state.updated", params: { patch: { status: "idle" } } }); await new Promise((r) => setTimeout(r, 10)); });
    await setup.renderOnce();
  } };
}

describe("production prompt-history reference interaction", () => {
  test("a folded paste recalls folded and resubmits the full expansion", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zc-prompt-history-"));
    process.env.ZCODE_TUI_STATE_DIR = dir;
    resetPromptHistoryForTests();
    const h = harness(dir);
    const s = await h.mount();
    try {
      await s.waitForFrame((f) => f.includes("Ask anything") && f.includes("Build"));
      await act(async () => { await s.mockInput.pasteBracketedText(FOLDED); });
      await s.waitForFrame((f) => f.includes(LABEL));
      await act(async () => { await s.mockInput.pressKeys(["\r"]); });
      await s.renderOnce();
      expect(h.sent.at(-1)?.content).toBe(FOLDED);
      await h.endTurn(s);
      await act(async () => { await s.mockInput.pressKeys(["\x1b[A"]); });
      // The recall is the folded label in the composer's draft row — the
      // transcript above carries the old turn's flat echo; the draft must
      // not.
      const recalled = await s.waitForFrame((f) => f.includes(LABEL));
      const draftRow = recalled.split("\n").find((line) => line.includes(LABEL));
      expect(draftRow).toBeDefined();
      expect(draftRow).not.toContain("line two");
      await act(async () => { await s.mockInput.pressKeys(["\r"]); });
      await s.renderOnce();
      expect(h.sent.at(-1)?.content).toBe(FOLDED);
    } finally {
      s.renderer.destroy();
      delete process.env.ZCODE_TUI_STATE_DIR;
      resetPromptHistoryForTests();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("an attachment submission recalls its tray part and re-uploads the same bytes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zc-prompt-history-"));
    process.env.ZCODE_TUI_STATE_DIR = dir;
    resetPromptHistoryForTests();
    const shot = join(dir, "shot.png");
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    writeFileSync(shot, bytes);
    const h = harness(dir);
    const s = await h.mount();
    try {
      await s.waitForFrame((f) => f.includes("Ask anything") && f.includes("Build"));
      await act(async () => { await s.mockInput.pasteBracketedText(shot); });
      await s.waitForFrame((f) => f.includes("[Image 1]"));
      await act(async () => { await s.mockInput.pressKeys(["\r"]); });
      await s.renderOnce();
      expect(h.sent.at(-1)?.attachments?.[0]?.fileName).toBe("shot.png");
      const firstBegin = h.uploads.find((u) => u.method === "v4/attachment/begin");
      expect(firstBegin?.totalBytes).toBe(bytes.byteLength);
      await h.endTurn(s);
      await act(async () => { await s.mockInput.pressKeys(["\x1b[A"]); });
      await s.waitForFrame((f) => f.includes("[Image 1]"));
      await act(async () => { await s.mockInput.pressKeys(["\r"]); });
      await s.renderOnce();
      const begins = h.uploads.filter((u) => u.method === "v4/attachment/begin");
      expect(begins).toHaveLength(2);
      expect(begins[1]?.totalBytes).toBe(bytes.byteLength);
      expect(begins[1]?.mime).toBe("image/png");
      expect(h.sent.at(-1)?.attachments?.[0]?.fileName).toBe("shot.png");
    } finally {
      s.renderer.destroy();
      delete process.env.ZCODE_TUI_STATE_DIR;
      resetPromptHistoryForTests();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("rich entries persist across a restart — the sidecar recalls folded", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zc-prompt-history-"));
    process.env.ZCODE_TUI_STATE_DIR = dir;
    resetPromptHistoryForTests();
    const h1 = harness(dir);
    const s1 = await h1.mount();
    try {
      await s1.waitForFrame((f) => f.includes("Ask anything") && f.includes("Build"));
      await act(async () => { await s1.mockInput.pasteBracketedText(FOLDED); });
      await s1.waitForFrame((f) => f.includes(LABEL));
      await act(async () => { await s1.mockInput.pressKeys(["\r"]); });
      await s1.renderOnce();
      expect(h1.sent.at(-1)?.content).toBe(FOLDED);
      await h1.endTurn(s1);
    } finally {
      s1.renderer.destroy();
      resetPromptHistoryForTests();
    }
    // A fresh mount over the same state dir recalls the recorded fold.
    const h2 = harness(dir);
    const s2 = await h2.mount();
    try {
      await s2.waitForFrame((f) => f.includes("Ask anything") && f.includes("Build"));
      await act(async () => { await s2.mockInput.pressKeys(["\x1b[A"]); });
      await s2.waitForFrame((f) => f.includes(LABEL));
      await act(async () => { await s2.mockInput.pressKeys(["\r"]); });
      await s2.renderOnce();
      expect(h2.sent.at(-1)?.content).toBe(FOLDED);
    } finally {
      s2.renderer.destroy();
      delete process.env.ZCODE_TUI_STATE_DIR;
      resetPromptHistoryForTests();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
