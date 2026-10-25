// InlineToolRow spinner + children law (reference message-parts.tsx
// InlineToolRow + the per-tool call sites in routes/session/index.tsx): a
// tool that passes `spinner` runs with its CHILDREN under the spinner glyph
// ("⠋ Read /path"), one that does not shows the pending label; the Read
// "↳ Loaded" rows render unconditionally; subagent rows carry the model
// label suffix; Skill quotes its resolved name. Char frames do not
// establish live pixels.
import { describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { ToolPart, editDiffView, subagentModelLabel, toolDisplay } from "./session/tool-parts";
import { THEMES } from "./design";

const C = Object.values(THEMES)[0]!;

const PATCH = "@@ -1,1 +1,1 @@\n-const old = 1;\n+const fresh = 2;\n";

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

describe("inline tool rows (reference spinner + children law)", () => {
  test("a running Read shows its label under the spinner, not the pending text", async () => {
    const setup = await testRender(
      part({ tool: "read", status: "running", input: { file_path: "/tmp/fixture.ts" } }),
      { width: 80, height: 10 },
    );
    try {
      const frame = await setup.waitForFrame((f) => f.includes("Read /tmp/fixture.ts"), { maxPasses: 20 });
      expect(frame).toContain("⠋ Read /tmp/fixture.ts");
      expect(frame).not.toContain("Reading file…");
    } finally {
      setup.renderer.destroy();
    }
  });

  test("Glob keeps the pending label while running (no spinner prop)", async () => {
    const setup = await testRender(
      part({ tool: "glob", status: "running", input: { pattern: "**/*.ts" } }),
      { width: 80, height: 10 },
    );
    try {
      const frame = await setup.waitForFrame((f) => f.includes("Finding files…"), { maxPasses: 20 });
      expect(frame).toContain("⠋ Finding files…");
    } finally {
      setup.renderer.destroy();
    }
  });

  test("the Read loaded rows render without expansion", async () => {
    const setup = await testRender(
      part({
        tool: "read",
        status: "completed",
        input: { file_path: "/tmp/fixture.ts" },
        metadata: { loaded: ["/tmp/other.ts"] },
      }),
      { width: 80, height: 10 },
    );
    try {
      const frame = await setup.waitForFrame((f) => f.includes("Loaded /tmp/other.ts"), { maxPasses: 20 });
      expect(frame).toContain("↳ Loaded /tmp/other.ts");
    } finally {
      setup.renderer.destroy();
    }
  });

  test("a running subagent shows its title under the spinner with the model suffix", async () => {
    const setup = await testRender(
      part({
        tool: "subagent",
        status: "running",
        input: { agent: "general", description: "hunting the leak", model: "zai-api/glm-5.3-flash#high" },
      }),
      { width: 80, height: 10 },
    );
    try {
      const frame = await setup.waitForFrame((f) => f.includes("General Subagent — hunting the leak"), { maxPasses: 20 });
      expect(frame).toContain("⠋ General Subagent — hunting the leak · zai-api/glm-5.3-flash (high)");
      expect(frame).not.toContain("Delegating…");
    } finally {
      setup.renderer.destroy();
    }
  });

  test("Skill quotes its resolved name", async () => {
    const setup = await testRender(
      part({ tool: "skill", status: "completed", input: { id: "fixture-skill" }, metadata: { name: "Fixture Skill" } }),
      { width: 80, height: 10 },
    );
    try {
      const frame = await setup.waitForFrame((f) => f.includes("Skill"), { maxPasses: 20 });
      expect(frame).toContain('→ Skill "Fixture Skill"');
    } finally {
      setup.renderer.destroy();
    }
  });

  test("subagentModelLabel splits reference and variant", () => {
    expect(subagentModelLabel("zai-api/glm-5.3-flash#high")).toBe("zai-api/glm-5.3-flash (high)");
    expect(subagentModelLabel("glm-5.3-flash")).toBe("glm-5.3-flash");
    expect(subagentModelLabel(undefined)).toBeUndefined();
    expect(toolDisplay("bash")).toBe("shell");
  });
});

describe("edit block (reference Edit view law)", () => {
  test("split on wide terminals, unified below 120 columns", () => {
    expect(editDiffView(130)).toBe("split");
    expect(editDiffView(120)).toBe("unified");
    expect(editDiffView(80)).toBe("unified");
  });

  test("a one-line replacement is side-by-side at 130 and stacked at 80", async () => {
    const part = (width: number) => (
      <ToolPart
        C={C}
        m={{ tool: "edit", status: "completed", input: { file_path: "/tmp/fixture.ts" }, metadata: { files: [{ patch: PATCH }] } }}
        expanded={false}
        width={width}
        spinnerChar="⠋"
      />
    );
    const wide = await testRender(mount(part(130)), { width: 130, height: 12 });
    try {
      const frame = await wide.waitForFrame((f) => f.includes("const fresh = 2"), { maxPasses: 20 });
      const row = frame.split("\n").find((l) => l.includes("const fresh = 2"));
      expect(row).toContain("const old = 1");
    } finally {
      wide.renderer.destroy();
    }
    const narrow = await testRender(mount(part(80)), { width: 80, height: 12 });
    try {
      const frame = await narrow.waitForFrame((f) => f.includes("const fresh = 2"), { maxPasses: 20 });
      const row = frame.split("\n").find((l) => l.includes("const fresh = 2"));
      expect(row).not.toContain("const old = 1");
    } finally {
      narrow.renderer.destroy();
    }
  });
});
