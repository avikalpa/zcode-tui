// Unit checks for the composer tab overlay (0.6.73): the entry shaping
// (agent titlecase + the "@agent subagent" strip), the running/inactive
// predicate shared with the retired picker, the hints grammar, the row
// label, and the 5-row window math.
import { describe, expect, test } from "bun:test";
import {
  COMPOSER_OVERLAY_ROWS,
  COMPOSER_TABS,
  composerHints,
  composerRowLabel,
  composerSubagentEntries,
  splitAgentTitle,
  titlecaseAgent,
  windowStart,
} from "./composer-tabs";
import type { SubagentTab } from "./session/subagents";

function tab(over: Partial<SubagentTab>): SubagentTab {
  return {
    sessionID: "sess_child",
    label: "Reply with the word ok",
    description: "",
    status: "running",
    ...over,
  };
}

describe("titlecaseAgent", () => {
  test("upcases every word initial (Locale.titlecase verbatim)", () => {
    expect(titlecaseAgent("general-purpose")).toBe("General-Purpose");
    expect(titlecaseAgent("explore")).toBe("Explore");
  });
});

describe("splitAgentTitle", () => {
  test("strips an @agent subagent prefix and titlecases the agent", () => {
    expect(splitAgentTitle("@explore subagent find the door")).toEqual({
      agent: "Explore",
      title: "find the door",
    });
  });
  test("keeps the whole label when no prefix matches", () => {
    expect(splitAgentTitle("plain title")).toEqual({ agent: "", title: "plain title" });
  });
  test("falls back to the whole label when the prefix is everything", () => {
    expect(splitAgentTitle("@explore subagent")).toEqual({ agent: "Explore", title: "@explore subagent" });
  });
});

describe("composerSubagentEntries", () => {
  const tabs = [
    tab({ sessionID: "sess_a", label: "Reply with the word ok", subagentType: "general-purpose", status: "running" }),
    tab({ sessionID: "sess_b", label: "Second task", subagentType: "explore", status: "completed" }),
    tab({ sessionID: "sess_c", label: "@explore subagent sweep", status: "error" }),
  ];

  test("active filter = running only, agent from subagentType titlecased", () => {
    expect(composerSubagentEntries(tabs, "active")).toEqual([
      { sessionID: "sess_a", agent: "General-Purpose", title: "Reply with the word ok", running: true, current: false },
    ]);
  });

  test("inactive filter = everything else, ended rows not running", () => {
    const rows = composerSubagentEntries(tabs, "inactive");
    expect(rows.map((r) => r.sessionID)).toEqual(["sess_b", "sess_c"]);
    expect(rows.every((r) => !r.running)).toBe(true);
  });

  test("an @agent prefix titlecases when subagentType is missing", () => {
    expect(composerSubagentEntries(tabs, "inactive")[1]).toEqual({
      sessionID: "sess_c",
      agent: "Explore",
      title: "sweep",
      running: false,
      current: false,
    });
  });

  test("current marks the row matching the viewed session", () => {
    expect(composerSubagentEntries(tabs, "active", "sess_a")[0].current).toBe(true);
    expect(composerSubagentEntries(tabs, "active", "sess_other")[0].current).toBe(false);
  });

  test("an empty active list maps to no rows (the empty paint)", () => {
    expect(composerSubagentEntries([tab({ status: "completed" })], "active")).toEqual([]);
  });
});

describe("composerHints", () => {
  test("shows the toggle hint; the interrupt hint stays host-blocked", () => {
    const hints = composerHints(
      [{ sessionID: "s", agent: "A", title: "t", running: true, current: false }],
      0,
      "active",
    );
    expect(hints).toEqual([{ label: "show inactive", shortcut: "ctrl+a" }]);
  });
  test("the label flips with the filter", () => {
    expect(composerHints([], 0, "inactive")).toEqual([{ label: "show active", shortcut: "ctrl+a" }]);
  });
});

describe("composerRowLabel", () => {
  test("is Agent: title", () => {
    expect(composerRowLabel({ sessionID: "s", agent: "Explore", title: "the door", running: false, current: false })).toBe(
      "Explore: the door",
    );
  });
});

describe("windowStart", () => {
  test("short lists pin to the top", () => {
    expect(windowStart(3, 4)).toBe(0);
  });
  test("the window follows the selection past the limit", () => {
    expect(windowStart(0, 8)).toBe(0);
    expect(windowStart(4, 8)).toBe(0);
    expect(windowStart(5, 8)).toBe(1);
    expect(windowStart(7, 8)).toBe(3);
  });
  test("the limit is the reference scrollbox maxHeight of 5", () => {
    expect(COMPOSER_OVERLAY_ROWS).toBe(5);
    expect(windowStart(5, 8, COMPOSER_OVERLAY_ROWS)).toBe(1);
  });
});

describe("COMPOSER_TABS", () => {
  test("registers the subagents and shell tabs in reference order", () => {
    expect(COMPOSER_TABS.map((t) => t.id)).toEqual(["subagents", "shell"]);
    expect(COMPOSER_TABS.map((t) => t.label)).toEqual(["Subagents", "Shell"]);
  });
});
