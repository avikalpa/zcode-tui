// Write block law (reference routes/session/index.tsx Write): the completed
// block shows the FULL content through the line-number gutter (text.subdued,
// minWidth 3, paddingRight 1) wrapping the syntax code element (conceal off,
// text.default, filetype of the path), then the metadata diagnostics error
// rows — severity 1 only, "Error [line:column] message", capped at 3.
// filetypeOf reads the reference grammar table. Char frames do not
// establish live pixels.
import { describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { ToolPart, parseDiagnostics } from "./session/tool-parts";
import { filetypeOf } from "./diff/diff-viewer";
import { THEMES } from "./design";

const C = Object.values(THEMES)[0]!;
const CONTENT = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n");

function mount(node: React.ReactNode) {
  return <box style={{ width: 80, flexDirection: "column" }}>{node}</box>;
}

function part(m: Partial<Parameters<typeof ToolPart>[0]["m"]> & { tool: string }) {
  return mount(
    <ToolPart
      C={C}
      m={{ status: "completed", input: {}, ...m } as Parameters<typeof ToolPart>[0]["m"]}
      expanded={false}
      width={80}
      spinnerChar="⠋"
    />,
  );
}

describe("write block (reference line-number + syntax body law)", () => {
  test("a completed Write shows the full content with a line-number gutter, not a truncated body", async () => {
    const setup = await testRender(
      part({ tool: "write", input: { file_path: "/tmp/fixture.ts", content: CONTENT } }),
      { width: 80, height: 40 },
    );
    try {
      const frame = await setup.waitForFrame((f) => f.includes("line 30"), { maxPasses: 30 });
      // the 30th source line renders (the inherited 12-line slice cut here)
      expect(frame).toContain("line 30");
      // gutter digits for the last row ride beside it (minWidth 3 right-align)
      expect(frame).toMatch(/30\s*line 30/);
    } finally {
      setup.renderer.destroy();
    }
  });

  test("metadata diagnostics render as severity-1 error rows with line:column", async () => {
    const setup = await testRender(
      part({
        tool: "write",
        input: { file_path: "/tmp/fixture.ts", content: CONTENT },
        metadata: {
          diagnostics: {
            "/tmp/fixture.ts": [
              { severity: 1, range: { start: { line: 1, character: 0 } }, message: "first" },
              { severity: 2, range: { start: { line: 2, character: 0 } }, message: "warn should skip" },
              { severity: 1, range: { start: { line: 3, character: 4 } }, message: "second" },
            ],
          },
        },
      }),
      { width: 80, height: 40 },
    );
    try {
      const frame = await setup.waitForFrame((f) => f.includes("Error [2:1] first"), { maxPasses: 30 });
      expect(frame).toContain("Error [2:1] first");
      expect(frame).toContain("Error [4:5] second");
      expect(frame).not.toContain("warn should skip");
    } finally {
      setup.renderer.destroy();
    }
  });
});

describe("write block helpers", () => {
  test("parseDiagnostics keeps severity 1 only, requires range+message, caps at 3", () => {
    const diagnostic = (severity: number, line: number, message = "m") => ({
      severity,
      range: { start: { line, character: 0 } },
      message,
    });
    const value = {
      "/tmp/x.ts": [
        diagnostic(1, 0, "a"),
        diagnostic(2, 1, "warning"),
        { severity: 1, message: "no range" },
        { severity: 1, range: { start: { line: 3 } }, message: "no character" },
        diagnostic(1, 4, "b"),
        diagnostic(1, 5, "c"),
        diagnostic(1, 6, "d"),
      ],
    };
    const parsed = parseDiagnostics(value, "/tmp/x.ts");
    expect(parsed.map((d) => d.message)).toEqual(["a", "b", "c"]);
    expect(parsed[0]!.range.start.line).toBe(0);
    expect(parseDiagnostics(undefined, "/tmp/x.ts")).toEqual([]);
    expect(parseDiagnostics({ "/tmp/other.ts": [diagnostic(1, 0, "a")] }, "/tmp/x.ts")).toEqual([]);
  });

  test("filetypeOf reads the reference grammar table", () => {
    expect(filetypeOf("src/main.ts")).toBe("typescript");
    expect(filetypeOf("src/app.tsx")).toBe("typescript");
    expect(filetypeOf("script.py")).toBe("python");
    expect(filetypeOf("run.sh")).toBe("bash");
    expect(filetypeOf("Makefile")).toBe("none");
    expect(filetypeOf("")).toBe("none");
    expect(filetypeOf(".hidden")).toBe("none");
  });
});
