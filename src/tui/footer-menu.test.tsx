// Unit checks for the footer-menu grammar port (reference
// mini/footer.menu.tsx). The window/selection math itself is select-controller
// and covered there; these pin the menu-specific pieces: the text budget
// helpers, the categorized row builder, and the footer-tone colors.
import { describe, expect, test } from "bun:test";
import { buildMenuRows, footerMenuText, footerToneColor, FOOTER_COMPACT_WIDTH } from "./footer-menu";
import { THEMES } from "./design";

describe("footerMenuText", () => {
  test("passes short text through", () => {
    expect(footerMenuText("open session", 20)).toBe("open session");
    expect(footerMenuText("open session", 12)).toBe("open session");
  });

  test("non-mono truncates with an ellipsis inside the budget", () => {
    const out = footerMenuText("a very long session title", 10);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(10);
  });

  test("mono truncates with a dotted suffix instead", () => {
    const out = footerMenuText("a very long session title", 10, true);
    expect(out.endsWith("...")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(10);
  });

  test("counts display width, not code units (CJK)", () => {
    // Two CJK chars are 4 columns; a width-4 budget keeps both, width-3
    // keeps one plus the ellipsis.
    expect(footerMenuText("会话", 4)).toBe("会话");
    expect(footerMenuText("会话", 3)).toBe("会…");
  });

  test("degenerate budgets collapse honestly", () => {
    expect(footerMenuText("anything", 0)).toBe("");
    expect(footerMenuText("x", 1)).toBe("x");
  });
});

describe("buildMenuRows", () => {
  const items = (categories: (string | undefined)[], display = "row") =>
    categories.map((category, index) => ({ display: `${display} ${index}`, category }));

  test("headers and spacers interleave for multi-category lists", () => {
    const rows = buildMenuRows(items(["Pinned", "Pinned", "Today", "Yesterday"]));
    expect(rows.map((row) => row.type)).toEqual([
      "header", "item", "item", "spacer", "header", "item", "spacer", "header", "item",
    ]);
    const headers = rows.filter((row) => row.type === "header");
    expect(headers.map((row) => (row as { label: string }).label)).toEqual(["Pinned", "Today", "Yesterday"]);
  });

  test("item indices stay the caller's item indexes", () => {
    const rows = buildMenuRows(items([undefined, "Group", "Group"]));
    const itemRows = rows.filter((row) => row.type === "item");
    expect(itemRows.map((row) => (row as { index: number }).index)).toEqual([0, 1, 2]);
  });

  test("uncategorized items wear no header", () => {
    const rows = buildMenuRows(items([undefined, undefined]));
    expect(rows.every((row) => row.type === "item")).toBe(true);
  });

  test("compact mode drops headers and spacers", () => {
    const rows = buildMenuRows(items(["Pinned", "Today"]), true);
    expect(rows.every((row) => row.type === "item")).toBe(true);
    expect(rows).toHaveLength(2);
  });

  test("a category-less gap does not re-trigger a same-category header", () => {
    // The reference compares against the last SEEN category, so
    // Today / uncategorized / Today paints a single header.
    const rows = buildMenuRows(items(["Today", undefined, "Today"]));
    const headers = rows.filter((row) => row.type === "header");
    expect(headers).toHaveLength(1);
  });
});

describe("footerToneColor", () => {
  const C = THEMES["zai-dark"];

  test("the four tones map onto the theme", () => {
    expect(footerToneColor(C, "selection")).toBe(C.accent);
    expect(footerToneColor(C, "running")).toBe(C.accent);
    expect(footerToneColor(C, "error")).toBe(C.error);
    expect(footerToneColor(C, "success")).toBe(C.success);
  });

  test("a missing tone falls back to the muted arm", () => {
    expect(footerToneColor(C, undefined)).toBe(C.subtle);
  });
});

describe("FOOTER_COMPACT_WIDTH", () => {
  test("the reference compact breakpoint ports verbatim", () => {
    expect(FOOTER_COMPACT_WIDTH).toBe(40);
  });
});
