import { describe, expect, test } from "bun:test";
import {
  formatContextLabel,
  formatTokens,
  formatTurnFooter,
  formatDateHeading,
  matchSlashCommands,
  mdFor,
  modeAccent,
  modeLabel,
  parseSlashCommand,
  shortCwd,
  SLASH_COMMANDS,
  THEMES,
  THEME_NAMES,
} from "./design";

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/;

describe("OpenCode-shaped zcode-tui design model", () => {
  test("ships the exact official OpenCode palettes plus the zai arms", () => {
    // The opencode theme tokens are the upstream dark arm, verbatim.
    expect(THEMES.opencode.bg).toBe("#0a0a0a");
    expect(THEMES.opencode.panel).toBe("#141414");
    expect(THEMES.opencode.surface).toBe("#1e1e1e");
    expect(THEMES.opencode.border).toBe("#484848");
    expect(THEMES.opencode.borderActive).toBe("#606060");
    expect(THEMES.opencode.accent).toBe("#fab283");
    expect(THEMES.opencode.user).toBe("#5c9cf5");
    expect(THEMES.everforest.bg).toBe("#2d353b");
    expect(THEMES.tokyonight.bg).toBe("#1a1b26");
    expect(THEMES["zai-dark"].accent).toBe("#60a5fa");
    // The full official set (33) plus the two brand arms.
    expect(THEME_NAMES.length).toBeGreaterThanOrEqual(35);
  });

  test("every theme carries a complete, valid token set", () => {
    for (const name of THEME_NAMES) {
      const C = THEMES[name];
      for (const [token, value] of Object.entries(C)) {
        expect(HEX.test(value as string)).toBe(true);
      }
      expect(C.bg).toBeDefined();
      expect(C.selected).toBeDefined();
    }
    expect(mdFor("opencode").mdHeading).toBe("#9d7cd8");
  });

  test("mode labels and accents follow the reference status grammar", () => {
    expect(modeLabel("auto")).toEqual({ label: "Build", auto: true });
    expect(modeLabel("plan").label).toBe("Plan");
    expect(modeLabel("build").auto).toBe(false);
    const C = THEMES.opencode;
    expect(modeAccent("build", C)).toBe(C.user);
    expect(modeAccent("plan", C)).toBe(C.assistant);
    expect(modeAccent("yolo", C)).toBe(C.error);
  });

  test("formats the per-turn footer like the reference", () => {
    expect(formatTurnFooter("auto", "GLM-5.3-Flash", 4200, 83)).toEqual({
      head: "Build",
      rest: "GLM-5.3-Flash · 4.2s · 19.8 tok/s",
    });
    expect(formatTurnFooter("plan", undefined, undefined, undefined)).toEqual({ head: "Plan", rest: "" });
  });

  test("formats context usage like the reference", () => {
    expect(formatContextLabel(29_214, 1_000_000)).toBe("29.2k (3%)");
    expect(formatTokens(29214)).toBe("29,214");
  });

  test("recognizes the slash commands used by the front page", () => {
    expect(parseSlashCommand("/sessions")).toBe("sessions");
    expect(parseSlashCommand("/sessions search words")).toBe("sessions");
    expect(parseSlashCommand("/new")).toBe("new");
    expect(parseSlashCommand("plain prompt")).toBeNull();
  });

  test("slash registry: prefix matches, unknown tokens stay null", () => {
    expect(parseSlashCommand("/theme")).toBe("themes");
    expect(parseSlashCommand("/nonsense")).toBeNull();
    expect(parseSlashCommand("/help")).toBe("commands");
    expect(SLASH_COMMANDS.length).toBeGreaterThanOrEqual(10);
    expect(matchSlashCommands("").length).toBe(SLASH_COMMANDS.length);
    expect(matchSlashCommands("ses").map((c) => c.name)).toContain("sessions");
    expect(matchSlashCommands("zzz")).toHaveLength(0);
  });

  test("formats session groups and home paths deterministically", () => {
    expect(formatDateHeading(Date.parse("2026-09-04T12:00:00Z"))).toBe("Fri Sep 04 2026");
    expect(shortCwd("/home/example/project", "/home/example")).toBe("~/project");
    expect(shortCwd("/workspace/project", "/home/example")).toBe("/workspace/project");
  });
});
