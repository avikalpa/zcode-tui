import { describe, expect, test } from "bun:test";
import { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppServer } from "../protocol/client";
import { App, partsToTurns } from "./app";
import { createModelPreferenceRepository } from "./session/model-preference";

// Reference AssistantFooter law (opencode v2ref b084acc55e,
// routes/session/index.tsx 1934-1985 + AssistantRetry 2418-2444 +
// routes/session/rows.ts 325-329): a terminal-by-error turn renders an
// `Error: <message>` row in the error colour, a retrying turn renders
// `⚠ Retrying in Ns|Retry due · attempt N · <message>` in the warning
// colour, the footer agent word turns subdued under an error, and the
// footer row itself appears on terminal-by-error turns even without
// metrics. A "Step interrupted" error suppresses the row and rides the
// footer suffix instead. Char frames do not establish live pixels.

function erroredSession(messages: unknown[]) {
  return messages;
}

function messagesWithTurn(error?: Record<string, unknown>, retry?: Record<string, unknown>, text = "partial answer") {
  return [
    { info: { id: "u1", role: "user", time: { created: 1 } }, parts: [{ type: "text", text: "run the fixture" }] },
    {
      info: {
        id: "a1",
        role: "assistant",
        model: { modelId: "test-model" },
        time: { created: 2 },
        ...(error ? { error } : {}),
        ...(retry ? { retry } : {}),
      },
      parts: text ? [{ type: "text", text }] : [],
    },
  ];
}

async function sessionWith(messages: unknown[]) {
  const dir = mkdtempSync(join(tmpdir(), "zc-turnerr-"));
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
    <App client={client} preferences={preferences} resumeId="fixture-turnerr" onQuit={() => {}} />,
    { width: 100, height: 30 },
  );
  await setup.waitForFrame((f) => f.includes("run the fixture"));
  return { ...setup, cleanup: () => { setup.renderer.destroy(); rmSync(dir, { recursive: true, force: true }); } };
}

function blanksBetween(frame: string, from: string, to: string): number {
  const lines = frame.split("\n");
  const start = lines.findIndex((l) => l.includes(from));
  if (start < 0) throw new Error(`frame lacks ${JSON.stringify(from)}:\n${frame}`);
  const end = lines.findIndex((l, i) => i > start && l.includes(to));
  if (end < 0) throw new Error(`frame lacks ${JSON.stringify(to)} below ${JSON.stringify(from)}:\n${frame}`);
  return lines.slice(start + 1, end).filter((l) => l.trim() === "").length;
}

describe("assistant turn error law (reference AssistantFooter)", () => {
  test("an errored terminal turn renders the Error row and the footer, one blank line apart", async () => {
    const s = await sessionWith(erroredSession(messagesWithTurn({ name: "APIError", message: "rate limited" })));
    try {
      const frame = await s.waitForFrame((f) => f.includes("Error: rate limited"));
      expect(frame).toContain("Error: rate limited");
      // the SessionRowView row gap sits above the error row (flattened:
      // the error row carries paddingTop 1), and the reference's
      // conditional marginTop 1 is the gap before the metrics row
      expect(blanksBetween(frame, "partial answer", "Error: rate limited")).toBe(1);
      expect(blanksBetween(frame, "Error: rate limited", "Build · test-model")).toBe(1);
    } finally {
      s.cleanup();
    }
  });

  test("a terminal-by-error turn renders the footer even without metrics", async () => {
    const s = await sessionWith(erroredSession(messagesWithTurn({ message: "boom" }, undefined, "")));
    try {
      const frame = await s.waitForFrame((f) => f.includes("Error: boom"));
      // rows.ts: the footer row is pushed when terminal || retry — the
      // head alone, no duration/tok segments
      expect(frame).toContain("Build · test-model");
    } finally {
      s.cleanup();
    }
  });

  test("a retry renders the warning row and suppresses the error row", async () => {
    const s = await sessionWith(
      erroredSession(
        messagesWithTurn({ message: "rate limited" }, { attempt: 2, at: Date.now() - 1000, error: { message: "rate limited" } }),
      ),
    );
    try {
      const frame = await s.waitForFrame((f) => f.includes("Retry due"));
      expect(frame).toContain("⚠ Retry due · attempt 2 · rate limited");
      expect(frame).not.toContain("Error: rate limited");
      expect(blanksBetween(frame, "partial answer", "⚠ Retry due")).toBe(1);
      expect(blanksBetween(frame, "⚠ Retry due · attempt 2 · rate limited", "Build · test-model")).toBe(1);
    } finally {
      s.cleanup();
    }
  });

  test("an upcoming retry counts down in seconds", async () => {
    const s = await sessionWith(
      erroredSession(
        messagesWithTurn(undefined, { attempt: 3, at: Date.now() + 5000, error: { message: "overloaded" } }),
      ),
    );
    try {
      const frame = await s.waitForFrame((f) => f.includes("Retrying in"));
      expect(frame).toContain("⚠ Retrying in 5s · attempt 3 · overloaded");
    } finally {
      s.cleanup();
    }
  });

  test("a Step interrupted error rides the footer suffix, not the error row", async () => {
    const s = await sessionWith(erroredSession(messagesWithTurn({ message: "Step interrupted" })));
    try {
      const frame = await s.waitForFrame((f) => f.includes("interrupted"));
      expect(frame).not.toContain("Error: Step interrupted");
      expect(frame).toContain("Build · test-model · interrupted");
    } finally {
      s.cleanup();
    }
  });
});

describe("partsToTurns error extraction (util/error.ts message law)", () => {
  test("extracts info.error.message and the retry attempt", () => {
    const [turn] = partsToTurns({
      info: {
        role: "assistant",
        error: { name: "APIError", message: "rate limited" },
        retry: { attempt: 2, at: 12345, error: { message: "rate limited" } },
      },
      parts: [],
    });
    expect(turn.error).toBe("rate limited");
    expect(turn.retry).toEqual({ attempt: 2, at: 12345, message: "rate limited" });
  });

  test("falls back to error.data.message, then to the string form", () => {
    const [viaData] = partsToTurns({ info: { role: "assistant", error: { data: { message: "boom" } } }, parts: [] });
    expect(viaData.error).toBe("boom");
    const [viaString] = partsToTurns({ info: { role: "assistant", error: "plain string" }, parts: [] });
    expect(viaString.error).toBe("plain string");
  });

  test("leaves error and retry undefined when the info carries none", () => {
    const [turn] = partsToTurns({ info: { role: "assistant" }, parts: [] });
    expect(turn.error).toBeUndefined();
    expect(turn.retry).toBeUndefined();
  });
});
