import { describe, expect, test } from "bun:test";
import { expandTracked, foldDecision, inPaste, pasteCuts, pasteLabel, reassignParts, type PastePart } from "./paste-fold";

describe("paste fold decisions", () => {
  test("folds at 3+ lines, over 150 chars, and not below either bound", () => {
    expect(foldDecision("one\ntwo\nthree")).toEqual({ fold: true, lines: 3 });
    expect(foldDecision("x".repeat(151))).toEqual({ fold: true, lines: 1 });
    expect(foldDecision("one\ntwo")).toEqual({ fold: false, lines: 2 });
    expect(foldDecision("x".repeat(150))).toEqual({ fold: false, lines: 1 });
  });

  test("the label counts trimmed lines", () => {
    expect(pasteLabel(3)).toBe("[Pasted ~3 lines]");
    expect(pasteLabel(12)).toBe("[Pasted ~12 lines]");
  });
});

describe("expandTracked", () => {
  test("splices part text over each range, highest offset first", () => {
    const text = "a [Pasted ~1 lines] b [Pasted ~2 lines] c";
    const parts = [
      { start: 2, end: 19, text: "first" },
      { start: 22, end: 39, text: "second\nsecond" },
    ];
    expect(expandTracked(text, parts)).toBe("a first b second\nsecond c");
  });

  test("a single part at the start expands in place", () => {
    expect(expandTracked("[Pasted ~1 lines] tail", [{ start: 0, end: 17, text: "head" }])).toBe("head tail");
  });
});

describe("reassignParts", () => {
  const part = (start: number, end: number, text: string, label = "[Pasted ~3 lines]"): PastePart => ({
    start,
    end,
    text,
    label,
  });

  test("shifts ranges when text is typed before the label", () => {
    const live = reassignParts("xx [Pasted ~3 lines] y", [part(0, 17, "abc")]);
    expect(live).toEqual([part(3, 20, "abc")]);
  });

  test("drops a part whose label was destroyed by editing inside it", () => {
    const live = reassignParts("[Pasted ~3 line]", [part(0, 18, "abc")]);
    expect(live).toEqual([]);
  });

  test("assigns identical labels in document order", () => {
    const draft = "[Pasted ~3 lines] mid [Pasted ~3 lines]";
    const live = reassignParts(draft, [part(0, 17, "first"), part(22, 39, "second")]);
    expect(live.map((p) => [p.start, p.end, p.text])).toEqual([
      [0, 17, "first"],
      [22, 39, "second"],
    ]);
  });

  test("drops the expanded part while keeping the survivor", () => {
    const draft = "full text [Pasted ~3 lines]";
    const live = reassignParts(draft, [part(0, 17, "first"), part(10, 27, "second")]);
    expect(live).toEqual([{ start: 10, end: 27, text: "second", label: "[Pasted ~3 lines]" }]);
  });
});

describe("pasteCuts", () => {
  test("cuts at both boundaries of every part", () => {
    expect([...pasteCuts("[Pasted ~1 lines] ok", [{ start: 0, end: 17 }])].sort((a, b) => a - b)).toEqual([0, 17]);
  });

  test("inPaste is half-open", () => {
    const parts = [{ start: 2, end: 5 }];
    expect(inPaste(parts, 2)).toBe(true);
    expect(inPaste(parts, 4)).toBe(true);
    expect(inPaste(parts, 5)).toBe(false);
  });
});
