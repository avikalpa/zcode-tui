// Unit checks for the subagent strip (0.6.52): the reference status colors
// and glyphs (footer.subagent.tsx) and the inspector count cell.
import { describe, expect, test } from "bun:test";
import { THEMES } from "./design";
import {
  subagentCountLabel,
  subagentStatusColor,
  subagentStatusIcon,
} from "./subagent-strip";

const C = THEMES["zai-dark"];

describe("subagentStatusColor", () => {
  test("the four tones map onto the theme", () => {
    expect(subagentStatusColor(C, "completed")).toBe(C.success);
    expect(subagentStatusColor(C, "cancelled")).toBe(C.subtle);
    expect(subagentStatusColor(C, "error")).toBe(C.error);
    expect(subagentStatusColor(C, "running")).toBe(C.accent);
  });
});

describe("subagentStatusIcon (verbatim glyphs)", () => {
  test("the four statuses", () => {
    expect(subagentStatusIcon("completed")).toBe("●");
    expect(subagentStatusIcon("cancelled")).toBe("○");
    expect(subagentStatusIcon("error")).toBe("◍");
    expect(subagentStatusIcon("running")).toBe("◔");
  });

  test("mono fallbacks", () => {
    expect(subagentStatusIcon("completed", true)).toBe("*");
    expect(subagentStatusIcon("cancelled", true)).toBe("-");
    expect(subagentStatusIcon("error", true)).toBe("!");
    expect(subagentStatusIcon("running", true)).toBe(".");
  });
});

describe("subagentCountLabel (i of n)", () => {
  test("hidden on the first tab or a single tab", () => {
    expect(subagentCountLabel(0, 3)).toBe("");
    expect(subagentCountLabel(0, 1)).toBe("");
    expect(subagentCountLabel(2, 1)).toBe("");
  });

  test("shown past the first of several", () => {
    expect(subagentCountLabel(1, 3)).toBe("1 of 3");
    expect(subagentCountLabel(2, 2)).toBe("2 of 2");
  });
});
