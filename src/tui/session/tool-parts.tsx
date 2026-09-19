// Ported from opencode v2.0.7 packages/tui/src/routes/session/index.tsx
// (ToolPart + the per-tool components), routes/session/message-parts.tsx
// (InlineToolRow), util/tool-display.ts, util/collapse-tool-output.ts and
// ui/border.ts — the tool-call rows, verbatim grammar: the per-tool icons,
// titles, pending lines, block shells and the generic expandable row.
//
// zcode wiring adaptations (the only non-port parts, recorded in
// docs/parity-v2.md deviation queue): the upstream rows expand via mouse
// click — this binding has no mouse plane, so expansion is keyboard-driven
// (ctrl+o toggles the expanded set, adapter registered in the ledger); there
// is no background-shell output client (output renders from the part);
// zcode tool input carries file_path rather than path.

import { TextAttributes } from "@opentui/core";
import type { ThemeTokens } from "../design";
import { stringWidth } from "../diff/string-width";
import { FilePath } from "../diff/file-path";
import { PatchDiff } from "../diff/patch-diff";

// ---- ui/border.ts ----
export const EmptyBorder = {
  topLeft: "",
  bottomLeft: "",
  vertical: "",
  topRight: "",
  bottomRight: "",
  horizontal: " ",
  bottomT: "",
  topT: "",
  cross: "",
  leftT: "",
  rightT: "",
};

export const SplitBorder = {
  border: ["left" as const, "right" as const],
  customBorderChars: {
    ...EmptyBorder,
    vertical: "┃",
  },
};

// ---- util/tool-display.ts ----
export function canonicalToolName(name: string) {
  const lower = name.toLowerCase();
  if (lower === "bash") return "shell";
  if (lower === "task") return "subagent";
  if (lower === "apply_patch") return "patch";
  return lower;
}

export function finiteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return undefined;
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function primitiveInputSummary(input: Record<string, unknown>, omit: readonly string[] = []) {
  const entries = Object.entries(input).filter(([key, value]) => {
    if (omit.includes(key)) return false;
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
  });
  if (entries.length === 0) return "";
  return `[${entries.map(([key, value]) => `${key}=${String(value)}`).join(", ")}]`;
}

export function genericToolSummary(tool: string, input: Record<string, unknown>) {
  const args = primitiveInputSummary(input).replace(/\s+/g, " ");
  return `${tool}${args ? ` ${args}` : ""}`;
}

// ---- util/collapse-tool-output.ts ----
export function collapseToolOutput(output: string, maxLines: number, maxChars: number) {
  const lines = output.split("\n");
  if (lines.length <= maxLines && Array.from(output).length <= maxChars) {
    return { output, overflow: false };
  }
  const visible = lines.slice(0, maxLines);
  if (lines.length > maxLines && visible.length > 0) visible[visible.length - 1] += "…";
  const preview = visible.join("\n");
  if (Array.from(preview).length > maxChars) {
    return {
      output:
        Array.from(preview)
          .slice(0, Math.max(0, maxChars - 1))
          .join("") + "…",
      overflow: true,
    };
  }
  return { output: preview, overflow: true };
}

export function collapseShellOutput(input: string, output: string, maxLines: number, maxChars: number) {
  if (!input) {
    const collapsed = collapseToolOutput(output, maxLines, maxChars);
    return {
      input,
      output: collapsed.overflow ? collapseTail(output, maxLines, maxChars) : output,
      overflow: collapsed.overflow,
    };
  }
  const commandLines = Math.min(2, maxLines);
  const lineChars = Math.max(1, Math.floor(maxChars / Math.max(1, maxLines)));
  const command = collapseShellCommand(input, commandLines, lineChars);
  if (!command.output || command.output === input) {
    if (!output) return { input: command.output, output, overflow: command.overflow };
  }
  const lines = Math.max(1, maxLines - command.lines - 1);
  const chars = Math.max(1, maxChars - Array.from(command.output).length - 2);
  const collapsed = collapseToolOutput(output, lines, chars);
  return {
    input: command.output,
    output: collapsed.overflow ? collapseTail(output, lines, chars) : output,
    overflow: command.overflow || collapsed.overflow,
  };
}

function collapseShellCommand(input: string, maxLines: number, lineWidth: number) {
  const visible: string[] = [];
  let lines = 1;
  let width = 0;
  const graphemes = Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(input), (s) => s.segment);
  const overflow = graphemes.some((segment) => {
    if (segment === "\n") {
      if (lines >= maxLines) return true;
      visible.push(segment);
      lines++;
      width = 0;
      return false;
    }
    const next = stringWidth(segment);
    if (width + next > lineWidth) {
      if (lines >= maxLines) return true;
      lines++;
      width = 0;
    }
    visible.push(segment);
    width += next;
    return false;
  });
  if (!overflow) return { output: input, overflow, lines };
  if (width >= lineWidth) {
    const removed = visible.pop();
    if (removed !== undefined && removed !== "\n") width -= stringWidth(removed);
  }
  return { output: visible.join("") + "…", overflow, lines };
}

function collapseTail(output: string, maxLines: number, maxChars: number) {
  const lines = output.split("\n");
  if (lines.length <= maxLines && Array.from(output).length <= maxChars) return output;
  const count = Math.max(1, lines.length - Math.max(0, maxLines - 1));
  const label = `(${count} earlier ${count === 1 ? "line" : "lines"})`;
  if (maxLines <= 1) return label;
  const preview = Array.from(lines.slice(-(maxLines - 1)).join("\n"));
  const available = maxChars - Array.from(label).length - 1;
  if (available <= 0) return label;
  return `${label}\n${preview.slice(-available).join("")}`;
}

// ---- the row model: the zcode wiring side ----
export type ToolPartModel = {
  tool: string;
  status: string; // pending | streaming | running | completed | error
  input: Record<string, unknown>;
  output?: string;
  error?: string;
  metadata?: Record<string, unknown>;
};

export function toolDisplay(tool: string): string {
  const known = new Set([
    "shell", "glob", "read", "grep", "webfetch", "websearch",
    "write", "edit", "subagent", "execute", "patch", "question", "skill",
  ]);
  const normalized = canonicalToolName(tool);
  return known.has(normalized) ? normalized : "generic";
}

const INLINE_TOOL_ICON_WIDTH = 2;

// path fields: the zcode protocol speaks file_path; upstream speaks path.
function inputPath(input: Record<string, unknown>): string | undefined {
  return stringValue(input.file_path) ?? stringValue(input.path);
}

export function ToolPart(props: {
  C: ThemeTokens;
  m: ToolPartModel;
  syntaxStyle?: unknown;
  expanded: boolean;
  width: number;
  spinnerChar: string;
}) {
  const C = props.C;
  const m = props.m;
  const display = toolDisplay(m.tool);
  const complete = m.status === "completed";
  const failed = m.status === "error";
  const loading = m.status === "streaming" || m.status === "running" || m.status === "pending";
  const error = failed ? (m.error ?? "tool failed") : undefined;
  const spinnerPrefix = loading ? `${props.spinnerChar} ` : "";

  const statusBadge = (label: string) => (
    <text content={` ${label} `} fg={C.subtle} bg={C.panel} />
  );

  // ---- InlineToolRow (message-parts.tsx) ----
  const inlineRow = (icon: string, color: string, children: string, pending: string, opts?: { strikethrough?: boolean }) => {
    if (loading) {
      return (
        <box style={{ paddingLeft: 3, paddingTop: 1, flexDirection: "row", flexShrink: 0 }}>
          <text content={`${spinnerPrefix}${pending}`} fg={color} />
        </box>
      );
    }
    return (
      <box style={{ paddingLeft: 3, paddingTop: 1, flexDirection: "row", flexShrink: 0 }}>
        <text content={icon} width={INLINE_TOOL_ICON_WIDTH} fg={failed ? C.error : color} attributes={opts?.strikethrough ? TextAttributes.STRIKETHROUGH : undefined} />
        <text content={failed && error ? error : children} fg={failed ? C.error : color} attributes={opts?.strikethrough ? TextAttributes.STRIKETHROUGH : undefined} wrapMode="none" />
      </box>
    );
  };

  // ---- BlockToolContent (index.tsx) ----
  const blockTool = (opts: {
    path?: { label: string; value: string };
    title?: string;
    children?: React.ReactNode;
  }) => (
    <box
      style={{
        borderStyle: "single",
        border: ["left"],
        customBorderChars: SplitBorder.customBorderChars,
        borderColor: C.border,
        paddingTop: 1,
        paddingBottom: 1,
        paddingLeft: 2,
        gap: 1,
        marginTop: 1,
        marginBottom: 1,
        flexDirection: "column",
        flexShrink: 0,
      }}
    >
      {opts.path ? (
        <box style={{ flexDirection: "row", gap: 1, minWidth: 0, flexShrink: 0 }}>
          <text content={spinnerPrefix ? opts.path.label.replace(/^# /, "") : opts.path.label} fg={C.subtle} />
          <FilePath value={opts.path.value} maxWidth={Math.max(2, props.width - 8 - stringWidth(opts.path.label))} fg={C.subtle} />
        </box>
      ) : opts.title ? (
        <text content={spinnerPrefix ? opts.title.replace(/^# /, "") : opts.title} fg={C.subtle} />
      ) : null}
      {opts.children}
      {error ? <text content={error} fg={C.error} /> : null}
    </box>
  );

  const input = m.input;
  const metadata = m.metadata ?? {};
  const output = (m.output ?? "").trim();

  switch (display) {
    case "shell": {
      // ShellDisplay, minus the background-shell output client (no such
      // zcode verb): the command + collapsed output in a block.
      const command = stringValue(input.command) ?? "";
      const workdir = stringValue(input.workdir);
      const prefix = workdir && workdir !== "." ? `cd ${workdir} && ` : "";
      const fullInput = command ? `${complete ? "$ " : ""}${prefix}${command}` : "";
      const maxLines = 10;
      const maxChars = maxLines * Math.max(20, props.width - 6 - (loading ? 2 : 0));
      const collapsed = collapseShellOutput(fullInput, output, maxLines, maxChars);
      const shownInput = props.expanded ? fullInput : collapsed.input;
      const shownOutput = props.expanded ? output : collapsed.output;
      return blockTool({
        title: command ? undefined : loading ? "Writing command…" : "Writing command…",
        children: (
          <box style={{ flexDirection: "column", gap: 1, flexShrink: 0 }}>
            {shownInput ? <text content={shownInput} fg={C.fg} wrapMode="char" /> : null}
            {shownOutput ? <text content={shownOutput} fg={C.subtle} /> : null}
          </box>
        ),
      });
    }
    case "write": {
      const path = inputPath(input);
      if (complete) {
        return blockTool({
          path: { label: "# Wrote", value: path ?? "" },
          children: stringValue(input.content) ? (
            <text content={(stringValue(input.content) ?? "").split("\n").slice(0, 12).join("\n")} fg={C.fg} />
          ) : null,
        });
      }
      return inlineRow("←", C.subtle, `Write ${path ?? ""}`, "Preparing write…");
    }
    case "edit": {
      const path = inputPath(input);
      const files = Array.isArray(metadata.files) ? metadata.files : [];
      const first = files.find((f): f is Record<string, unknown> => typeof f === "object" && f !== null);
      const patch = first ? stringValue(first.patch) : undefined;
      if (patch) {
        return blockTool({
          path: { label: "← Edit", value: path ?? "" },
          children: (
            <PatchDiff
              diff={patch}
              hunkFg={C.subtle}
              view="unified"
              showLineNumbers
              wrapMode="char"
              fg={C.fg}
              addedBg={C.success}
              removedBg={C.error}
              contextBg={C.surface}
              addedSignColor={C.success}
              removedSignColor={C.error}
              lineNumberFg={C.faint}
              lineNumberBg={C.surface}
              addedLineNumberBg={C.surface}
              removedLineNumberBg={C.surface}
              syntaxStyle={props.syntaxStyle}
            />
          ),
        });
      }
      return blockTool({
        path: path ? { label: "← Edit", value: path } : undefined,
        title: path ? undefined : "# Preparing edit…",
      });
    }
    case "glob": {
      const count = finiteNumber(metadata.count);
      const path = stringValue(input.path);
      return inlineRow(
        "✱",
        C.subtle,
        `Glob "${stringValue(input.pattern) ?? ""}"${path ? ` in ${path} ` : " "}${count !== undefined ? `(${count} ${count === 1 ? "match" : "matches"})` : ""}`,
        "Finding files…",
      );
    }
    case "read": {
      const loaded = Array.isArray(metadata.loaded)
        ? metadata.loaded.filter((p): p is string => typeof p === "string")
        : [];
      return (
        <box style={{ flexDirection: "column", flexShrink: 0 }}>
          {inlineRow("→", C.subtle, `Read ${inputPath(input) ?? ""}`, "Reading file…")}
          {props.expanded
            ? loaded.map((filepath) => (
                <box key={filepath} style={{ paddingLeft: 6, flexDirection: "row", flexShrink: 0 }}>
                  <text content={`↳ Loaded ${filepath}`} fg={C.subtle} />
                </box>
              ))
            : null}
        </box>
      );
    }
    case "grep": {
      const matches = finiteNumber(metadata.matches);
      const path = stringValue(input.path);
      return inlineRow(
        "✱",
        C.subtle,
        `Grep "${stringValue(input.pattern) ?? ""}"${path ? ` in ${path} ` : " "}${matches !== undefined ? `(${matches} ${matches === 1 ? "match" : "matches"})` : ""}`,
        "Searching content…",
      );
    }
    case "webfetch":
      return inlineRow("%", C.subtle, `WebFetch ${stringValue(input.url) ?? ""}`, "Fetching from the web…");
    case "websearch":
      return inlineRow("◈", C.subtle, `Web Search "${stringValue(input.query) ?? ""}"`, "Searching web…");
    case "subagent": {
      const description = stringValue(input.description);
      const agent = stringValue(input.agent) ?? stringValue(input.subagent_type) ?? "General";
      const title = `${agent.charAt(0).toUpperCase()}${agent.slice(1)} Subagent — ${description ?? "Subagent"}`;
      const icon = complete ? "✓" : "│";
      return inlineRow(icon, C.subtle, title, "Delegating…");
    }
    case "question":
      return inlineRow("◈", C.subtle, String(input.question ?? "Question"), "Asking…");
    case "skill":
      return inlineRow("→", C.subtle, String(input.skill ?? input.name ?? "Skill"), "Loading skill…");
    case "patch": {
      const targets = [...String(input.patchText ?? "").matchAll(/\*\*\* (?:Add|Update|Delete) File: ([^\r\n]+)/g)].map(
        (match) => match[1].trim(),
      );
      const first = targets[0];
      return inlineRow("←", C.subtle, `Patch ${targets.length > 1 ? `(${targets.length} files) ` : ""}${first ?? ""}`, "Applying patch…");
    }
    default: {
      // GenericTool: the summary line + the expandable input/output detail.
      const entries = Object.entries(input);
      const expandable = entries.length > 0 || output.length > 0;
      if (!expandable) {
        return inlineRow(failed ? "✗" : "✓", C.subtle, genericToolSummary(m.tool, input), m.tool);
      }
      return (
        <box style={{ flexDirection: "column", flexShrink: 0 }}>
          {inlineRow(failed ? "✗" : "✓", C.subtle, genericToolSummary(m.tool, input), m.tool)}
          {props.expanded ? (
            <box style={{ paddingLeft: 3 + INLINE_TOOL_ICON_WIDTH, flexDirection: "column", flexShrink: 0 }}>
              {entries.map(([key, value]) => (
                <box key={key} style={{ flexDirection: "row", flexShrink: 0 }}>
                  <text content={`${key}: `} fg={C.subtle} />
                  <text content={typeof value === "string" ? value : JSON.stringify(value)} fg={C.fg} wrapMode="word" />
                </box>
              ))}
              {output ? (
                <box style={{ flexDirection: "row", flexShrink: 0 }}>
                  <text content="output: " fg={C.subtle} />
                  <text content={output} fg={C.fg} wrapMode="word" />
                </box>
              ) : null}
            </box>
          ) : null}
        </box>
      );
    }
  }
}
