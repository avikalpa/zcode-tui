// Visual tokens and small view-model helpers for the OpenCode-shaped shell.
// The palettes are intentionally app-local: zcode-tui speaks the same OpenTUI
// language as OpenCode without taking a dependency on its private components.
//
// Theme sources, in order of authority:
//   1. OFFICIAL_THEMES (themes-generated.ts) — the 33 official OpenCode TUI
//      palettes, ported verbatim (dark arm) from the upstream repo.
//   2. The two zai arms below — ZCode brand colours that have no OpenCode twin.
import { OFFICIAL_MD, OFFICIAL_THEMES } from "./themes-generated";

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

export function isOfficialTheme(name: ThemeName): boolean {
  return name in OFFICIAL_THEMES;
}

export function mdFor(theme: ThemeName): MdTokens {
  return OFFICIAL_MD[theme] ?? OFFICIAL_MD.opencode;
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

// OpenCode's composer status grammar: `Build auto · GPT-6 Astra OpenAI · Low`.
// The agent word is the mode (Build when riding on auto), auto follows only in
// auto mode, provider rides muted after the model, effort is the variant slot.
export function modeLabel(mode: string): { label: string; auto: boolean } {
  if (mode === "auto") return { label: "Build", auto: true };
  return { label: mode.charAt(0).toUpperCase() + mode.slice(1), auto: false };
}

export function formatTokens(n: number): string {
  return n.toLocaleString("en-US");
}

// The compact usage label on the composer underline: `29.2k (7%)`.
export function formatContextLabel(used: number, window: number): string {
  const k = used / 1000;
  const compact = k >= 100 ? `${Math.round(k)}k` : `${k.toFixed(1)}k`;
  const pct = window > 0 ? Math.round((used / window) * 100) : 0;
  return `${compact} (${pct}%)`;
}

// The per-turn footer under a completed assistant message. The head carries
// the mode word (rendered in the mode accent), the rest rides muted:
// head `Build`, rest `GLM-5.3-Flash · 4.2s · 19.8 tok/s`.
export function formatTurnFooter(
  mode: string,
  model: string | undefined,
  durationMs: number | undefined,
  outputTokens: number | undefined,
): { head: string; rest: string } {
  const parts: string[] = [];
  const seconds = durationMs && durationMs > 0 ? durationMs / 1000 : undefined;
  if (seconds !== undefined) parts.push(`${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`);
  if (outputTokens !== undefined && outputTokens > 0 && seconds !== undefined && seconds > 0) {
    parts.push(`${(outputTokens / seconds).toFixed(1)} tok/s`);
  }
  const tail = [model, ...parts].filter(Boolean).join(" · ");
  return { head: modeLabel(mode).label, rest: tail };
}

export function formatDateHeading(epochMs: number): string {
  // Date#toDateString is the compact grouping voice used by the reference
  // picker: "Fri Sep 04 2026" rather than a locale-dependent long date.
  return new Date(epochMs).toDateString();
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
  { name: "sessions", aliases: ["session"], description: "browse and resume conversations" },
  { name: "new", aliases: ["new-session"], description: "start a fresh ZCode session" },
  { name: "home", aliases: [], description: "return to the zcodetui front page" },
  { name: "model", aliases: [], description: "choose from the safe model allowlist" },
  { name: "themes", aliases: ["theme"], description: "OpenCode plus terminal colour arms" },
  { name: "commands", aliases: ["help"], description: "open the command palette" },
  { name: "mode", aliases: [], description: "cycle plan · build · edit · yolo · auto" },
  { name: "effort", aliases: [], description: "cycle reasoning effort low · high · max" },
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
  | "sessions" | "new" | "home" | "model" | "themes" | "commands"
  | "mode" | "effort" | "thinking" | "fork" | "compact" | "quit"
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
