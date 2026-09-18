// The stash model contract, tested against a throwaway state dir (the
// module reads ZCODE_TUI_STATE_DIR lazily, so the env set here lands before
// the first touch — the real ~/.config/zcode-tui is never involved). These
// pin the v2.0.7 semantics the port must keep: LIFO pop, remove-by-index
// for the dialog's take-on-restore, MAX 50 with oldest-drop, sanitize-on-
// load, and jsonl round-trips.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "zc-stash-test-"));
process.env.ZCODE_TUI_STATE_DIR = dir;

const { getRelativeTime, getStashPreview, parsePromptStash, promptStash, resetStashForTests } = await import("./prompt-stash");

const storeFile = () => path.join(dir, "prompt-stash.jsonl");

beforeEach(() => {
  rmSync(storeFile(), { force: true });
  resetStashForTests();
});

afterEach(() => {
  resetStashForTests();
});

test("stash round-trips through the jsonl store", () => {
  promptStash.push({ prompt: { text: "first draft" } });
  promptStash.push({ prompt: { text: "second draft\nwith two lines" } });
  const onDisk = readFileSync(storeFile(), "utf8");
  expect(onDisk.trim().split("\n").length).toBe(2);
  expect(parsePromptStash(onDisk).map((e) => e.prompt.text)).toEqual(["first draft", "second draft\nwith two lines"]);
});

test("pop takes the newest entry and rewrites the store", () => {
  promptStash.push({ prompt: { text: "older" } });
  promptStash.push({ prompt: { text: "newer" } });
  const entry = promptStash.pop();
  expect(entry?.prompt.text).toBe("newer");
  expect(promptStash.list().map((e) => e.prompt.text)).toEqual(["older"]);
  expect(promptStash.pop()?.prompt.text).toBe("older");
  expect(promptStash.pop()).toBeUndefined();
  expect(readFileSync(storeFile(), "utf8")).toBe("");
});

test("remove takes an index, out-of-range is a no-op", () => {
  promptStash.push({ prompt: { text: "a" } });
  promptStash.push({ prompt: { text: "b" } });
  promptStash.push({ prompt: { text: "c" } });
  promptStash.remove(1);
  expect(promptStash.list().map((e) => e.prompt.text)).toEqual(["a", "c"]);
  promptStash.remove(9);
  expect(promptStash.list().length).toBe(2);
});

test("parse drops junk lines and caps at MAX entries", () => {
  const junk = ["not json", JSON.stringify({ prompt: {}, timestamp: 1 }), JSON.stringify({ prompt: { text: "ok" }, timestamp: 2 })];
  const fiftyOne = Array.from({ length: 51 }, (_, i) => JSON.stringify({ prompt: { text: `e${i}` }, timestamp: 100 + i }));
  const parsed = parsePromptStash([...junk, ...fiftyOne].join("\n"));
  expect(parsed.length).toBe(50);
  expect(parsed[0].prompt.text).toBe("e1");
  expect(parsed[49].prompt.text).toBe("e50");
});

test("a store over the cap is sanitized on load (file rewritten to the kept window)", () => {
  const lines = Array.from({ length: 52 }, (_, i) => JSON.stringify({ prompt: { text: `s${i}` }, timestamp: 1000 + i }));
  writeFileSync(storeFile(), lines.join("\n") + "\n");
  // The FIRST touch initializes from the file: load() sanitizes and
  // rewrites the store to the kept window (reference onMount behavior).
  expect(promptStash.list().map((e) => e.prompt.text)).toEqual(
    Array.from({ length: 50 }, (_, i) => `s${i + 2}`),
  );
  expect(readFileSync(storeFile(), "utf8").trim().split("\n").length).toBe(50);
});

test("relative time and preview follow the reference grammar", () => {
  const now = Date.now();
  expect(getRelativeTime(now - 5_000, now)).toBe("just now");
  expect(getRelativeTime(now - 5 * 60_000, now)).toBe("5m ago");
  expect(getRelativeTime(now - 5 * 3_600_000, now)).toBe("5h ago");
  expect(getRelativeTime(now - 3 * 86_400_000, now)).toBe("3d ago");
  expect(getStashPreview("hello\nworld")).toBe("hello");
  expect(getStashPreview("x".repeat(60))).toBe(`${"x".repeat(49)}…`);
});
