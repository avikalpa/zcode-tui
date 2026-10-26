// Shell block law (reference routes/session/index.tsx ShellDisplay): while
// RUNNING the command rides a bare spinner-glyph row (glyph + command,
// gap 1) with the "$ " prefix withheld and the collapse budget loses 2
// columns; any settled state carries "$ " again. A commandless running
// shell shows "⠋ Writing command…" through the block title. Char frames
// do not establish live pixels.
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

describe("shell block (reference running spinner law)", () => {
  test("a running shell shows the command under the spinner glyph without the $ prefix", async () => {
    const setup = await testRender(
      part({ tool: "shell", status: "running", input: { command: "bun test" } }),
      { width: 80, height: 12 },
    );
    try {
      const frame = await setup.waitForFrame((f) => f.includes("bun test"), { maxPasses: 30 });
      expect(frame).toContain("⠋ bun test");
      expect(frame).not.toContain("$ bun test");
    } finally {
      setup.renderer.destroy();
    }
  });

  test("a completed shell carries the $ prefix and no spinner glyph", async () => {
    const setup = await testRender(
      part({ tool: "shell", input: { command: "bun test" } }),
      { width: 80, height: 12 },
    );
    try {
      const frame = await setup.waitForFrame((f) => f.includes("$ bun test"), { maxPasses: 30 });
      expect(frame).toContain("$ bun test");
      expect(frame).not.toContain("⠋ bun test");
    } finally {
      setup.renderer.destroy();
    }
  });

  test("a commandless running shell spins on the Writing command… title", async () => {
    const setup = await testRender(
      part({ tool: "shell", status: "running", input: {} }),
      { width: 80, height: 12 },
    );
    try {
      const frame = await setup.waitForFrame((f) => f.includes("Writing command…"), { maxPasses: 30 });
      expect(frame).toContain("⠋ Writing command…");
    } finally {
      setup.renderer.destroy();
    }
  });
});
