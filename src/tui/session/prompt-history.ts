// Ported from opencode v2.0.8 packages/tui/src/prompt/history.tsx (the
// PromptInfo store): submitted prompts persist with their attachment and
// paste parts, so Up/Down recall restores the folded composer — paste labels
// in the text with the full source riding in the part, attachment labels
// backed by their tray parts — instead of a flat expansion. One JSON object
// per line under the TUI state dir (ours:
// ~/.config/zcode-tui/prompt-history.jsonl; ZCODE_TUI_STATE_DIR overrides
// it), adjacent-only dedupe by full-entry JSON equality, 50-entry bound,
// self-healing rewrite on load. The shared CLI store's plain texts stay the
// seed backbone for cross-surface entries; rich entries recorded here
// overlay them at seed time (mergeSeed). Only the wiring is ours; the
// shapes, limits and dedupe semantics are the reference's.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

// Reference PastedText: the full pasted text, plus the label range it
// folds into in the composer text.
export type HistoryPaste = { text: string; source: { start: number; end: number; text: string } };

// Attachment part as the reference stores it — the data: uri re-decodes at
// recall; bytes never persist outside the uri.
export type HistoryFile = { uri: string; mime: string; name?: string; label: string };

export type RichPrompt = { text: string; files: HistoryFile[]; pasted: HistoryPaste[] };

// A recall list row: a rich entry carries its parts; plain entries are the
// shared store's flat texts.
export type HistoryItem = { text: string; rich?: { files: HistoryFile[]; pasted: HistoryPaste[] } };

export const MAX_HISTORY_ENTRIES = 50;

// Reference parsePromptInfo: text must be a string and pasted an array;
// everything else is tolerance, not acceptance.
export function parseRichPrompt(value: unknown): RichPrompt | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Record<string, unknown>;
  if (typeof input.text !== "string" || !Array.isArray(input.pasted)) return undefined;
  return {
    text: input.text,
    files: Array.isArray(input.files) ? (input.files as HistoryFile[]) : [],
    pasted: input.pasted as HistoryPaste[],
  };
}

export function parsePromptHistory(text: string): RichPrompt[] {
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return parseRichPrompt(JSON.parse(line));
      } catch {
        return undefined;
      }
    })
    .filter((line): line is RichPrompt => line !== undefined)
    .slice(-MAX_HISTORY_ENTRIES);
}

// Reference isDuplicateEntry: full-entry JSON equality, adjacent-only.
export function isDuplicateEntry(previous: HistoryItem | undefined, next: HistoryItem): boolean {
  if (!previous) return false;
  return JSON.stringify(previous) === JSON.stringify(next);
}

// Boot seeding: rich entries recorded by this adapter recall first
// (newest-first from the oldest-last file), then the shared store's plain
// texts that a rich entry does not already cover by exact text — the
// identical plain prompt must not list twice. Both arms bound to
// MAX_HISTORY_ENTRIES like the reference reader.
export function mergeSeed(richOldestLast: RichPrompt[], sharedNewestFirst: string[]): HistoryItem[] {
  const rich = [...richOldestLast].reverse().map((entry) => ({ text: entry.text, rich: { files: entry.files, pasted: entry.pasted } }));
  const covered = new Set(rich.map((entry) => entry.text));
  const shared = sharedNewestFirst
    .filter((text) => text.length > 0)
    .filter((text) => !covered.has(text))
    .map((text) => ({ text }));
  return [...rich, ...shared].slice(0, MAX_HISTORY_ENTRIES);
}

function stateDir(): string {
  return process.env.ZCODE_TUI_STATE_DIR ?? path.join(process.env.HOME ?? "", ".config", "zcode-tui");
}

function historyPath(): string {
  return path.join(stateDir(), "prompt-history.jsonl");
}

function writeAll(entries: RichPrompt[]) {
  mkdirSync(stateDir(), { recursive: true });
  writeFileSync(historyPath(), entries.map((e) => JSON.stringify(e)).join("\n") + (entries.length > 0 ? "\n" : ""));
}

let entries: RichPrompt[] | undefined;

function load(): RichPrompt[] {
  try {
    const lines = parsePromptHistory(readFileSync(historyPath(), "utf8"));
    // Reference onMount: a file that grew past MAX (or carried junk) is
    // rewritten sanitized so the on-disk store stays canonical.
    if (lines.length > 0) writeAll(lines);
    return lines;
  } catch {
    return [];
  }
}

function current(): RichPrompt[] {
  if (!entries) entries = load();
  return entries;
}

// Test hook: drop the memo so the next touch re-reads the store file (bun
// caches module instances, so tests cannot re-import a fresh copy).
export function resetPromptHistoryForTests(): void {
  entries = undefined;
}

export const promptHistory = {
  historyPath,

  // Oldest-last, the on-disk order.
  all(): RichPrompt[] {
    return current();
  },

  // Reference append: adjacent-only dedupe by full-entry equality resets
  // the recall cursor; the bound trims oldest first.
  append(item: RichPrompt): void {
    const entry: RichPrompt = { text: item.text, files: item.files.map((f) => ({ ...f })), pasted: item.pasted.map((p) => ({ text: p.text, source: { ...p.source } })) };
    const list = current();
    const last = list[list.length - 1];
    if (last && JSON.stringify(last) === JSON.stringify(entry)) return;
    let next = [...list, entry];
    if (next.length > MAX_HISTORY_ENTRIES) {
      next = next.slice(-MAX_HISTORY_ENTRIES);
      entries = next;
      writeAll(next);
      return;
    }
    entries = next;
    mkdirSync(stateDir(), { recursive: true });
    appendFileSync(historyPath(), JSON.stringify(entry) + "\n");
  },
};
