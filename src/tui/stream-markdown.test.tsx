// Streaming markdown (reference TextPart: the partial text renders through
// the markdown component while the turn is in flight — message-parts.tsx
// 147-174 — so headings, lists and code fences are styled mid-stream and
// the completion swap causes no reflow). The inherited plain-text streaming
// row showed raw markers ("# Heading", "```") and re-flowed at completion.
// Real session events drive the turn; char frames do not establish pixels.
import { describe, expect, test } from "bun:test";
import { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppServer } from "../protocol/client";
import { App } from "./app";
import { createModelPreferenceRepository } from "./session/model-preference";

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "zc-stream-md-"));
  const preferences = createModelPreferenceRepository(join(dir, "state.json"));
  let push: (event: Record<string, unknown>) => void = () => {};
  const client = {
    request: async (method: string) => {
      if (method === "session/list") return { sessions: [] };
      if (method === "session/resume") return {
        session: { status: "running" }, messages: [
          { info: { role: "user", id: "fixture-user" }, parts: [{ type: "text", text: "Stream a fixture." }] },
          { info: { role: "assistant", id: "fixture-assistant" }, parts: [] },
        ],
      };
      return {};
    },
    onPush: (fn: typeof push) => { push = fn; },
    onAsk: () => {}, onBackendLost: () => {},
  } as unknown as AppServer;
  const setup = await testRender(<App client={client} preferences={preferences} resumeId="fixture-stream" onQuit={() => {}} />, { width: 100, height: 35 });
  await setup.waitForFrame((f) => f.includes("Stream a fixture."));
  return { ...setup,
    emit: (payload: Record<string, unknown>) => act(() => { push({ method: "session/event", params: { payload } }); }),
    cleanup: () => { setup.renderer.destroy(); rmSync(dir, { recursive: true, force: true }); },
  };
}

async function frameWith(setup: Awaited<ReturnType<typeof fixture>>, needle: string) {
  for (let i = 0; i < 100; i++) {
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    if (frame.includes(needle)) return frame;
    await Bun.sleep(20);
  }
  throw new Error(`Missing ${needle}:\n${setup.captureCharFrame()}`);
}

describe("streaming markdown (reference TextPart treatment)", () => {
  test("the ellipsis placeholder shows before the first delta, then markdown takes over", async () => {
    const setup = await fixture();
    try {
      // No text yet: the assistant tail shows the placeholder row.
      const idle = await frameWith(setup, "…");
      expect(idle).toContain("Stream a fixture.");
      await setup.emit({ type: "text_delta", delta: "# Fixture heading\n\nBody line." });
      const frame = await frameWith(setup, "Fixture heading");
      // Styled markdown: the ATX marker is concealed mid-stream.
      expect(frame).not.toContain("# Fixture heading");
      expect(frame).toContain("Body line.");
    } finally {
      setup.cleanup();
    }
  });

  test("a partial code fence renders as a block, not raw backticks", async () => {
    const setup = await fixture();
    try {
      await setup.emit({ type: "text_delta", delta: "```js\nconst a = 1" });
      const frame = await frameWith(setup, "const a = 1");
      expect(frame).not.toContain("```");
    } finally {
      setup.cleanup();
    }
  });
});
