import { describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppServer } from "../protocol/client";
import { App } from "./app";
import { createModelPreferenceRepository } from "./session/model-preference";

// The composer metadata row takes the reference PromptMetadataRow law
// (component/prompt/metadata.tsx, pinned v2ref, ground-truth frames at
// /tmp/zq-ux-parity/ref-meta-*.txt): agent word in the mode accent, "auto"
// only in the autoaccept analogue, `·` + model, provider, `·` + variant
// (bold), with the reference width law — below 44 terminal columns the agent
// and provider drop, and the auto segment yields before anything else.

async function boot(width: number, height: number, resumeId?: string) {
  const dir = mkdtempSync(join(tmpdir(), "zc-meta-"));
  const preferences = createModelPreferenceRepository(join(dir, "state.json"));
  let push = (_event: Record<string, unknown>) => {};
  const client = {
    request: async (method: string) => {
      if (method === "session/list") return { sessions: [] };
      if (method === "session/resume") return { session: { status: "idle" }, messages: [] };
      return {};
    },
    onPush: (fn: typeof push) => { push = fn; },
    onAsk: () => {}, onBackendLost: () => {},
  } as unknown as AppServer;
  const setup = await testRender(
    <App client={client} preferences={preferences} resumeId={resumeId} onQuit={() => {}} />,
    { width, height },
  );
  // The home wait needle respects the ported width law plus the pre-existing
  // narrow-home left clip (short-terminal geometry leftover): below 44 the
  // agent word drops; at 44 the clipped frame hides it.
  const needle = resumeId ? "Build ·" : width >= 60 ? "Build" : "GLM-5.3-Flash";
  await setup.waitForFrame((f) => f.includes(needle));
  // Below 44 the metadata row is identical across the resume's mode flip,
  // so the needle resolves before the finally arms typing — settle over
  // that gap. My narrow fixtures only TYPE (no boot paste), so the settle
  // cannot trip the paste-queue changed() drop law.
  if (!resumeId && width < 60) await new Promise((resolve) => setTimeout(resolve, 30));
  return { ...setup, cleanup: () => { setup.renderer.destroy(); rmSync(dir, { recursive: true, force: true }); } };
}

describe("composer metadata row reference laws", () => {
  test("a wide home row reads `Build auto · model provider · max` with no thinking-off suffix", async () => {
    const s = await boot(100, 30);
    try {
      const frame = s.captureCharFrame();
      expect(frame).toContain("Build auto · GLM-5.3-Flash Z.AI Coding Plan · max");
      expect(frame).not.toContain("thinking off");
    } finally { s.cleanup(); }
  });

  test("a session row reads `Build · model provider · max` (no auto segment)", async () => {
    const s = await boot(100, 30, "fixture-meta");
    try {
      const frame = s.captureCharFrame();
      expect(frame).toContain("Build · GLM-5.3-Flash Z.AI Coding Plan · max");
      expect(frame).not.toContain("Build auto");
    } finally { s.cleanup(); }
  });

  test("at 44 columns the auto segment yields to fit", async () => {
    const s = await boot(44, 20);
    try {
      const frame = s.captureCharFrame();
      // The auto segment yields; the model row survives the pre-existing
      // narrow-home clip (the short-terminal geometry leftover).
      expect(frame).toContain("GLM-5.3-Flash · max");
      expect(frame).not.toContain("Build auto");
    } finally { s.cleanup(); }
  });

  test("below 44 columns the agent word and provider drop outright", async () => {
    const s = await boot(40, 20);
    try {
      const frame = s.captureCharFrame();
      const row = frame.split("\n").find((l) => l.includes("GLM-5.3-Flash · max"));
      expect(row).toBeDefined();
      expect(row).not.toContain("Build");
      expect(row).not.toContain("Coding Plan");
    } finally { s.cleanup(); }
  });
});
