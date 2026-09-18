// Ported from opencode v2.0.7 packages/tui/src/prompt/stash.tsx (the
// PromptStash provider) + the getRelativeTime/getStashPreview helpers from
// component/dialog-stash.tsx. The Solid provider became a plain module —
// zcode-tui is single-instance, the draft is app state in app.tsx, and the
// store file matches the reference layout: one JSON object per line under
// the TUI state dir (ours: ~/.config/zcode-tui/prompt-stash.jsonl;
// ZCODE_TUI_STATE_DIR overrides it for tests/harnesses). Only the wiring is
// ours; the shapes, limits and take semantics are verbatim.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export type StashEntry = {
  prompt: { text: string };
  timestamp: number;
};

export const MAX_STASH_ENTRIES = 50;

function stateDir(): string {
  return process.env.ZCODE_TUI_STATE_DIR ?? path.join(process.env.HOME ?? "", ".config", "zcode-tui");
}

function stashPath(): string {
  return path.join(stateDir(), "prompt-stash.jsonl");
}

// The reference stores the full PromptInfo (text + mentions + files + …);
// our composer is plain text + cursor, so the prompt payload is {text}.
export function parsePromptStash(text: string): StashEntry[] {
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        const value = JSON.parse(line) as unknown;
        if (!value || typeof value !== "object") return undefined;
        const entry = value as Record<string, unknown>;
        const prompt = entry.prompt as Record<string, unknown> | undefined;
        if (!prompt || typeof prompt.text !== "string") return undefined;
        if (typeof entry.timestamp !== "number") return undefined;
        return { prompt: { text: prompt.text }, timestamp: entry.timestamp };
      } catch {
        return undefined;
      }
    })
    .filter((line): line is StashEntry => line !== undefined)
    .slice(-MAX_STASH_ENTRIES);
}

function writeAll(entries: StashEntry[]) {
  mkdirSync(stateDir(), { recursive: true });
  writeFileSync(stashPath(), entries.map((e) => JSON.stringify(e)).join("\n") + (entries.length > 0 ? "\n" : ""));
}

let entries: StashEntry[] | undefined;

function load(): StashEntry[] {
  try {
    const lines = parsePromptStash(readFileSync(stashPath(), "utf8"));
    // Reference onMount: a file that grew past MAX (or carried junk) is
    // rewritten sanitized so the on-disk store stays canonical.
    if (lines.length > 0) writeAll(lines);
    return lines;
  } catch {
    return [];
  }
}

// Lazy so tests and harnesses can point ZCODE_TUI_STATE_DIR elsewhere
// before the first touch.
function current(): StashEntry[] {
  if (!entries) entries = load();
  return entries;
}

// Test hook: drop the memo so the next touch re-reads the store file (bun
// caches module instances, so tests cannot re-import a fresh copy).
export function resetStashForTests(): void {
  entries = undefined;
}

export const promptStash = {
  stashPath,

  list(): StashEntry[] {
    return current();
  },

  push(entry: Omit<StashEntry, "timestamp">): void {
    const stash: StashEntry = { prompt: { ...entry.prompt }, timestamp: Date.now() };
    const list = current();
    let next = [...list, stash];
    if (next.length > MAX_STASH_ENTRIES) {
      next = next.slice(-MAX_STASH_ENTRIES);
      entries = next;
      writeAll(next);
      return;
    }
    entries = next;
    mkdirSync(stateDir(), { recursive: true });
    appendFileSync(stashPath(), JSON.stringify(stash) + "\n");
  },

  pop(): StashEntry | undefined {
    const list = current();
    if (list.length === 0) return undefined;
    const entry = list[list.length - 1];
    entries = list.slice(0, -1);
    writeAll(entries);
    return entry;
  },

  remove(index: number): void {
    const list = current();
    if (index < 0 || index >= list.length) return;
    entries = list.filter((_, i) => i !== index);
    writeAll(entries);
  },
};

// dialog-stash.tsx: relative age in the description column.
export function getRelativeTime(timestamp: number, now = Date.now()): string {
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toISOString().slice(0, 16).replace("T", " ");
}

// dialog-stash.tsx: the title column previews the first line only.
export function getStashPreview(input: string, maxLength = 50): string {
  const firstLine = input.split("\n")[0].trim();
  if (firstLine.length <= maxLength) return firstLine;
  return `${firstLine.slice(0, Math.max(1, maxLength - 1))}…`;
}
