import { expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { PromptFooter } from "./prompt-footer";
import { THEMES } from "./design";

test("wide idle footer shares one row: location left, both hints right", async () => {
  const setup = await testRender(<PromptFooter C={THEMES.opencode} width={75} terminalWidth={100}
    location="/fixture/projects/terminal/some/very/long/path:topic" />, { width: 75, height: 3 });
  try {
    const frame = await setup.waitForFrame((f) => f.includes("shift+tab"));
    const lines = frame.split("\n").filter((line) => line.trim());
    expect(lines).toHaveLength(1);
    for (const text of ["shift+tab agents", "ctrl+p commands"]) expect(lines[0]).toContain(text);
    expect(lines[0]).toContain("…");
  } finally { setup.renderer.destroy(); }
});

test("narrow status prioritizes usage and path, hiding shortcuts like the reference", async () => {
  const setup = await testRender(<PromptFooter C={THEMES.opencode} width={40} terminalWidth={40}
    location="/fixture/文件/long-directory/session:topic" context="12K · 6%" />, { width: 40, height: 3 });
  try {
    const frame = await setup.waitForFrame((f) => f.includes("12K"));
    expect(frame).toContain("6%");
    expect(frame).not.toContain("commands");
    expect(frame).toContain("…");
    expect(frame.split("\n").filter((line) => line.trim())).toHaveLength(1);
  } finally { setup.renderer.destroy(); }
});

test("running status uses the reference interrupt label and leaves usage visible", async () => {
  const setup = await testRender(<PromptFooter C={THEMES.opencode} width={80} terminalWidth={80} location="/fixture"
    running spinner="▪" context="12K · 6%" />, { width: 80, height: 3 });
  try {
    const frame = await setup.waitForFrame((f) => f.includes("esc interrupt"));
    expect(frame).toContain("12K · 6%");
    expect(frame).not.toContain("commands");
  } finally { setup.renderer.destroy(); }
});
