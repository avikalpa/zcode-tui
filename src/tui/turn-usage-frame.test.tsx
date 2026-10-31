// Turn-usage frame tests: the extraction of info.tokens/usageModel
// (partsToTurns), the debug-gated App row after a resumed turn's terminal
// step, and the expanded-table treatment (reference TurnTokenUsage,
// routes/session/index.tsx 1484-1628). Char frames do not establish live
// pixels.
import { describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppServer } from "../protocol/client";
import { App, partsToTurns } from "./app";
import { TurnUsageRow, type TurnUsage } from "./turn-usage";
import { createModelPreferenceRepository } from "./session/model-preference";
import { THEMES } from "./design";

describe("info.tokens extraction", () => {
  test("partsToTurns carries the token counts and the usage model identity", () => {
    const [turn] = partsToTurns({
      info: {
        id: "a1",
        role: "assistant",
        model: { providerId: "zai", modelId: "GLM-5.3-Flash" },
        finish: "end_turn",
        time: { created: 1000, completed: 2000 },
        tokens: { input: 10, output: 2, reasoning: 1, cache: { read: 7, write: 3 } },
      },
      parts: [],
    });
    expect(turn.tokens).toEqual({ input: 10, output: 2, reasoning: 1, cache: { read: 7, write: 3 } });
    expect(turn.usageModel).toEqual({ providerId: "zai", modelId: "GLM-5.3-Flash" });
  });

  test("a malformed tokens object never NaNs the sums", () => {
    const [turn] = partsToTurns({
      info: { role: "assistant", tokens: { input: "x", cache: null } },
      parts: [],
    });
    expect(turn.tokens).toEqual({ input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } });
  });

  test("absent tokens and a reference-voice model stay undefined-shaped", () => {
    const [turn] = partsToTurns({
      info: { role: "assistant", model: { providerID: "zai", id: "GLM-5.3-Flash", variant: "high" } },
      parts: [],
    });
    expect(turn.tokens).toBeUndefined();
    expect(turn.usageModel).toEqual({ providerId: "zai", modelId: "GLM-5.3-Flash", variant: "high" });
  });
});

// Token-bearing steps in the shape the sitting-10 dump verified.
function tokenMultiStepMessages() {
  return [
    { info: { id: "u1", role: "user", time: { created: 1000 } }, parts: [{ type: "text", text: "run the fixture" }] },
    {
      info: {
        id: "a1",
        role: "assistant",
        model: { providerId: "zai", modelId: "GLM-5.3-Flash" },
        finish: "tool-calls",
        time: { created: 2000, completed: 5000 },
        tokens: { input: 300, output: 20, reasoning: 0, cache: { read: 200, write: 0 } },
      },
      parts: [{ type: "text", text: "step one" }],
    },
    {
      info: {
        id: "a2",
        role: "assistant",
        model: { providerId: "zai", modelId: "GLM-5.3-Flash" },
        finish: "end_turn",
        time: { created: 5000, completed: 8000 },
        tokens: { input: 100, output: 40, reasoning: 0, cache: { read: 500, write: 0 } },
      },
      parts: [{ type: "text", text: "step two" }],
    },
  ];
}

async function sessionWith(messages: unknown[], seed: Record<string, unknown> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "zc-usage-"));
  writeFileSync(join(dir, "state.json"), JSON.stringify(seed));
  const preferences = createModelPreferenceRepository(join(dir, "state.json"));
  let push = (_event: Record<string, unknown>) => {};
  const client = {
    request: async (method: string) => {
      if (method === "session/list") return { sessions: [] };
      if (method === "session/resume") return { session: { status: "idle" }, messages };
      return {};
    },
    onPush: (fn: typeof push) => { push = fn; },
    onAsk: () => {},
    onBackendLost: () => {},
  } as unknown as AppServer;
  const setup = await testRender(
    <App client={client} preferences={preferences} resumeId="fixture-usage" onQuit={() => {}} />,
    { width: 100, height: 30 },
  );
  await setup.waitForFrame((f) => f.includes("run the fixture"));
  return { ...setup, cleanup: () => { setup.renderer.destroy(); rmSync(dir, { recursive: true, force: true }); } };
}

describe("resumed turn-usage row (debug gate)", () => {
  test("gate on: the summary line renders after the terminal step with the turn sums", async () => {
    const s = await sessionWith(tokenMultiStepMessages(), { turnTokens: true });
    try {
      const frame = await s.waitForFrame((f) => f.includes("Tokens:"));
      // one turn, two steps: new = (320-200) + (140) … totals from the fixture
      const line = frame.split("\n").find((l) => l.includes("+ Tokens"));
      expect(line).toBeDefined();
      expect(line).toContain("Tokens: 2 steps · 460 new · 700 cached · 1,160 total");
      // collapsed by default — no per-step table
      expect(frame).not.toContain("Cached  Total");
    } finally {
      s.cleanup();
    }
  });

  test("gate off: no usage row renders", async () => {
    const s = await sessionWith(tokenMultiStepMessages());
    try {
      const frame = await s.waitForFrame((f) => f.includes("step two"));
      expect(frame).not.toContain("Tokens:");
    } finally {
      s.cleanup();
    }
  });

  test("click expands the per-step table", async () => {
    const s = await sessionWith(tokenMultiStepMessages(), { turnTokens: true });
    try {
      let frame = await s.waitForFrame((f) => f.includes("+ Tokens"));
      const lines = frame.split("\n");
      const y = lines.findIndex((l) => l.includes("+ Tokens"));
      await s.mockMouse.click(lines[y]!.indexOf("+ Tokens") + 1, y);
      frame = await s.waitForFrame((f) => f.includes("Cached  Total"));
      // finish labels padded two past the Step column ("tool-call" is widest)
      expect(frame).toContain("tool-call");
      expect(frame).toContain("end_turn");
      // the toggle marker flipped
      expect(frame).toContain("- Tokens");
    } finally {
      s.cleanup();
    }
  });
});

describe("expanded-table treatment (component frames)", () => {
  const usage: TurnUsage = {
    steps: [
      { finish: "tool-call", tools: [{ name: "Bash", input: { command: "ls -la", timeout: 5 } }], newTokens: 120, cached: 200, total: 320, reuseDrop: undefined },
      { finish: "end_turn", tools: [], newTokens: 460, cached: 300, total: 760, reuseDrop: 200 },
    ],
    count: 2,
    newTokens: 580,
    cached: 500,
    total: 1_080,
    reuseDrops: 1,
  };

  test("header floor, per-step rows, bold new counts, bust warning, verbose tools", async () => {
    const setup = await testRender(
      <box style={{ width: 100, height: 14, flexDirection: "column" }}>
        <TurnUsageRow usage={usage} C={Object.values(THEMES)[0]!} verbose={true} />
      </box>,
      { width: 100, height: 14 },
    );
    try {
      let frame = await setup.waitForFrame((f) => f.includes("+ Tokens"));
      expect(frame).toContain("+ Tokens: 2 steps · 580 new · 500 cached · 1,080 total");
      // the cache-bust suffix rides the summary line
      expect(frame).toContain("! 1 likely cache bust");
      const lines = frame.split("\n");
      const y = lines.findIndex((l) => l.includes("+ Tokens"));
      await setup.mockMouse.click(lines[y]!.indexOf("+ Tokens") + 1, y);
      frame = await setup.waitForFrame((f) => f.includes("Cached  Total"));
      const rows = frame.split("\n");
      // header row: Step padded past the widest label, right-aligned columns
      const header = rows.find((l) => l.includes("Step"));
      expect(header).toContain("Step       New  Cached  Total");
      // step rows: finish label, bold new count, two-space gutters
      const step1 = rows.find((l) => l.includes("tool-call"));
      expect(step1).toContain("tool-call  120     200    320");
      const step2 = rows.find((l) => l.includes("end_turn"));
      expect(step2).toContain("end_turn   460     300    760");
      // verbose: the tool name and its primary-key summary under the step
      const tool = rows.find((l) => l.includes("Bash"));
      expect(tool).toContain("ls -la  timeout: 5");
      // the busting step's warning line
      const bust = rows.find((l) => l.includes("Likely cache bust"));
      expect(bust).toContain("! Likely cache bust: 200 fewer cached tokens than the previous step");
    } finally {
      setup.renderer.destroy();
    }
  });

  test("non-verbose expansion withholds the tool rows", async () => {
    const setup = await testRender(
      <box style={{ width: 100, height: 10, flexDirection: "column" }}>
        <TurnUsageRow usage={usage} C={Object.values(THEMES)[0]!} verbose={false} />
      </box>,
      { width: 100, height: 10 },
    );
    try {
      let frame = await setup.waitForFrame((f) => f.includes("+ Tokens"));
      const lines = frame.split("\n");
      const y = lines.findIndex((l) => l.includes("+ Tokens"));
      await setup.mockMouse.click(lines[y]!.indexOf("+ Tokens") + 1, y);
      frame = await setup.waitForFrame((f) => f.includes("Cached  Total"));
      expect(frame).not.toContain("Bash");
    } finally {
      setup.renderer.destroy();
    }
  });
});
