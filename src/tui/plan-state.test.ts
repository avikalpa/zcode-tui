import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { catalogModels, codingPlanSummary, credentialAge, meterText, readPlanState, refreshPlanCatalog } from "./plan-state";

describe("plan presentation projection", () => {
  test("reads only public status metadata from user-owned files", () => {
    const home = mkdtempSync(join(tmpdir(), "plan-ui-"));
    try {
      mkdirSync(join(home, ".config/zcode-tui"), { recursive: true });
      mkdirSync(join(home, ".local/state/zcode-tui"), { recursive: true });
      writeFileSync(join(home, ".config/zcode-tui/autoclaw-plan.json"), JSON.stringify({
        auth: { accessToken: "synthetic-private-token", refreshToken: "synthetic-private-refresh", updatedAt: "2026-01-01T00:00:00Z" },
        identity: { appId: "synthetic-private-identity" },
      }));
      writeFileSync(join(home, ".local/state/zcode-tui/autoclaw-model-catalog.json"), JSON.stringify({ models: [{ id: "fixture-auto", name: "Fixture Auto" }] }));
      const state = readPlanState(home, Date.parse("2026-01-01T02:00:00Z"));
      expect(state.autoclaw.present).toBe(true);
      expect(state.autoclaw.credentialReady).toBe(true);
      expect(credentialAge(state.autoclaw.credentialAgeMs)).toBe("2h old");
      expect(state.autoclaw.models).toEqual([{ id: "fixture-auto", name: "Fixture Auto" }]);
      expect(state.autoclaw.catalogSource).toBe("cache");
      expect(JSON.stringify(state)).not.toContain("synthetic-private");
      writeFileSync(join(home, ".local/state/zcode-tui/autoclaw-model-catalog.json"), "invalid");
      const offline = readPlanState(home);
      expect(offline.autoclaw.catalogSource).toBe("fallback");
      expect(offline.autoclaw.models).toHaveLength(4);
    } finally { rmSync(home, { recursive: true }); }
  });
  test("finite used/limit pairs yield meters; absent or invalid limits stay unknown", () => {
    const state = codingPlanSummary({ entryStatus: { items: { "builtin:fixture-plan": { status: "available", usage: { used: 25, limit: 100 } } } } });
    expect(state.entitlements).toEqual([{ label: "fixture plan", status: "available" }]);
    expect(meterText(state.meters[0])).toContain("25 / 100 (25%)");
    expect(codingPlanSummary({ usage: { used: 3, limit: 0 } }).meters).toEqual([]);
    expect(codingPlanSummary({ usage: { used: -1, limit: 100 } }).meters).toEqual([]);
    expect(codingPlanSummary(undefined).codingCache).toBe(false);
    expect(codingPlanSummary(null).codingCache).toBe(false);
    expect(codingPlanSummary({ entryStatus: { updatedAt: 1000 } }, 5000).codingCacheAgeMs).toBe(4000);
    expect(codingPlanSummary({ entryStatus: { updatedAt: 6000 } }, 5000).codingCacheAgeMs).toBeUndefined();
    expect(meterText({ label: "over", used: 120, limit: 100 })).toContain("120%");
  });
  test("catalog validation, missing files, offline fallback and live refresh", async () => {
    expect(catalogModels({ models: [null, {}, { id: "" }, { id: "one" }, { id: "one" }] })).toEqual([{ id: "one", name: "one" }]);
    const state = readPlanState(join(tmpdir(), "nonexistent-plan-fixture"));
    expect(state.autoclaw.present).toBe(false);
    expect(state.autoclaw.credentialAgeMs).toBeNull();
    state.autoclaw.models = [{ id: "cached", name: "Cached" }];
    state.autoclaw.catalogSource = "cache";
    expect(await refreshPlanCatalog(state, async () => { throw new Error("offline"); })).toBe(state);
    expect(await refreshPlanCatalog(state, async () => ({ ok: false, failure: "offline" }))).toBe(state);
    const next = await refreshPlanCatalog(state, async () => ({ ok: true, models: [{ id: "live", name: "Live", contextWindow: 10, maxTokens: 1, reasoning: false }] }));
    expect(next.autoclaw.catalogSource).toBe("live");
    expect(next.autoclaw.models[0].id).toBe("live");
  });
});
