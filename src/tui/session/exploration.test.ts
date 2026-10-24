import { describe, expect, test } from "bun:test";
import {
  explorationLabel,
  groupExplorationRows,
  isExplorationTool,
  type ExplorationTool,
} from "./exploration";

// Reference grammar (pinned v2ref): routes/session/index.tsx SessionGroupView
// — "Explored/Exploring — " + counts where grep/glob fold into "search" and
// plurals are `1 read` / `2 reads` / `1 search` / `2 searches`, joined ", "
// in first-seen order. Grouping merges only ADJACENT parts (grouping/tree.ts
// appendEntry merges into the previous node only when it is a group of the
// same kind), and only read/glob/grep qualify (grouping/session.ts partPath).

describe("exploration label", () => {
  test("counts fold grep/glob into search with reference plurals", () => {
    expect(explorationLabel(["Read", "Read", "Grep"], true)).toBe("Explored — 2 reads, 1 search");
    expect(explorationLabel(["Read"], true)).toBe("Explored — 1 read");
    expect(explorationLabel(["Glob", "Grep"], false)).toBe("Exploring — 2 searches");
    expect(explorationLabel(["glob", "glob", "glob", "read"], true)).toBe(
      "Explored — 3 searches, 1 read",
    );
  });

  test("accumulates counts over the whole group, first-seen name order", () => {
    // The reference reduce() counts every part in the group — the interleaved
    // Grep parts both land in "search" — while Object.entries keeps the order
    // each NAME was first seen.
    expect(explorationLabel(["Grep", "Read", "Read", "Grep"], true)).toBe(
      "Explored — 2 searches, 2 reads",
    );
    expect(explorationLabel(["Grep", "Read"], true)).toBe("Explored — 1 search, 1 read");
  });
});

describe("isExplorationTool", () => {
  test("accepts read/glob/grep in any case and rejects the rest", () => {
    expect(isExplorationTool("Read")).toBe(true);
    expect(isExplorationTool("GLOB")).toBe(true);
    expect(isExplorationTool("grep")).toBe(true);
    expect(isExplorationTool("Bash")).toBe(false);
    expect(isExplorationTool("Write")).toBe(false);
    expect(isExplorationTool(undefined)).toBe(false);
  });
});

describe("groupExplorationRows", () => {
  const tool = (name: string, over: Partial<ExplorationTool> = {}): ExplorationTool => ({
    role: "tool",
    toolName: name,
    toolStatus: "completed",
    ...over,
  });

  test("coalesces a consecutive run into one settled row", () => {
    const rows = groupExplorationRows([
      tool("Read"),
      tool("Grep", { toolStatus: undefined, toolOk: undefined }),
      tool("Read"),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("exploration");
    if (rows[0].kind !== "exploration") return;
    expect(rows[0].tools).toHaveLength(3);
    expect(rows[0].completed).toBe(false);
    expect(rows[0].label).toBe("Exploring — 2 reads, 1 search");
  });

  test("a non-tool row breaks the run into two groups", () => {
    const rows = groupExplorationRows([
      tool("Read"),
      { role: "assistant", text: "mid reply" } as unknown as ExplorationTool,
      tool("Grep"),
    ]);
    expect(rows.map((r) => r.kind)).toEqual(["exploration", "message", "exploration"]);
    expect(explorationLabel.length > 0).toBe(true);
    if (rows[0].kind !== "exploration" || rows[2].kind !== "exploration") return;
    expect(rows[0].label).toBe("Explored — 1 read");
    expect(rows[2].label).toBe("Explored — 1 search");
  });

  test("non-exploration tools and transcript rows pass through untouched", () => {
    const rows = groupExplorationRows([
      tool("Write"),
      tool("Write"),
      { role: "user", text: "hi" } as unknown as ExplorationTool,
    ]);
    expect(rows.map((r) => r.kind)).toEqual(["message", "message", "message"]);
  });

  test("a failed tool still settles the group", () => {
    const rows = groupExplorationRows([tool("Read", { toolStatus: "error", toolOk: false })]);
    if (rows[0].kind !== "exploration") throw new Error("expected group");
    expect(rows[0].completed).toBe(true);
  });
});
