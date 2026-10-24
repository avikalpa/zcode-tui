import { describe, expect, test } from "bun:test";
import { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import { ModelDialog, modelOptions, type ModelChoice } from "./model-dialog";
import { StatusDialog } from "./status-dialog";
import type { PlanState } from "./plan-state";
import { THEMES } from "./design";
const models: ModelChoice[] = [
  { label: "Coding Fast", providerId: "zai", providerLabel: "Z.AI Coding Plan", modelId: "coding-fast" },
  { label: "Coding Large", providerId: "zai", providerLabel: "Z.AI Coding Plan", modelId: "coding-large" },
];
const plans: PlanState = {
  codingCache: true, entitlements: [{ label: "coding plan", status: "available" }],
  meters: [{ label: "Requests", used: 25, limit: 100 }],
  autoclaw: { present: true, credentialReady: true, credentialAgeMs: 7_200_000, catalogSource: "cache",
    models: ["Auto", "Fast", "Large", "Flash"].map((name) => ({ id: `fixture-${name.toLowerCase()}`, name: `Fixture ${name}` })) },
};
const prefs = { recent: [], favorite: [] };
describe("plan dialogs", () => {
  test("model search burst selects the intended model and refuses a separate runner", async () => {
    const picked: string[] = [];
    const setup = await testRender(<ModelDialog models={models} plans={plans} prefs={prefs} current={models[0]} C={THEMES.opencode}
      onSelect={(m) => picked.push(m.modelId)} onFavorite={() => {}} onClose={() => {}} />, { width: 100, height: 30 });
    try {
      await setup.waitForFrame((f) => f.includes("Coding Large"));
      await act(async () => { await setup.mockInput.pressKeys([..."coding large", "\r"]); });
      expect(picked).toEqual(["coding-large"]);
      await act(async () => { await setup.mockInput.pressKeys([...Array(12).fill("\x7f"), ..."fixture large", "\r"]); });
      const frame = await setup.waitForFrame((f) => f.includes("Fixture Large") && !f.includes("Coding Large"));
      expect(frame).toContain("separate runner");
      expect(picked).toEqual(["coding-large"]);
    } finally { setup.renderer.destroy(); }
  });
  test("both provider groups and all four cached models fit the normal picker", async () => {
    const setup = await testRender(<ModelDialog models={models} plans={plans} prefs={prefs} current={models[0]} C={THEMES.opencode} onSelect={() => {}} onFavorite={() => {}} onClose={() => {}} />, { width: 100, height: 30 });
    try {
      const frame = await setup.waitForFrame((f) => f.includes("Fixture Flash"), { maxPasses: 20 });
      for (const text of ["Select model", "Z.AI Coding Plan", "AutoClaw", "Coding Fast", "Fixture Auto", "Fixture Fast", "Fixture Large", "Fixture Flash", "favorite"]) expect(frame).toContain(text);
      const options = modelOptions(models, plans, prefs);
      expect(options.filter((o) => o.group === "AutoClaw")).toHaveLength(4);
      expect(options.filter((o) => o.group === "AutoClaw").every((o) => o.disabled)).toBe(true);
      expect(new Set(options.map((o) => o.id)).size).toBe(6);
    } finally { setup.renderer.destroy(); }
  });
  test("favorites and recents retain provider identity without duplicate models", () => {
    const options = modelOptions(models, plans, { favorite: [models[1]], recent: [models[0], models[1]] });
    expect(options[0].group).toBe("Favorites");
    expect(options[0].description).toBe("Z.AI Coding Plan");
    expect(options[1].group).toBe("Recent");
    expect(options).toHaveLength(6);
    expect(modelOptions(models, { ...plans, autoclaw: { ...plans.autoclaw, models: [] } }, prefs).at(-1)?.description).toContain("autoclaw setup");
  });
  test("status renders cached meters, credential age, catalog count, telemetry and MCP together", async () => {
    const setup = await testRender(<StatusDialog C={THEMES.opencode} plans={plans} usage={{ kind: "ready", tokens: 1234, sessions: 2 }} mcpState={{ kind: "ready", servers: [{ name: "Fixture MCP", status: "connected" }] }} width={100} height={40} onClose={() => {}} />, { width: 100, height: 40 });
    try {
      const frame = await setup.waitForFrame((f) => f.includes("Fixture MCP"), { maxPasses: 20 });
      for (const text of ["Status", "Z.AI Coding Plan", "25 / 100 (25%)", "1,234 tokens", "AutoClaw", "Plan file · present", "2h old", "4 models · cache", "Connected"]) expect(frame).toContain(text);
    } finally { setup.renderer.destroy(); }
  });
  test("missing data has honest empty states rather than fabricated zero quota", async () => {
    const setup = await testRender(<StatusDialog C={THEMES.opencode} plans={{ ...plans, codingCache: false, entitlements: [], meters: [], autoclaw: { present: false, credentialReady: false, credentialAgeMs: null, models: [], catalogSource: "unavailable" } }} usage={{ kind: "unavailable" }} mcpState={{ kind: "ready", servers: [] }} width={80} height={40} onClose={() => {}} />, { width: 80, height: 40 });
    try {
      const frame = await setup.waitForFrame((f) => f.includes("No MCP servers"), { maxPasses: 20 });
      for (const text of ["Entitlements unavailable", "Quota meters unavailable", "not configured", "not provisioned", "0 models · unavailable", "Usage unavailable"]) expect(frame).toContain(text);
      expect(frame).not.toContain("(0%)");
    } finally { setup.renderer.destroy(); }
  });
  test("MCP request failure is unavailable, not an empty successful list", async () => {
    const setup = await testRender(<StatusDialog C={THEMES.opencode} plans={plans} usage={{ kind: "unavailable" }}
      mcpState={{ kind: "unavailable" }} width={80} height={40} onClose={() => {}} />, { width: 80, height: 40 });
    try {
      const frame = await setup.waitForFrame((f) => f.includes("MCP servers unavailable"));
      expect(frame).not.toContain("No MCP servers");
      expect(frame).not.toContain("MCP servers · loading");
      expect(frame).toContain("Z.AI Coding Plan");
      expect(frame).toContain("AutoClaw");
    } finally { setup.renderer.destroy(); }
  });
  test("status keyboard End/Home reaches server details while keeping chrome", async () => {
    const setup = await testRender(<StatusDialog C={THEMES.opencode} plans={plans} usage={{ kind: "ready", tokens: 10 }}
      mcpState={{ kind: "ready", servers: [{ name: "Fixture failed server", status: "failed", error: "Fixture connection refused" }] }}
      width={60} height={20} onClose={() => {}} />, { width: 60, height: 20 });
    try {
      await setup.waitForFrame((f) => f.includes("Status"));
      await act(async () => { setup.mockInput.pressKey("END"); });
      const bottom = await setup.waitForFrame((f) => f.includes("Fixture connection refused"));
      expect(bottom).toContain("Status");
      expect(bottom).toContain("esc close");
      await act(async () => { setup.mockInput.pressKey("HOME"); });
      expect(await setup.waitForFrame((f) => f.includes("Z.AI Coding Plan"))).toContain("Status");
    } finally { setup.renderer.destroy(); }
  });
  test("short status viewport keeps the title visible and scrolls to the final server", async () => {
    const setup = await testRender(<StatusDialog C={THEMES.opencode} plans={plans} usage={{ kind: "ready", tokens: 1234 }} mcpState={{ kind: "ready", servers: Array.from({ length: 8 }, (_, i) => ({ name: `Server ${i + 1}`, status: "connected" })) }} width={80} height={24} onClose={() => {}} />, { width: 80, height: 24 });
    try {
      const frame = await setup.waitForFrame((f) => f.includes("Status"), { maxPasses: 20 });
      expect(frame).not.toContain("Server 8");
      for (let i = 0; i < 12; i++) await setup.mockMouse.scroll(40, 12, "down");
      const bottom = await setup.waitForFrame((f) => f.includes("Server 8"), { maxPasses: 20 });
      expect(bottom).toContain("Status");
      expect(bottom).toContain("esc");
    } finally { setup.renderer.destroy(); }
  });

});
