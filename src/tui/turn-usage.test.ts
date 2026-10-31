// Turn-usage law tests (opencode v2ref b084acc55e, routes/session/rows.ts
// turn-usage flush + cacheReuseDrop + hasTokenUsage/tokenTotal, and
// routes/session/index.tsx turnTokenToolSummary/columns).
import { describe, expect, test } from "bun:test";
import {
  cacheReuseDrop,
  hasTokenUsage,
  tokenTotal,
  turnTokenToolSummary,
  turnUsageColumns,
  turnUsageRows,
  type TurnTokens,
  type UsageModel,
} from "./turn-usage";
import type { TurnMessage } from "./app";

const tokens = (over: Partial<TurnTokens> = {}): TurnTokens => ({
  input: 100,
  output: 20,
  reasoning: 5,
  cache: { read: 200, write: 10 },
  ...over,
});

describe("token totals (rows.ts hasTokenUsage/tokenTotal)", () => {
  test("tokenTotal sums all five fields", () => {
    expect(tokenTotal(tokens())).toBe(335);
  });

  test("hasTokenUsage drops absent and all-zero steps", () => {
    expect(hasTokenUsage({})).toBe(false);
    expect(hasTokenUsage({ tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } })).toBe(false);
    expect(hasTokenUsage({ tokens: tokens() })).toBe(true);
  });
});

describe("cacheReuseDrop (rows.ts cacheReuseDrop)", () => {
  const model: UsageModel = { providerId: "zai", modelId: "GLM-5.3-Flash" };
  const usage = (read: number, model_: UsageModel = model) => ({ read, model: model_ });

  test("no baseline, no drop", () => {
    expect(cacheReuseDrop(undefined, usage(500))).toBeUndefined();
  });

  test("a positive drop on the same model reports", () => {
    expect(cacheReuseDrop(usage(1_000), usage(800))).toBe(200);
  });

  test("a grown or equal cache never reads as a bust", () => {
    expect(cacheReuseDrop(usage(800), usage(1_000))).toBeUndefined();
    expect(cacheReuseDrop(usage(800), usage(800))).toBeUndefined();
  });

  test("a model switch resets the baseline", () => {
    expect(cacheReuseDrop(usage(1_000), usage(800, { providerId: "openai", modelId: "gpt" }))).toBeUndefined();
    expect(cacheReuseDrop(usage(1_000), usage(800, { providerId: "zai", modelId: "other" }))).toBeUndefined();
  });

  test("a variant switch resets the baseline", () => {
    expect(cacheReuseDrop(usage(1_000, { ...model, variant: "high" }), usage(800, { ...model, variant: "low" }))).toBeUndefined();
  });

  test("openai cache reads within one-two 1,024-token buckets never bust", () => {
    const openai = { providerId: "openai", modelId: "gpt" };
    // one and two bucket drops are the lawful drift
    expect(cacheReuseDrop(usage(4_096, openai), usage(3_072, openai))).toBeUndefined();
    expect(cacheReuseDrop(usage(4_096, openai), usage(2_048, openai))).toBeUndefined();
    // a three-bucket drop is outside the lawful drift and reports
    expect(cacheReuseDrop(usage(4_096, openai), usage(1_024, openai))).toBe(3_072);
    expect(cacheReuseDrop(usage(4_096, openai), usage(1_000, openai))).toBe(3_096);
  });
});

// The multi-step shape the live backend showed (sitting-10 dump):
// per-step assistant messages, tool-calls on the middle step, end_turn last.
function step(finish: string | undefined, tokens_: TurnTokens | undefined, id: string, extra: Partial<TurnMessage> = {}): TurnMessage {
  return {
    role: "assistant",
    text: `step ${id}`,
    messageId: id,
    finish,
    tokens: tokens_,
    usageModel: { providerId: "zai", modelId: "GLM-5.3-Flash" },
    ...extra,
  };
}

describe("turnUsageRows (rows.ts legacy flush law)", () => {
  test("a multi-step turn flushes ONE row keyed by the terminal message id", () => {
    const rows = turnUsageRows([
      { role: "user", text: "go", messageId: "u1" },
      step("tool-calls", tokens({ input: 300, cache: { read: 200, write: 0 } }), "a1"),
      step("end_turn", tokens({ input: 100, output: 40, cache: { read: 500, write: 0 } }), "a2"),
    ]);
    expect([...rows.keys()]).toEqual(["a2"]);
    const usage = rows.get("a2")!;
    expect(usage.count).toBe(2);
    expect(usage.steps.map((s) => s.finish)).toEqual(["tool-call", "end_turn"]);
    // new = total - cached, per step: step totals 525 and 645
    expect(usage.steps[0]!.newTokens).toBe(300 + 20 + 5 + 0);
    expect(usage.steps[1]!.newTokens).toBe(100 + 40 + 5 + 0);
    expect(usage.cached).toBe(200 + 500);
    expect(usage.total).toBe(525 + 645);
  });

  test("all-zero token steps filter out; a turn with none flushes nothing", () => {
    const rows = turnUsageRows([
      step("end_turn", { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, "a1"),
      step("end_turn", tokens(), "a2"),
    ]);
    // a1 carries no usage, a2 is its own turn's terminal flush
    expect([...rows.keys()]).toEqual(["a2"]);
    expect(rows.get("a2")!.count).toBe(1);
  });

  test("steps accumulate until the terminal step — a live tail flushes nothing", () => {
    const rows = turnUsageRows([
      { role: "user", text: "go", messageId: "u1" },
      step("tool-calls", tokens(), "a1"),
      step(undefined, tokens(), "a2"),
    ]);
    expect(rows.size).toBe(0);
  });

  test("an errored step is terminal and flushes (rows.ts terminal law)", () => {
    const rows = turnUsageRows([step(undefined, tokens(), "a1", { error: "boom" })]);
    expect([...rows.keys()]).toEqual(["a1"]);
  });

  test("the cache baseline persists across turns: a same-model drop busts", () => {
    const rows = turnUsageRows([
      step("end_turn", tokens({ cache: { read: 1_000, write: 0 } }), "a1"),
      step("end_turn", tokens({ cache: { read: 800, write: 0 } }), "a2"),
    ]);
    expect(rows.get("a1")!.reuseDrops).toBe(0);
    expect(rows.get("a2")!.steps[0]!.reuseDrop).toBe(200);
  });

  test("a zero-token turn leaves the baseline untouched (flushTurn early return)", () => {
    const rows = turnUsageRows([
      step("end_turn", tokens({ cache: { read: 1_000, write: 0 } }), "a1"),
      step("end_turn", { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, "a2"),
      step("end_turn", tokens({ cache: { read: 900, write: 0 } }), "a3"),
    ]);
    // a2 flushed nothing, so a3 busts against a1's 1,000 — not against zero.
    expect(rows.get("a3")!.steps[0]!.reuseDrop).toBe(100);
  });

  test("tool rows attach to the nearest open assistant step", () => {
    const rows = turnUsageRows([
      step("tool-calls", tokens(), "a1"),
      { role: "tool", text: "cmd", toolName: "Bash", toolCallId: "t1", toolInput: { command: "ls" } } as TurnMessage,
      step("end_turn", tokens(), "a2"),
      { role: "tool", text: "read", toolName: "Read", toolCallId: "t2", toolInput: { path: "/x" } } as TurnMessage,
    ]);
    // a2's trailing tool row anchors the row; both steps ride it
    const usage = rows.get("t2")!;
    expect(usage.steps[0]!.tools.map((t) => t.name)).toEqual(["Bash"]);
    expect(usage.steps[1]!.tools.map((t) => t.name)).toEqual(["Read"]);
  });

  test("a terminal step without an id flushes nothing (rows key on message ids)", () => {
    const rows = turnUsageRows([step("end_turn", tokens(), "")]);
    expect(rows.size).toBe(0);
  });
});

describe("table columns and tool summaries (TurnTokenUsage helpers)", () => {
  test("columns take the header floors, widest cell wins", () => {
    const columns = turnUsageColumns([
      { finish: "tool-call", tools: [], newTokens: 12_345, cached: 678, total: 12_999, reuseDrop: undefined },
      { finish: "end_turn", tools: [], newTokens: 5, cached: 1_234_567, total: 1_234_600, reuseDrop: undefined },
    ]);
    expect(columns.step).toBe("tool-call".length);
    expect(columns.newTokens).toBe("12,345".length);
    expect(columns.cached).toBe("1,234,567".length);
    expect(columns.total).toBe("1,234,600".length);
  });

  test("turnTokenToolSummary: string input, primary key first, scalars in entry order", () => {
    expect(turnTokenToolSummary({ name: "Bash", input: "ls -la" })).toBe("ls -la");
    expect(
      turnTokenToolSummary({ name: "Bash", input: { command: "ls", timeout: 5, nested: { deep: true }, flag: true } }),
    ).toBe("ls  timeout: 5  flag: true");
    expect(turnTokenToolSummary({ name: "Read", input: { path: "/x", limit: 10 } })).toBe("/x  limit: 10");
    expect(turnTokenToolSummary({ name: "Read", input: undefined })).toBe("");
  });

  test("a terminal step's trailing tool rows anchor the row and ride the step", () => {
    const rows = turnUsageRows([
      step("end_turn", tokens({ cache: { read: 1_000, write: 0 } }), "a1"),
      { role: "tool", text: "read", toolName: "Read", toolCallId: "t9", toolInput: { path: "/x" } } as TurnMessage,
    ]);
    expect([...rows.keys()]).toEqual(["t9"]);
    expect(rows.get("t9")!.steps[0]!.tools.map((t) => t.name)).toEqual(["Read"]);
  });
});
