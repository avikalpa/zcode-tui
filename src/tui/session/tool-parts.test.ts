import { describe, expect, test } from "bun:test";
import {
  canonicalToolName,
  collapseShellOutput,
  collapseToolOutput,
  genericToolSummary,
  primitiveInputSummary,
  toolDisplay,
} from "./tool-parts";

describe("tool display classes", () => {
  test("canonical names map zcode tool vocabulary", () => {
    expect(canonicalToolName("Bash")).toBe("shell");
    expect(canonicalToolName("Task")).toBe("subagent");
    expect(canonicalToolName("apply_patch")).toBe("patch");
    expect(canonicalToolName("Read")).toBe("read");
  });

  test("unknown tools fall to generic", () => {
    expect(toolDisplay("TodoWrite")).toBe("generic");
    expect(toolDisplay("Bash")).toBe("shell");
    expect(toolDisplay("WebFetch")).toBe("webfetch");
  });
});

describe("generic tool summary", () => {
  test("tool + primitive args, non-primitives omitted", () => {
    expect(genericToolSummary("TodoWrite", { todos: [{ x: 1 }], n: 2, flag: true })).toBe("TodoWrite [n=2, flag=true]");
    expect(genericToolSummary("Read", {})).toBe("Read");
  });

  test("primitiveInputSummary brackets", () => {
    expect(primitiveInputSummary({ a: "x", b: 1 })).toBe("[a=x, b=1]");
    expect(primitiveInputSummary({ a: "x" }, ["a"])).toBe("");
  });
});

describe("collapseToolOutput", () => {
  test("short output passes whole", () => {
    const r = collapseToolOutput("one\ntwo", 10, 1000);
    expect(r.overflow).toBe(false);
    expect(r.output).toBe("one\ntwo");
  });

  test("long output truncates to the head with an ellipsis", () => {
    const out = Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n");
    const r = collapseToolOutput(out, 10, 10000);
    expect(r.overflow).toBe(true);
    expect(r.output.split("\n").length).toBe(10);
    expect(r.output.endsWith("…")).toBe(true);
  });

  test("very long single line clips by chars", () => {
    const r = collapseToolOutput("x".repeat(5000), 10, 100);
    expect(r.overflow).toBe(true);
    expect(r.output.length).toBeLessThanOrEqual(101);
  });
});

describe("collapseShellOutput", () => {
  test("command + long output keeps the head and tails the output", () => {
    const out = Array.from({ length: 60 }, (_, i) => `out ${i}`).join("\n");
    const r = collapseShellOutput("$ ls -la", out, 10, 10000);
    expect(r.input).toBe("$ ls -la");
    expect(r.overflow).toBe(true);
    // tail collapse: the LAST lines survive with an "(N earlier lines)" label
    expect(r.output).toContain("earlier");
    expect(r.output).toContain("out 59");
  });

  test("short command and output pass through without overflow", () => {
    const r = collapseShellOutput("$ echo hi", "hi", 10, 1000);
    expect(r.overflow).toBe(false);
    expect(r.output).toBe("hi");
  });
});
