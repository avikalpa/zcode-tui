import { describe, expect, test } from "bun:test";
import {
  adaptiveSessionTabLayout,
  closeSessionTab,
  cycleSessionTab,
  moveSessionTab,
  moveSessionTabHistory,
  openSessionTab,
  recordClosedSessionTab,
  recordSessionTabHistory,
  reopenSessionTab,
  sessionTabOverflowWidth,
} from "./session-tabs-model";

const tab = (id: string, title?: string) => ({ sessionID: id, title });

describe("open/close tabs", () => {
  test("openSessionTab appends new, updates title, dedupes", () => {
    let tabs = openSessionTab([], tab("a"));
    tabs = openSessionTab(tabs, tab("b"));
    expect(tabs.map((t) => t.sessionID)).toEqual(["a", "b"]);
    const updated = openSessionTab(tabs, tab("a", "Renamed"));
    expect(updated.find((t) => t.sessionID === "a")?.title).toBe("Renamed");
    expect(openSessionTab(updated, tab("a", "Renamed"))).toBe(updated);
  });

  test("closeSessionTab prefers the tab to the right, then left", () => {
    const tabs = [tab("a"), tab("b"), tab("c")];
    expect(closeSessionTab(tabs, "b").next).toBe("c");
    expect(closeSessionTab(tabs, "c").next).toBe("b");
    expect(closeSessionTab(tabs, "x").next).toBeUndefined();
    expect(closeSessionTab(tabs, "a").tabs.map((t) => t.sessionID)).toEqual(["b", "c"]);
  });

  test("reopen restores the closed tab at its original index and walks the stack", () => {
    let stack = recordClosedSessionTab([], tab("a"), 0);
    stack = recordClosedSessionTab(stack, tab("b"), 1);
    const r1 = reopenSessionTab(stack, [tab("c")]);
    expect(r1.sessionID).toBe("b");
    expect(r1.tabs!.map((t) => t.sessionID)).toEqual(["c", "b"]);
    const r2 = reopenSessionTab(r1.stack, r1.tabs!);
    expect(r2.sessionID).toBe("a");
    expect(r2.tabs!.map((t) => t.sessionID)).toEqual(["a", "c", "b"]);
  });
});

describe("move + cycle", () => {
  test("moveSessionTab reorders and clamps", () => {
    const tabs = [tab("a"), tab("b"), tab("c")];
    expect(moveSessionTab(tabs, "c", 0).map((t) => t.sessionID)).toEqual(["c", "a", "b"]);
    expect(moveSessionTab(tabs, "a", 99).map((t) => t.sessionID)).toEqual(["b", "c", "a"]);
    expect(moveSessionTab(tabs, "a", 0)).toBe(tabs);
  });

  test("cycleSessionTab walks forward and backward with wrap", () => {
    const tabs = [tab("a"), tab("b"), tab("c")];
    expect(cycleSessionTab(tabs, "a", 1)?.sessionID).toBe("b");
    expect(cycleSessionTab(tabs, "c", 1)?.sessionID).toBe("a");
    expect(cycleSessionTab(tabs, "a", -1)?.sessionID).toBe("c");
    expect(cycleSessionTab(tabs, undefined, 1)?.sessionID).toBe("a");
  });
});

describe("tab history", () => {
  test("records switches, dedupes repeats, bounded forward move", () => {
    let h = recordSessionTabHistory({ entries: [], index: -1 }, "a");
    h = recordSessionTabHistory(h, "b");
    h = recordSessionTabHistory(h, "b");
    expect(h.entries).toEqual(["a", "b"]);
    h = recordSessionTabHistory(h, "c");
    // The cursor semantics: the cursor sits on the newest entry after a
    // record; forward only finds entries AFTER the cursor, so walk back
    // first (direction -1 is the model half; upstream binds back to none).
    const back = moveSessionTabHistory(h, [tab("a"), tab("b"), tab("c")], "c", -1);
    expect(back.sessionID).toBe("b");
    const fwd = moveSessionTabHistory(back.history, [tab("a"), tab("b"), tab("c")], "b", 1);
    expect(fwd.sessionID).toBe("c");
    const none = moveSessionTabHistory(fwd.history, [tab("a"), tab("b"), tab("c")], "c", 1);
    expect(none.sessionID).toBeUndefined();
  });
});

describe("adaptiveSessionTabLayout", () => {
  test("empty tabs lay out to nothing", () => {
    const l = adaptiveSessionTabLayout([], "a", 100);
    expect(l.tabs).toEqual([]);
  });

  test("wide terminals fit every tab at roomy widths", () => {
    const tabs = [tab("a"), tab("b")];
    const l = adaptiveSessionTabLayout(tabs, "a", 200);
    expect(l.before).toBe(0);
    expect(l.after).toBe(0);
    expect(l.widths.reduce((x, y) => x + y, 0)).toBeLessThanOrEqual(200);
  });

  test("narrow terminals show a window with overflow markers", () => {
    const tabs = ["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => tab(id));
    const l = adaptiveSessionTabLayout(tabs, "d", 60);
    expect(l.widths.length).toBeLessThan(tabs.length);
    expect(l.before + l.widths.length + l.after).toBe(tabs.length);
    expect(l.tabs.some((t) => t.sessionID === "d")).toBe(true);
  });

  test("overflow marker budget matches the reference constant", () => {
    expect(sessionTabOverflowWidth(12)).toBe(4);
  });
});
