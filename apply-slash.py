#!/usr/bin/env python3
"""Port the remaining OpenCode keybind/slash surface onto app.tsx + design.ts."""
from pathlib import Path

# ── design.ts: registry additions ──────────────────────────────────────────
p = Path("src/tui/design.ts")
s = p.read_text()
old = """export const SLASH_COMMANDS: SlashCommandSpec[] = [
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
];"""
new = """export const SLASH_COMMANDS: SlashCommandSpec[] = [
  { name: "agents", aliases: ["agent", "mode"], description: "switch agent mode" },
  { name: "sessions", aliases: ["session"], description: "browse and resume conversations" },
  { name: "new", aliases: ["new-session"], description: "start a fresh ZCode session" },
  { name: "home", aliases: [], description: "return to the zcodetui front page" },
  { name: "model", aliases: [], description: "choose from the safe model allowlist" },
  { name: "themes", aliases: ["theme"], description: "OpenCode plus terminal colour arms" },
  { name: "commands", aliases: ["help"], description: "open the command palette" },
  { name: "status", aliases: [], description: "session and backend status" },
  { name: "effort", aliases: [], description: "cycle reasoning effort low · high · max" },
  { name: "thinking", aliases: [], description: "toggle thinking" },
  { name: "fork", aliases: [], description: "fork the session at the latest checkpoint" },
  { name: "compact", aliases: [], description: "compact the session context" },
  { name: "exit", aliases: ["quit"], description: "exit zcode-tui" },
];"""
assert old in s, "registry"
s = s.replace(old, new)

old = """export type SlashCommand =
  | "sessions" | "new" | "home" | "model" | "themes" | "commands"
  | "mode" | "effort" | "thinking" | "fork" | "compact" | "quit"
  | null;"""
new = """export type SlashCommand =
  | "agents" | "sessions" | "new" | "home" | "model" | "themes" | "commands"
  | "status" | "effort" | "thinking" | "fork" | "compact" | "quit"
  | null;"""
assert old in s, "slash union"
s = s.replace(old, new)
p.write_text(s)
print("design.ts updated")
