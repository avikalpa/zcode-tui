// Inline tool status details (reference routes/session/index.tsx, pinned
// v2ref): Glob/Grep hide the count segment when it is 0 (Solid <Show> is
// truthy-gated on finiteNumber), Read's "↳ Loaded" rows render only on the
// completed status, and GenericTool pretty-prints non-string input values
// (JSON.stringify(value, null, 2)). Char frames do not establish live
// pixels.
import { describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { ToolPart } from "./session/tool-parts";
import { THEMES } from "./design";

const C = Object.values(THEMES)[0]!;

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

async function frameOf(node: React.ReactNode, needle: string, width = 80, height = 24) {
  const setup = await testRender(mount(node), { width, height });
  try {
    return await setup.waitForFrame((f) => f.includes(needle), { maxPasses: 30 });
  } finally {
    setup.renderer.destroy();
  }
}

describe("glob/grep count law (reference <Show> truthy gate)", () => {
  test("a glob with zero matches hides the count segment", async () => {
    const frame = await frameOf(
      part({ tool: "glob", input: { pattern: "**/*.nope" }, metadata: { count: 0 } }),
      'Glob "**/*.nope"',
    );
    expect(frame).not.toContain("(0 matches)");
  });

  test("a glob with matches shows the pluralized count", async () => {
    const frame = await frameOf(
      part({ tool: "glob", input: { pattern: "**/*.ts" }, metadata: { count: 2 } }),
      "(2 matches)",
    );
    expect(frame).toContain("(2 matches)");
  });

  test("a grep with zero matches hides the count segment", async () => {
    const frame = await frameOf(
      part({ tool: "grep", input: { pattern: "nothing" }, metadata: { matches: 0 } }),
      'Grep "nothing"',
    );
    expect(frame).not.toContain("(0 matches)");
  });
});

describe("read loaded-row law (completed-only)", () => {
  test("a running read shows no loaded rows even when metadata carries them", async () => {
    // the spinner law shows the row's children under the glyph while
    // running ("⠋ Read /tmp/a.ts"), so that is the settle needle
    const frame = await frameOf(
      part({ tool: "read", status: "running", input: { file_path: "/tmp/a.ts" }, metadata: { loaded: ["/tmp/a.ts"] } }),
      "Read /tmp/a.ts",
    );
    expect(frame).not.toContain("↳ Loaded");
  });

  test("a completed read shows its loaded rows", async () => {
    const frame = await frameOf(
      part({ tool: "read", input: { file_path: "/tmp/a.ts" }, metadata: { loaded: ["/tmp/a.ts"] } }),
      "↳ Loaded /tmp/a.ts",
    );
    expect(frame).toContain("↳ Loaded /tmp/a.ts");
  });
});

describe("generic tool detail law (pretty-printed values)", () => {
  test("expanded objects print pretty JSON, not compact", async () => {
    const setup = await testRender(
      mount(
        <ToolPart
          C={C}
          m={{ tool: "customtool", status: "completed", input: { options: { retries: 3 } } } as Parameters<typeof ToolPart>[0]["m"]}
          expanded={true}
          width={80}
          spinnerChar="⠋"
        />,
      ),
      { width: 80, height: 24 },
    );
    try {
      const expanded = await setup.waitForFrame((f) => f.includes("options:"), { maxPasses: 30 });
      expect(expanded).toContain('"retries": 3');
      expect(expanded).not.toContain('{"retries":3}');
    } finally {
      setup.renderer.destroy();
    }
  });
});
