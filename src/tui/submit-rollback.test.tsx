// Submit failure rollback (reference prompt/index.tsx fail/restoreEntry):
// a failed upload or send rolls the optimistic transcript rows back, gives
// the composer its entry back unless the user has typed something new, and
// reports the error as a toast. These tests drive the real App with real fs
// attachment resolution; the upload family is stubbed at the client boundary.
import { describe, expect, test } from "bun:test";
import { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppServer } from "../protocol/client";
import { App } from "./app";
import { createModelPreferenceRepository } from "./session/model-preference";

const MARKER = "rollback hello";
const LABEL = "[Image 1]";

type Gate = (error: Error) => void;

function harness(opts?: { sendError?: Error; gateUploads?: boolean }) {
  const dir = mkdtempSync(join(tmpdir(), "zc-submit-rollback-"));
  const shot = join(dir, "shot.png");
  writeFileSync(shot, new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
  const preferences = createModelPreferenceRepository(join(dir, "model-pref.json"));
  const sent: { content?: string }[] = [];
  const uploadGates: Gate[] = [];
  let push = (_event: Record<string, unknown>) => {};
  const client = {
    request: async (method: string, params: Record<string, unknown>) => {
      if (method === "session/list") return { sessions: [] };
      if (method === "session/resume") return { session: { status: "idle" }, messages: [] };
      if (method === "session/send") {
        sent.push({ content: params.content as string });
        if (opts?.sendError) throw opts.sendError;
        return {};
      }
      if (method === "v4/attachment/begin") {
        if (opts?.gateUploads) {
          return new Promise((_resolve, reject) => {
            uploadGates.push((error) => reject(error));
          });
        }
        return {};
      }
      if (method === "v4/attachment/commit") return { ref: "zcode-artifact://fixture" };
      return {};
    },
    onPush: (fn: typeof push) => { push = fn; },
    onAsk: () => {}, onBackendLost: () => {},
  } as unknown as AppServer;
  const mount = () => testRender(
    <App client={client} preferences={preferences} resumeId="fixture-submit-rollback" onQuit={() => {}} />,
    { width: 100, height: 30 },
  );
  const settle = async (setup: Awaited<ReturnType<typeof testRender>>, ms = 30) => {
    await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
    await setup.renderOnce();
  };
  return { dir, shot, mount, sent, uploadGates, settle };
}

async function composeShot(s: Awaited<ReturnType<ReturnType<typeof harness>["mount"]>>, shot: string) {
  await act(async () => { await s.mockInput.pressKeys([...`${MARKER} `]); });
  await act(async () => { await s.mockInput.pasteBracketedText(shot); });
  await s.waitForFrame((f) => f.includes(LABEL));
}

describe("production submit-failure rollback interaction", () => {
  test("a failed upload rolls the turn rows back and restores the composer entry", async () => {
    const h = harness({ gateUploads: true });
    const s = await h.mount();
    try {
      await s.waitForFrame((f) => f.includes("Ask anything") && f.includes("Build"));
      await composeShot(s, h.shot);
      await act(async () => { await s.mockInput.pressKeys(["\r"]); });
      await h.settle(s);
      expect(h.sent).toHaveLength(0);
      await act(async () => { h.uploadGates[0]?.(new Error("upload refused")); });
      await h.settle(s);
      const frame = await s.waitForFrame((f) => f.includes(MARKER));
      // The echo row is gone: only the restored composer names the marker,
      // and the attachment's file name rode nowhere else.
      expect(frame.includes("shot.png")).toBe(false);
      expect(frame.includes("attachment upload failed")).toBe(true);
    } finally {
      s.renderer.destroy();
      rmSync(h.dir, { recursive: true, force: true });
    }
  });

  test("a rejected session/send rolls the turn rows back and restores the composer entry", async () => {
    const h = harness({ sendError: new Error("host refused") });
    const s = await h.mount();
    try {
      await s.waitForFrame((f) => f.includes("Ask anything") && f.includes("Build"));
      await composeShot(s, h.shot);
      await act(async () => { await s.mockInput.pressKeys(["\r"]); });
      await h.settle(s, 60);
      expect(h.sent).toHaveLength(1);
      await h.settle(s);
      const frame = await s.waitForFrame((f) => f.includes(MARKER));
      expect(frame.includes("shot.png")).toBe(false);
    } finally {
      s.renderer.destroy();
      rmSync(h.dir, { recursive: true, force: true });
    }
  });

  test("text typed while the upload was pending is never overwritten by the restore", async () => {
    const h = harness({ gateUploads: true });
    const s = await h.mount();
    try {
      await s.waitForFrame((f) => f.includes("Ask anything") && f.includes("Build"));
      await composeShot(s, h.shot);
      await act(async () => { await s.mockInput.pressKeys(["\r"]); });
      await h.settle(s);
      expect(h.sent).toHaveLength(0);
      await act(async () => { await s.mockInput.pressKeys([..."keepme"]); });
      await h.settle(s);
      await act(async () => { h.uploadGates[0]?.(new Error("upload refused")); });
      await h.settle(s);
      const frame = await s.waitForFrame((f) => f.includes("keepme"));
      expect(frame.includes(MARKER)).toBe(false);
      expect(frame.includes("shot.png")).toBe(false);
    } finally {
      s.renderer.destroy();
      rmSync(h.dir, { recursive: true, force: true });
    }
  });
});
