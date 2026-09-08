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
  opencode: {
    bg: "#0a0a0a",
    panel: "#1e1e1e",
    surface: "#141414",
    border: "#292929",
    borderActive: "#5c9cf5",
    fg: "#e6e6e6",
    subtle: "#a0a0a0",
    faint: "#666666",
    brand: "#f5f5f5",
    accent: "#5c9cf5",
    accentText: "#0a0a0a",
    user: "#5c9cf5",
    assistant: "#44d5bd",
    tool: "#e6a653",
    warning: "#f5a742",
    error: "#f07878",
    success: "#58c98b",
    selected: "#2a2a2a",
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
  catppuccin: {
    bg: "#1e1e2e",
    panel: "#242438",
    surface: "#313244",
    border: "#45475a",
    borderActive: "#89b4fa",
    fg: "#cdd6f4",
    subtle: "#a6adc8",
    faint: "#6c7086",
    brand: "#f5c2e7",
    accent: "#89b4fa",
    accentText: "#1e1e2e",
    user: "#89b4fa",
    assistant: "#94e2d5",
    tool: "#fab387",
    warning: "#f9e2af",
    error: "#f38ba8",
    success: "#a6e3a1",
    selected: "#45475a",
  },
  dracula: {
    bg: "#282a36",
    panel: "#30323f",
    surface: "#44475a",
    border: "#6272a4",
    borderActive: "#8be9fd",
    fg: "#f8f8f2",
    subtle: "#bdc0cc",
    faint: "#787b8e",
    brand: "#ff79c6",
    accent: "#8be9fd",
    accentText: "#282a36",
    user: "#8be9fd",
    assistant: "#50fa7b",
    tool: "#ffb86c",
    warning: "#f1fa8c",
    error: "#ff5555",
    success: "#50fa7b",
    selected: "#44475a",
  },
  nord: {
    bg: "#2e3440",
    panel: "#353c4a",
    surface: "#3b4252",
    border: "#4c566a",
    borderActive: "#88c0d0",
    fg: "#d8dee9",
    subtle: "#a8b1c2",
    faint: "#616b7f",
    brand: "#8fbcbb",
    accent: "#88c0d0",
    accentText: "#2e3440",
    user: "#81a1c1",
    assistant: "#8fbcbb",
    tool: "#d08770",
    warning: "#ebcb8b",
    error: "#bf616a",
    success: "#a3be8c",
    selected: "#434c5e",
  },
  gruvbox: {
    bg: "#282828",
    panel: "#32302f",
    surface: "#3c3836",
    border: "#504945",
    borderActive: "#83a598",
    fg: "#ebdbb2",
    subtle: "#bdae93",
    faint: "#928374",
    brand: "#fabd2f",
    accent: "#83a598",
    accentText: "#282828",
    user: "#83a598",
    assistant: "#b8bb26",
    tool: "#fe8019",
    warning: "#fabd2f",
    error: "#fb4934",
    success: "#b8bb26",
    selected: "#504945",
  },
  "rose-pine": {
    bg: "#191724",
    panel: "#211f2f",
    surface: "#26233a",
    border: "#403d52",
    borderActive: "#c4a7e7",
    fg: "#e0def4",
    subtle: "#b5b1cc",
    faint: "#6e6a86",
    brand: "#ebbcba",
    accent: "#c4a7e7",
    accentText: "#191724",
    user: "#9ccfd8",
    assistant: "#31748f",
    tool: "#f6c177",
    warning: "#f6c177",
    error: "#eb6f92",
    success: "#9ccfd8",
    selected: "#403d52",
  },
  tokyonight: {
    bg: "#1a1b26",
    panel: "#202331",
    surface: "#24283b",
    border: "#3b4261",
    borderActive: "#7aa2f7",
    fg: "#c0caf5",
    subtle: "#9aa5ce",
    faint: "#565f89",
    brand: "#bb9af7",
    accent: "#7aa2f7",
    accentText: "#1a1b26",
    user: "#7dcfff",
    assistant: "#73daca",
    tool: "#ff9e64",
    warning: "#e0af68",
    error: "#f7768e",
    success: "#73daca",
    selected: "#3b4261",
  },
  matrix: {
    bg: "#050805",
    panel: "#0b120b",
    surface: "#101b10",
    border: "#1b451b",
    borderActive: "#47ff47",
    fg: "#a8d8a8",
    subtle: "#6da36d",
    faint: "#386638",
    brand: "#47ff47",
    accent: "#47ff47",
    accentText: "#050805",
    user: "#72d572",
    assistant: "#b0f2b0",
    tool: "#d5e66d",
    warning: "#d5e66d",
    error: "#ff6868",
    success: "#47ff47",
    selected: "#163016",
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
