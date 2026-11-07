import { expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "./app";
import { createModelPreferenceRepository } from "./session/model-preference";
import { THEMES, tokensFor, THEME_NAMES, type ThemeName, type ThemeTokens } from "./design";

// Home chrome COLOR laws (span ground truth, pinned v2ref): the palette is
// the ported verbatim OpenCode theme set (design.ts authority note), and the
// rendered roles must land on the same token roles the reference draws —
// wall/agent on the accent (C.user under the opencode theme, the reference's
// categorical[0] agent colour), subdued separators/labels, default model
// text, warning+bold variant, hint keys in default with subdued words,
// strip ▀ extending the composer body surface over the base background, and
// the bottom strip's success ⊙ with default count and subdued /mcps +
// version. The reference span captures live at
// /tmp/zq-ux-parity/ref-spans-home.txt (feature-plugins/home/footer.tsx +
// component/prompt/index.tsx metadata law).
//
// The active theme follows the App's boot resolution for a fresh
// repository: state.json's theme.name is empty in these fixtures, so the
// legacy flat file answers when valid and the default opencode palette
// otherwise — these assertions hold under any enrolled theme.

function activeTokens(): ThemeTokens {
  try {
    const legacy = readFileSync(`${process.env.HOME}/.config/zcode-tui/theme`, "utf8").trim() as ThemeName;
    if ((THEME_NAMES as string[]).includes(legacy)) return tokensFor(legacy);
  } catch {
    // No legacy file — the App boots on the default opencode palette.
  }
  return THEMES.opencode;
}

function hexRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "").slice(0, 6);
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
}

function sameFg(span: { fg: { r: number; g: number; b: number } }, hex: string): boolean {
  const [r, g, b] = hexRgb(hex);
  return Math.abs(span.fg.r - r) < 0.004 && Math.abs(span.fg.g - g) < 0.004 && Math.abs(span.fg.b - b) < 0.004;
}

type Span = { text: string; fg: { r: number; g: number; b: number }; bg: { r: number; g: number; b: number }; attributes: number };

function spansOf(frame: { lines: { spans: Span[] }[] }, row: number): Span[] {
  return (frame.lines[row]?.spans ?? []).filter((sp) => sp.text.trim().length > 0);
}

async function boot() {
  const dir = mkdtempSync(join(tmpdir(), "zc-chromecolor-"));
  const preferences = createModelPreferenceRepository(join(dir, "state.json"));
  const client = {
    request: async (method: string) => {
      if (method === "session/list") return { sessions: [] };
      if (method === "mcp/list") return { statuses: { alpha: { status: "connected" } } };
      return {};
    },
    onPush: () => {}, onAsk: () => {}, onBackendLost: () => {},
  } as never;
  const setup = await testRender(<App client={client} preferences={preferences} onQuit={() => {}} />, { width: 100, height: 30 });
  await setup.waitForFrame((f) => f.includes("╹"));
  await setup.waitForFrame((f) => f.includes("MCP"));
  return { ...setup, cleanup: () => { setup.renderer.destroy(); rmSync(dir, { recursive: true, force: true }); } };
}

test("home chrome spans land on the reference token roles", async () => {
  const C = activeTokens();
  const s = await boot();
  try {
    const f = s.captureSpans();

    // Wall + strip corner share the accent (the agent-colour slot: C.user
    // under the opencode palette, the reference categorical[0][200]).
    const wall = spansOf(f, 15).find((sp) => sp.text === "┃");
    expect(wall).toBeDefined();
    expect(sameFg(wall!, C.user)).toBe(true);
    const strip = spansOf(f, 19);
    const corner = strip.find((sp) => sp.text === "╹");
    expect(corner).toBeDefined();
    expect(sameFg(corner!, C.user)).toBe(true);
    // The ▀ rule extends the composer body surface over the base background.
    const rule = strip.find((sp) => sp.text.startsWith("▀"));
    expect(rule).toBeDefined();
    expect(sameFg(rule!, C.surface)).toBe(true);
    expect(sameFg(rule!, C.bg)).toBe(false);
    const [r, g, b] = hexRgb(C.bg);
    expect(Math.abs(rule!.bg.r - r) < 0.004 && Math.abs(rule!.bg.g - g) < 0.004 && Math.abs(rule!.bg.b - b) < 0.004).toBe(true);

    // Placeholder rides subdued on the body surface.
    const placeholder = spansOf(f, 16).find((sp) => sp.text.includes("Ask anything"));
    expect(placeholder).toBeDefined();
    expect(sameFg(placeholder!, C.subtle)).toBe(true);

    // Metadata row: agent accent, subdued separators/labels/provider,
    // default model text, warning+bold variant.
    const meta = spansOf(f, 18);
    const agentSpan = meta.find((sp) => sp.text.includes("Build"));
    expect(agentSpan).toBeDefined();
    expect(sameFg(agentSpan!, C.user)).toBe(true);
    const separators = meta.filter((sp) => sp.text === "·");
    expect(separators.length).toBeGreaterThan(0);
    for (const sep of separators) expect(sameFg(sep, C.subtle)).toBe(true);
    const variant = meta[meta.length - 1];
    expect(sameFg(variant, C.warning)).toBe(true);
    expect((variant.attributes & 1) === 1).toBe(true);
    const model = meta.find((sp) => sp !== agentSpan && sp !== variant && sp.text !== "·" && sameFg(sp, C.fg));
    expect(model).toBeDefined();

    // Footer: subdued location, hint keys in default with subdued words.
    const footer = spansOf(f, 20);
    const location = footer[0];
    expect(sameFg(location, C.subtle)).toBe(true);
    const keySpans = footer.filter((sp) => sp.text.includes("+"));
    expect(keySpans.length).toBe(2);
    for (const key of keySpans) expect(sameFg(key, C.fg)).toBe(true);
    const words = footer.filter((sp) => sp.text === "agents" || sp.text === "commands");
    expect(words.length).toBe(2);
    for (const word of words) expect(sameFg(word, C.subtle)).toBe(true);

    // Bottom strip: success ⊙, default count, subdued /mcps + version.
    const stripRow = spansOf(f, 28);
    const dot = stripRow.find((sp) => sp.text.startsWith("⊙"));
    expect(dot).toBeDefined();
    expect(sameFg(dot!, C.success)).toBe(true);
    const count = stripRow.find((sp) => sp.text.includes("1 MCP"));
    expect(count).toBeDefined();
    expect(sameFg(count!, C.fg)).toBe(true);
    const command = stripRow.find((sp) => sp.text === "/mcps");
    expect(command).toBeDefined();
    expect(sameFg(command!, C.subtle)).toBe(true);
    const version = stripRow.find((sp) => /^\d+\.\d+\.\d+/.test(sp.text));
    expect(version).toBeDefined();
    expect(sameFg(version!, C.subtle)).toBe(true);
  } finally { s.cleanup(); }
});
