import { describe, expect, test } from "bun:test";
import {
  moveSelection,
  moveSelectionOffset,
  reconcileSelection,
  reconcileSelectionWindow,
  revealSelectionOffset,
} from "./select-controller";

describe("reconcileSelection", () => {
  test("clamps into the live range", () => {
    expect(reconcileSelection(0, 5)).toBe(0);
    expect(reconcileSelection(4, 5)).toBe(4);
    expect(reconcileSelection(-3, 5)).toBe(0);
    expect(reconcileSelection(9, 5)).toBe(4);
  });

  test("empty list collapses to 0", () => {
    expect(reconcileSelection(3, 0)).toBe(0);
  });
});

describe("moveSelection", () => {
  test("clamp policy pins at the ends", () => {
    expect(moveSelection(0, { count: 3, delta: -1, policy: "clamp" })).toBe(0);
    expect(moveSelection(2, { count: 3, delta: 1, policy: "clamp" })).toBe(2);
  });

  test("wrap policy folds over both ends", () => {
    expect(moveSelection(0, { count: 3, delta: -1, policy: "wrap" })).toBe(2);
    expect(moveSelection(2, { count: 3, delta: 1, policy: "wrap" })).toBe(0);
  });

  test("empty list stays at 0", () => {
    expect(moveSelection(1, { count: 0, delta: 1, policy: "wrap" })).toBe(0);
  });
});

describe("revealSelectionOffset", () => {
  test("keeps the window when the selection is inside it", () => {
    expect(revealSelectionOffset(2, { count: 20, limit: 8, selected: 5 })).toBe(2);
  });

  test("pulls the window up when the selection is above it", () => {
    expect(revealSelectionOffset(5, { count: 20, limit: 8, selected: 3 })).toBe(3);
  });

  test("pushes the window down when the selection is below it", () => {
    expect(revealSelectionOffset(0, { count: 20, limit: 8, selected: 8 })).toBe(1);
    expect(revealSelectionOffset(0, { count: 20, limit: 8, selected: 12 })).toBe(5);
  });

  test("never passes the last full window", () => {
    expect(revealSelectionOffset(0, { count: 20, limit: 8, selected: 19 })).toBe(12);
  });
});

describe("reconcileSelectionWindow", () => {
  test("holds the selection inside the clamped window", () => {
    expect(reconcileSelectionWindow(4, { count: 20, limit: 8, offset: 2 })).toBe(4);
    expect(reconcileSelectionWindow(1, { count: 20, limit: 8, offset: 2 })).toBe(2);
    expect(reconcileSelectionWindow(15, { count: 20, limit: 8, offset: 2 })).toBe(9);
  });

  test("empty list collapses to 0", () => {
    expect(reconcileSelectionWindow(3, { count: 0, limit: 8, offset: 0 })).toBe(0);
  });
});

describe("moveSelectionOffset", () => {
  const inside = { count: 40, limit: 9 };

  test("middle moves leave the window alone", () => {
    // margin = min(2, floor((9-1)/2)) = 2; window 4..12
    expect(moveSelectionOffset(4, { ...inside, selected: 8, direction: 1 })).toBe(4);
    expect(moveSelectionOffset(4, { ...inside, selected: 9, direction: 1 })).toBe(4);
    expect(moveSelectionOffset(4, { ...inside, selected: 8, direction: -1 })).toBe(4);
  });

  test("crossing the bottom margin nudges the window down", () => {
    // selected > offset+limit-margin-1 = 10 → offset = selected - limit + margin + 1
    expect(moveSelectionOffset(4, { ...inside, selected: 11, direction: 1 })).toBe(5);
    expect(moveSelectionOffset(4, { ...inside, selected: 12, direction: 1 })).toBe(6);
  });

  test("crossing the top margin nudges the window up", () => {
    // selected < offset+margin = 6 → offset = selected - margin
    expect(moveSelectionOffset(4, { ...inside, selected: 5, direction: -1 })).toBe(3);
    expect(moveSelectionOffset(4, { ...inside, selected: 4, direction: -1 })).toBe(2);
  });

  test("window never escapes the list", () => {
    expect(moveSelectionOffset(0, { ...inside, selected: 39, direction: 1 })).toBeLessThanOrEqual(31);
    expect(moveSelectionOffset(31, { ...inside, selected: 0, direction: -1 })).toBeGreaterThanOrEqual(0);
  });
});
