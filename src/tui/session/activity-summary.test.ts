// Re-derived contract for opencode v2.0.18 #51131 (their 293-line
// session-verbosity test is not vendored — the reference strips tests) on our
// NormMessage / NormPart shapes: the level matrices in grouping/session.ts and
// the activitySummary counting rules in activity-summary.ts.
import { expect, test } from "bun:test";
import {
  activitySummary,
  busyLabel,
  summarizeActivity,
  type Item,
} from "./activity-summary";
import {
  defaultVerbosity,
  instructionPaths,
  messagePath,
  partPath,
  projectEntries,
  type ProjectionEntry,
} from "./grouping/session";
import type { NormMessage, NormPart } from "./rows";

let seq = 0;
function assistantMessage(parts: NormPart[], completed = true): NormMessage {
  seq += 1;
  return {
    type: "assistant",
    id: `a${seq}`,
    text: "",
    time: { created: 1000, completed: completed ? 2000 : undefined },
    content: parts,
  };
}

type ToolPart = Extract<NormPart, { type: "tool" }>;
type ThoughtPart = Extract<NormPart, { type: "reasoning" }>;

function item(part: Item["part"], completed = true): Item {
  return { message: assistantMessage([part], completed), part };
}

function toolPart(name: string, status = "completed", metadata?: Record<string, unknown>): ToolPart {
  return { type: "tool", id: `t-${name}-${Math.random()}`, name, state: { status, input: {}, metadata } };
}

function thoughtPart(text: string, completed = true): ThoughtPart {
  return { type: "reasoning", text, time: completed ? { completed: 1500 } : {} };
}

test("partPath: low wraps every non-text part in an activity group; medium and high do not", () => {
  expect(partPath({ type: "tool", name: "Bash" }, "low")).toEqual(["activity"]);
  expect(partPath({ type: "reasoning" }, "low")).toEqual(["activity", "reasoning"]);
  expect(partPath({ type: "text" }, "low")).toEqual([]);
  expect(partPath({ type: "tool", name: "Bash" }, "medium")).toEqual([]);
  expect(partPath({ type: "tool", name: "Bash" }, "high")).toEqual([]);
  expect(partPath({ type: "tool", name: "Bash" })).toEqual(partPath({ type: "tool", name: "Bash" }, defaultVerbosity));
});

test("partPath: questions stand alone; exploration tools group at every level, case-insensitively", () => {
  for (const level of ["low", "medium", "high"] as const) {
    expect(partPath({ type: "tool", name: "question" }, level)).toEqual([]);
    expect(partPath({ type: "tool", name: "Read" }, level)).toEqual(level === "low" ? ["activity", "exploration"] : ["exploration"]);
    expect(partPath({ type: "tool", name: "WebFetch" }, level)).toEqual(level === "low" ? ["activity", "exploration"] : ["exploration"]);
    expect(partPath({ type: "tool", name: "WebSearch" }, level)).toEqual(level === "low" ? ["activity", "exploration"] : ["exploration"]);
  }
});

test("instructionPaths reads synthetic meta only; messagePath routes loads at every level", () => {
  const load: NormMessage = {
    type: "synthetic",
    id: "s1",
    text: "",
    time: { created: 1 },
    content: [],
    meta: { instruction: { paths: ["/a.md", "/b.md", 3] } } as NormMessage["meta"],
  };
  expect(instructionPaths(load)).toEqual(["/a.md", "/b.md"]);
  expect(instructionPaths({ ...load, type: "user" })).toEqual([]);
  expect(instructionPaths(undefined)).toEqual([]);
  expect(messagePath(load, "low")).toEqual(["activity", "instructions"]);
  expect(messagePath(load, "medium")).toEqual(["instructions"]);
  expect(messagePath(load, "high")).toEqual(["instructions"]);
  const plain = assistantMessage([]);
  expect(messagePath({ ...plain, type: "user" }, "low")).toEqual([]);
});

test("activitySummary counts finished work with upstream's noun order and pluralization", () => {
  const items: Item[] = [
    item(toolPart("Bash")),
    item(toolPart("Bash")),
    item(toolPart("Edit")),
    item(toolPart("Write")),
    item(thoughtPart("step one")),
    item(toolPart("Read")),
    item(toolPart("Read")),
    item(toolPart("Read")),
    item(toolPart("Grep")),
  ];
  expect(activitySummary(items, 2).label).toBe("2 commands, 2 edits, 1 thought, 3 reads, 1 tool, 2 instructions");
});

test("activitySummary: running items are active and excluded from the label; closed finishes them", () => {
  const running = [item(toolPart("Bash", "running"), true), item(thoughtPart("drafting", false), false)];
  const open = activitySummary(running, 0);
  expect(open.active).toBe(true);
  expect(open.label).toBe("");
  const closed = activitySummary(running, 0, true);
  // Upstream: tool activity ignores `closed` — the running command stays active.
  expect(closed.active).toBe(true);
  expect(closed.label).toBe("1 thought");
});

test("busyLabel: stable per running item, independent of details", () => {
  expect(busyLabel({ type: "reasoning", text: "" })).toBe("Thinking…");
  expect(busyLabel(toolPart("Bash", "running"))).toBe("Running command…");
  expect(busyLabel(toolPart("Task", "running"))).toBe("Running subagent…");
  expect(busyLabel(toolPart("Glob", "streaming"))).toBe("Preparing glob…");
});

test("activitySummary: redacted-only reasoning is not a visible thought", () => {
  const items = [item({ type: "reasoning", text: "   ", time: { completed: 1500 } })];
  expect(activitySummary(items, 0).label).toBe("");
});

test("activitySummary: execute counts finished nested calls, or itself when none finished", () => {
  const nested = { toolCalls: [{ tool: "read", status: "completed" }, { tool: "bash", status: "error" }] };
  const code = [item(toolPart("execute", "completed", nested))];
  expect(activitySummary(code, 0).label).toBe("1 read, 1 tool");
  expect(activitySummary(code, 0).failed).toBe(true);
  const bare = [item(toolPart("execute", "completed"))];
  expect(activitySummary(bare, 0).label).toBe("1 tool");
  expect(activitySummary(bare, 0).failed).toBe(false);
});

test("activitySummary: direct tool errors fail the group", () => {
  expect(activitySummary([item(toolPart("Edit", "error"))], 0).failed).toBe(true);
  expect(activitySummary([item(toolPart("Edit"))], 0).failed).toBe(false);
});

test("summarizeActivity walks the subtree, skips pending refs, and falls back to the busy label", () => {
  const first = toolPart("Read", "running");
  const second = toolPart("Bash", "running");
  const msg = assistantMessage([first, second], false);
  const path = (name: string) => partPath({ type: "tool", name }, "low");
  const rows = projectEntries([
    { entry: { type: "part", ref: { messageID: msg.id, partID: first.id } }, part: { type: "tool", name: "Read" }, path: path("Read") },
    { entry: { type: "part", ref: { messageID: msg.id, partID: second.id } }, part: { type: "tool", name: "Bash" }, path: path("Bash") },
  ]);
  const group = rows[0];
  expect(group.type).toBe("group");
  if (group.type !== "group") return;
  const message = (id: string) => (id === msg.id ? msg : undefined);
  // Pending refs are left out of the summary entirely.
  const pendingRefs = [first, second].map((part) => ({ messageID: msg.id, partID: part.id }));
  const allPending = summarizeActivity(group, message, pendingRefs, false);
  expect(allPending.label).toBe("");
  expect(allPending.active).toBe(false);
  // While nothing has finished, the label is the first running item's status.
  const live = summarizeActivity(group, message, [], false);
  expect(live.label).toBe("Running read…");
  expect(live.active).toBe(true);
});

test("projectEntries: low nests exploration under one activity group; medium matches the old shape", () => {
  const mk = (over: Partial<ProjectionEntry>): ProjectionEntry => ({
    entry: { type: "part", ref: { messageID: "m1", partID: `p${Math.random()}` } },
    part: { type: "tool", name: "Read" },
    ...over,
  });
  const low = projectEntries([
    mk({ part: { type: "reasoning" }, path: partPath({ type: "reasoning" }, "low") }),
    mk({ path: partPath({ type: "tool", name: "Read" }, "low") }),
    mk({ path: partPath({ type: "tool", name: "WebFetch" }, "low") }),
  ]);
  expect(low).toHaveLength(1);
  expect(low[0]).toMatchObject({ type: "group", kind: "activity" });
  const medium = projectEntries([
    mk({ part: { type: "reasoning" }, path: partPath({ type: "reasoning" }, "medium") }),
    mk({ path: partPath({ type: "tool", name: "Read" }, "medium") }),
  ]);
  expect(medium.map((row) => (row.type === "group" ? row.kind : row.type))).toEqual(["reasoning", "exploration"]);
});
