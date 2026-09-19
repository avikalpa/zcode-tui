// The state.json repository contract for the theme voice (0.6.32): the
// theme:{name,mode} pair survives a load/update round-trip under the same
// lock-merged write path as the model fields, and a garbage or absent theme
// decodes to the unlocked nulls (a broken state file must never take the
// TUI down). Runs against a throwaway file — the real state.json is never
// involved.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "zc-uistate-test-"));
const statePath = path.join(dir, "state.json");

const { createModelPreferenceRepository } = await import("./model-preference");

describe("UiState repository theme voice", () => {
  test("fresh state decodes to the unlocked theme nulls", () => {
    const repo = createModelPreferenceRepository(statePath);
    const state = repo.load();
    expect(state.theme).toEqual({ name: null, mode: null });
  });

  test("update persists theme name/mode and keeps them through a reload", () => {
    const repo = createModelPreferenceRepository(statePath);
    repo.update(() => ({ theme: { name: "dracula", mode: "light" } }));
    const onDisk = JSON.parse(readFileSync(statePath, "utf8"));
    expect(onDisk.theme).toEqual({ name: "dracula", mode: "light" });
    expect(repo.load().theme).toEqual({ name: "dracula", mode: "light" });
  });

  test("update merges under the lock — a theme write never clobbers model fields", () => {
    const repo = createModelPreferenceRepository(statePath);
    repo.update((current) => ({ ...current, favorite: [{ providerId: "zai", modelId: "GLM-5.3" }] }));
    repo.update((current) => ({ theme: { ...current.theme, mode: "dark" } }));
    const state = repo.load();
    expect(state.favorite).toEqual([{ providerId: "zai", modelId: "GLM-5.3" }]);
    expect(state.theme).toEqual({ name: "dracula", mode: "dark" });
  });

  test("a garbage theme object sanitizes to the unlocked nulls", () => {
    rmSync(statePath, { force: true });
    writeFileSync(statePath, JSON.stringify({ theme: { name: 42, mode: "tent" }, animations: false }));
    const repo = createModelPreferenceRepository(statePath);
    const state = repo.load();
    expect(state.theme).toEqual({ name: null, mode: null });
    expect(state.animations).toBe(false);
  });
});
