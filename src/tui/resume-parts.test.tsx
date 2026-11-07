import { describe, expect, test } from "bun:test";
import { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppServer } from "../protocol/client";
import { App, partsToTurns, type TurnMessage } from "./app";
import { groupExplorationRows } from "./session/exploration";
import { turnUsageRows } from "./turn-usage";
import { createModelPreferenceRepository } from "./session/model-preference";

// rows.ts part projection (routes/session/rows.ts reduce + index.tsx part
// rows): a resumed message renders one row per part IN PART ORDER —
// reasoning, tools (grouped), text — with the assistant-footer entry last,
// and the footer model reads the catalog name or the `providerId/modelId`
// fallback (AssistantFooter model memo). The inherited build collapsed all
// parts into one turn and emitted tool rows after it, so a resumed session
// showed tools below the reply and lost the provider half of the model.
const REASONING = {
  type: "reasoning",
  text: "The redirect handler drops the query string after login.",
  time: { created: 1001, completed: 1600 },
};
const READ_PART = {
  type: "tool",
  tool: "read",
  callID: "part_t1",
  state: { status: "completed", input: { path: "src/auth.ts" }, metadata: { loaded: ["src/auth.ts"] } },
};
const GLOB_PART = {
  type: "tool",
  tool: "glob",
  callID: "part_t2",
  state: { status: "completed", input: { pattern: "src/**/*.ts" }, metadata: { count: 2 } },
};
const REPLY = "The bug is in `handleLogin`. It drops `location.search`.";
const ASSISTANT_INFO = {
  id: "msg_a1",
  role: "assistant",
  agent: "build",
  model: { providerId: "demo", modelId: "demo-model" },
  time: { created: 1001, completed: 2500 },
  finish: "stop",
};

describe("partsToTurns resume part projection", () => {
  test("rows follow part order: reasoning, tools, text; identity rides the last segment", () => {
    const turns = partsToTurns({
      info: ASSISTANT_INFO,
      parts: [REASONING, READ_PART, GLOB_PART, { type: "text", text: REPLY }],
    });
    expect(turns.map((t) => t.role)).toEqual(["assistant", "tool", "tool", "assistant"]);
    expect(turns[0].thinking).toBe(REASONING.text);
    expect(turns[0].finish).toBeUndefined();
    expect(turns[1].toolName).toBe("read");
    expect(turns[2].toolName).toBe("glob");
    expect(turns[3].text).toBe(REPLY);
    // The terminal identity (footer metrics, tokens, provider) lands on the
    // last segment — the row the assistant-footer entry closes.
    expect(turns[3].finish).toBe("stop");
    expect(turns[3].providerId).toBe("demo");
    expect(turns[3].model).toBe("demo-model");
  });

  test("parts ending with tools close with a footer-only segment", () => {
    const turns = partsToTurns({
      info: ASSISTANT_INFO,
      parts: [{ type: "text", text: REPLY }, READ_PART],
    });
    expect(turns.map((t) => t.role)).toEqual(["assistant", "tool", "assistant"]);
    expect(turns[0].finish).toBeUndefined();
    expect(turns[0].text).toBe(REPLY);
    expect(turns[1].toolName).toBe("read");
    // The reference's assistant-footer entry follows every part row, so the
    // closing segment carries the metrics with no body of its own.
    expect(turns[2].text).toBe("");
    expect(turns[2].finish).toBe("stop");
  });

  test("a mid-turn step (finish tool-calls) contributes no footer row of its own", () => {
    const turns = partsToTurns({
      info: { ...ASSISTANT_INFO, finish: "tool-calls" },
      parts: [READ_PART],
    });
    expect(turns.map((t) => t.role)).toEqual(["tool", "assistant"]);
    expect(turns[1].finish).toBe("tool-calls");
    // MessageView's footer gate needs duration/error/retry; a metrics-less
    // tool-calls segment renders nothing (the flushed rows.ts entry is the
    // part rows only).
    expect(turns[1].error).toBeUndefined();
  });

  test("the exploration walk groups the split tool rows and counts both", () => {
    const turns = partsToTurns({
      info: ASSISTANT_INFO,
      parts: [REASONING, READ_PART, GLOB_PART, { type: "text", text: REPLY }],
    });
    const grouped = groupExplorationRows(turns);
    const group = grouped.find((r) => r.kind === "exploration");
    expect(group).toBeDefined();
    expect(group && group.kind === "exploration" ? group.label : "").toBe("Explored — 1 read, 1 search");
  });

  test("the usage flush keeps one step per message across the split segments", () => {
    const turns = partsToTurns({
      info: {
        ...ASSISTANT_INFO,
        tokens: { input: 4000, output: 60, reasoning: 0, cache: { read: 1024, write: 0 } },
      },
      parts: [REASONING, READ_PART, GLOB_PART, { type: "text", text: REPLY }],
    }) as TurnMessage[];
    const rows = turnUsageRows(turns);
    expect(rows.size).toBe(1);
    const usage = rows.get("msg_a1");
    expect(usage).toBeDefined();
    expect(usage?.count).toBe(1);
    expect(usage?.steps[0].tools.map((t) => t.name)).toEqual(["read", "glob"]);
    expect(usage?.steps[0].total).toBe(5084);
  });
});

describe("resume part-order frame", () => {
  test("the resumed transcript renders Thought, Explored, reply, footer in reference rhythm", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zc-resume-parts-"));
    const preferences = createModelPreferenceRepository(join(dir, "state.json"));
    let push = (_event: Record<string, unknown>) => {};
    const client = {
      request: async (method: string) => {
        if (method === "session/list") return { sessions: [] };
        if (method === "session/resume")
          return {
            session: { status: "idle" },
            messages: [
              { info: { id: "msg_u1", role: "user", time: { created: 1000 } }, parts: [{ type: "text", text: "Fix the login redirect bug" }] },
              { info: ASSISTANT_INFO, parts: [REASONING, READ_PART, GLOB_PART, { type: "text", text: REPLY }] },
            ],
          };
        return {};
      },
      onPush: (fn: typeof push) => { push = fn; },
      onAsk: () => {}, onBackendLost: () => {},
    } as unknown as AppServer;
    const setup = await testRender(
      <App client={client} preferences={preferences} resumeId="ses_parts" onQuit={() => {}} />,
      { width: 100, height: 30 },
    );
    try {
      const frame = await setup.waitForFrame((f) => f.includes("Build · demo/demo-model · 1.5s"));
      const lines = frame.split("\n");
      const indexOf = (needle: string) => {
        const at = lines.findIndex((l) => l.includes(needle));
        if (at === -1) throw new Error(`frame lacks ${JSON.stringify(needle)}:\n${frame}`);
        return at;
      };
      const thought = indexOf("+ Thought · 599ms");
      const explored = indexOf("→ Explored — 1 read, 1 search");
      const reply = indexOf("The bug is in");
      const footer = indexOf("Build · demo/demo-model · 1.5s");
      // Reference order: reasoning row, tool rows, text row, footer — with
      // exactly one blank row between each (SessionRowView marginTop 1).
      expect(explored).toBeGreaterThan(thought);
      expect(reply).toBeGreaterThan(explored);
      expect(footer).toBeGreaterThan(reply);
      expect(lines[explored - 1].trim()).toBe("");
      expect(lines[reply - 1].trim()).toBe("");
      expect(lines[footer - 1].trim()).toBe("");
      // AssistantFooter model law: no catalog entry for demo/demo-model, so
      // the footer shows the provider/model pair, not the bare model id.
      expect(footer).toBeGreaterThan(reply);
    } finally {
      setup.renderer.destroy();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20000);
});
