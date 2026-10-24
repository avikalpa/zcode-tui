// The paste queue (reference prompt/index.tsx enqueuePaste): pastes
// serialize on one chain, and changed() — captured at dequeue — drops a
// paste whose composer moved underneath it across the async resolution
// boundary. These tests drive the App with a gated pasteResolver so the
// race is deterministic instead of a filesystem-timing guess.
import { describe, expect, test } from "bun:test";
import { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppServer } from "../protocol/client";
import { App } from "./app";
import { createModelPreferenceRepository } from "./session/model-preference";
import type { ResolvedAttachment } from "./attachment";

type Resolver = (text: string) => Promise<ResolvedAttachment[] | undefined>;

function gatedResolver(result: ResolvedAttachment[] | undefined) {
  const pending: ((value: undefined) => void)[] = [];
  const resolver: Resolver = () =>
    new Promise<undefined>((resolve) => { pending.push(resolve); }).then(() => result);
  return { pending, resolver };
}

const image = (): ResolvedAttachment => ({
  type: "file",
  uri: "data:image/png;base64,QUJD",
  mime: "image/png",
  bytes: new Uint8Array([65, 66, 67]),
  filename: "shot.png",
});

async function pasteHarness(resolver: Resolver, pending: unknown[] = []) {
  const dir = mkdtempSync(join(tmpdir(), "zc-paste-queue-"));
  const preferences = createModelPreferenceRepository(join(dir, "state.json"));
  const sent: { content: string }[] = [];
  let push = (_event: Record<string, unknown>) => {};
  const client = {
    request: async (method: string, params: Record<string, unknown>) => {
      if (method === "session/list") return { sessions: [] };
      if (method === "session/resume") return { session: { status: "idle" }, messages: [] };
      if (method === "session/send") sent.push({ content: params.content as string });
      return {};
    },
    onPush: (fn: typeof push) => { push = fn; },
    onAsk: () => {}, onBackendLost: () => {},
  } as unknown as AppServer;
  const setup = await testRender(
    <App client={client} preferences={preferences} resumeId="fixture-paste-queue" pasteResolver={resolver} onQuit={() => {}} />,
    { width: 100, height: 30 },
  );
  await setup.waitForFrame((f) => f.includes("Ask anything") && f.includes("Build"));
  const keys = async (values: string[]) => {
    await act(async () => { await setup.mockInput.pressKeys(values); });
    await setup.renderOnce();
  };
  const waitPending = async (count: number) => {
    for (let i = 0; i < 200 && pending.length < count; i++) {
      await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    }
  };
  const send = async () => { await keys(["\r"]); return sent.at(-1)?.content; };
  return { ...setup, keys, sent, send, waitPending,
    cleanup: () => { setup.renderer.destroy(); rmSync(dir, { recursive: true, force: true }); },
  };
}

describe("production paste queue reference interaction", () => {
  test("typing while an attachment resolves drops the paste — typed keys keep their order", async () => {
    const gate = gatedResolver([image()]);
    const s = await pasteHarness(gate.resolver, gate.pending);
    try {
      await act(async () => { await s.mockInput.pasteBracketedText("/tmp/shot.png"); });
      await s.waitPending(1);
      await s.keys([..."typed"]);
      await act(async () => { gate.pending[0]?.(undefined); await new Promise((r) => setTimeout(r, 20)); });
      await s.renderOnce();
      expect(await s.send()).toBe("typed");
    } finally { s.cleanup(); }
  });

  test("pastes serialize on the queue — a second paste does not resolve before the first lands", async () => {
    const gate = gatedResolver(undefined);
    const s = await pasteHarness(gate.resolver, gate.pending);
    try {
      await act(async () => { await s.mockInput.pasteBracketedText("alpha"); });
      await s.waitPending(1);
      await act(async () => { await s.mockInput.pasteBracketedText("bravo"); });
      await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
      expect(gate.pending.length).toBe(1);
      await act(async () => { gate.pending[0]?.(undefined); await s.waitPending(2); });
      await act(async () => { gate.pending[1]?.(undefined); await new Promise((r) => setTimeout(r, 20)); });
      await s.renderOnce();
      expect(await s.send()).toBe("alphabravo");
    } finally { s.cleanup(); }
  });

  test("a paste that resolves with no edits still lands as its attachment part", async () => {
    let calls = 0;
    const s = await pasteHarness(async () => { calls += 1; return [image()]; });
    try {
      await act(async () => { await s.mockInput.pasteBracketedText("/tmp/shot.png"); });
      await s.waitForFrame((f) => f.includes("[Image 1]"));
      expect(calls).toBe(1);
    } finally { s.cleanup(); }
  });
});
