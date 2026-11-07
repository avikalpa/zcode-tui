import { describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "./app";
import { createModelPreferenceRepository } from "./session/model-preference";

// Home composer geometry laws (routes/home.tsx, feature-plugins/home/
// footer.tsx, pinned v2ref): the prompt container is width 100% capped at
// maxWidth 75 inside an outer pad of 1 below 44 columns else 2, so it
// shrinks with the terminal instead of clipping; the Prompt body pads 1/2
// on the same threshold and the placeholder clips at the input width; the
// footer hint strip gates on the TERMINAL width (>= 44); and the MCP ⊙
// count plus version live in a bottom home.footer strip gated at height
// >= 12 and width >= 44, with /mcps and the version only at >= 64.
//
// The rendered cursor cell rides one column ahead of the reference frames
// (block-cursor char-frame artifact; sitting-12 precedent) — text positions
// below are asserted relative to that occupied cell.

async function boot(width: number, statuses?: Record<string, { status?: string }>) {
  const dir = mkdtempSync(join(tmpdir(), "zc-homegeo-"));
  const preferences = createModelPreferenceRepository(join(dir, "state.json"));
  const client = {
    request: async (method: string) => {
      if (method === "session/list") return { sessions: [] };
      if (method === "mcp/list") return { statuses: statuses ?? {} };
      return {};
    },
    onPush: () => {}, onAsk: () => {}, onBackendLost: () => {},
  } as never;
  const setup = await testRender(
    <App client={client} preferences={preferences} onQuit={() => {}} />,
    { width, height: 30 },
  );
  await setup.waitForFrame((f) => f.includes("╹"));
  return { ...setup, cleanup: () => { setup.renderer.destroy(); rmSync(dir, { recursive: true, force: true }); } };
}

// The ╹+▀ run length: frame lines are padded to the terminal width, so
// count the border cells instead of using line length.
function borderRun(line: string): number {
  const col = line.indexOf("╹");
  let run = 1;
  while (line[col + run] === "▀") run++;
  return run;
}

function stripRow(frame: string): { index: number; line: string } {
  const lines = frame.split("\n");
  const index = lines.findIndex((l) => l.includes("╹"));
  expect(index).toBeGreaterThan(-1);
  return { index, line: lines[index] };
}

describe("home composer geometry laws", () => {
  test("100 columns: container centered at maxWidth 75, footer inside it, MCP strip at the bottom", async () => {
    const s = await boot(100, { alpha: { status: "connected" } });
    try {
      const strip = stripRow(s.captureCharFrame());
      // ╹ at the centered container column (pad 2 + ceil((96-75)/2)), the
      // ╹+▀ run spanning the full 75-cell container.
      expect(strip.line.indexOf("╹")).toBe(13);
      expect(borderRun(strip.line)).toBe(75);
      const lines = s.captureCharFrame().split("\n");
      const footer = lines[strip.index + 1];
      expect(footer.indexOf("~/")).toBe(13);
      expect(footer).toContain("shift+tab agents");
      expect(footer).toContain("ctrl+p commands");
      await s.waitForFrame((f) => f.includes("MCP"));
      const lines2 = s.captureCharFrame().split("\n");
      const mcp = lines2.findIndex((l) => l.includes("⊙ 1 MCP"));
      expect(mcp).toBe(28);
      expect(lines2[mcp]).toContain("/mcps");
      expect(lines2[mcp]).toContain("0.8.0");
      expect(lines2[mcp].indexOf("⊙")).toBe(2);
    } finally { s.cleanup(); }
  });

  test("44 columns: pad 2 container fills to 40, hints stay on the terminal-width gate", async () => {
    const s = await boot(44, { alpha: { status: "connected" } });
    try {
      const strip = stripRow(s.captureCharFrame());
      expect(strip.line.indexOf("╹")).toBe(2);
      expect(borderRun(strip.line)).toBe(40);
      const lines = s.captureCharFrame().split("\n");
      const footer = lines[strip.index + 1];
      expect(footer.indexOf("…")).toBe(2);
      expect(footer).toContain("shift+tab agents");
      await s.waitForFrame((f) => f.includes("MCP"));
      const lines2 = s.captureCharFrame().split("\n");
      const mcp = lines2.findIndex((l) => l.includes("⊙ 1 MCP"));
      
      expect(mcp).toBe(28);
      expect(lines2[mcp]).not.toContain("/mcps");
      expect(lines2[mcp]).not.toContain("0.8.0");
    } finally { s.cleanup(); }
  });

  test("40 columns: pad 1 body clips the placeholder, hints drop, the strip gate closes", async () => {
    const s = await boot(40);
    try {
      const frame = s.captureCharFrame();
      const strip = stripRow(frame);
      expect(strip.line.indexOf("╹")).toBe(1);
      expect(borderRun(strip.line)).toBe(38);
      const lines = frame.split("\n");
      const footer = lines[strip.index + 1];
      expect(footer.indexOf("~/")).toBe(1);
      expect(frame).not.toContain("shift+tab");
      // The placeholder clips at the 35-cell input width instead of
      // wrapping — the wall rows stay four, placeholder on one of them.
      const placeholder = lines.filter((l) => l.includes("Ask anything"));
      expect(placeholder).toHaveLength(1);
      expect(placeholder[0].indexOf("Ask")).toBe(4);
      expect(placeholder[0].trimEnd().endsWith('sta')).toBe(true);
      expect(frame).not.toContain("0.8.0");
    } finally { s.cleanup(); }
  });
});
