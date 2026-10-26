import { describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppServer } from "../protocol/client";
import { App, partsToTurns, attachTurnMetrics, type TurnMessage } from "./app";
import { createModelPreferenceRepository } from "./session/model-preference";

// Reference resume footer law (opencode v2ref b084acc55e,
// routes/session/rows.ts 325-351 + turnDuration/turnTokensPerSecond
// 353-383): the projection pushes an assistant-footer row for EVERY
// terminal assistant message — finish set and not tool-calls/unknown, or
// an error — and the footer duration is TURN-SCOPED: message.time.completed
// minus the turn input's time.created. Throughput needs every step's
// time.streamed, which the zcode payload does not carry, so resumed
// footers read `Build · model · <duration>` with no tok/s segment.
// The inherited resume path derived no metrics, so reopened sessions
// rendered no footers at all.

describe("resume metrics extraction", () => {
  test("partsToTurns carries finish and the completed timestamp", () => {
    const [end] = partsToTurns({
      info: { role: "assistant", finish: "end_turn", time: { created: 1000, completed: 8000 } },
      parts: [],
    });
    expect(end.finish).toBe("end_turn");
    expect(end.completedAt).toBe(8000);
    const [mid] = partsToTurns({
      info: { role: "assistant", finish: "tool-calls", time: { created: 1000, completed: 5000 } },
      parts: [],
    });
    expect(mid.finish).toBe("tool-calls");
    const [live] = partsToTurns({ info: { role: "assistant", time: { created: 1000 } }, parts: [] });
    expect(live.finish).toBeUndefined();
    expect(live.completedAt).toBeUndefined();
  });

  test("attachTurnMetrics stamps the turn-scoped duration on terminal steps only", () => {
    const turns: TurnMessage[] = [
      { role: "user", text: "go", createdAt: 1000 },
      { role: "assistant", text: "step one", finish: "tool-calls", createdAt: 2000, completedAt: 5000 },
      { role: "assistant", text: "step two", finish: "end_turn", createdAt: 5000, completedAt: 8000 },
    ];
    const [user, mid, last] = attachTurnMetrics(turns);
    expect(mid.durationMs).toBeUndefined();
    expect(last.durationMs).toBe(7000);
  });

  test("attachTurnMetrics falls back to the message created time without a preceding user turn", () => {
    const [only] = attachTurnMetrics([
      { role: "assistant", text: "solo", finish: "stop", createdAt: 100, completedAt: 300 },
    ]);
    expect(only.durationMs).toBe(200);
  });

  test("attachTurnMetrics leaves non-terminal and live turns untouched", () => {
    const turns: TurnMessage[] = [
      { role: "user", text: "go", createdAt: 1000 },
      { role: "assistant", text: "mid", finish: "tool-calls", createdAt: 2000, completedAt: 5000 },
      { role: "assistant", text: "live", createdAt: 5000, turnStart: 999 },
    ];
    const kept = attachTurnMetrics(turns);
    expect(kept[1].durationMs).toBeUndefined();
    expect(kept[2].durationMs).toBeUndefined();
    expect(kept[2].turnStart).toBe(999);
  });
});

// The multi-step shape the live backend showed (verified 2026-10-26 via a
// real session/resume dump): per-step assistant messages, finish
// tool-calls on the middle steps and end_turn on the last.
function multiStepMessages() {
  return [
    { info: { id: "u1", role: "user", time: { created: 1000 } }, parts: [{ type: "text", text: "run the fixture" }] },
    {
      info: { id: "a1", role: "assistant", model: { modelId: "test-model" }, finish: "tool-calls", time: { created: 2000, completed: 5000 } },
      parts: [{ type: "text", text: "step one" }],
    },
    {
      info: { id: "a2", role: "assistant", model: { modelId: "test-model" }, finish: "end_turn", time: { created: 5000, completed: 8000 } },
      parts: [{ type: "text", text: "step two" }],
    },
  ];
}

async function sessionWith(messages: unknown[]) {
  const dir = mkdtempSync(join(tmpdir(), "zc-resume-"));
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
    <App client={client} preferences={preferences} resumeId="fixture-resume" onQuit={() => {}} />,
    { width: 100, height: 30 },
  );
  await setup.waitForFrame((f) => f.includes("run the fixture"));
  return { ...setup, cleanup: () => { setup.renderer.destroy(); rmSync(dir, { recursive: true, force: true }); } };
}

describe("resumed session footer (rows.ts projection law)", () => {
  test("a reopened multi-step turn renders exactly one footer with the turn duration", async () => {
    const s = await sessionWith(multiStepMessages());
    try {
      const frame = await s.waitForFrame((f) => f.includes("step two"));
      // terminal step only, turn-scoped duration (user 1000 -> completed 8000)
      const footerLines = frame.split("\n").filter((l) => l.includes("Build · test-model"));
      expect(footerLines).toHaveLength(1);
      expect(footerLines[0]).toContain("7.0s");
      // no tok/s: the payload carries no time.streamed (reference
      // turnTokensPerSecond returns undefined without it)
      expect(frame).not.toContain("tok/s");
    } finally {
      s.cleanup();
    }
  });
});
