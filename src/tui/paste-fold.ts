// The OpenCode long-paste fold (packages/tui/src/component/prompt/index.tsx
// pasteInputText + prompt/part.ts): a bracketed paste of 3+ lines or >150
// chars becomes a virtual `[Pasted ~N lines]` part at the cursor; the full
// text rides in the part and is spliced back at submit. config prompt.paste
// =full keeps the raw text. Our composer is a plain JS string, so parts
// track string-index ranges and are re-derived from their labels after
// every edit — the structural-extmark identity the reference gets from the
// editor is approximated by document-order, first-free-occurrence label
// assignment (two folds of the same line count share a label; an edit that
// swaps two identical labels in the draft can exchange their parts).

export interface PastePart {
  start: number;
  end: number;
  text: string;
  label: string;
}

// pasteInputText: lineCount over the trimmed normalized text, folded when
// >= 3 lines or > 150 chars — unless prompt.paste is "full".
export function foldDecision(normalized: string): { fold: boolean; lines: number } {
  const content = normalized.trim();
  const lines = (content.match(/\n/g)?.length ?? 0) + 1;
  return { fold: lines >= 3 || content.length > 150, lines };
}

export function pasteLabel(lines: number): string {
  return `[Pasted ~${lines} lines]`;
}

// expandTrackedPastedText: splice each part's text over its range, highest
// offset first so earlier splices cannot shift later ranges.
export function expandTracked(text: string, parts: readonly { start: number; end: number; text: string }[]): string {
  return [...parts]
    .sort((a, b) => b.start - a.start)
    .reduce((acc, part) => acc.slice(0, part.start) + part.text + acc.slice(part.end), text);
}

// syncExtmarksWithPromptParts for a string draft: a part whose recorded
// range still holds its label exactly keeps it (position identity — the
// extmark survived the edit untouched); the rest re-anchor to the unclaimed
// occurrence nearest their old start. A label destroyed by an edit drops
// its part — the reference drops the extmark the same way.
export function reassignParts(draft: string, parts: readonly PastePart[]): PastePart[] {
  const claimed: [number, number][] = [];
  const overlaps = (at: number, len: number) => claimed.some(([s, e]) => at < e && at + len > s);
  const live: (PastePart | null)[] = new Array(parts.length).fill(null);
  parts.forEach((part, i) => {
    if (draft.slice(part.start, part.end) === part.label && !overlaps(part.start, part.label.length)) {
      claimed.push([part.start, part.end]);
      live[i] = { ...part };
    }
  });
  parts.forEach((part, i) => {
    if (live[i]) return;
    let best = -1;
    let bestDistance = Infinity;
    for (let at = draft.indexOf(part.label); at !== -1; at = draft.indexOf(part.label, at + 1)) {
      if (overlaps(at, part.label.length)) continue;
      const distance = Math.abs(at - part.start);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = at;
      }
    }
    if (best === -1) return;
    claimed.push([best, best + part.label.length]);
    live[i] = { ...part, start: best, end: best + part.label.length };
  });
  return live.filter((part): part is PastePart => part !== null).sort((a, b) => a.start - b.start);
}

// The Composer cut planner: paste ranges join the cursor/selection cut set
// so each rendered segment carries its span flags.
export interface DraftSeg {
  text: string;
  sel: boolean;
  paste: boolean;
}

export function pasteCuts(draft: string, parts: readonly { start: number; end: number }[]): Set<number> {
  const cuts = new Set<number>();
  for (const part of parts) {
    if (part.start >= 0 && part.start <= draft.length) cuts.add(part.start);
    if (part.end >= 0 && part.end <= draft.length) cuts.add(part.end);
  }
  return cuts;
}

export function inPaste(parts: readonly { start: number; end: number }[], at: number): boolean {
  return parts.some((part) => at >= part.start && at < part.end);
}
