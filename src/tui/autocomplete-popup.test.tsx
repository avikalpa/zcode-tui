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

  // The reference caps the popup at the anchor's absolute y when open —
  // height = min(10, count, max(1, anchor.y)) — autocomplete.tsx 849-854.
  const clampCommands = ["aa", "bb", "cc", "dd", "ee", "ff"].map((name) => ({
    name,
    aliases: [] as string[],
    description: `desc ${name}`,
  }));
  const popupRows = (frame: string) => frame.split("\n").filter((l) => (l.match(/┃/g) ?? []).length >= 2);

  test("the popup height is capped at the anchor's y when the anchor clamp is given", async () => {
    const setup = await testRender(
      mount(<SlashPopup commands={clampCommands} files={[]} idx={0} win={0} C={C} width={40} maxRows={3} />),
      { width: 60, height: 20 },
    );
    try {
      await setup.waitForFrame((f) => f.includes("desc bb"), { maxPasses: 20 });
      const frame = await setup.waitForFrame((f) => (f.match(/┃/g) ?? []).filter(Boolean).length >= 2, { maxPasses: 20 });
      const rows = popupRows(frame);
      expect(rows.length).toBe(3);
      expect(rows[0]).toContain("┃ /aa");
      expect(rows[2]).toContain("┃ /cc");
    } finally {
      setup.renderer.destroy();
    }
  });

  test("the clamp never drops below one row and never inflates a short list", async () => {
    const setup = await testRender(
      mount(<SlashPopup commands={clampCommands.slice(0, 2)} files={[]} idx={0} win={0} C={C} width={40} maxRows={0} />),
      { width: 60, height: 20 },
    );
    try {
      await setup.waitForFrame((f) => f.includes("desc"), { maxPasses: 20 });
      const frame = await setup.waitForFrame((f) => (f.match(/┃/g) ?? []).filter(Boolean).length >= 2, { maxPasses: 20 });
      const rows = popupRows(frame);
      expect(rows.length).toBe(1);
      expect(rows[0]).toContain("┃ /aa");
    } finally {
      setup.renderer.destroy();
    }
    const wide = await testRender(
      mount(<SlashPopup commands={clampCommands.slice(0, 3)} files={[]} idx={0} win={0} C={C} width={40} maxRows={99} />),
      { width: 60, height: 20 },
    );
    try {
      await wide.waitForFrame((f) => f.includes("desc bb"), { maxPasses: 20 });
      const wideFrame = await wide.waitForFrame((f) => f.includes("desc aa"), { maxPasses: 20 });
      expect(popupRows(wideFrame).length).toBe(3);
    } finally {
      wide.renderer.destroy();
    }
  });

  test("the empty message stays a single row under the clamp", async () => {
    const setup = await testRender(
      mount(<SlashPopup commands={[]} files={[]} idx={0} win={0} C={C} width={40} maxRows={0} empty="No matching commands" />),
      { width: 60, height: 20 },
    );
    try {
      const frame = await setup.waitForFrame((f) => f.includes("No matching commands"), { maxPasses: 20 });
      expect(popupRows(frame).length).toBe(1);
    } finally {
      setup.renderer.destroy();
    }
  });

  test("the selection stays inside the clamped window without inventing rows", async () => {
    const setup = await testRender(
      mount(<SlashPopup commands={clampCommands} files={[]} idx={5} win={0} C={C} width={40} maxRows={3} />),
      { width: 60, height: 20 },
    );
    try {
      await setup.waitForFrame((f) => f.includes("desc bb"), { maxPasses: 20 });
      const frame = await setup.waitForFrame((f) => (f.match(/┃/g) ?? []).filter(Boolean).length >= 2, { maxPasses: 20 });
      const rows = popupRows(frame);
      // The App's reveal window already slid past the cap, so the render
      // repairs the slice: exactly maxRows rows, the off-window tail gone.
      expect(rows.length).toBe(3);
      expect(rows[0]).toContain("┃ /aa");
      expect(rows[2]).toContain("┃ /cc");
      expect(frame).not.toContain("desc ff");
    } finally {
      setup.renderer.destroy();
    }
  });
});
