import { describe, expect, test } from "bun:test";
import { useState } from "react";
import { testRender } from "@opentui/react/test-utils";
import { RGBA, SyntaxStyle, TextAttributes } from "@opentui/core";
import { THEMES } from "../design";
import {
  ThinkingBlock, appendThinking, completeThinking, generateThinkingSyntax,
  reasoningContent, reasoningSummary, thinkingDuration, thinkingDurationLabel,
} from "./thinking";

const C = THEMES.opencode;
const syntax = SyntaxStyle.fromStyles({ default: { fg: RGBA.fromHex(C.fg) },
  "markup.italic": { fg: RGBA.fromHex(C.fg), italic: true },
  "markup.strong": { fg: RGBA.fromHex(C.fg), bold: true } });
const body = "Opening sentence is preserved. " + "A measured fixture detail. ".repeat(8) + "Final sentence is preserved.";
const parts = [{ text: `**Inspecting fixture**\n\n${body}`, startedAt: 1000, completedAt: 3500 }];
// Highlighting runs in a worker after the renderer can become idle. The
// renderer's waitForFrame stops at idle, so explicitly await worker output.
async function waitForText(setup: Awaited<ReturnType<typeof testRender>>, needle: string) {
  for (let i = 0; i < 100; i++) {
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    if (frame.includes(needle)) return frame;
    await Bun.sleep(20);
  }
  throw new Error(`Missing ${needle}:\n${setup.captureCharFrame()}`);
}
const row = (frame: string, needle: string) => frame.split("\n").findIndex((line) => line.includes(needle));

describe("thinking disclosure (pinned OpenCode reference)", () => {
  test("completed header opens the entire markdown block and closes again", async () => {
    const setup = await testRender(<ThinkingBlock parts={parts} mode="hide" done C={C} syntaxStyle={syntax} spinnerChar="·" />, { width: 80, height: 24 });
    try {
      const closed = await setup.waitForFrame((f) => f.includes("+ Thought: Inspecting fixture · 2.5s"));
      expect(closed).not.toContain("Opening sentence");
      await setup.mockMouse.click(4, row(closed, "+ Thought"));
      const open = await waitForText(setup, "Final sentence is preserved.");
      expect(open).toContain("Opening sentence is preserved.");
      expect(open).toContain("┃");
      expect(open).toContain("- Thought · 2.5s");
      await setup.mockMouse.click(20, row(open, "- Thought"));
      const closedAgain = await setup.waitForFrame((f) => f.includes("+ Thought:"));
      expect(closedAgain).not.toContain("Opening sentence");
    } finally { setup.renderer.destroy(); }
  });

  test("live reasoning can be expanded and remains readable after completion", async () => {
    function Fixture() {
      const [done, setDone] = useState(false);
      return <box flexDirection="column">
        <text content="Finish fixture" onMouseUp={() => setDone(true)} />
        <ThinkingBlock parts={done ? parts : [{ ...parts[0], completedAt: undefined }]} mode="hide" done={done} C={C} syntaxStyle={syntax} spinnerChar="◐" />
      </box>;
    }
    const setup = await testRender(<Fixture />, { width: 80, height: 24 });
    try {
      const live = await setup.waitForFrame((f) => f.includes("Thinking: Inspecting fixture"));
      expect(live).not.toContain("Opening sentence");
      await setup.mockMouse.click(4, row(live, "Thinking:"));
      await waitForText(setup, "Opening sentence");
      await setup.mockMouse.click(4, 0);
      const done = await setup.waitForFrame((f) => f.includes("- Thought · 2.5s"));
      expect(await waitForText(setup, "Final sentence is preserved.")).toContain("- Thought · 2.5s");
    } finally { setup.renderer.destroy(); }
  });

  test("show mode exposes every part; hide mode summarizes steps and excludes unknown time", async () => {
    const multiple = [...parts, { text: "Untimed second step" }];
    const setup = await testRender(<ThinkingBlock parts={multiple} mode="show" done C={C} syntaxStyle={syntax} spinnerChar="·" />, { width: 80, height: 24 });
    try {
      const frame = await waitForText(setup, "Untimed second step");
      expect(frame).toContain("Thought: 2.5s");
      expect(frame).toContain("Opening sentence");
      expect(frame).not.toContain("+ Thought");
    } finally { setup.renderer.destroy(); }
    const hidden = await testRender(<ThinkingBlock parts={multiple} mode="hide" done C={C} syntaxStyle={syntax} spinnerChar="·" />, { width: 80, height: 24 });
    try {
      const frame = await hidden.waitForFrame((f) => f.includes("+ Thought · 2 steps · 2.5s"));
      expect(frame).not.toContain("Untimed second step");
    } finally { hidden.renderer.destroy(); }
  });

  test("empty and encrypted placeholders produce no disclosure", async () => {
    const setup = await testRender(<ThinkingBlock parts={[{ text: " [REDACTED] " }, { text: "  " }]} mode="hide" done C={C} syntaxStyle={syntax} spinnerChar="·" />, { width: 40, height: 8 });
    try { await setup.flush(); expect(setup.captureCharFrame().trim()).toBe(""); }
    finally { setup.renderer.destroy(); }
  });

  test("a narrow viewport keeps the full body available across wrapped lines", async () => {
    const setup = await testRender(<ThinkingBlock parts={[{ text: "First fixture line.\n\nLast fixture line." }]} mode="show" done C={C} syntaxStyle={syntax} spinnerChar="·" />, { width: 24, height: 20 });
    try {
      const frame = await waitForText(setup, "Last fixture line.");
      expect(frame).toContain("First fixture line.");
      expect(frame).not.toContain("0ms");
    } finally { setup.renderer.destroy(); }
  });
});

describe("reasoning data and syntax", () => {
  test("summary detection preserves ordinary bold prose and incomplete titles", () => {
    expect(reasoningSummary("**Inspection**\n\n    indented body")).toEqual({ title: "Inspection", body: "    indented body" });
    expect(reasoningSummary("**Inspection**").title).toBe("Inspection");
    expect(reasoningSummary("**Inspection").title).toBeNull();
    expect(reasoningSummary("**Important:** keep this in the body.").title).toBeNull();
    expect(reasoningContent({ text: "[REDACTED]" })).toBe("");
  });
  test("reasoning ends at text/tool boundaries; answer latency does not inflate its duration", () => {
    let parts = appendThinking([], "First ", 1000);
    parts = appendThinking(parts, "step", 2000);
    parts = completeThinking(parts, 3500);
    parts = appendThinking(parts, "Second step", 5000);
    parts = completeThinking(parts, 6000);
    parts = completeThinking(parts, 20000);
    expect(parts.map((p) => p.text)).toEqual(["First step", "Second step"]);
    expect(thinkingDuration(parts)).toBe(3500);
    expect(thinkingDuration([{ text: "historical text" }])).toBeUndefined();
    expect(thinkingDurationLabel(999)).toBe("999ms");
    expect(thinkingDurationLabel(61500)).toBe("1m 1s");
  });
  test("thinking syntax subdues every scope while retaining bold and italic emphasis", () => {
    const fg = RGBA.fromHex(C.subtle);
    const thinking = generateThinkingSyntax(syntax, fg);
    expect(thinking.mergeStyles("markup.italic").attributes & TextAttributes.ITALIC).not.toBe(0);
    expect(thinking.mergeStyles("markup.strong").attributes & TextAttributes.BOLD).not.toBe(0);
    expect(thinking.getStyle("markup.strong")?.fg?.equals(fg)).toBe(true);
  });
});
