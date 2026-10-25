// Composer autocomplete popup frame treatment (reference Autocomplete port,
// b084acc55e 873-951): SplitBorder walls in the border colour, background
// default inside, pad-1 rows, full-set command alignment, leading-space
// descriptions, per-trigger empty messages. Char frames do not establish
// live pixels.
import { describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { SlashPopup } from "./app";
import { THEMES } from "./design";

const C = Object.values(THEMES)[0]!;

// The popup floats above its anchor; the fixture reproduces the App shape —
// an anchor box in the middle of the screen so bottom:"100%" stays visible.
function mount(popup: React.ReactNode) {
  return (
    <box style={{ width: 60, height: 20, flexDirection: "column" }}>
      <box style={{ height: 5, flexShrink: 0 }} />
      <box style={{ height: 6, flexShrink: 0, flexDirection: "column" }}>{popup}</box>
    </box>
  );
}

describe("popup treatment (reference autocomplete frames)", () => {
  test("SplitBorder walls, row pad, full-set name alignment, leading-space description", async () => {
    const setup = await testRender(
      mount(
        <SlashPopup
          commands={[
            { name: "agents", aliases: ["agent"], description: "switch agent mode" },
            { name: "sessions", aliases: ["session"], description: "browse conversations" },
          ]}
          files={[]}
          idx={0}
          win={0}
          C={C}
          width={40}
        />,
      ),
      { width: 60, height: 20 },
    );
    try {
      const frame = await setup.waitForFrame((f) => f.includes("switch agent mode"), { maxPasses: 20 });
      const lines = frame.split("\n");
      // Wall + row pad before the name; the wall closes the row.
      const agentLine = lines.find((l) => l.includes("/agents"));
      const sessionLine = lines.find((l) => l.includes("/sessions"));
      expect(agentLine).toBeDefined();
      expect(agentLine!.trimEnd().endsWith("┃")).toBe(true);
      expect(agentLine).toContain("┃ /agents");
      // Alignment over the FULL command set ("/new-session" → pad 14), not a
      // fixed 12: eight spaces separate "agents" from its description.
      expect(agentLine).toContain("/agents        switch agent mode");
      // Both descriptions start at the same column.
      expect(sessionLine).toBeDefined();
      expect(sessionLine!.indexOf("browse conversations")).toBe(agentLine!.indexOf("switch agent mode"));
    } finally {
      setup.renderer.destroy();
    }
  });

  test("per-trigger empty messages replace the invented generic line", async () => {
    const setup = await testRender(
      mount(<SlashPopup commands={[]} files={[]} idx={0} win={0} C={C} width={60} empty="No matching commands" />),
      { width: 60, height: 20 },
    );
    try {
      const frame = await setup.waitForFrame((f) => f.includes("No matching commands"), { maxPasses: 20 });
      expect(frame).not.toContain("No matching items");
      const line = frame.split("\n").find((l) => l.includes("No matching commands"));
      expect(line).toContain("┃ No matching commands");
    } finally {
      setup.renderer.destroy();
    }
  });

  test("the reference empty message for the @ trigger", async () => {
    const setup = await testRender(
      mount(
        <SlashPopup commands={[]} files={[]} idx={0} win={0} C={C} width={60} empty="No matching files, agents, or references" />,
      ),
      { width: 60, height: 20 },
    );
    try {
      await setup.waitForFrame((f) => f.includes("No matching files, agents, or references"), { maxPasses: 20 });
    } finally {
      setup.renderer.destroy();
    }
  });
});
