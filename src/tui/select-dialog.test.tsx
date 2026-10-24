// SelectDialog rendering tests (reference-parity, 2026-09-17 themes wave).
// Production rendering and stdin-driven keyboard/mouse interactions.
// mockInput reaches useKeyboard; these checks do not establish live pixels.
import { describe, expect, test } from "bun:test";
import { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import { SelectDialog, matchesDialogFilter, type DialogOption } from "./select-dialog";

const OPTIONS: DialogOption<string>[] = [
  { id: "alpha", label: "alpha", value: "alpha" },
  { id: "beta", label: "beta", value: "beta" },
  { id: "gamma", label: "gamma", value: "gamma" },
];

describe("SelectDialog reference parity", () => {
  test("Search placeholder with caret, bare rows, gutter ● on the current row", async () => {
    const setup = await testRender(
      <SelectDialog
        title="Themes"
        options={OPTIONS}
        currentId="beta"
        onSelect={() => {}}
        onClose={() => {}}
      />,
      { width: 60, height: 20 },
    );
    const frame = await setup.waitForFrame((f) => f.includes("Themes") && f.includes("beta"), { maxPasses: 20 });
    expect(frame).toContain("Search");
    expect(frame).toContain("█");
    expect(frame).toContain("●");
    // The mid-row suffix marker is gone (0.6.14 and earlier drew "beta  ●").
    expect(frame).not.toContain("beta  ●");
    // No phantom description column unless the caller passes one.
    expect(frame).not.toContain("OpenCod");
    setup.renderer.destroy();
  });

  test("onHighlight fires at mount with the first shown option", async () => {
    const seen: (string | undefined)[] = [];
    const setup = await testRender(
      <SelectDialog
        title="Themes"
        options={OPTIONS}
        currentId="alpha"
        onHighlight={(opt) => seen.push(opt?.id)}
        onSelect={() => {}}
        onClose={() => {}}
      />,
      { width: 60, height: 20 },
    );
    await setup.waitForFrame((f) => f.includes("alpha"), { maxPasses: 20 });
    expect(seen).toContain("alpha");
    setup.renderer.destroy();
  });

  test("descriptions still render for the dialogs that pass real ones", async () => {
    const setup = await testRender(
      <SelectDialog
        title="Model"
        options={[{ id: "glm", label: "GLM-5.3", description: "zai-api/GLM-5.3", value: "glm" }]}
        onSelect={() => {}}
        onClose={() => {}}
      />,
      { width: 60, height: 20 },
    );
    const frame = await setup.waitForFrame((f) => f.includes("GLM-5.3"), { maxPasses: 20 });
    // Narrow cards truncate the description (pre-existing geometry) — the
    // point is that a real description renders, muted, beside the label.
    expect(frame).toContain("zai-api");
    setup.renderer.destroy();
  });
});


describe("picker interaction parity", () => {
  test("Enter on an empty search result preserves the query and dialog", async () => {
    let closed = false;
    const picked: string[] = [];
    const setup = await testRender(<SelectDialog title="Sessions" options={OPTIONS}
      onSelect={(v) => picked.push(v)} onClose={() => { closed = true; }} />, { width: 80, height: 30 });
    try {
      await setup.waitForFrame((f) => f.includes("gamma"));
      await act(async () => { await setup.mockInput.pressKeys([..."unmatched", "\r"]); });
      const frame = await setup.waitForFrame((f) => f.includes("No matching items"));
      expect(frame).toContain("unmatched");
      expect(picked).toEqual([]);
      expect(closed).toBe(false);
    } finally { setup.renderer.destroy(); }
  });
  test("search and Enter in a single burst select the matching row", async () => {
    const picked: string[] = [];
    const setup = await testRender(<SelectDialog title="Sessions" options={OPTIONS}
      onSelect={(value) => picked.push(value)} onClose={() => {}} />, { width: 80, height: 30 });
    try {
      await setup.waitForFrame((f) => f.includes("gamma"));
      await act(async () => { await setup.mockInput.pressKeys([..."gamma", "\r"]); });
      expect(picked).toEqual(["gamma"]);
    } finally { setup.renderer.destroy(); }
  });
  test("filter + navigation + action uses the same immediate selected row", async () => {
    const acted: string[] = [];
    const setup = await testRender(<SelectDialog title="Select model" options={[
      { id: "first", label: "Coding One", group: "Coding Plan", value: "first" },
      { id: "second", label: "Coding Two", group: "Coding Plan", value: "second" },
      { id: "third", label: "Fixture Other", value: "third" },
    ]} onAction={(_action, option) => acted.push(option?.id ?? "missing")}
      onSelect={() => {}} onClose={() => {}} />, { width: 80, height: 30 });
    try {
      await setup.waitForFrame((f) => f.includes("Coding Two"));
      await act(async () => { await setup.mockInput.pressKeys([..."coding", "\x1b[B", "\x06"]); });
      expect(acted).toEqual(["second"]);
    } finally { setup.renderer.destroy(); }
  });
  test("search accepts words across the model name and provider", () => {
    const row = { label: "GLM-5.3-Flash", group: "AutoClaw", description: "cached model" };
    expect(matchesDialogFilter(row, "glm flash")).toBe(true);
    expect(matchesDialogFilter(row, "autoclaw flash")).toBe(true);
    expect(matchesDialogFilter(row, "missing flash")).toBe(false);
  });
  test("mouse selects enabled rows and esc closes; disabled rows remain inert", async () => {
    const picked: string[] = [];
    let closed = false;
    const setup = await testRender(<SelectDialog title="Fixture picker" options={[
      { id: "ready", label: "Ready model", value: "ready", description: "Full provider name" },
      { id: "disabled", label: "Separate runner", value: "disabled", disabled: true },
    ]} onSelect={(v) => picked.push(v)} onClose={() => { closed = true; }} />, { width: 80, height: 30 });
    try {
      const frame = await setup.waitForFrame((f) => f.includes("Ready model"), { maxPasses: 20 });
      expect(frame).toContain("Full provider name");
      const lines = frame.split("\n");
      const clickText = async (needle: string) => {
        const y = lines.findIndex((line) => line.includes(needle));
        await setup.mockMouse.click(lines[y].indexOf(needle) + 1, y);
        await setup.renderOnce();
      };
      await clickText("Separate runner");
      expect(picked).toEqual([]);
      await clickText("Ready model");
      expect(picked).toEqual(["ready"]);
      await clickText("esc");
      expect(closed).toBe(true);
    } finally { setup.renderer.destroy(); }
  });
});
