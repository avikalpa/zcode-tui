import { describe, expect, test } from "bun:test";
import { formatSessionTranscript, withTimestampedFallback, type TranscriptTurn } from "./transcript";

const SESSION = { id: "sess-1", title: "My session", createdAt: 1727000000000, updatedAt: 1727000099999 };

describe("withTimestampedFallback", () => {
  test("keeps a real title", () => {
    expect(withTimestampedFallback({ ...SESSION, title: "My session" })).toBe("My session");
  });
  test("falls back to the timestamped root title", () => {
    const t = withTimestampedFallback({ id: "s", createdAt: 0, updatedAt: 0 });
    expect(t.startsWith("New session - ")).toBe(true);
  });
  test("child sessions fall back to the Child prefix", () => {
    const t = withTimestampedFallback({ id: "s", parentID: "p", createdAt: 0, updatedAt: 0 });
    expect(t.startsWith("Child session - ")).toBe(true);
  });
});

describe("formatSessionTranscript", () => {
  test("header carries id/created/updated and the title", () => {
    const out = formatSessionTranscript(SESSION, [], true);
    expect(out.startsWith("# My session\n\n**Session ID:** sess-1\n")).toBe(true);
    expect(out).toContain("**Created:**");
    expect(out).toContain("**Updated:**");
    expect(out.endsWith("\n---\n\n\n")).toBe(true);
  });

  test("user and assistant sections with the v2 grammar", () => {
    const turns: TranscriptTurn[] = [
      { role: "user", text: "hello" },
      { role: "assistant", text: "hi there" },
    ];
    const out = formatSessionTranscript(SESSION, turns, true);
    expect(out).toContain("## User\n\nhello");
    expect(out).toContain("## Assistant\n\nhi there");
    expect(out).toContain("\n\n---\n\n");
  });

  test("thinking block only behind the toggle", () => {
    const turns: TranscriptTurn[] = [{ role: "assistant", text: "answer", thinking: "hmm" }];
    expect(formatSessionTranscript(SESSION, turns, true)).toContain("_Thinking:_\n\nhmm");
    expect(formatSessionTranscript(SESSION, turns, false)).not.toContain("Thinking");
  });

  test("tool blocks ride the current assistant section and honor the tools toggle", () => {
    const turns: TranscriptTurn[] = [
      { role: "user", text: "run it" },
      { role: "assistant", text: "running" },
      { role: "tool", text: "", toolName: "Bash", toolInput: { command: "ls" }, toolOut: "file.txt", toolStatus: "completed" },
      { role: "assistant", text: "done" },
    ];
    const out = formatSessionTranscript(SESSION, turns, false, true);
    expect(out).toContain("**Tool: Bash**\n\n**Input:**\n```json\n{\n  \"command\": \"ls\"\n}\n```\n\nfile.txt");
    const toolAt = out.indexOf("**Tool: Bash**");
    const assistantAt = out.indexOf("## Assistant");
    const userAt = out.indexOf("## User");
    expect(toolAt).toBeGreaterThan(assistantAt);
    expect(assistantAt).toBeGreaterThan(userAt);
    expect(out).toContain("done");
    const noTools = formatSessionTranscript(SESSION, turns, false, false);
    expect(noTools).not.toContain("**Tool:");
  });

  test("tool error prints the error text; streaming prints nothing", () => {
    const err: TranscriptTurn[] = [
      { role: "assistant", text: "x" },
      { role: "tool", text: "", toolName: "T", toolStatus: "error", toolError: "boom" },
    ];
    expect(formatSessionTranscript(SESSION, err, false)).toContain("```\n\nboom");
    const streaming: TranscriptTurn[] = [
      { role: "assistant", text: "x" },
      { role: "tool", text: "", toolName: "T", toolStatus: "streaming", toolOut: "partial" },
    ];
    expect(formatSessionTranscript(SESSION, streaming, false)).not.toContain("partial");
  });

  test("untitled sessions take the timestamped fallback in the header", () => {
    const out = formatSessionTranscript({ id: "s2", createdAt: 0, updatedAt: 0 }, [], true);
    expect(out.startsWith("# New session - ")).toBe(true);
  });

  test("empty assistant sections do not emit headers", () => {
    const turns: TranscriptTurn[] = [{ role: "assistant", text: "" }];
    const out = formatSessionTranscript(SESSION, turns, false);
    expect(out).not.toContain("## Assistant");
  });
});
