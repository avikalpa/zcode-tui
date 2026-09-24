// Unit checks for the subagent tab plane (0.6.52): the host
// session/subagents payload mapping (live-probed shape) and the reference
// picker/label semantics the strip renders.
import { describe, expect, test } from "bun:test";
import {
  mapHostSubagents,
  pickerTabs,
  subagentStatusLabel,
  tabIndex,
  type SubagentTab,
} from "./subagents";

const RUNNING_ITEM = {
  childSessionId: "sess_subagent_agent_a",
  agentId: "agent_a",
  toolCallId: "call_a",
  subagentType: "general-purpose",
  title: "Reply with single word ok",
  startedAt: 1790279158774,
  status: "running",
};
const ENDED_ITEM = {
  childSessionId: "sess_subagent_agent_b",
  agentId: "agent_b",
  toolCallId: "call_b",
  subagentType: "general-purpose",
  title: "Second task",
  startedAt: 1790279100000,
  status: "success",
  summary: "ok",
  endedAt: 1790279170011,
};

describe("mapHostSubagents", () => {
  test("empty probe shape maps to no tabs", () => {
    expect(mapHostSubagents({ revision: 3, childSessionIds: [], running: [], ended: { total: 0, items: [] } })).toEqual([]);
  });

  test("non-object payloads map to no tabs", () => {
    expect(mapHostSubagents(undefined)).toEqual([]);
    expect(mapHostSubagents("nope")).toEqual([]);
    expect(mapHostSubagents(null)).toEqual([]);
  });

  test("running items first, ended after, host order kept", () => {
    const tabs = mapHostSubagents({ running: [RUNNING_ITEM], ended: { total: 1, items: [ENDED_ITEM] } });
    expect(tabs.map((t) => t.sessionID)).toEqual(["sess_subagent_agent_a", "sess_subagent_agent_b"]);
    expect(tabs[0].status).toBe("running");
    expect(tabs[1].status).toBe("completed");
  });

  test("success maps to completed and carries summary + type + times", () => {
    const [tab] = mapHostSubagents({ running: [], ended: { total: 1, items: [ENDED_ITEM] } });
    expect(tab).toEqual({
      sessionID: "sess_subagent_agent_b",
      label: "Second task",
      description: "",
      status: "completed",
      summary: "ok",
      subagentType: "general-purpose",
      startedAt: 1790279100000,
      endedAt: 1790279170011,
    });
  });

  test("unmeasured statuses map to error conservatively", () => {
    const tabs = mapHostSubagents({ running: [], ended: { total: 1, items: [{ ...ENDED_ITEM, status: "mystery" }] } });
    expect(tabs[0].status).toBe("error");
  });

  test("cancelled vocabulary maps to cancelled", () => {
    const tabs = mapHostSubagents({ running: [], ended: { total: 1, items: [{ ...ENDED_ITEM, status: "cancelled" }] } });
    expect(tabs[0].status).toBe("cancelled");
  });

  test("missing title falls back to Subagent; items without ids drop", () => {
    const tabs = mapHostSubagents({ running: [{ status: "running" }], ended: { total: 1, items: [{ ...ENDED_ITEM, title: undefined, childSessionId: "sess_c" }] } });
    expect(tabs).toHaveLength(1);
    expect(tabs[0].label).toBe("Subagent");
  });
});

describe("pickerTabs (RunSubagentSelectBody filter)", () => {
  const tabs: SubagentTab[] = [
    { sessionID: "a", label: "A", description: "", status: "running" },
    { sessionID: "b", label: "B", description: "", status: "completed" },
    { sessionID: "c", label: "C", description: "", status: "error" },
  ];

  test("active shows running only", () => {
    expect(pickerTabs(tabs, "active").map((t) => t.sessionID)).toEqual(["a"]);
  });

  test("inactive shows everything not running", () => {
    expect(pickerTabs(tabs, "inactive").map((t) => t.sessionID)).toEqual(["b", "c"]);
  });
});

describe("subagentStatusLabel (reference strings)", () => {
  test("the four statuses", () => {
    expect(subagentStatusLabel("completed")).toBe("done");
    expect(subagentStatusLabel("cancelled")).toBe("cancelled");
    expect(subagentStatusLabel("error")).toBe("error");
    expect(subagentStatusLabel("running")).toBe("running");
  });
});

describe("tabIndex (cycle math)", () => {
  test("finds the tab or -1", () => {
    const tabs = [{ sessionID: "a" }, { sessionID: "b" }] as SubagentTab[];
    expect(tabIndex(tabs, "b")).toBe(1);
    expect(tabIndex(tabs, "zzz")).toBe(-1);
  });
});
