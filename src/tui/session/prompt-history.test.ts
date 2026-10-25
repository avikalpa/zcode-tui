// The rich prompt-history store (reference prompt/history.tsx): parse
// validation, adjacent-only full-entry dedupe, the 50-entry bound, the
// self-healing rewrite, and the boot merge with the shared store's plain
// texts.
import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_HISTORY_ENTRIES,
  isDuplicateEntry,
  mergeSeed,
  parsePromptHistory,
  parseRichPrompt,
  promptHistory,
  resetPromptHistoryForTests,
} from "./prompt-history";

const paste = (text: string, label = "[Pasted ~3 lines]") => ({ text, source: { start: 0, end: label.length, text: label } });
const file = (label = "[Image 1]") => ({ uri: "data:image/png;base64,QUJD", mime: "image/png", name: "shot.png", label });
const rich = (text: string, extra: Partial<{ files: unknown[]; pasted: unknown[] }> = {}) =>
  ({ text, files: (extra.files as never) ?? [], pasted: (extra.pasted as never) ?? [] }) as ReturnType<typeof parseRichPrompt> & object;

function withStore(run: () => void) {
  const dir = join(tmpdir(), `zc-prompt-history-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  process.env.ZCODE_TUI_STATE_DIR = dir;
  resetPromptHistoryForTests();
  try {
    run();
  } finally {
    delete process.env.ZCODE_TUI_STATE_DIR;
    resetPromptHistoryForTests();
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("parsePromptHistory / parseRichPrompt", () => {
  test("keeps valid lines, drops junk and shape-invalid entries, bounds to 50", () => {
    const lines = [
      JSON.stringify(rich("kept", { pasted: [paste("source")] })),
      "not json",
      JSON.stringify({ text: 7, pasted: [] }),
      JSON.stringify({ text: "no pasted field" }),
    ];
    const parsed = parsePromptHistory(lines.join("\n"));
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.text).toBe("kept");
    expect(parseRichPrompt(undefined)).toBeUndefined();
    expect(MAX_HISTORY_ENTRIES).toBe(50);
  });

  test("an entry with no files defaults to an empty tray", () => {
    const parsed = parsePromptHistory(JSON.stringify({ text: "t", pasted: [] }));
    expect(parsed[0]?.files).toEqual([]);
  });
});

describe("isDuplicateEntry", () => {
  test("adjacent full-entry equality — same text with different parts is not a duplicate", () => {
    expect(isDuplicateEntry({ text: "a" }, { text: "a" })).toBe(true);
    expect(isDuplicateEntry(undefined, { text: "a" })).toBe(false);
    expect(isDuplicateEntry({ text: "a" }, { text: "a", rich: { files: [], pasted: [paste("x")] } })).toBe(false);
    expect(isDuplicateEntry({ text: "[Pasted ~3 lines]", rich: { files: [], pasted: [paste("x")] } }, { text: "x" })).toBe(false);
  });
});

describe("promptHistory store", () => {
  test("append persists one JSON object per line; reload reads them oldest-last", () =>
    withStore(() => {
      promptHistory.append(rich("first", { pasted: [paste("one")] }));
      promptHistory.append(rich("second", { files: [file()] }));
      const onDisk = readFileSync(promptHistory.historyPath(), "utf8").trim().split("\n");
      expect(onDisk).toHaveLength(2);
      expect(JSON.parse(onDisk[0]).text).toBe("first");
      expect(promptHistory.all()[1]?.files[0]?.label).toBe("[Image 1]");
    }));

  test("an identical adjacent entry is refused; a different one after it is kept", () =>
    withStore(() => {
      promptHistory.append(rich("same", { pasted: [paste("s")] }));
      promptHistory.append(rich("same", { pasted: [paste("s")] }));
      expect(readFileSync(promptHistory.historyPath(), "utf8").trim()).not.toContain("\n");
      promptHistory.append(rich("same", { pasted: [paste("different")] }));
      expect(promptHistory.all()).toHaveLength(2);
    }));

  test("the bound trims oldest and rewrites; junk lines are dropped on load", () =>
    withStore(() => {
      for (let i = 0; i < MAX_HISTORY_ENTRIES + 3; i++) promptHistory.append(rich(`e${i}`));
      const all = promptHistory.all();
      expect(all).toHaveLength(MAX_HISTORY_ENTRIES);
      expect(all[0]?.text).toBe("e3");
      expect(all[MAX_HISTORY_ENTRIES - 1]?.text).toBe(`e${MAX_HISTORY_ENTRIES + 2}`);
      writeFileSync(promptHistory.historyPath(), "garbage\n" + JSON.stringify(rich("good", { pasted: [] })) + "\n");
      resetPromptHistoryForTests();
      expect(promptHistory.all().map((e) => e.text)).toEqual(["good"]);
      const healed = readFileSync(promptHistory.historyPath(), "utf8");
      expect(healed).not.toContain("garbage");
    }));
});

describe("mergeSeed", () => {
  test("rich entries lead newest-first; shared texts hidden by a rich entry drop", () => {
    const items = mergeSeed([rich("old", { pasted: [] }), rich("new", { pasted: [] })], ["newer-cli", "new", "older-cli"]);
    expect(items.map((i) => i.text)).toEqual(["new", "old", "newer-cli", "older-cli"]);
    expect(items[0]?.rich).toBeDefined();
    expect(items[2]?.rich).toBeUndefined();
  });

  test("empty shared texts are dropped and the merge bounds to 50", () => {
    const shared = ["", "x", ...Array.from({ length: 60 }, (_, i) => `s${i}`)];
    expect(mergeSeed([], shared)).toHaveLength(MAX_HISTORY_ENTRIES);
    expect(mergeSeed([], shared)[0]?.text).toBe("x");
  });
});
