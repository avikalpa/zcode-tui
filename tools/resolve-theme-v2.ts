// Build-time resolver for the v2 default theme (emits tools/theme-v2-opencode.json).
//
// Upstream's live default theme is no longer the v1 asset
// (tui/theme/assets/opencode.json) but the v2 theme document
// (tui/theme/assets/v2/opencode.json), resolved at runtime by the
// @opencode/theme package. Our themes bake at build time, so this script
// runs the VENDORED ENGINE VERBATIM (tools/opencode-reference/theme-pkg/,
// pinned by tools/sync-opencode.sh alongside the rest of the reference)
// to resolve both arms, then reads out the tokens design.ts speaks.
// Every read cites its upstream source:
//   - map() in the reference's tui/mini/theme.ts — the live app's own
//     bridge from ResolvedTheme to flat tokens;
//   - the v1 -> v2 correspondence (packages/theme/src/tui/v1-migrate.ts)
//     for slots the live bridge does not name.
// Regenerate: bun tools/resolve-theme-v2.ts
// Consume:    python3 tools/gen-themes.py (merges the "opencode" theme).
import { readFileSync, writeFileSync } from "node:fs";
import type { RGBA } from "@opentui/core";
import {
  parseThemeDocument,
  resolveThemeDocument,
  type ResolvedTheme,
} from "./opencode-reference/theme-pkg/index.js";

const ROOT = new URL("..", import.meta.url).pathname;
const DOC = `${ROOT}tools/opencode-reference/tui/theme/assets/v2/opencode.json`;
const OUT = `${ROOT}tools/theme-v2-opencode.json`;
const VERSION = readFileSync(`${ROOT}tools/opencode-reference/VERSION`, "utf8").trim();

// design.ts ThemeTokens. Sources: mini/theme.ts map() lines 136-171;
// migrateMode() in v1-migrate.ts for the v1 slots (panel/surface/
// borderActive/assistant); hue scales where the live bridge reads them
// (map():145 running = hue.interactive[200], map():150 categorical[200]).
const TOKENS: Record<string, (r: ResolvedTheme) => RGBA> = {
  bg: (r) => r.background.base, // map():136 background
  panel: (r) => r.background.raised.base, // v1 backgroundPanel (migrate); map():158 surface/shade
  surface: (r) => r.background.raised.high, // v1 backgroundElement (migrate); map():160 pane
  border: (r) => r.border.base, // map():161
  borderActive: (r) => r.scrollbar.base, // v1 borderActive (migrate:125)
  fg: (r) => r.text.base, // map():157
  subtle: (r) => r.text.muted, // map():156
  faint: (r) => r.hue.neutral[500], // v1 borderSubtle has no v2 successor; the doc's
  // mid neutral (raised.max's step) is the band the esc-hint/logo art reads at.
  brand: (r) => r.text.base, // TOKEN_MAP: brand = text
  accent: (r) => r.hue.interactive[200], // map():145 running; the doc's own
  // $selected/$focused action ref ($hue.interactive.200)
  accentText: (r) => r.background.base, // TOKEN_MAP: accentText = background
  user: (r) => r.categorical[0][200], // map():150-153 — the live app tints agent
  // identities from the categorical cycle; slot 0 is the Build agent's color.
  assistant: (r) => r.text.feedback.info.base, // v1 info (migrate:100)
  tool: (r) => r.text.feedback.warning.base, // = warning slot (TOKEN_MAP)
  warning: (r) => r.text.feedback.warning.base, // map():154
  error: (r) => r.text.feedback.error.base, // map():155
  success: (r) => r.text.feedback.success.base, // map():148
  selected: (r) => r.text.formfield.selected, // map():144 selection
};

const DIFF: Record<string, (r: ResolvedTheme) => RGBA> = {
  diffAdded: (r) => r.diff.text.added,
  diffRemoved: (r) => r.diff.text.removed,
  diffContext: (r) => r.diff.text.context,
  diffHunkHeader: (r) => r.diff.text.hunkHeader,
  diffAddedBg: (r) => r.diff.background.added,
  diffRemovedBg: (r) => r.diff.background.removed,
  diffContextBg: (r) => r.diff.background.context,
  diffHighlightAdded: (r) => r.diff.highlight.added,
  diffHighlightRemoved: (r) => r.diff.highlight.removed,
  diffLineNumber: (r) => r.diff.lineNumber.text,
  diffAddedLineNumberBg: (r) => r.diff.lineNumber.background.added,
  diffRemovedLineNumberBg: (r) => r.diff.lineNumber.background.removed,
};

const MD: Record<string, (r: ResolvedTheme) => RGBA> = {
  mdText: (r) => r.markdown.text,
  mdHeading: (r) => r.markdown.heading,
  mdLink: (r) => r.markdown.link,
  mdLinkText: (r) => r.markdown.linkText,
  mdCode: (r) => r.markdown.code,
  mdQuote: (r) => r.markdown.blockQuote,
  mdEmph: (r) => r.markdown.emphasis,
  mdStrong: (r) => r.markdown.strong,
  mdListItem: (r) => r.markdown.listItem,
  mdListEnum: (r) => r.markdown.listEnumeration,
  synComment: (r) => r.syntax.comment,
  synKeyword: (r) => r.syntax.keyword,
  synFunction: (r) => r.syntax.function,
  synVariable: (r) => r.syntax.variable,
  synString: (r) => r.syntax.string,
  synNumber: (r) => r.syntax.number,
  synType: (r) => r.syntax.type,
  synOperator: (r) => r.syntax.operator,
  synPunct: (r) => r.syntax.punctuation,
};

function hex(c: RGBA): string {
  const [r, g, b, a] = c.toInts();
  const h = (n: number) => Math.round(n).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}${a === 255 ? "" : h(a)}`.toLowerCase();
}

const document = parseThemeDocument(JSON.parse(readFileSync(DOC, "utf8")), "opencode");

const out: Record<string, unknown> = { version: VERSION };
for (const mode of ["dark", "light"] as const) {
  const r = resolveThemeDocument(document, mode);
  const read = (table: Record<string, (r: ResolvedTheme) => RGBA>) =>
    Object.fromEntries(Object.entries(table).map(([k, fn]) => [k, hex(fn(r))]));
  out[mode] = { tokens: read(TOKENS), md: read(MD), diff: read(DIFF) };
}

writeFileSync(OUT, JSON.stringify({ version: VERSION, ...out }, null, 2) + "\n");
console.log(`wrote ${OUT} (pin ${VERSION}, dark+light)`);
