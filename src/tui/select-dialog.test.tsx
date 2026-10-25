// SelectDialog rendering tests (reference-parity, 2026-09-17 themes wave).
// Production rendering and stdin-driven keyboard/mouse interactions.
// mockInput reaches useKeyboard; these checks do not establish live pixels.
import { describe, expect, test } from "bun:test";
import { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import { SelectDialog, TextPromptDialog, matchesDialogFilter, filterDialogOptions, type DialogOption } from "./select-dialog";

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
      const frame = await setup.waitForFrame((f) => f.includes("No results found"));
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
      { id: "third", label: "Fixture Other", value: "third" },
      { id: "first", label: "Coding One", group: "Coding Plan", value: "first" },
      { id: "second", label: "Coding Two", group: "Coding Plan", value: "second" },
    ]} onAction={(_action, option) => acted.push(option?.id ?? "missing")}
      onSelect={() => {}} onClose={() => {}} />, { width: 80, height: 30 });
    try {
      await setup.waitForFrame((f) => f.includes("Coding Two"));
      await act(async () => { await setup.mockInput.pressKeys([..."coding", "\x1b[B", "\x06"]); });
      expect(acted).toEqual(["first"]);
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

describe("grouped picker viewport", () => {
  const grouped = Array.from({ length: 12 }, (_, i) => ({
    id: `model-${i}`, label: `Fixture model ${String(i).padStart(2, "0")}`,
    group: `Provider ${i}`, value: `model-${i}`,
  }));
  test("short terminal keeps the selected last group and footer visible", async () => {
    const picked: string[] = [];
    const setup = await testRender(<SelectDialog title="Select model" options={grouped}
      footerHints={[{ key: "enter", label: "select" }, { key: "ctrl+f", label: "favorite" }]}
      onSelect={(v) => picked.push(v)} onClose={() => {}} />, { width: 60, height: 20 });
    try {
      await setup.waitForFrame((f) => f.includes("Select model"));
      await act(async () => { await setup.mockInput.pressKeys(["\x1b[F"]); });
      const end = await setup.waitForFrame((f) => f.includes("Fixture model 11"));
      expect(end).toContain("select enter");
      expect(end).toContain("favorite ctrl+f");
      expect(end).toContain("esc");
      await act(async () => { await setup.mockInput.pressKeys(["\r"]); });
      expect(picked).toEqual(["model-11"]);
      await act(async () => { await setup.mockInput.pressKeys(["\x1b[H"]); });
      const start = await setup.waitForFrame((f) => f.includes("Fixture model 00"));
      expect(start).toContain("Provider 0");
      expect(start).toContain("select enter");
    } finally { setup.renderer.destroy(); }
  });
  test("narrow footer stacks actions and preserves the last selection", async () => {
    const setup = await testRender(<SelectDialog title="Sessions" options={grouped}
      footerHints={[{ key: "ctrl+f", label: "pin/unpin" }, { key: "ctrl+d", label: "delete" }, { key: "ctrl+r", label: "rename" }]}
      currentId="model-11" onSelect={() => {}} onClose={() => {}} />, { width: 40, height: 18 });
    try {
      const frame = await setup.waitForFrame((f) => f.includes("Fixture model 11"));
      expect(frame).toContain("pin/unpin ctrl+f");
      expect(frame).toContain("delete ctrl+d");
      expect(frame).toContain("rename ctrl+r");
      expect(frame).toContain("●");
    } finally { setup.renderer.destroy(); }
  });
  test("arrows and page movement wrap like the reference", async () => {
    const picked: string[] = [];
    const setup = await testRender(<SelectDialog title="Themes" options={OPTIONS}
      onSelect={(v) => picked.push(v)} onClose={() => {}} />, { width: 60, height: 20 });
    try {
      await setup.waitForFrame((f) => f.includes("alpha"));
      await act(async () => { await setup.mockInput.pressKeys(["\x1b[A", "\r", "\x1b[B", "\r", "\x1b[6~", "\r"]); });
      expect(picked).toEqual(["gamma", "alpha", "alpha"]);
    } finally { setup.renderer.destroy(); }
  });
});


describe("ranked picker search", () => {
  test("abbreviations match and title matches outrank provider-only matches", () => {
    const options = [
      { id: "provider", label: "Other model", group: "Flash", value: "provider" },
      { id: "title", label: "Flash", group: "Fixture", value: "title" },
      { id: "abbr", label: "Code Review Engine", group: "Fixture", value: "abbr" },
    ];
    expect(filterDialogOptions(options, "flash").map((o) => o.id)).toEqual(["title", "provider"]);
    expect(filterDialogOptions(options, "cdrev").map((o) => o.id)).toEqual(["abbr"]);
  });
  test("provider groups stay contiguous without changing first-seen group order", () => {
    const options = [
      { id: "a", label: "First", group: "One", value: "a" },
      { id: "b", label: "Second", group: "Two", value: "b" },
      { id: "c", label: "Third", group: "One", value: "c" },
    ];
    expect(filterDialogOptions(options, "").map((o) => o.id)).toEqual(["a", "c", "b"]);
  });
  test("fuzzy query plus Enter dispatches the ranked model within one burst", async () => {
    const picked: string[] = [];
    const setup = await testRender(<SelectDialog title="Models" options={[
      { id: "provider", label: "Other model", group: "Flash", value: "provider" },
      { id: "title", label: "Flash", group: "Fixture", value: "title" },
    ]} onSelect={(v) => picked.push(v)} onClose={() => {}} />, { width: 80, height: 30 });
    try {
      await setup.waitForFrame((f) => f.includes("Models"));
      await act(async () => { await setup.mockInput.pressKeys([..."flsh", "\r"]); });
      expect(picked).toEqual(["title"]);
    } finally { setup.renderer.destroy(); }
  });
});


describe("text prompt native editing", () => {
  test("typing and Enter in one burst submit the complete value", async () => {
    const values: string[] = [];
    const setup = await testRender(<TextPromptDialog title="Fixture title" onSubmit={(v) => values.push(v)} onClose={() => {}} />, { width: 80, height: 25 });
    try {
      await setup.waitForFrame((f) => f.includes("Fixture title"));
      await act(async () => { await setup.mockInput.pressKeys([..."new title", "\r"]); });
      expect(values).toEqual(["new title"]);
    } finally { setup.renderer.destroy(); }
  });
  test("selection replaces the initial value before same-burst submission", async () => {
    const values: string[] = [];
    const setup = await testRender(<TextPromptDialog title="Fixture title" initialValue="old title"
      onSubmit={(v) => values.push(v)} onClose={() => {}} />, { width: 80, height: 25 });
    try {
      await setup.waitForFrame((f) => f.includes("old title"));
      await act(async () => { await setup.mockInput.pressKeys(["\x1b[H", "\x1b[1;2F", ..."replacement title", "\r"]); });
      expect(values).toEqual(["replacement title"]);
    } finally { setup.renderer.destroy(); }
  });
  test("bracketed paste reaches the dialog editor and Escape cancels", async () => {
    const values: string[] = []; let closed = false;
    const setup = await testRender(<TextPromptDialog title="Fixture title" onSubmit={(v) => values.push(v)} onClose={() => { closed = true; }} />, { width: 80, height: 25 });
    try {
      await setup.waitForFrame((f) => f.includes("Fixture title"));
      await act(async () => { await setup.mockInput.pasteBracketedText("pasted title"); await setup.mockInput.pressKeys(["\r"]); });
      expect(values).toEqual(["pasted title"]);
      await act(async () => { await setup.mockInput.pressKeys(["\x1b"], 100); });
      expect(closed).toBe(true);
    } finally { setup.renderer.destroy(); }
  });
});

// Reference Option row law (opencode v2ref b084acc ui/dialog-select.tsx,
// verified against rendered ground-truth frames captured from the reference
// test harness at 100x30 / 80x24 / 60x20 — sitting 7 unit 1):
// - the title truncates at a FIXED 61 characters (Locale.truncate, character
//   based, "…") regardless of row width — width-relative ratios are wrong;
// - the description joins with a SINGLE space and the pair hard-clips at the
//   row's usable width (dialogWidth - 12 - status) WITHOUT an ellipsis;
// - group headers share the title column (card + 4);
// - an empty result set reads "No results found" / "No items available".
describe("picker row geometry (reference Option law)", () => {
  const LONG = "A very long session title that goes well beyond the sixty-one character truncation boundary for sure";

  test("wide rows cap the title at 61 characters even with room for more", async () => {
    const setup = await testRender(<SelectDialog title="Sessions" size="large" options={[
      { id: "s1", label: LONG, value: "s1" },
    ]} onSelect={() => {}} onClose={() => {}} />, { width: 100, height: 30 });
    try {
      const frame = await setup.waitForFrame((f) => f.includes("sixty-on"));
      // Locale.truncate(title, 61): first 60 chars + "…".
      expect(frame).toContain(`${LONG.slice(0, 60)}…`);
      // Nothing past the cap survives, even though the row is 76 cells wide.
      expect(frame).not.toContain(LONG.slice(60));
    } finally { setup.renderer.destroy(); }
  });

  test("description joins with one space and hard-clips without an ellipsis", async () => {
    const setup = await testRender(<SelectDialog title="Sessions" size="large" options={[
      { id: "s1", label: LONG, value: "s1", description: "some-provider-name" },
    ]} onSelect={() => {}} onClose={() => {}} />, { width: 100, height: 30 });
    try {
      // Card is 88 wide → usable 76; 61-cap + " " + desc clips mid-description.
      const frame = await setup.waitForFrame((f) => f.includes("sixty-on"));
      expect(frame).toContain(`${LONG.slice(0, 60)}…`);
      expect(frame).toContain("some-provi");
      // The clip is silent: the full description and an ellipsized tail are
      // both wrong — reference overflow hidden cuts without a marker.
      expect(frame).not.toContain("some-provider-name");
      expect(frame).not.toContain("na…");
    } finally { setup.renderer.destroy(); }
  });

  test("group headers share the title column", async () => {
    const setup = await testRender(<SelectDialog title="Sessions" options={[
      { id: "a", label: "First pinned session", value: "a", group: "Pinned" },
      { id: "b", label: "Today session", value: "b", group: "Today" },
    ]} onSelect={() => {}} onClose={() => {}} />, { width: 80, height: 24 });
    try {
      const frame = await setup.waitForFrame((f) => f.includes("Pinned") && f.includes("Today session"));
      const lines = frame.split("\n");
      const headerCol = (lines.find((l) => l.includes("Pinned")) ?? "").indexOf("Pinned");
      const rowCol = (lines.find((l) => l.includes("First pinned session")) ?? "").indexOf("First pinned session");
      expect(headerCol).toBeGreaterThan(-1);
      expect(rowCol).toBeGreaterThan(-1);
      expect(headerCol).toBe(rowCol);
    } finally { setup.renderer.destroy(); }
  });

  test("empty and unmatched lists use the reference default views", async () => {
    const none = await testRender(<SelectDialog title="Sessions" options={[]}
      onSelect={() => {}} onClose={() => {}} />, { width: 80, height: 24 });
    try {
      const frame = await none.waitForFrame((f) => f.includes("Sessions"));
      expect(frame).toContain("No items available");
    } finally { none.renderer.destroy(); }

    const unmatched = await testRender(<SelectDialog title="Sessions" options={[
      { id: "a", label: "alpha", value: "a" },
    ]} onSelect={() => {}} onClose={() => {}} />, { width: 80, height: 24 });
    try {
      await unmatched.waitForFrame((f) => f.includes("alpha"));
      await act(async () => { await unmatched.mockInput.pressKeys([..."zzz"]); });
      const frame = await unmatched.waitForFrame((f) => f.includes("No results found"));
      expect(frame).toContain("zzz");
    } finally { unmatched.renderer.destroy(); }
  });
});
