// PatchDiff virtualization contract (v2.0.18 #51122 render half).
// Renders a >3000-line new-file patch inside a scrollbox and proves the
// virtual window: only the chunks overlapping the viewport (+-1) mount real
// DiffRenderables while the rest stay fixed-height placeholders, the window
// follows the scroll offset, and a small patch stays on the per-hunk path
// even when the scroll plane is wired.
import { describe, expect, test } from "bun:test";
import { DiffRenderable, type Renderable, type ScrollBoxRenderable } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { PatchDiff, type PatchDiffProps } from "./patch-diff";
import { splitAddedPatch } from "./split-patch-hunks";

const LINES = 3200;
const bigPatch = [
  "--- /dev/null",
  "+++ b/big.txt",
  `@@ -0,0 +1,${LINES} @@`,
  ...Array.from({ length: LINES }, (_, i) => `+line ${i}`),
].join("\n");

const smallPatch = [
  "--- /dev/null",
  "+++ b/small.txt",
  "@@ -0,0 +1,40 @@",
  ...Array.from({ length: 40 }, (_, i) => `+tiny ${i}`),
].join("\n");

const baseProps = {
  hunkFg: "#89dceb",
  lineNumberBg: "#1b1d2b",
  view: "unified" as const,
  showLineNumbers: true,
  wrapMode: "none" as const,
  fg: "#e0e0e0",
  addedBg: "#12311c",
  removedBg: "#3c1c1e",
  contextBg: "#1b1d2b",
  addedSignColor: "#a6e3a1",
  removedSignColor: "#f38ba8",
  lineNumberFg: "#7f849c",
  addedLineNumberBg: "#12311c",
  removedLineNumberBg: "#3c1c1e",
} satisfies Omit<PatchDiffProps, "diff">;

function countDiffs(node: Renderable): number {
  return (
    (node instanceof DiffRenderable ? 1 : 0) +
    node.getChildren().reduce((sum: number, child) => sum + countDiffs(child), 0)
  );
}

describe("PatchDiff virtualization (#51122 render half)", () => {
  test("a 3200-line added file splits into 25 chunks and mounts only the viewport window", async () => {
    const chunks = splitAddedPatch(bigPatch, 128);
    expect(chunks?.length).toBe(Math.ceil(3200 / 128));

    let scrollBox: ScrollBoxRenderable | undefined;
    const setup = await testRender(
      <scrollbox
        ref={(element: ScrollBoxRenderable) => {
          scrollBox = element;
        }}
        style={{ width: "100%", height: "100%" }}
        scrollbarOptions={{ visible: false }}
      >
        <PatchDiff {...baseProps} diff={bigPatch} scroll={() => scrollBox} />
      </scrollbox>,
      { width: 80, height: 24 },
    );
    await setup.waitForFrame((frame) => frame.includes("line 0"), { maxPasses: 40 });
    const atTop = countDiffs(setup.renderer.root);
    expect(atTop).toBeGreaterThan(0);
    expect(atTop).toBeLessThanOrEqual(6);

    scrollBox!.scrollTop = 128 * 12;
    await setup.waitForFrame((frame) => frame.includes("line 1536"), { maxPasses: 60 });
    const midFile = countDiffs(setup.renderer.root);
    expect(midFile).toBeGreaterThan(0);
    expect(midFile).toBeLessThanOrEqual(6);
    setup.renderer.destroy();
  });

  test("a small patch stays on the per-hunk path with the scroll plane wired", async () => {
    let scrollBox: ScrollBoxRenderable | undefined;
    const setup = await testRender(
      <scrollbox
        ref={(element: ScrollBoxRenderable) => {
          scrollBox = element;
        }}
        style={{ width: "100%", height: "100%" }}
        scrollbarOptions={{ visible: false }}
      >
        <PatchDiff {...baseProps} diff={smallPatch} scroll={() => scrollBox} />
      </scrollbox>,
      { width: 80, height: 24 },
    );
    await setup.waitForFrame((frame) => frame.includes("tiny 0"), { maxPasses: 40 });
    expect(countDiffs(setup.renderer.root)).toBe(1);
    setup.renderer.destroy();
  });
});
