import { describe, expect, test } from "bun:test";
import {
  assertFundingRoute, chooseEffort, collectionDecision, configureSession,
  createSession, matchAvailableModel, observeTurn, outcomeExitCode,
  isSessionActivity, needsRecoveryContinue, type ModelRef, type RunClient,
} from "./run";

const wanted: ModelRef = { providerId: "zai-api", modelId: "GLM-5.3-Flash", options: { reasoningLevel: "max" } };
const snapshot = (level = "high", providerId = "zai", modelId = wanted.modelId) => ({
  session: { model: { providerId, modelId } },
  settings: { model: { current: { providerId, modelId } },
    thoughtLevel: { current: level, enabled: true, available: ["low", "high", "max"].map(value => ({ value })) } },
});

describe("native model and effort verification", () => {
  test("variant acceptance still sets max and reads it back", async () => {
    const calls: { method: string; params: Record<string, unknown> }[] = [];
    const client: RunClient = { async request(method, params) {
      calls.push({ method, params });
      if (method === "session/create") {
        if ((params.model as any).options) throw new Error("Unrecognized key: options");
        return snapshot("high");
      }
      return method === "session/read" ? snapshot("max") : {};
    } };
    const created = await createSession(client, {}, wanted);
    const actual = await configureSession(client, "sess_invented", created, wanted);
    expect(actual).toEqual({ providerId: "zai", modelId: wanted.modelId, options: { reasoningLevel: "max" } });
    expect(calls.map(c => c.method)).toEqual(["session/create", "session/create", "session/setThoughtLevel", "session/read"]);
    expect(calls[2].params).toEqual({ sessionId: "sess_invented", thoughtLevel: "max" });
  });

  test("setter acknowledgement without max readback fails closed", async () => {
    const client: RunClient = { async request(method) { return method === "session/read" ? snapshot("high") : {}; } };
    await expect(configureSession(client, "sess_invented", snapshot(), wanted)).rejects.toThrow("readback mismatch");
  });

  test("provider mismatch is rejected before setter or send", async () => {
    const methods: string[] = [];
    const client: RunClient = { async request(method) { methods.push(method); return {}; } };
    await expect(configureSession(client, "sess_invented", snapshot("high", "other"), wanted)).rejects.toThrow("requested route");
    expect(methods).toEqual([]);
  });

  test("readback provider drift is rejected", async () => {
    const client: RunClient = { async request(method) { return method === "session/read" ? snapshot("max", "other") : {}; } };
    await expect(configureSession(client, "sess_invented", snapshot(), wanted)).rejects.toThrow("readback mismatch");
  });

  test("generic model uses advertised supported effort without relabeling max", async () => {
    const generic = { settings: { model: { current: { providerId: "example", modelId: "plain" } },
      thoughtLevel: { enabled: true, current: "enabled", available: [{ value: "enabled" }, { value: "disabled" }] } } };
    expect(chooseEffort(generic)).toBe("enabled");
    expect(() => chooseEffort(generic, "max")).toThrow("unsupported");
    const client: RunClient = { async request() { return generic; } };
    expect((await configureSession(client, "sess_invented", generic, null)).options?.reasoningLevel).toBe("enabled");
  });

  test("nonreasoning models remain usable and missing metadata stays unverified", () => {
    expect(chooseEffort({ settings: { thoughtLevel: { enabled: false } } })).toBeNull();
    expect(() => chooseEffort({})).toThrow("ambiguous");
  });

  test("registry matching allows the measured alias, preserves case, rejects arbitrary providers", () => {
    const listing = "Unsupported model: missing. Available models: coding/GLM-5.3-Flash, zai/glm-5.3-flash, zai/GLM-5.3-Flash";
    expect(matchAvailableModel(listing, wanted.modelId, "zai-api")?.providerId).toBe("zai");
    expect(matchAvailableModel(listing, wanted.modelId, "zai-api")?.modelId).toBe(wanted.modelId);
    expect(matchAvailableModel(listing, wanted.modelId, "start-plan")).toBeNull();
  });

  test("unverified full and StartPlan requests never reach create/send", async () => {
    let requests = 0;
    const client: RunClient = { async request() { requests++; return {}; } };
    for (const ref of [{ ...wanted, modelId: "GLM-5.3" }, { ...wanted, providerId: "start-plan" }]) {
      expect(() => assertFundingRoute(ref)).toThrow("full_allowed=false");
      await expect(createSession(client, {}, ref)).rejects.toThrow("unverified");
    }
    expect(requests).toBe(0);
  });
});

const collecting = {
  now: 1000, started: 0, deadline: 0, maxMs: 1000, count: 12, maxEvents: 100,
  lastEvent: 999, quietMs: 100, toolQuietMs: 500, toolInFlight: false,
  modelInFlight: false, replyComplete: true, error: false,
};
describe("collection termination is not completion", () => {
  test("telemetry after a final reply cannot postpone the work clock", () => {
    const own = "sess_fixture";
    expect(isSessionActivity({ method: "v4/telemetry/event", params: { sessionId: own } }, own)).toBe(false);
    expect(isSessionActivity({ method: "session/event", params: { sessionId: "sess_other" } }, own)).toBe(false);
    expect(isSessionActivity({ method: "session/event", params: { sessionId: own } }, own)).toBe(true);
    let lastWork = 100;
    for (let now = 200; now <= 1000; now += 100) {
      if (isSessionActivity({ method: "v4/telemetry/event" }, own)) lastWork = now;
    }
    expect(collectionDecision({ ...collecting, maxMs: 2000, lastEvent: lastWork })).toBe("settled");
  });
  test("normal final yields never get automatic continuation prompts", () => {
    expect(needsRecoveryContinue("settled", "", false, 0, 3)).toBe(false);
    expect(needsRecoveryContinue("settled", "transient", true, 0, 3)).toBe(false);
    expect(needsRecoveryContinue("cut-midtool", "transient", false, 0, 3)).toBe(false);
    expect(needsRecoveryContinue("settled", "transient", false, 0, 3)).toBe(true);
    expect(needsRecoveryContinue("settled", "transient", false, 3, 3)).toBe(false);
  });
  test("the canary request-start silence never settles", () => {
    expect(collectionDecision({ ...collecting, maxMs: 2000, lastEvent: 1,
      modelInFlight: true, replyComplete: false })).toBeNull();
    expect(collectionDecision({ ...collecting, maxMs: 2000, lastEvent: 1,
      replyComplete: false })).toBeNull();
  });
  test("native final reply is distinct from tool calls and empty completions", () => {
    const start = { type: "model_request_started", requestId: "req-fixture",
      model: { role: "main" }, querySource: "main_turn" };
    const initial = { pending: [], replyComplete: false, textSeen: false };
    const active = observeTurn(initial, start);
    const text = observeTurn(active, { kind: "text_delta", delta: "42" });
    expect(observeTurn(text, { ...start, type: "model_request_completed", finishReason: "tool-calls" }).replyComplete).toBe(false);
    expect(observeTurn(active, { ...start, type: "model_request_completed", finishReason: "stop" }).replyComplete).toBe(false);
    expect(observeTurn(text, { ...start, type: "model_request_completed", finishReason: "stop" }).replyComplete).toBe(true);
    expect(observeTurn(active, { ...start, type: "model_request_completed", model: { role: "classifier" }, finishReason: "stop" }).pending).toEqual(["req-fixture"]);
  });
  test("active text at the collection boundary is incomplete", () => {
    expect(collectionDecision(collecting)).toBe("collection-limit");
    expect(outcomeExitCode("collection-limit")).not.toBe(0);
  });
  test("active tool at the collection boundary is a limit", () => {
    expect(collectionDecision({ ...collecting, toolInFlight: true })).toBe("collection-limit");
  });
  test("event limit with active text or tool is incomplete", () => {
    for (const toolInFlight of [false, true]) {
      expect(collectionDecision({ ...collecting, maxMs: 2000, count: 100, toolInFlight })).toBe("event-limit");
    }
    expect(outcomeExitCode("event-limit")).not.toBe(0);
  });
  test("budget wins at equal collection boundary and over quiet", () => {
    expect(collectionDecision({ ...collecting, deadline: 1000, lastEvent: 1 })).toBe("budget");
    expect(outcomeExitCode("budget")).toBe(4);
  });
  test("quiet within the limits settles only without a tool", () => {
    expect(collectionDecision({ ...collecting, maxMs: 2000, lastEvent: 1 })).toBe("settled");
    expect(collectionDecision({ ...collecting, maxMs: 2000, lastEvent: 1, toolInFlight: true })).toBe("cut-midtool");
    expect(collectionDecision({ ...collecting, maxMs: 2000, toolInFlight: true })).toBeNull();
  });
  test("no events cannot settle successfully", () => {
    expect(collectionDecision({ ...collecting, count: 0 })).toBe("no-events");
    expect(collectionDecision({ ...collecting, count: 0, now: 500 })).toBeNull();
    expect(outcomeExitCode("no-events")).toBe(1);
  });
  test("transport error wins even without events or while text is active", () => {
    expect(collectionDecision({ ...collecting, error: true, count: 0 })).toBe("error");
    expect(collectionDecision({ ...collecting, error: true })).toBe("error");
    expect(outcomeExitCode("error")).toBe(1);
  });
});
