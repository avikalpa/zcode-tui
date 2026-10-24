import { describe, expect, test } from "bun:test";
import { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppServer } from "../protocol/client";
import { App } from "./app";
import { createModelPreferenceRepository } from "./session/model-preference";

async function composer(width = 100) {
  const dir = mkdtempSync(join(tmpdir(), "zc-composer-"));
  const preferences = createModelPreferenceRepository(join(dir, "state.json"));
  const sent: string[] = [];
  let push = (_event: Record<string, unknown>) => {};
  const client = {
    request: async (method: string, params: Record<string, unknown>) => {
      if (method === "session/list") return { sessions: [] };
      if (method === "session/resume") return { session: { status: "idle" }, messages: [] };
      if (method === "session/send") sent.push(params.content as string);
      return {};
    },
    onPush: (fn: typeof push) => { push = fn; },
    onAsk: () => {}, onBackendLost: () => {},
  } as unknown as AppServer;
  const setup = await testRender(<App client={client} preferences={preferences} resumeId="fixture-composer" onQuit={() => {}} />, { width, height: 30 });
  await setup.waitForFrame((f) => f.includes("Ask anything") && f.includes("Build"));
  const keys = async (values: string[]) => {
    await act(async () => { await setup.mockInput.pressKeys(values); });
    await setup.renderOnce();
  };
  const finish = async () => {
    await act(async () => { push({ method: "session/event", params: { payload: { content: "Done.", stopReason: "end_turn" } } }); });
    await setup.renderOnce();
  };
  const seed = async () => {
    await keys([..."previous fixture prompt", "\r"]);
    await finish();
  };
  const send = async () => { await keys(["\r"]); return sent.at(-1); };
  return { ...setup, keys, seed, sent, send, finish,
    cleanup: () => { setup.renderer.destroy(); rmSync(dir, { recursive: true, force: true }); },
  };
}

describe("production composer reference interaction", () => {
  test("up first moves to the beginning; history never replaces a different draft", async () => {
    const s = await composer();
    try {
      await s.seed();
      await s.keys([..."unfinished fixture", "\x1b[A", "\x1b[A", "!"]);
      expect(await s.send()).toBe("!unfinished fixture");
    } finally { s.cleanup(); }
  });

  test("history previous lands at start; next lands at end and returns to empty", async () => {
    const s = await composer();
    try {
      await s.seed();
      await s.keys(["\x1b[A", "!"]);
      expect(await s.send()).toBe("!previous fixture prompt");
      await s.finish();
      await s.keys(["\x1b[A", "\x1b[B", "\x1b[B", ..."fresh fixture"]);
      expect(await s.send()).toBe("fresh fixture");
    } finally { s.cleanup(); }
  });

  test("multiline arrows move visually then traverse history at the boundaries", async () => {
    const s = await composer();
    try {
      await s.keys([..."first", "\n", ..."second", "\r"]);
      expect(s.sent.at(-1)).toBe("first\nsecond");
      await s.finish();
      await s.keys([..."newest fixture", "\r"]);
      await s.finish();
      await s.keys(["\x1b[A", "\x1b[A", "\x1b[B", "\x1b[B", "\x1b[B"]);
      expect(await s.send()).toBe("newest fixture");
    } finally { s.cleanup(); }
  });

  test("wrapped single-line input uses visual arrow movement", async () => {
    const s = await composer(40);
    try {
      const text = "abcdefghijklmnopqrstuvwxyz".repeat(3);
      await s.keys([...text, "\x1b[A", "!"]);
      const result = await s.send();
      expect(result?.replace("!", "")).toBe(text);
      expect(result?.indexOf("!")).toBeGreaterThan(0);
      expect(result?.indexOf("!")).toBeLessThan(text.length);
    } finally { s.cleanup(); }
  });

  test("bracketed paste normalizes newlines and undo removes the whole insertion", async () => {
    const s = await composer();
    try {
      await s.keys([..."prefix "]);
      await act(async () => { await s.mockInput.pasteBracketedText("one\r\ntwo\rthree"); });
      await s.renderOnce();
      expect(await s.send()).toBe("prefix one\ntwo\nthree");
      await s.finish();
      await s.keys([..."keep "]);
      await act(async () => { await s.mockInput.pasteBracketedText("atomic fixture paste"); });
      await s.keys(["\x1f", "\r"]);
      expect(s.sent.at(-1)).toBe("keep");
    } finally { s.cleanup(); }
  });

  test("paste while a picker is open cannot mutate the composer", async () => {
    const s = await composer();
    try {
      await s.keys([..."/sessions", "\r"]);
      await s.waitForFrame((f) => f.includes("Sessions") && f.includes("Search"));
      await act(async () => { await s.mockInput.pasteBracketedText("unexpected fixture text"); });
      // Bare Esc waits for the terminal parser's Alt-prefix timeout.
      await act(async () => { await s.mockInput.pressKeys(["\x1b"], 100); });
      await s.waitForFrame((f) => !f.includes("Sessions") && f.includes("Ask anything"));
      await s.keys([..."intended fixture"]);
      expect(await s.send()).toBe("intended fixture");
    } finally { s.cleanup(); }
  });
});
