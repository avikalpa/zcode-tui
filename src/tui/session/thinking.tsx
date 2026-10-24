// Ported from opencode v2ref b084acc55ea2cdb50e9c2ec49a8d9ab3608d43ad:
// packages/tui/src/{context/thinking.ts,routes/session/message-parts.tsx,
// routes/session/thinking-syntax.ts,routes/session/index.tsx
// (SessionReasoningGroupView),util/locale.ts}. MIT; see THIRD-PARTY-NOTICES.md.
// React and theme-token bindings replace Solid/context. ZCode deltas provide
// locally observed reasoning boundaries; absent historical timestamps stay unknown.
import { useMemo, useState } from "react";
import { RGBA, SyntaxStyle } from "@opentui/core";
import { useRenderer } from "@opentui/react";
import type { ThemeTokens } from "../design";
import { SplitBorder } from "./tool-parts";

export type ThinkingMode = "show" | "hide";
export type ThinkingPart = { text: string; startedAt?: number; completedAt?: number };

export function reasoningSummary(text: string) {
  const content = text.trim();
  const match = content.match(/^\*\*([^*\n]+)\*\*(?:\r?\n\r?\n|$)/);
  if (!match) return { title: null, body: content };
  return { title: match[1].trim(), body: content.slice(match[0].length).trimEnd() };
}

export function nextThinkingMode(current: ThinkingMode): ThinkingMode {
  return current === "show" ? "hide" : "show";
}

export function reasoningContent(part: ThinkingPart) {
  return part.text.replace("[REDACTED]", "").trim();
}

export function appendThinking(parts: ThinkingPart[] = [], delta: string, now: number): ThinkingPart[] {
  const last = parts.at(-1);
  if (last && last.completedAt === undefined) {
    return [...parts.slice(0, -1), { ...last, text: last.text + delta }];
  }
  return [...parts, { text: delta, startedAt: now }];
}

export function completeThinking(parts: ThinkingPart[] = [], now: number = Date.now()): ThinkingPart[] {
  return parts.map((part) => part.completedAt === undefined ? { ...part, completedAt: now } : part);
}

export function thinkingDuration(parts: ThinkingPart[]): number | undefined {
  let known = false;
  const total = parts.reduce((sum, part) => {
    if (part.startedAt === undefined || part.completedAt === undefined) return sum;
    known = true;
    return sum + Math.max(0, part.completedAt - part.startedAt);
  }, 0);
  return known ? total : undefined;
}

export function thinkingDurationLabel(input: number): string {
  if (input < 1000) return `${input}ms`;
  if (input < 60000) return `${(input / 1000).toFixed(1)}s`;
  if (input < 3600000) return `${Math.floor(input / 60000)}m ${Math.floor((input % 60000) / 1000)}s`;
  if (input < 86400000) return `${Math.floor(input / 3600000)}h ${Math.floor((input % 3600000) / 60000)}m`;
  return `${Math.floor(input / 86400000)}d ${Math.floor((input % 86400000) / 3600000)}h`;
}

export function generateThinkingSyntax(syntax: SyntaxStyle, foreground: RGBA) {
  return SyntaxStyle.fromStyles(Object.fromEntries(
    syntax.getRegisteredNames().map((name) => [name, { ...syntax.getStyle(name), fg: foreground }]),
  ));
}

function ThinkingBody({ part, syntax, C, paddingLeft = 1 }: {
  part: ThinkingPart; syntax: SyntaxStyle; C: ThemeTokens; paddingLeft?: number;
}) {
  return (
    <box style={{ marginTop: 1, flexShrink: 0 }}>
      <box border={["left"]} customBorderChars={SplitBorder.customBorderChars} borderColor={C.border}
        style={{ paddingLeft, flexShrink: 0 }}>
        <code filetype="markdown" drawUnstyledText={false} streaming={part.completedAt === undefined}
          syntaxStyle={syntax} content={reasoningContent(part)} conceal={true} fg={C.subtle} />
      </box>
    </box>
  );
}

export function ThinkingBlock({ parts, mode, done, C, syntaxStyle, spinnerChar }: {
  parts: ThinkingPart[]; mode: ThinkingMode; done: boolean; C: ThemeTokens;
  syntaxStyle: SyntaxStyle; spinnerChar: string;
}) {
  const renderer = useRenderer();
  const [expanded, setExpanded] = useState(false);
  const [hover, setHover] = useState(false);
  const syntax = useMemo(() => generateThinkingSyntax(syntaxStyle, RGBA.fromHex(C.subtle)), [syntaxStyle, C.subtle]);
  const visible = parts.filter((part) => reasoningContent(part));
  if (!visible.length) return null;
  const title = reasoningSummary(reasoningContent(visible.at(-1)!)).title;
  const duration = thinkingDuration(visible);
  const warning = RGBA.fromHex(C.warning);
  const subduedWarning = RGBA.fromValues(warning.r, warning.g, warning.b, 0.6);

  if (mode === "show") {
    return <box style={{ flexDirection: "column", flexShrink: 0 }}>
      {visible.map((part, index) => {
        const completed = done || part.completedAt !== undefined;
        const elapsed = thinkingDuration([part]);
        return <box key={index} style={{ flexDirection: "column", flexShrink: 0 }}>
          <box border={["left"]} customBorderChars={SplitBorder.customBorderChars} borderColor={C.border}
            style={{ paddingLeft: 1, flexShrink: 0 }}>
            <text content={completed ? `Thought${elapsed !== undefined ? `: ${thinkingDurationLabel(elapsed)}` : ""}` : `${spinnerChar} Thinking`}
              fg={subduedWarning} wrapMode="none" />
          </box>
          <ThinkingBody part={part} syntax={syntax} C={C} />
        </box>;
      })}
    </box>;
  }

  const label = done
    ? `${expanded ? "-" : "+"} Thought${!expanded && title ? `: ${title}` : ""}${visible.length > 1 ? ` · ${visible.length} steps` : ""}${duration ? ` · ${thinkingDurationLabel(duration)}` : ""}`
    : `${spinnerChar} Thinking${title ? `: ${title}` : ""}`;
  return <box style={{ flexDirection: "column", flexShrink: 0 }}>
    <box onMouseOver={() => setHover(true)} onMouseOut={() => setHover(false)} onMouseUp={() => {
      if (renderer.getSelection()?.getSelectedText()) return;
      setExpanded((value) => !value);
    }} style={{ flexShrink: 0 }}>
      <text content={label} fg={!done ? C.fg : hover || expanded ? C.warning : subduedWarning} wrapMode="none" />
    </box>
    {expanded ? <box style={{ paddingLeft: 3, flexDirection: "column", flexShrink: 0 }}>
      {visible.map((part, index) => <ThinkingBody key={index} part={part} syntax={syntax} C={C} />)}
    </box> : null}
  </box>;
}
