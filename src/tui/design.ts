// Visual tokens and small view-model helpers for the OpenCode-shaped shell.
// The palettes are intentionally app-local: zcode-tui speaks the same OpenTUI
// language as OpenCode without taking a dependency on its private components.
//
// Theme sources, in order of authority:
//   1. OFFICIAL_THEMES / OFFICIAL_THEMES_LIGHT (themes-generated.ts) — the 33
//      official OpenCode TUI palettes, ported verbatim (both arms, the
//      upstream theme:{token:{dark,light}} documents) from the vendored
//      reference.
//   2. The two zai arms below — ZCode brand colours that have no OpenCode
//      twin (single-mode documents: zai-dark is dark-only, zai-light light).
import { OFFICIAL_DIFF, OFFICIAL_MD, OFFICIAL_THEMES, OFFICIAL_DIFF_LIGHT, OFFICIAL_MD_LIGHT, OFFICIAL_THEMES_LIGHT } from "./themes-generated";

export interface ThemeTokens {
  bg: string;
  panel: string;
  surface: string;
  border: string;
  borderActive: string;
  fg: string;
  subtle: string;
  faint: string;
  brand: string;
  accent: string;
  accentText: string;
  user: string;
  assistant: string;
  tool: string;
  warning: string;
  error: string;
  success: string;
  selected: string;
}

// Markdown + syntax colour arms from the same upstream theme files; the
// assistant transcript renders through these so code blocks and headings tint
// exactly like OpenCode's do under the active theme.
export type MdTokens = typeof OFFICIAL_MD[string];

const ZAI_THEMES: Record<string, ThemeTokens> = {
  "zai-dark": {
    bg: "#161616",
    panel: "#202020",
    surface: "#2b2b2b",
    border: "#ffffff1a",
    borderActive: "#60a5fa",
    fg: "#d4d4d4",
    subtle: "#a3a3a3",
    faint: "#6b6b6b",
    brand: "#ffffff",
    accent: "#60a5fa",
    accentText: "#161616",
    user: "#60a5fa",
    assistant: "#2dd4bf",
    tool: "#f59e0b",
    warning: "#f59e0b",
    error: "#f87171",
    success: "#4ade80",
    selected: "#ffffff1a",
  },
  "zai-light": {
    bg: "#f8f8f8",
    panel: "#ffffff",
    surface: "#ffffff",
    border: "#0d0d0d1a",
    borderActive: "#2563eb",
    fg: "#262626",
    subtle: "#595959",
    faint: "#8c8c8c",
    brand: "#000000",
    accent: "#2563eb",
    accentText: "#ffffff",
    user: "#2563eb",
    assistant: "#0f766e",
    tool: "#b45309",
    warning: "#b45309",
    error: "#b91c1c",
    success: "#15803d",
    selected: "#0d0d0d0d",
  },
};

export const THEMES: Record<string, ThemeTokens> = {
  ...(OFFICIAL_THEMES as Record<string, ThemeTokens>),
  ...ZAI_THEMES,
};

export type ThemeName = string;
export const THEME_NAMES = Object.keys(THEMES) as ThemeName[];

// The color arms (v2 context/theme.tsx): a theme document carries the modes
// it defines; the active mode resolves only within those (v2 loadTheme keeps
// the document's first mode when the request is outside it).
export type ThemeMode = "dark" | "light";
export const THEME_MODES: readonly ThemeMode[] = ["dark", "light"];

// v2 themeModes(document): official documents define both arms; the zai
// brand arms are single-mode.
export function themeModes(theme: ThemeName): readonly ThemeMode[] {
  if (theme in OFFICIAL_THEMES_LIGHT) return THEME_MODES;
  if (theme === "zai-light") return ["light"];
  if (theme === "zai-dark") return ["dark"];
  return THEME_MODES;
}

export function isOfficialTheme(name: ThemeName): boolean {
  return name in OFFICIAL_THEMES;
}

export function tokensFor(theme: ThemeName, requested: ThemeMode = "dark"): ThemeTokens {
  const modes = themeModes(theme);
  const mode = modes.includes(requested) ? requested : (modes[0] ?? "dark");
  if (mode === "light") {
    const light = (OFFICIAL_THEMES_LIGHT as Record<string, ThemeTokens>)[theme];
    if (light) return light;
  }
  return THEMES[theme] ?? THEMES.opencode;
}

export function mdFor(theme: ThemeName, requested: ThemeMode = "dark"): MdTokens {
  if (requested === "light" && themeModes(theme).includes("light")) {
    const light = (OFFICIAL_MD_LIGHT as Record<string, MdTokens>)[theme];
    if (light) return light;
  }
  return OFFICIAL_MD[theme] ?? OFFICIAL_MD.opencode;
}

// The per-theme diff arms (added/removed/context + line-number gutters) —
// the diff viewer's card backgrounds, signs, counts and hunk headers read
// these, exactly as the reference theme module exposes them.
export type DiffTokens = typeof OFFICIAL_DIFF[string];
export function diffFor(theme: ThemeName, requested: ThemeMode = "dark"): DiffTokens {
  if (requested === "light" && themeModes(theme).includes("light")) {
    const light = (OFFICIAL_DIFF_LIGHT as Record<string, DiffTokens>)[theme];
    if (light) return light;
  }
  return OFFICIAL_DIFF[theme] ?? OFFICIAL_DIFF.opencode;
}

// The accent a surface carries for the active mode — OpenCode tints the
// composer's left border with the active agent's colour; our analogue is the
// mode. `yolo` reads as danger, `plan` as the calm accent, everything else as
// the secondary blue the reference uses for its Build agent.
export function modeAccent(mode: string, C: ThemeTokens): string {
  switch (mode) {
    case "plan": return C.assistant;
    case "yolo": return C.error;
    case "edit": return C.warning;
    default: return C.user;
  }
}

// OpenCode's composer status grammar: `Build auto · GPT-6 Astra OpenAI · high`.
// The agent word is the mode (Build when riding on auto), auto follows only in
// auto mode, provider rides muted after the model, effort is the variant slot
// (lowercase, as the reference draws it).
export function modeLabel(mode: string): { label: string; auto: boolean } {
  if (mode === "auto") return { label: "Build", auto: true };
  return { label: mode.charAt(0).toUpperCase() + mode.slice(1), auto: false };
}

export function formatTokens(n: number): string {
  return n.toLocaleString("en-US");
}

// v2 Locale.number (util/locale.ts): compact token counts — `1.0M` / `29.2K`
// / plain integer below 1000.
export function formatNumberCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

// v2 Locale.time (util/locale.ts): the locale short-time form — `8:23 AM`.
export function formatTimeShort(input: number): string {
  return new Date(input).toLocaleTimeString(undefined, { timeStyle: "short" });
}

// v2 Locale.duration (util/locale.ts): `900ms` under a second, one decimal
// under a minute, then `1m 5s` / `1h 0m` / `1d 3h` scales.
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) {
    const minutes = Math.floor(ms / 60_000);
    const seconds = Math.floor((ms % 60_000) / 1000);
    return `${minutes}m ${seconds}s`;
  }
  if (ms < 86_400_000) {
    const hours = Math.floor(ms / 3_600_000);
    const minutes = Math.floor((ms % 3_600_000) / 60_000);
    return `${hours}h ${minutes}m`;
  }
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  return `${days}d ${hours}h`;
}

// The compact usage label on the composer underline: `29.2K (7%)` — v2's
// formatContextUsage = Locale.number(tokens) + rounded percent (0.6.30 fixed
// the case + sub-K grammar to the reference).
export function formatContextLabel(used: number, window: number): string {
  const pct = window > 0 ? Math.round((used / window) * 100) : 0;
  return `${formatNumberCompact(used)} (${pct}%)`;
}

// The per-turn footer under a completed assistant message. The head carries
// the mode word (rendered in the mode accent), the rest rides muted:
// head `Build`, rest `GLM-5.3-Flash · 4.2s · 19.8 tok/s`. The throughput
// numerator counts output + reasoning tokens (v2.0.8, upstream rows.ts).
// Width gates + the `· interrupted` suffix are the v2 AssistantFooter
// grammar (routes/session/index.tsx): model hidden under 28 cols, duration
// hidden in the 28-35 band, `interrupted` appended subdued.
export function formatTurnFooter(
  mode: string,
  model: string | undefined,
  durationMs: number | undefined,
  outputTokens: number | undefined,
  reasoningTokens?: number,
  width?: number,
  interrupted?: boolean,
): { head: string; rest: string } {
  const parts: string[] = [];
  if (model !== undefined && (width === undefined || width >= 28)) parts.push(model);
  const ms = durationMs && durationMs > 0 ? durationMs : undefined;
  const seconds = ms !== undefined ? ms / 1000 : undefined;
  if (ms !== undefined && (width === undefined || width < 28 || width >= 36)) {
    parts.push(formatDuration(ms));
  }
  const generated = (outputTokens ?? 0) + (reasoningTokens ?? 0);
  if (generated > 0 && seconds !== undefined && seconds > 0) {
    parts.push(`${(generated / seconds).toFixed(1)} tok/s`);
  }
  if (interrupted) parts.push("interrupted");
  const tail = parts.filter(Boolean).join(" · ");
  return { head: modeLabel(mode).label, rest: tail };
}

// Greedy word-wrap for the multiline composer: break at the last space that
// fits, hard-break words longer than the width, preserve explicit newlines.
export function wrapText(text: string, width: number): string[] {
  const width_ = Math.max(10, width);
  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (paragraph === "") { out.push(""); continue; }
    let line = "";
    for (const word of paragraph.split(" ")) {
      const candidate = line ? `${line} ${word}` : word;
      if (candidate.length <= width_) { line = candidate; continue; }
      if (line) { out.push(line); line = ""; }
      if (word.length <= width_) { line = word; continue; }
      let rest = word;
      while (rest.length > width_) { out.push(rest.slice(0, width_)); rest = rest.slice(width_); }
      line = rest;
    }
    out.push(line);
  }
  return out;
}

// wrapText with source offsets: byte-identical display rows, each carrying
// the draft index of its first character. The composer's cursor AND
// selection both render from these rows so a highlighted slice lands
// exactly where its characters do (input.select.* family, 0.6.25).
export function wrapRows(text: string, width: number): { text: string; start: number }[] {
  const width_ = Math.max(10, width);
  const out: { text: string; start: number }[] = [];
  let pos = 0;
  for (const paragraph of text.split("\n")) {
    if (paragraph === "") { out.push({ text: "", start: pos }); pos += 1; continue; }
    let line = "";
    let lineStart = pos;
    let wpos = pos;
    for (const word of paragraph.split(" ")) {
      const candidate = line ? `${line} ${word}` : word;
      if (candidate.length <= width_) { if (!line) lineStart = wpos; line = candidate; wpos += word.length + 1; continue; }
      if (line) { out.push({ text: line, start: lineStart }); line = ""; }
      if (word.length <= width_) { line = word; lineStart = wpos; wpos += word.length + 1; continue; }
      let rest = word;
      let rstart = wpos;
      while (rest.length > width_) { out.push({ text: rest.slice(0, width_), start: rstart }); rest = rest.slice(width_); rstart += width_; }
      line = rest;
      lineStart = rstart;
      wpos = rstart + rest.length + 1;
    }
    out.push({ text: line, start: lineStart });
    pos += paragraph.length + 1;
  }
  return out;
}

export function formatDateHeading(epochMs: number): string {
  // Date#toDateString is the compact grouping voice used by the reference
  // picker: "Fri Sep 04 2026" rather than a locale-dependent long date.
  // Today reads as "Today", same as the reference session list.
  const label = new Date(epochMs).toDateString();
  return label === new Date().toDateString() ? "Today" : label;
}

export interface SlashCommandSpec {
  name: string;
  aliases: string[];
  description: string;
}

// The one command registry: the composer autocomplete popup, the
// unknown-command refusal, and the ctrl+k palette all read this list. An
// unregistered "/token" must never reach the model as chat — the 2026-09-08
// parity wave measured a garbage "//sessions" turn costing ~51k ctx tokens
// because the fall-through let it through silently.
export const SLASH_COMMANDS: SlashCommandSpec[] = [
  { name: "agents", aliases: ["agent", "mode"], description: "switch agent mode" },
  { name: "sessions", aliases: ["session"], description: "browse and resume conversations" },
  { name: "new", aliases: ["new-session"], description: "start a fresh ZCode session" },
  { name: "home", aliases: [], description: "return to the zcodetui front page" },
  { name: "model", aliases: [], description: "choose from the safe model allowlist" },
  { name: "themes", aliases: ["theme"], description: "OpenCode plus terminal colour arms" },
  { name: "commands", aliases: [], description: "open the command palette" },
  { name: "diff", aliases: [], description: "open the diff viewer" },
  { name: "help", aliases: [], description: "keybind help" },
  { name: "timeline", aliases: [], description: "session timeline · fork at a prompt" },
  { name: "status", aliases: [], description: "session and backend status" },
  { name: "skills", aliases: [], description: "insert a skill mention" },
  { name: "mcps", aliases: ["mcp"], description: "MCP server status" },
  { name: "effort", aliases: [], description: "choose reasoning effort · low high max" },
  { name: "variants", aliases: ["thinking", "effort"], description: "switch model variant" },
  { name: "settings", aliases: [], description: "open settings" },
  { name: "thinking", aliases: [], description: "toggle thinking" },
  { name: "fork", aliases: [], description: "fork the session at the latest checkpoint" },
  { name: "compact", aliases: [], description: "compact the session context" },
  { name: "quit", aliases: ["exit"], description: "exit zcode-tui" },
];

export function matchSlashCommands(prefix: string): SlashCommandSpec[] {
  const needle = prefix.trim().toLowerCase();
  if (!needle) return SLASH_COMMANDS;
  return SLASH_COMMANDS.filter(
    (c) => c.name.startsWith(needle) || c.aliases.some((a) => a.startsWith(needle)),
  );
}

export type SlashCommand =
  | "agents" | "sessions" | "new" | "home" | "model" | "themes" | "commands"
  | "status" | "effort" | "thinking" | "fork" | "compact" | "quit" | "help" | "timeline"
  | "diff"
  | "skills"
  | "mcps"
  | "variants"
  | "settings"
  | null;

export function parseSlashCommand(input: string): SlashCommand {
  const token = input.trim().split(/\s+/, 1)[0]?.toLowerCase() ?? "";
  if (!token.startsWith("/")) return null;
  const name = token.slice(1);
  const spec = SLASH_COMMANDS.find((c) => c.name === name || c.aliases.includes(name));
  return spec ? (spec.name as Exclude<SlashCommand, null>) : null;
}

export function shortCwd(cwd: string, home = process.env.HOME ?? ""): string {
  if (home && cwd === home) return "~";
  if (home && cwd.startsWith(`${home}/`)) return `~/${cwd.slice(home.length + 1)}`;
  return cwd;
}
