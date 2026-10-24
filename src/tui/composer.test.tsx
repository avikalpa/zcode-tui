import { describe, expect, test } from "bun:test";
import { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppServer } from "../protocol/client";
import { App } from "./app";
import { createModelPreferenceRepository } from "./session/model-preference";

async function composer(width = 100, state: Record<string, unknown> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "zc-composer-"));
  const preferences = createModelPreferenceRepository(join(dir, "state.json"));
  if (Object.keys(state).length > 0) preferences.update(() => state);
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

describe("production composer paste folding", () => {
  test("a long paste folds to its label, edits shift it, and submit carries the full text", async () => {
    const s = await composer();
    try {
      await s.keys([..."head "]);
      await act(async () => { await s.mockInput.pasteBracketedText("alpha\nbravo\ncharlie"); });
      await s.waitForFrame((f) => f.includes("[Pasted ~3 lines]"));
      // The fold leaves one separator space; typing resumes right after it.
      await s.keys([..."tail"]);
      expect(await s.send()).toBe("head alpha\nbravo\ncharlie tail");
    } finally { s.cleanup(); }
  });

  test("re-pasting the folded text at the cursor expands the fold", async () => {
    const s = await composer();
    try {
      const long = "delta\necho\nfoxtrot";
      await act(async () => { await s.mockInput.pasteBracketedText(long); });
      await s.waitForFrame((f) => f.includes("[Pasted ~3 lines]"));
      await act(async () => { await s.mockInput.pasteBracketedText(long); });
      await s.waitForFrame((f) => !f.includes("[Pasted ~3 lines]"));
      expect(await s.send()).toBe(long);
    } finally { s.cleanup(); }
  });

  test("prompt.paste=full keeps the raw text unfolded", async () => {
    const s = await composer(100, { paste: "full" });
    try {
      const long = "golf\nhotel\nindia";
      await s.keys([..."keep "]);
      await act(async () => { await s.mockInput.pasteBracketedText(long); });
      await s.waitForFrame((f) => f.includes("india") && !f.includes("[Pasted ~3 lines]"));
      expect(await s.send()).toBe("keep golf\nhotel\nindia");
    } finally { s.cleanup(); }
  });

  test("pasting an SVG path tracks the content under its SVG label", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zc-svg-paste-"));
    try {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg"><rect width="2" height="2"/></svg>`;
      const file = join(dir, "logo.svg");
      writeFileSync(file, svg);
      const s = await composer();
      try {
        await act(async () => { await s.mockInput.pasteBracketedText(file); });
        await s.waitForFrame((f) => f.includes("[SVG: logo.svg]"));
        expect(await s.send()).toBe(svg);
      } finally { s.cleanup(); }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
