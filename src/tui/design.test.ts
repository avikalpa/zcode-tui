import { describe, expect, test } from "bun:test";
import {
  formatDateHeading,
  matchSlashCommands,
  parseSlashCommand,
  shortCwd,
  SLASH_COMMANDS,
  THEMES,
  THEME_NAMES,
} from "./design";

describe("OpenCode-shaped zcode-tui design model", () => {
  test("ships the reference palette and multiple theme arms", () => {
    expect(THEMES.opencode.bg).toBe("#0a0a0a");
    expect(THEMES["zai-dark"].accent).toBe("#60a5fa");
    expect(THEME_NAMES).toContain("opencode");
    expect(THEME_NAMES.length).toBeGreaterThanOrEqual(10);
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
