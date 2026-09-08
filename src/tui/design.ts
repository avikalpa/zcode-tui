// Visual tokens and small view-model helpers for the OpenCode-shaped shell.
// The palettes are intentionally app-local: zcode-tui speaks the same OpenTUI
// language as OpenCode without taking a dependency on its private components.

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

export const THEMES = {
  "opencode": {
    bg: "#0a0a0a",
    panel: "#141414",
    surface: "#1e1e1e",
    border: "#3c3c3c",
    borderActive: "#606060",
    fg: "#eeeeee",
    subtle: "#808080",
    faint: "#4b4b4b",
    brand: "#eeeeee",
    accent: "#fab283",
    accentText: "#0a0a0a",
    user: "#5c9cf5",
    assistant: "#56b6c2",
    tool: "#f5a742",
    warning: "#f5a742",
    error: "#e06c75",
    success: "#7fd88f",
    selected: "#363636",
  },
  "everforest": {
    bg: "#2d353b",
    panel: "#333c43",
    surface: "#343f44",
    border: "#7a8478",
    borderActive: "#9da9a0",
    fg: "#d3c6aa",
    subtle: "#7a8478",
    faint: "#57605d",
    brand: "#d3c6aa",
    accent: "#a7c080",
    accentText: "#2d353b",
    user: "#7fbbb3",
    assistant: "#83c092",
    tool: "#e69875",
    warning: "#e69875",
    error: "#e67e80",
    success: "#a7c080",
    selected: "#465051",
  },
  "gruvbox": {
    bg: "#282828",
    panel: "#3c3836",
    surface: "#504945",
    border: "#504945",
    borderActive: "#ebdbb2",
    fg: "#ebdbb2",
    subtle: "#928374",
    faint: "#625a52",
    brand: "#ebdbb2",
    accent: "#83a598",
    accentText: "#282828",
    user: "#d3869b",
    assistant: "#fabd2f",
    tool: "#fe8019",
    warning: "#fe8019",
    error: "#fb4934",
    success: "#b8bb26",
    selected: "#605851",
  },
  "tokyonight": {
    bg: "#1a1b26",
    panel: "#1e2030",
    surface: "#222436",
    border: "#545c7e",
    borderActive: "#9099b2",
    fg: "#c8d3f5",
    subtle: "#828bb8",
    faint: "#535976",
    brand: "#c8d3f5",
    accent: "#82aaff",
    accentText: "#1a1b26",
    user: "#c099ff",
    assistant: "#82aaff",
    tool: "#ff966c",
    warning: "#ff966c",
    error: "#ff757f",
    success: "#c3e88d",
    selected: "#3a3e56",
  },
  "catppuccin": {
    bg: "#1e1e2e",
    panel: "#181825",
    surface: "#11111b",
    border: "#585b70",
    borderActive: "#45475a",
    fg: "#cdd6f4",
    subtle: "#9399b2",
    faint: "#5e6277",
    brand: "#cdd6f4",
    accent: "#89b4fa",
    accentText: "#1e1e2e",
    user: "#cba6f7",
    assistant: "#94e2d5",
    tool: "#f9e2af",
    warning: "#f9e2af",
    error: "#f38ba8",
    success: "#a6e3a1",
    selected: "#323341",
  },
  "dracula": {
    bg: "#282a36",
    panel: "#21222c",
    surface: "#44475a",
    border: "#191a21",
    borderActive: "#bd93f9",
    fg: "#f8f8f2",
    subtle: "#6272a4",
    faint: "#485272",
    brand: "#f8f8f2",
    accent: "#bd93f9",
    accentText: "#282a36",
    user: "#ff79c6",
    assistant: "#ffb86c",
    tool: "#f1fa8c",
    warning: "#f1fa8c",
    error: "#ff5555",
    success: "#50fa7b",
    selected: "#4c526c",
  },
  "nord": {
    bg: "#2E3440",
    panel: "#3B4252",
    surface: "#434C5E",
    border: "#434C5E",
    borderActive: "#4C566A",
    fg: "#ECEFF4",
    subtle: "#8B95A7",
    faint: "#616979",
    brand: "#ECEFF4",
    accent: "#88C0D0",
    accentText: "#2E3440",
    user: "#81A1C1",
    assistant: "#88C0D0",
    tool: "#D08770",
    warning: "#D08770",
    error: "#BF616A",
    success: "#A3BE8C",
    selected: "#555e70",
  },
  "rosepine": {
    bg: "#191724",
    panel: "#1f1d2e",
    surface: "#26233a",
    border: "#21202e",
    borderActive: "#9ccfd8",
    fg: "#e0def4",
    subtle: "#6e6a86",
    faint: "#48455a",
    brand: "#e0def4",
    accent: "#9ccfd8",
    accentText: "#191724",
    user: "#c4a7e7",
    assistant: "#9ccfd8",
    tool: "#f6c177",
    warning: "#f6c177",
    error: "#eb6f92",
    success: "#31748f",
    selected: "#38354d",
  },
  "one-dark": {
    bg: "#282c34",
    panel: "#21252b",
    surface: "#353b45",
    border: "#2c313a",
    borderActive: "#61afef",
    fg: "#abb2bf",
    subtle: "#5c6370",
    faint: "#454a55",
    brand: "#abb2bf",
    accent: "#61afef",
    accentText: "#282c34",
    user: "#c678dd",
    assistant: "#d19a66",
    tool: "#e5c07b",
    warning: "#e5c07b",
    error: "#e06c75",
    success: "#98c379",
    selected: "#3f4550",
  },
  "material": {
    bg: "#263238",
    panel: "#1e272c",
    surface: "#37474f",
    border: "#1e272c",
    borderActive: "#82aaff",
    fg: "#eeffff",
    subtle: "#546e7a",
    faint: "#3f535c",
    brand: "#eeffff",
    accent: "#82aaff",
    accentText: "#263238",
    user: "#c792ea",
    assistant: "#ffcb6b",
    tool: "#ffcb6b",
    warning: "#ffcb6b",
    error: "#f07178",
    success: "#c3e88d",
    selected: "#3e515a",
  },
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
} satisfies Record<string, ThemeTokens>;

export type ThemeName = keyof typeof THEMES;
export const THEME_NAMES = Object.keys(THEMES) as ThemeName[];

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
