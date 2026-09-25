// zcode-tui — an OpenCode-shaped ZCode client.
//
// The runtime and protocol stay ZCode's. This file owns the presentation
// layer: home, sessions picker, session transcript, composer, sidebar, themes,
// and the small keyboard state machines that make those surfaces feel like one
// TUI. The surfaces follow the OpenCode reference UI (surfaces, spacing and
// status grammar measured against its published TUI components), not its code.
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useKeyboard, useTerminalDimensions, usePaste } from "@opentui/react";
import { SyntaxStyle, TextAttributes, decodePasteBytes } from "@opentui/core";
import { SelectDialog, TextPromptDialog, ModalBackdrop, type DialogOption } from "./select-dialog";
import type { AppServer } from "../protocol/client";
import { recentInputs } from "../store/history";
import { formatSessionTranscript } from "./session/transcript";
import { errorMessage } from "./error";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { probe } from "./probes";
import { Announcer, type AnnouncePhase } from "./announce";
import {
  fetchPlanQuota,
  formatCompact,
  formatReset,
  parseUsageStats,
  quotaBar,
  readStoredApiKey,
  type PlanQuotaSnapshot,
  type UsageStatsSummary,
} from "./planQuota";
import {
  mapHostSubagents,
  pickerTabs,
  subagentStatusLabel,
  tabIndex as subagentTabIndex,
  type PickerFilter,
  type SubagentTab,
} from "./session/subagents";
import { modelDialogOptions } from "./model-dialog";
import { SubagentInspector, subagentStatusColor, subagentStatusIcon } from "./subagent-strip";
import {
  formatDateHeading,
  formatContextLabel,
  formatTimeShort,
  formatTokens,
  formatTurnFooter,
  matchSlashCommands,
  wrapRows,
  wrapText,
  mdFor,
  modeAccent,
  modeLabel,
  parseSlashCommand,
  shortCwd,
  SLASH_COMMANDS,
  THEME_NAMES,
  themeModes,
  tokensFor,
  type SlashCommandSpec,
  type ThemeMode,
  type ThemeName,
  type ThemeTokens,
  diffFor,
} from "./design";
import { DiffViewer, diffSourceLabel, filetypeOf, type DiffPreferences, type DiffViewerApi } from "./diff/diff-viewer";
import { PatchDiff } from "./diff/patch-diff";
import { ToolPart } from "./session/tool-parts";
import {
  messageBoundaryIDs,
  normalizeRawMessage,
  reduceSessionRows,
  resolvePart,
  turnDuration,
  type NormMessage,
  type NormPart,
  type RawMessageRecord,
  type SessionRow as TranscriptRow,
} from "./session/rows";
import { SessionGroupView, type GroupViewCtx } from "./session/group-view";
import { EntryAnchor, timelineAnchors } from "./session/anchor-view";
import { createModelPreferenceRepository, modelKey, type UiState } from "./session/model-preference";
import { SessionTabsStrip, type SessionTab, type SessionTabStatus } from "./session/session-tabs";
import {
  closeSessionTab,
  cycleSessionTab,
  moveSessionTabHistory,
  openSessionTab,
  recordClosedSessionTab,
  recordSessionTabHistory,
  reopenSessionTab,
  type ClosedSessionTab,
  type SessionTabHistory,
} from "./session/session-tabs-model";
import { getRelativeTime, getStashPreview, promptStash, type StashEntry } from "./session/prompt-stash";
import {
  attachmentKind,
  deduplicatePromptImages,
  nextAttachmentLabel,
  resolvePastedAttachments,
  stripAttachmentLabels,
  uploadSessionAttachment,
} from "./attachment";
import { listBranches, type DiffMode } from "./diff/git";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, appendFileSync, openSync, writeSync, closeSync, unlinkSync } from "node:fs";
import { spawn } from "node:child_process";
import pkgJson from "../../package.json";

const VERSION = pkgJson.version;

// Markdown tinting per active theme: the assistant transcript renders through
// a SyntaxStyle built from the SAME tree-sitter scope rules OpenCode feeds its
// markdown element (ported verbatim from their theme module), with colours from
// the active theme's markdown/syntax/diff arms. This is what turns fenced code
// blocks into highlighted, numbered panels and gives headings/lists/diffs
// their structure colours.
const mdStyleCache = new Map<string, SyntaxStyle>();
type ThemeRule = { scope: string[]; style: { foreground?: string; background?: string; bold?: boolean; italic?: boolean; underline?: boolean } };
function mdStyleFor(theme: ThemeName, themeMode: ThemeMode): SyntaxStyle {
  const cacheKey = `${theme}:${themeMode}`;
  const cached = mdStyleCache.get(cacheKey);
  if (cached) return cached;
  const C = tokensFor(theme, themeMode);
  const md = mdFor(theme, themeMode);
  const diff = diffFor(theme, themeMode);
  const rules: ThemeRule[] = [
    { scope: ["default"], style: { foreground: C.fg } },
    { scope: ["comment", "comment.documentation"], style: { foreground: md.synComment, italic: true } },
    { scope: ["string", "symbol"], style: { foreground: md.synString } },
    { scope: ["number", "boolean"], style: { foreground: md.synNumber } },
    { scope: ["character.special"], style: { foreground: md.synString } },
    { scope: ["keyword.return", "keyword.conditional", "keyword.repeat", "keyword.coroutine"], style: { foreground: md.synKeyword, italic: true } },
    { scope: ["keyword.type"], style: { foreground: md.synType, bold: true, italic: true } },
    { scope: ["keyword.function", "function.method"], style: { foreground: md.synFunction } },
    { scope: ["keyword"], style: { foreground: md.synKeyword, italic: true } },
    { scope: ["keyword.import"], style: { foreground: md.synKeyword } },
    { scope: ["operator", "keyword.operator", "punctuation.delimiter"], style: { foreground: md.synOperator } },
    { scope: ["keyword.conditional.ternary"], style: { foreground: md.synOperator } },
    { scope: ["variable", "variable.parameter", "function.method.call", "function.call"], style: { foreground: md.synVariable } },
    { scope: ["variable.member", "function", "constructor"], style: { foreground: md.synFunction } },
    { scope: ["type", "module"], style: { foreground: md.synType } },
    { scope: ["constant"], style: { foreground: md.synNumber } },
    { scope: ["property"], style: { foreground: md.synVariable } },
    { scope: ["class"], style: { foreground: md.synType } },
    { scope: ["parameter"], style: { foreground: md.synVariable } },
    { scope: ["punctuation", "punctuation.bracket"], style: { foreground: md.synPunct } },
    { scope: ["variable.builtin", "type.builtin", "function.builtin", "module.builtin", "constant.builtin"], style: { foreground: C.error } },
    { scope: ["variable.super"], style: { foreground: C.error } },
    { scope: ["string.escape", "string.regexp"], style: { foreground: md.synKeyword } },
    { scope: ["keyword.directive"], style: { foreground: md.synKeyword, italic: true } },
    { scope: ["punctuation.special"], style: { foreground: md.synOperator } },
    { scope: ["keyword.modifier"], style: { foreground: md.synKeyword, italic: true } },
    { scope: ["keyword.exception"], style: { foreground: md.synKeyword, italic: true } },
    // Markdown structure scopes.
    { scope: ["markup.heading"], style: { foreground: md.mdHeading, bold: true } },
    { scope: ["markup.heading.1"], style: { foreground: md.mdHeading, bold: true, underline: true } },
    { scope: ["markup.heading.2"], style: { foreground: md.mdHeading, bold: true } },
    { scope: ["markup.heading.3"], style: { foreground: md.mdHeading, bold: true } },
    { scope: ["markup.heading.4"], style: { foreground: md.mdHeading, bold: true } },
    { scope: ["markup.heading.5"], style: { foreground: md.mdHeading, bold: true } },
    { scope: ["markup.heading.6"], style: { foreground: md.mdHeading, bold: true } },
    { scope: ["markup.bold", "markup.strong"], style: { foreground: md.mdStrong, bold: true } },
    { scope: ["markup.italic"], style: { foreground: md.mdEmph, italic: true } },
    { scope: ["markup.list"], style: { foreground: md.mdListItem } },
    { scope: ["markup.quote"], style: { foreground: md.mdQuote, italic: true } },
    { scope: ["markup.raw", "markup.raw.block"], style: { foreground: md.mdCode } },
    { scope: ["markup.raw.inline"], style: { foreground: md.mdCode, background: C.bg } },
    { scope: ["markup.link"], style: { foreground: md.mdLink, underline: true } },
    { scope: ["markup.link.label"], style: { foreground: md.mdLinkText, underline: true } },
    { scope: ["markup.link.url"], style: { foreground: md.mdLink, underline: true } },
    { scope: ["label"], style: { foreground: md.mdLinkText } },
    { scope: ["spell", "nospell"], style: { foreground: C.fg } },
    { scope: ["conceal"], style: { foreground: C.subtle } },
    { scope: ["string.special", "string.special.url"], style: { foreground: md.mdLink, underline: true } },
    { scope: ["character"], style: { foreground: md.synString } },
    { scope: ["float"], style: { foreground: md.synNumber } },
    { scope: ["comment.error"], style: { foreground: C.error, italic: true, bold: true } },
    { scope: ["comment.warning"], style: { foreground: C.warning, italic: true, bold: true } },
    { scope: ["comment.todo", "comment.note"], style: { foreground: C.assistant, italic: true, bold: true } },
    { scope: ["namespace"], style: { foreground: md.synType } },
    { scope: ["field"], style: { foreground: md.synVariable } },
    { scope: ["type.definition"], style: { foreground: md.synType, bold: true } },
    { scope: ["keyword.export"], style: { foreground: md.synKeyword } },
    { scope: ["attribute", "annotation"], style: { foreground: C.warning } },
    { scope: ["diff.minus"], style: { foreground: diff.diffRemoved, background: diff.diffRemovedBg } },
    { scope: ["diff.delta"], style: { foreground: diff.diffContext, background: diff.diffContextBg } },
    { scope: ["error"], style: { foreground: C.error, bold: true } },
    { scope: ["warning"], style: { foreground: C.warning, bold: true } },
    { scope: ["info"], style: { foreground: C.assistant } },
    { scope: ["debug"], style: { foreground: C.subtle } },
  ];
  const style = SyntaxStyle.fromTheme(rules.map((r) => ({
    scope: r.scope,
    style: {
      foreground: r.style.foreground,
      background: r.style.background,
      bold: r.style.bold,
      italic: r.style.italic,
      underline: r.style.underline,
    },
  })));
  mdStyleCache.set(cacheKey, style);
  return style;
}

// ⛔ MODEL ALLOWLIST (owner ruling 2026-09-08): exactly these two on the zai
// provider. The runtime catalog must never re-introduce the paid login models.
// The wire ids intentionally preserve the desktop's canonical capitalization.
const ALLOWED_MODELS = [
  { label: "GLM-5.3-Flash", providerId: "zai", providerLabel: "Z.AI Coding Plan", modelId: "GLM-5.3-Flash", isDefault: true },
  { label: "GLM-5.3", providerId: "zai", providerLabel: "Z.AI Coding Plan", modelId: "GLM-5.3", isDefault: false },
] as const;

export const MODES = ["plan", "build", "edit", "yolo", "auto"] as const;
// v2 displayVersion: a 40/64-hex commit pin renders as the short sha, a
// semver stays whole (feature-plugins/system/plugins.tsx footer grammar).
const shortVersion = (version: string) =>
  /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(version) ? version.slice(0, 7) : version;
const EFFORTS = ["low", "high", "max"] as const;

type ModelChoice = { label: string; providerId: string; providerLabel?: string; modelId: string; isDefault?: boolean };
type AppView = "home" | "session" | "diff";
type DialogName = "sessions" | "model" | "mode" | "effort" | "palette" | "fork" | "themes" | "rename" | "help" | "queue" | "diffsource" | "diffbase" | "diffhelp" | "stash" | "skills" | "mcp" | "plugins" | "status" | "settings" | "msgactions" | "export" | "exportresult" | "imagepreview" | "subagents" | null;

// v2 PromptInput.FileAttachment as our draft carries it: the data-uri,
// its mime and bytes (the upload needs both), the filename, and the
// virtual [Image N]/[PDF N] label living in the draft text.
type PromptFilePart = { uri: string; mime: string; bytes: Uint8Array; name?: string; label: string };

export interface SessionRow {
  sessionId: string;
  title: string;
  status: string;
  mode?: string;
  updatedAt: number;
  createdAt?: number;
  modelId?: string;
}

export interface TurnMessage {
  role: string; // "user" | "assistant" | "tool"
  text: string;
  model?: string;
  toolName?: string;
  toolCallId?: string;
  toolOk?: boolean;
  toolMs?: number;
  toolOut?: string;
  // The v2 tool rows render from the structured part (per-tool titles,
  // collapse arithmetic, expandable detail) — deviation queue 1.
  toolInput?: Record<string, unknown>;
  toolStatus?: string;
  toolMeta?: Record<string, unknown>;
  toolError?: string;
  messageId?: string;
  // v2 timeline/fork rows carry the message creation time (Locale.time
  // footer); our payload takes it when one carries it.
  createdAt?: number;
  // Turn metrics for the per-message footer (OpenCode's
  // `Build · model · 4.2s · 19.8 tok/s` line).
  turnStart?: number;
  durationMs?: number;
  // v2 AssistantFooter appends a subdued `· interrupted` on a stopped turn
  // (0.6.30 port); we stamp it at session/stop time.
  interrupted?: boolean;
  outputTokens?: number;
  // v2.0.8 counts reasoning tokens in the throughput numerator (upstream
  // rows.ts); our payload takes the field when one ever carries it.
  reasoningTokens?: number;
  // Reasoning is collapsed once the turn completes; the streaming tail shows
  // it live until then.
  thinking?: string;
  thinkingMs?: number;
}

// The wordmark — designed by Astra (2026-09-14 consult) in the OpenCode
// block-letter style. Mark vocabulary: `_` space on faint bg, `^` upper-half
// block letter-on-faint, `~` upper-half block faint, `,` lower-half faint;
// anything else renders literally. left = quiet colour, right = bright.
const LOGO_LINES: [string, string][] = [
  ["                        ", "              "],
  ["▀▀▀█ █▀▀▀ █▀▀█ █▀▀█ █▀▀█", "▀█▀▀ █  █  ▀  "],
  ["▄█▀_ █___ █__█ █__█ █^^^", "_█__ █__█  █  "],
  ["▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀", "_▀▀▀ ▀▀▀▀  ▀▀▀"],
];

function LogoChar({ ch, fg, C }: { ch: string; fg: string; C: ThemeTokens }) {
  if (ch === "_") return <text content=" " fg={fg} bg={C.faint} />;
  if (ch === "^") return <text content="▀" fg={fg} bg={C.faint} />;
  if (ch === "~") return <text content="▀" fg={C.faint} />;
  if (ch === ",") return <text content="▄" fg={C.faint} />;
  return <text content={ch} fg={fg} />;
}

function ZCodeLogo({ C }: { C: ThemeTokens }) {
  return (
    <box style={{ flexDirection: "column", flexShrink: 0 }}>
      {LOGO_LINES.map(([left, right], index) => (
        <box key={index} style={{ flexDirection: "row" }}>
          <box style={{ flexDirection: "row" }}>
            {[...left].map((ch, i) => (
              <LogoChar key={i} ch={ch} fg={C.subtle} C={C} />
            ))}
          </box>
          <box style={{ flexDirection: "row" }}>
            {[...` ${right}`].map((ch, i) => (
              <LogoChar key={i} ch={ch} fg={C.brand} C={C} />
            ))}
          </box>
        </box>
      ))}
    </box>
  );
}

function relTime(ts: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function displayTitle(row: SessionRow): string {
  return row.title.trim() || "Untitled session";
}

function modelLabel(choice: ModelChoice | undefined): string {
  if (!choice) return ALLOWED_MODELS[0].label;
  return choice.label.replace(/\s+\([^)]*\)$/, "");
}

function statusMeta(row: SessionRow): string {
  return [row.status || "idle", row.mode || "build", `${relTime(row.updatedAt)} ago`].join(" · ");
}

function normalizeSession(value: Record<string, unknown>): SessionRow {
  const time = value.time as Record<string, unknown> | undefined;
  const updatedAt = Number(value.updatedAt ?? value.lastActivityAt ?? time?.updated ?? Date.now());
  const createdAt = Number(time?.created ?? 0);
  return {
    sessionId: String(value.sessionId ?? value.id ?? ""),
    title: String(value.title ?? ""),
    status: String(value.status ?? value.phase ?? "idle"),
    mode: typeof value.mode === "string" ? value.mode : undefined,
    updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : Date.now(),
    createdAt: Number.isFinite(createdAt) && createdAt > 0 ? createdAt : undefined,
    modelId: typeof value.modelId === "string" ? value.modelId : undefined,
  };
}

// The UX-state store rides the v2.0.8 preference repository (see
// ./session/model-preference): recent/favorite/variant survive restarts and
// now sync live across concurrent zcode-tui processes. Since 0.6.32 theme
// {name,mode} rides here too (the v2 config.theme voice); only pinned
// sessions keep a dedicated file.
const uiStatePath = `${process.env.HOME}/.config/zcode-tui/state.json`;
const uiStateRepository = createModelPreferenceRepository(uiStatePath);
// Word-motion helpers for the input editing grammar (opencode input_*):
// a word is a run of non-whitespace; motions skip the whitespace gap first.
function wordBackward(text: string, pos: number): number {
  let i = pos;
  while (i > 0 && /\s/.test(text[i - 1] ?? "")) i--;
  while (i > 0 && !/\s/.test(text[i - 1] ?? "")) i--;
  return i;
}
function wordForward(text: string, pos: number): number {
  const n = text.length;
  let i = pos;
  while (i < n && /\s/.test(text[i] ?? "")) i++;
  while (i < n && !/\s/.test(text[i] ?? "")) i++;
  return i;
}
function lineStart(text: string, pos: number): number {
  const nl = text.lastIndexOf("\n", Math.max(0, pos - 1));
  return nl + 1;
}
function lineEnd(text: string, pos: number): number {
  const nl = text.indexOf("\n", pos);
  return nl === -1 ? text.length : nl;
}
// The reference editor handoff (packages/tui editor.ts): write the text to a
// temp .md, suspend the renderer, spawn VISUAL||EDITOR with inherit stdio,
// read back, resume. normalizeEditorContent strips ONE trailing newline.
function normalizeEditorContent(content: string): string {
  if (content.endsWith("\r\n")) {
    const body = content.slice(0, -2);
    return !body.includes("\n") && !body.includes("\r") ? body : content;
  }
  if (content.endsWith("\n")) {
    const body = content.slice(0, -1);
    return !body.includes("\n") && !body.includes("\r") ? body : content;
  }
  return content;
}
// The reference clipboard primitive (packages/tui clipboard.ts writeOsc52):
// OSC 52 with tmux/screen passthrough. OpenTUI owns fd 1, so the sequence
// goes through /dev/tty — the controlling PTY — like the probe channel does.
function osc52Copy(text: string): boolean {
  const sequence = `\x1b]52;c;${Buffer.from(text).toString("base64")}\x07`;
  const passthrough = `\x1bPtmux;\x1b${sequence}\x1b\\`;
  const payload = process.env.TMUX ? sequence + passthrough : process.env.STY ? passthrough : sequence;
  // Preferred: the controlling terminal. Fallback: raw fd 1 — OpenTUI
  // replaces the process.stdout STREAM but a raw writeSync syscall still
  // lands in the PTY.
  try {
    const tty = openSync("/dev/tty", "w");
    try {
      writeSync(tty, payload);
    } finally {
      closeSync(tty);
    }
    return true;
  } catch {
    try {
      writeSync(1, payload);
      return true;
    } catch {
      return false;
    }
  }
}
const isEffort = (value: unknown): value is (typeof EFFORTS)[number] =>
  typeof value === "string" && (EFFORTS as readonly string[]).includes(value);

// Running-state marker for the composer underline — v2's spinner group is a
// STATIC block char while busy (`▪`, mono fallback `*`; footer.width.ts +
// footer.view.tsx). Our animated braille was an invention; prime doctrine
// retires it (0.6.30).
// Ported from opencode v2.0.8 ui/dialog-export-options.tsx: the export
// form — format radio, the toggles the format carries, tab walks (v2's
// step order), return activates, Copy/Export confirm, esc cancels. OUR
// host gap: the zcode protocol has no session/export verb, so the json
// radio and its sanitize toggle have no data source and stay out (the
// 0.6.31 Revert-row precedent) — the tab order shortens accordingly.
// The v2 prompt image strip: the first three thumbs (height clamped to a
// quarter of the terminal, width twice the height) and the +N more box.
// Thumbs render the v2 <image> element verbatim (protocol auto: kitty/
// sixel when the terminal speaks them, the blocks fallback otherwise);
// the failed arm is v2's own. The click arms are mouse-only upstream.
function AttachmentStrip({ C, files, more, height }: {
  C: ThemeTokens;
  files: PromptFilePart[];
  more: (index: number) => void;
  height: number;
}) {
  if (files.length === 0) return null;
  const visible = files.slice(0, 3);
  return (
    <box style={{ flexDirection: "row", gap: 1, paddingBottom: 1, flexShrink: 0 }}>
      {visible.map((file, index) => (
        <ImageThumb key={file.label} C={C} file={file} height={height} onOpen={() => more(index)} />
      ))}
      {files.length > visible.length ? (
        <box style={{ width: 8, height, alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <text content={`+${files.length - visible.length} more`} fg={C.subtle} />
        </box>
      ) : null}
    </box>
  );
}

function ImageThumb({ C, file, height, onOpen }: {
  C: ThemeTokens;
  file: PromptFilePart;
  height: number;
  onOpen: () => void;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <box style={{ width: height * 2, height, flexShrink: 0 }}>
      {failed ? (
        <box style={{ width: "100%", height: "100%", alignItems: "center", justifyContent: "center" }}>
          <text content="No preview" fg={C.subtle} />
        </box>
      ) : (
        <image source={file.uri} fit="cover" protocol="auto" width="100%" height="100%" onError={() => setFailed(true)} />
      )}
    </box>
  );
}

// Ported from opencode v2.0.8 component/dialog-image-preview.tsx: the
// draft's image attachments walked with left/right, esc closes, the
// footer shows the label (or the failed arm's No preview).
function ImagePreviewDialog({ C, images, initial, onClose, width, height }: {
  C: ThemeTokens;
  images: PromptFilePart[];
  initial: number;
  onClose: () => void;
  width: number;
  height: number;
}) {
  const first = Math.max(0, Math.min(initial, Math.max(0, images.length - 1)));
  const [index, setIndex] = useState(first);
  const [failed, setFailed] = useState(false);
  const mirror = useRef({ index: first });
  const move = (direction: number) => {
    if (images.length < 2) return;
    setFailed(false);
    const next = (mirror.current.index + direction + images.length) % images.length;
    mirror.current.index = next;
    setIndex(next);
  };
  useKeyboard((key) => {
    if (key.name === "escape" || (key.ctrl && key.name === "c")) { onClose(); return; }
    if (key.name === "left") { move(-1); return; }
    if (key.name === "right") { move(1); return; }
  });
  if (images.length === 0) return null;
  const shown = Math.min(index, images.length - 1);
  const current = images[shown];
  const imageHeight = Math.max(3, height - 8);
  return (
    <ModalBackdrop C={C} width={width} height={height}>
      <box style={{ width: Math.min(96, Math.max(56, width - 6)), flexDirection: "column", backgroundColor: C.panel, paddingTop: 1, paddingBottom: 1, paddingLeft: 2, paddingRight: 2, gap: 1, flexShrink: 0 }}>
        <box style={{ height: 1, flexDirection: "row", justifyContent: "space-between", flexShrink: 0 }}>
          <text content={`Image ${shown + 1} of ${images.length}`} fg={C.fg} attributes={TextAttributes.BOLD} />
          <text content="esc" fg={C.faint} />
        </box>
        <box style={{ height: imageHeight, flexShrink: 0 }}>
          {failed ? (
            <box style={{ width: "100%", height: "100%", alignItems: "center", justifyContent: "center" }}>
              <text content="No preview" fg={C.subtle} />
            </box>
          ) : (
            <image source={current.uri} fit="fit" protocol="auto" width="100%" height={imageHeight} onError={() => setFailed(true)} />
          )}
        </box>
        <box style={{ height: 1, flexDirection: "row", justifyContent: "space-between", flexShrink: 0 }}>
          <text content={images.length > 1 ? "← previous" : ""} fg={C.subtle} />
          <text content={failed ? "No preview" : (current.name ?? current.label)} fg={failed ? C.error : C.subtle} />
          <text content={images.length > 1 ? "next →" : ""} fg={C.subtle} />
        </box>
      </box>
    </ModalBackdrop>
  );
}

function ExportDialog({ C, onClose, onConfirm, width, height }: {
  C: ThemeTokens;
  onClose: () => void;
  onConfirm: (opts: { action: "copy" | "export"; thinking: boolean; tools: boolean }) => void;
  width: number;
  height: number;
}) {
  type Active = "markdown" | "thinking" | "tools" | "copy" | "export";
  const [active, setActive] = useState<Active>("markdown");
  const [thinking, setThinking] = useState(true);
  const [tools, setTools] = useState(true);
  // The keyboard closure reads the mirror, not the render state — the
  // dialog must behave identically however useKeyboard registers handlers
  // across re-renders (the CX2 lesson: return read a stale `active` and
  // the toggle never fired).
  const mirror = useRef({ active: "markdown" as Active, thinking: true, tools: true });
  const move = (next: Active) => { mirror.current.active = next; setActive(next); };
  useKeyboard((key) => {
    if (key.name === "escape" || (key.ctrl && key.name === "c")) { onClose(); return; }
    if (key.name === "tab" || key.sequence === "\t") {
      const order: Active[] = ["markdown", "thinking", "tools", "copy", "export"];
      move(order[(order.indexOf(mirror.current.active) + 1) % order.length]);
      return;
    }
    if (key.name === "return") {
      // v2: a format row's return only selects it — the flow stays open.
      const s = mirror.current;
      if (s.active === "markdown") return;
      if (s.active === "thinking") { s.thinking = !s.thinking; setThinking(s.thinking); }
      else if (s.active === "tools") { s.tools = !s.tools; setTools(s.tools); }
      else onConfirm({ action: s.active, thinking: s.thinking, tools: s.tools });
    }
  });
  return (
    <ModalBackdrop C={C} width={width} height={height}>
      <box style={{ width: Math.min(64, Math.max(44, width - 4)), flexDirection: "column", flexShrink: 0, backgroundColor: C.panel, paddingTop: 1, paddingBottom: 1, paddingLeft: 2, paddingRight: 2 }}>
        <box style={{ height: 1, flexDirection: "row", justifyContent: "space-between", flexShrink: 0 }}>
          <text content="Export session" fg={C.fg} attributes={TextAttributes.BOLD} />
          <text content="esc" fg={C.faint} />
        </box>
        <box style={{ height: 1, flexShrink: 0 }} />
        <box style={{ height: 1, flexDirection: "row", flexShrink: 0 }}>
          <text content="Export as: " fg={C.fg} />
          <box style={{ paddingLeft: 1, paddingRight: 1, backgroundColor: active === "markdown" ? C.selected : C.panel }}>
            <text content="◉ Markdown" fg={active === "markdown" ? C.bg : C.accent} />
          </box>
        </box>
        <box style={{ height: 1, flexDirection: "row", flexShrink: 0, backgroundColor: active === "thinking" ? C.selected : C.panel }}>
          <text content={thinking ? "[x] " : "[ ] "} fg={active === "thinking" ? C.bg : C.fg} />
          <text content="Include thinking" fg={active === "thinking" ? C.bg : C.subtle} />
        </box>
        <box style={{ height: 1, flexDirection: "row", flexShrink: 0, backgroundColor: active === "tools" ? C.selected : C.panel }}>
          <text content={tools ? "[x] " : "[ ] "} fg={active === "tools" ? C.bg : C.fg} />
          <text content="Include tools" fg={active === "tools" ? C.bg : C.subtle} />
        </box>
        <box style={{ height: 1, flexShrink: 0 }} />
        <box style={{ height: 1, flexDirection: "row", justifyContent: "flex-end", flexShrink: 0 }}>
          <box style={{ paddingLeft: 4, paddingRight: 4, backgroundColor: active === "copy" ? C.selected : C.surface }}>
            <text content="Copy" fg={active === "copy" ? C.bg : C.fg} />
          </box>
          <box style={{ paddingLeft: 4, paddingRight: 4, backgroundColor: active === "export" ? C.accent : C.surface }}>
            <text content="Export" fg={active === "export" ? C.accentText : C.fg} />
          </box>
        </box>
      </box>
    </ModalBackdrop>
  );
}

// Ported from opencode v2.0.8 ui/dialog-export-result.tsx: the written
// export's path; enter/esc closes.
function ExportResultDialog({ C, path, onClose, width, height }: {
  C: ThemeTokens;
  path: string;
  onClose: () => void;
  width: number;
  height: number;
}) {
  useKeyboard((key) => {
    if (key.name === "escape" || key.name === "return" || (key.ctrl && key.name === "c")) { onClose(); return; }
  });
  return (
    <ModalBackdrop C={C} width={width} height={height}>
      <box style={{ width: Math.min(72, Math.max(44, width - 4)), flexDirection: "column", flexShrink: 0, backgroundColor: C.panel, paddingTop: 1, paddingBottom: 1, paddingLeft: 2, paddingRight: 2 }}>
        <box style={{ height: 1, flexDirection: "row", justifyContent: "space-between", flexShrink: 0 }}>
          <text content="Session exported" fg={C.fg} attributes={TextAttributes.BOLD} />
          <text content="esc" fg={C.faint} />
        </box>
        <box style={{ height: 1, flexShrink: 0 }} />
        <box style={{ height: 1, flexDirection: "row", flexShrink: 0 }}>
          <text content={path} fg={C.fg} wrapMode="none" />
        </box>
        <box style={{ height: 1, flexShrink: 0 }} />
        <box style={{ height: 1, flexDirection: "row", justifyContent: "flex-end", flexShrink: 0 }}>
          <box style={{ paddingLeft: 3, paddingRight: 3, backgroundColor: C.accent }}>
            <text content="Close" fg={C.accentText} />
          </box>
        </box>
      </box>
    </ModalBackdrop>
  );
}

function runningMarker(active: boolean): string {
  return active ? "▪" : "";
}

// The OpenCode toast overlay (consult item 3): top right, panel fill, split
// left+right borders tinted by variant, single slot — an arriving toast
// replaces the active one.
function Toast({
  C,
  message,
  variant,
  width,
}: {
  C: ThemeTokens;
  message: string;
  variant: "info" | "success" | "warning" | "error";
  width: number;
}) {
  const border = variant === "success" ? C.success : variant === "warning" ? C.warning : variant === "error" ? C.error : C.user;
  return (
    <box
      style={{
        position: "absolute",
        top: 2,
        right: 2,
        zIndex: 2000,
        width: Math.min(60, Math.max(20, width - 6)),
        backgroundColor: C.panel,
        paddingLeft: 2,
        paddingRight: 2,
        paddingTop: 1,
        paddingBottom: 1,
        borderStyle: "single",
        border: ["left", "right"],
        borderColor: border,
      }}
    >
      <text content={message} fg={C.fg} wrapMode="word" />
    </box>
  );
}

// The keybind hint grammar: the chord reads bright, the action muted, pairs
// separated by three spaces — the reference underline line.
function HintBits({ text, C }: { text: string; C: ThemeTokens }) {
  const parts = text.split("   ").filter(Boolean);
  return (
    <box style={{ flexDirection: "row", flexShrink: 0 }}>
      {parts.map((part, index) => {
        const [key, action] = part.split(" ");
        return (
          <box key={index} style={{ flexDirection: "row", flexShrink: 0 }}>
            {index > 0 ? <text content={"   "} fg={C.subtle} /> : null}
            <text content={`${key} `} fg={C.fg} />
            <text content={action ?? ""} fg={C.subtle} />
          </box>
        );
      })}
    </box>
  );
}

// ---- The transcript ROW views (slice 2, the render half of the
// transcript-render refactor family; upstream SessionRowView +
// SessionEntryView translated). One row per SessionRow: user blocks and part
// views re-home the v2.0.7-era MessageView branches verbatim; groups render
// through session/group-view.tsx; footers become their own rows (upstream
// AssistantFooter). The spacing rhythm stays ours (paddingTop inside each
// row's view rather than marginTop on the row wrapper) so unchanged grammar
// keeps the pixel voice. ----

// Raw-mirror helpers: the flat TurnMessage list keeps the copy/export/stream
// voice; these apply the same event payloads to the RAW records that feed
// reduceSessionRows. Each patch site in App is one adjacent call.
function appendRawDeltaPart(records: RawMessageRecord[], kind: "text" | "reasoning", delta: string): RawMessageRecord[] {
  if (records.length === 0) return records;
  const last = records[records.length - 1];
  if (String(last.info?.role) !== "assistant") return records;
  const parts = [...last.parts];
  const lastPart = parts[parts.length - 1] as Record<string, unknown> | undefined;
  if (lastPart && lastPart.type === kind && !(lastPart.time as { completed?: number } | undefined)?.completed) {
    parts[parts.length - 1] = { ...lastPart, text: String(lastPart.text ?? "") + delta };
  } else {
    parts.push({ type: kind, text: delta, time: { created: Date.now() } });
  }
  return [...records.slice(0, -1), { ...last, parts }];
}

function patchRawToolResult(records: RawMessageRecord[], callID: string, result: Record<string, unknown>): RawMessageRecord[] {
  return records.map((rec) => {
    if (String(rec.info?.role) !== "assistant") return rec;
    let touched = false;
    const parts = rec.parts.map((p) => {
      const part = p as Record<string, unknown>;
      if (part.type !== "tool" || part.callID !== callID) return p;
      touched = true;
      const state = (part.state ?? {}) as Record<string, unknown>;
      const ok = result.success !== false;
      return {
        ...part,
        state: {
          ...state,
          status: ok ? "completed" : "error",
          // The flat voice truncates at 220 in the result patch; the row view
          // keeps the same economy (ToolPart collapses beyond this anyway).
          output: String(result.content ?? "").slice(0, 220) || undefined,
          error: ok ? undefined : String(result.error ?? "failed"),
        },
      };
    });
    return touched ? { ...rec, parts } : rec;
  });
}

function finalizeRawAssistant(records: RawMessageRecord[], patch: {
  content?: string;
  completed?: number;
  durationMs?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  interrupted?: boolean;
}): RawMessageRecord[] {
  if (records.length === 0) return records;
  const last = records[records.length - 1];
  if (String(last.info?.role) !== "assistant") return records;
  const now = patch.completed ?? Date.now();
  const created = Number((last.info.time as Record<string, unknown> | undefined)?.created ?? now);
  const meta = {
    ...((last.info.meta ?? {}) as Record<string, unknown>),
    ...(patch.durationMs !== undefined ? { durationMs: patch.durationMs } : {}),
    ...(patch.outputTokens !== undefined ? { outputTokens: patch.outputTokens } : {}),
    ...(patch.reasoningTokens !== undefined ? { reasoningTokens: patch.reasoningTokens } : {}),
    ...(patch.interrupted !== undefined ? { interrupted: patch.interrupted } : {}),
  };
  let parts = last.parts.map((p) => {
    const part = p as Record<string, unknown>;
    if (part.type === "reasoning" && !(part.time as { completed?: number } | undefined)?.completed) {
      return { ...part, time: { ...(part.time as Record<string, unknown> ?? {}), completed: now } };
    }
    if (part.type === "tool" && (part.state as Record<string, unknown> | undefined)?.status === "running") {
      return { ...part, state: { ...(part.state as Record<string, unknown>), status: "error", error: "interrupted" } };
    }
    return p;
  });
  if (patch.content !== undefined) {
    parts = parts.map((p) => {
      const part = p as Record<string, unknown>;
      if (part.type !== "text") return p;
      const time = (part.time ?? {}) as Record<string, unknown>;
      return { ...part, text: patch.content, time: { ...time, completed: now } };
    });
  }
  const info = { ...last.info, time: { ...(last.info.time as Record<string, unknown> ?? {}), completed: now }, meta };
  void created;
  return [...records.slice(0, -1), { info, parts }];
}

function rowKey(row: TranscriptRow, index: number): string {
  if (row.type === "part") return `p:${row.ref.messageID}:${row.ref.partID}`;
  if (row.type === "message") return `m:${row.messageID}`;
  if (row.type === "assistant-footer") return `f:${row.messageID}`;
  if (row.type === "turn-usage") return `u:${row.messageIDs.join(",")}`;
  if (row.type === "compaction-queued") return `q:${row.inboxID}`;
  return `g:${index}`;
}

function UserBlock(props: { m: NormMessage; C: ThemeTokens; width: number }) {
  return (
    <box style={{ flexDirection: "column", paddingLeft: 2, paddingRight: 2, paddingTop: 1, flexShrink: 0 }}>
      <box style={{ flexDirection: "row", flexShrink: 0 }}>
        <box style={{ width: 1, flexShrink: 0, backgroundColor: props.C.user }} />
        <box style={{ flexGrow: 1, flexShrink: 0, backgroundColor: props.C.panel, paddingLeft: 2, paddingRight: 2 }}>
          <text content={wrapText(props.m.text, Math.max(20, props.width - 8)).join("\n")} fg={props.C.fg} />
        </box>
      </box>
    </box>
  );
}

function AssistantTextBlock(props: {
  content: string;
  streaming: boolean;
  C: ThemeTokens;
  mdStyle: SyntaxStyle;
  width: number;
}) {
  if (!props.streaming && props.content.trim()) {
    return (
      <box style={{ flexDirection: "column", paddingLeft: 3, paddingRight: 3, paddingTop: 1, flexShrink: 0 }}>
        <markdown
          content={breakLongTokens(props.content, Math.max(24, props.width - 8))}
          syntaxStyle={props.mdStyle}
          streaming={true}
          internalBlockMode="top-level"
          tableOptions={{ style: "grid" }}
          conceal={true}
        />
      </box>
    );
  }
  return (
    <box style={{ flexDirection: "column", paddingLeft: 3, paddingRight: 3, paddingTop: 1, flexShrink: 0 }}>
      <text content={wrapText(props.content || "…", Math.max(20, props.width - 6)).join("\n")} fg={props.C.fg} />
    </box>
  );
}

function ToolRowBlock(props: {
  part: Extract<NormPart, { type: "tool" }>;
  C: ThemeTokens;
  mdStyle: SyntaxStyle;
  width: number;
  expanded: boolean;
  spinnerChar: string;
}) {
  return (
    <box style={{ flexDirection: "column", paddingLeft: 0, paddingRight: 3, paddingTop: 1, flexShrink: 0 }}>
      <ToolPart
        C={props.C}
        syntaxStyle={props.mdStyle}
        width={props.width}
        expanded={props.expanded}
        spinnerChar={props.spinnerChar}
        m={{
          tool: props.part.name,
          status: props.part.state.status,
          input: props.part.state.input,
          output: props.part.state.output,
          error: props.part.state.error,
          metadata: {},
        }}
      />
    </box>
  );
}

function FooterRowBlock(props: { m: NormMessage; norms: NormMessage[]; C: ThemeTokens; width: number }) {
  const footer = formatTurnFooter(
    "auto",
    props.m.model?.id,
    turnDuration(props.m, props.norms),
    props.m.meta?.outputTokens,
    props.m.meta?.reasoningTokens,
    props.width,
    props.m.meta?.interrupted,
  );
  return (
    <box style={{ flexDirection: "column", paddingLeft: 3, paddingRight: 3, paddingTop: 1, flexShrink: 0 }}>
      {props.m.error ? <text content={`Error: ${props.m.error}`} fg={props.C.error} /> : null}
      {footer ? (
        <box style={{ flexDirection: "row", paddingTop: 0, flexShrink: 0 }}>
          <text content={footer.head} fg={props.C.user} />
          <text content={footer.rest ? ` · ${footer.rest}` : ""} fg={props.C.subtle} />
        </box>
      ) : null}
    </box>
  );
}

function TranscriptRowView(props: {
  row: TranscriptRow;
  norms: NormMessage[];
  normById: Map<string, NormMessage>;
  groupCtx: GroupViewCtx;
  running: boolean;
  isTail: boolean;
  C: ThemeTokens;
  mdStyle: SyntaxStyle;
  width: number;
  toolsExpanded: boolean;
  spinnerChar: string;
}) {
  const row = props.row;
  if (row.type === "group") {
    return <SessionGroupView ctx={props.groupCtx} row={row} />;
  }
  const body = (() => {
    if (row.type === "message") {
      const m = props.normById.get(row.messageID);
      if (!m) return null;
      if (m.type === "compaction") {
        return (
          <box style={{ paddingLeft: 3, paddingRight: 3, paddingTop: 1, flexShrink: 0 }}>
            <text content="Compacting context…" fg={props.C.subtle} />
          </box>
        );
      }
      return <UserBlock m={m} C={props.C} width={props.width} />;
    }
    if (row.type === "part") {
      const m = props.normById.get(row.ref.messageID);
      if (!m || m.type !== "assistant") return null;
      const part = resolvePart(m, row.ref.partID);
      if (!part) return null;
      if (part.type === "tool") {
        return (
          <ToolRowBlock
            part={part}
            C={props.C}
            mdStyle={props.mdStyle}
            width={props.width}
            expanded={props.toolsExpanded}
            spinnerChar={props.spinnerChar}
          />
        );
      }
      return (
        <AssistantTextBlock
          content={part.text}
          streaming={props.running && props.isTail}
          C={props.C}
          mdStyle={props.mdStyle}
          width={props.width}
        />
      );
    }
    if (row.type === "assistant-footer") {
      const m = props.normById.get(row.messageID);
      if (!m || m.type !== "assistant") return null;
      return <FooterRowBlock m={m} norms={props.norms} C={props.C} width={props.width} />;
    }
    if (row.type === "turn-usage") {
      // Upstream gates this debug surface behind config.debug.turn_tokens and
      // renders a collapsible per-step table; our reduce passes false so the
      // row never emits — the collapsed summary is the only arm ported.
      const total = row.messageIDs.reduce((t, id) => t + (props.normById.get(id)?.tokens?.output ?? 0), 0);
      return (
        <box style={{ paddingLeft: 3, paddingTop: 1, flexShrink: 0 }}>
          <text content={`turn tokens · ${total.toLocaleString()}`} fg={props.C.faint} />
        </box>
      );
    }
    return null;
  })();
  // Non-group rows register their renderable in the timeline-anchors
  // registry (upstream SessionRowView's useEntryAnchor); whole messages use
  // the canonical body part, footers/usage fall through entryRef.
  return (
    <EntryAnchor entry={row}>
      {body}
    </EntryAnchor>
  );
}

// opencode v2 submit semantics (component/prompt/index.tsx: isCommand is an
// EXACT registered-command-name match; there is no refusal path — unknown
// "/xyz" and pasted paths deliver as normal messages). Supersedes the
// 0.5-era unknown-command refusal (owner: "just copy opencode", 2026-09-17).
export function submitRoute(content: string): "command" | "message" {
  return content.startsWith("/") && parseSlashCommand(content) !== null ? "command" : "message";
}

// Markdown must keep its structure — only UNBREAKABLE runs (URLs, base64,
// minified JSON — the "beyond the border" screenshot) get split at the
// content width. Everything else passes through untouched.
export function breakLongTokens(text: string, limit: number): string {
  if (limit < 12) return text;
  const long = new RegExp(`[^\\s]{${limit},}`, "g");
  const chunker = new RegExp(`[^\\s]{1,${limit}}`, "g");
  return text.replace(long, (run) => (run.match(chunker) ?? [run]).join("\n"));
}

// Rebuild transcript rows from a message's TYPED parts (the store keeps
// reasoning / tool / text as separate parts). The old extractText pulled
// .text from ANY part, so reopening a session leaked reasoning into the
// body and lost the tool rows entirely.
export function partsToTurns(m: Record<string, unknown>): TurnMessage[] {
  const info = (m.info ?? {}) as Record<string, unknown>;
  const role = String(info.role ?? "?");
  const model = (info.model as Record<string, unknown> | undefined)?.modelId;
  const infoTime = (info.time ?? {}) as Record<string, unknown>;
  const parts = Array.isArray(m.parts) ? (m.parts as Record<string, unknown>[]) : [];
  let text = "";
  let thinkingText = "";
  const toolRows: TurnMessage[] = [];
  for (const p of parts) {
    const type = String(p.type ?? "");
    if (type === "reasoning" && typeof p.text === "string") {
      thinkingText += (thinkingText ? "\n" : "") + p.text;
    } else if (type === "tool") {
      const state = (p.state ?? {}) as Record<string, unknown>;
      const input = (state.input ?? {}) as Record<string, unknown>;
      const summary = String(
        input.command ?? input.description ?? input.file_path ?? input.url ?? input.pattern ?? JSON.stringify(input).slice(0, 60),
      );
      const status = String(state.status ?? "");
      const rawError = state.error;
      toolRows.push({
        role: "tool",
        text: summary,
        toolName: String(p.tool ?? "tool"),
        toolCallId: String(p.callID ?? ""),
        toolOk: status === "completed" ? true : status === "error" ? false : undefined,
        toolOut: String(state.output ?? state.result ?? ""),
        toolInput: input && typeof input === "object" ? input : {},
        toolStatus: status,
        toolMeta: state.metadata && typeof state.metadata === "object" ? (state.metadata as Record<string, unknown>) : {},
        toolError:
          rawError && typeof rawError === "object"
            ? String((rawError as Record<string, unknown>).message ?? "")
            : typeof rawError === "string"
              ? rawError
              : undefined,
      });
    } else if (typeof p.text === "string") {
      text += p.text;
    }
  }
  const out: TurnMessage[] = [{
    role,
    text,
    model: String(model ?? "") || undefined,
    messageId: String(info.id ?? info.messageId ?? "") || undefined,
    createdAt: Number(infoTime.created ?? info.createdAt ?? info.updatedAt ?? 0) || undefined,
    thinking: thinkingText || undefined,
  }];
  out.push(...toolRows);
  return out;
}

function sortedThemes(): ThemeName[] {
  return [...THEME_NAMES].sort((a, b) => a.localeCompare(b));
}

// The composer autocomplete popup — the OpenCode convention this TUI mirrors:
// typing "/" lists every command filtered as you type, directly above the
// composer, with enter running the highlighted command. Borderless block,
// selected row carries the primary highlight with background-coloured text.
// v2 Locale.truncateMiddle: head...tail within the budget (the autocomplete
// row never overflows — v2.0.11 #50008).
function truncateMiddle(value: string, maxWidth: number): string {
  if (value.length <= maxWidth) return value;
  if (maxWidth <= 1) return value.slice(0, Math.max(0, maxWidth));
  const keep = maxWidth - 1;
  const head = Math.ceil(keep / 2);
  const tail = keep - head;
  return value.slice(0, head) + "\u2026" + (tail > 0 ? value.slice(value.length - tail) : "");
}

function SlashPopup({
  commands,
  files,
  idx,
  C,
  width,
}: {
  commands: SlashCommandSpec[];
  files: string[];
  idx: number;
  C: ThemeTokens;
  width?: number;
}) {
  // One flat list across both triggers; <=10 rows visible, windowed around the
  // selection, no scrollbar (consult item 2).
  const items: { key: string; name: string; description?: string }[] = [
    ...commands.map((c) => ({ key: `/${c.name}`, name: `/${c.name}`, description: c.description })),
    ...files.map((f) => ({ key: `@${f}`, name: `@${f}` })),
  ];
  if (items.length === 0) {
    return (
      <box style={{ width: width ?? "100%", flexDirection: "column", flexShrink: 0, backgroundColor: C.panel, paddingLeft: 1, paddingRight: 1 }}>
        <text content="No matching items" fg={C.faint} />
      </box>
    );
  }
  const sel = Math.min(idx, items.length - 1);
  const visibleCount = Math.min(10, items.length);
  const win = Math.max(0, Math.min(sel - Math.floor(visibleCount / 2), Math.max(0, items.length - visibleCount)));
  const visible = items.slice(win, win + visibleCount);
  return (
    <box
      style={{
        width: width ?? "100%",
        flexDirection: "column",
        flexShrink: 0,
        backgroundColor: C.panel,
        paddingLeft: 1,
        paddingRight: 1,
      }}
    >
      {visible.map((item) => {
        const selected = items.indexOf(item) === sel;
        // v2.0.11 autocomplete row (#50008, #48551): the display truncates
        // middle to the popup budget so a long @path never overflows the
        // row, and the description collapses whitespace with one leading
        // space and flexes; the fixed padEnd column is gone.
        const popupWidth = typeof width === "number" ? width : 100;
        const contentWidth = Math.max(8, popupWidth - 6);
        return (
          <box key={item.key} style={{ height: 1, flexDirection: "row", flexShrink: 0, backgroundColor: selected ? C.accent : undefined }}>
            <text content={truncateMiddle(item.name, contentWidth)} fg={selected ? C.accentText : C.fg} wrapMode="none" flexShrink={0} />
            {item.description ? (
              <text content={` ${item.description.replace(/\s+/g, " ").trim()}`} fg={selected ? C.accentText : C.subtle} wrapMode="none" flexShrink={1} />
            ) : null}
          </box>
        );
      })}
    </box>
  );
}

// The OpenCode composer: a thin left accent edge tinted by the active mode
// (one half-block glyph per row, ending with the box), the input row, and the
// status grammar `Build auto · model provider · low` inside the box; a thin
// detached underline row; then the hint line below on the background. No full
// border — the reference keeps the box open-faced.
function Composer({
  C,
  width,
  underlineWidth,
  draft,
  placeholder,
  cursor,
  selection,
  cursorBlink,
  typing,
  mode,
  model,
  provider,
  effort,
  thinkingOff,
  leaderActive,
}: {
  C: ThemeTokens;
  width: number | "100%";
  underlineWidth: number;
  draft: string;
  placeholder: string;
  cursor: number | null;
  selection?: [number, number] | null;
  cursorBlink: boolean;
  typing: boolean;
  mode: string;
  model: string;
  provider: string;
  effort: string;
  thinkingOff: boolean;
  leaderActive: boolean;
}) {
  const label = modeLabel(mode);
  const accent = leaderActive ? C.border : modeAccent(mode, C);
  const underline = Math.max(0, underlineWidth);
  const wrapWidth = Math.max(12, underline - 4);
  // The cursor is a solid block that blinks while typing. With a draft it
  // splits the text at the cursor index (wrapped independently on either
  // side); an empty draft shows the block over the first placeholder cell.
  const glyph = cursorBlink ? "█" : " ";
  // Rows come from the offset-carrying wrap so the cursor AND the selected
  // slice land exactly on their characters (input.select.*, 0.6.25).
  type InputSeg = { text: string; sel: boolean };
  let inputRows: { segs: InputSeg[]; glyphIdx: number; glyph: string }[];
  if (!draft) {
    inputRows = [{ segs: [{ text: placeholder, sel: false }], glyphIdx: 0, glyph: typing ? glyph : " " }];
  } else {
    const cur = cursor ?? draft.length;
    const lo = selection ? selection[0] : -1;
    const hi = selection ? selection[1] : -1;
    inputRows = wrapRows(draft, wrapWidth).map((row) => {
      const rs = row.start;
      const re = rs + row.text.length;
      const cuts = new Set<number>([rs, re]);
      const ownsCursor = cur >= rs && cur <= re;
      if (ownsCursor) cuts.add(cur);
      if (lo >= 0) {
        cuts.add(Math.min(Math.max(lo, rs), re));
        cuts.add(Math.min(Math.max(hi, rs), re));
      }
      const pts = [...cuts].sort((a, b) => a - b);
      const segs: InputSeg[] = [];
      const starts: number[] = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        if (b > a) {
          segs.push({ text: draft.slice(a, b), sel: lo >= 0 && a >= lo && b <= hi });
          starts.push(a);
        }
      }
      let glyphIdx = -1;
      if (ownsCursor) {
        const at = starts.indexOf(cur);
        glyphIdx = at === -1 ? segs.length : at;
      }
      return { segs, glyphIdx, glyph: typing ? glyph : "" };
    });
  }
  return (
    <box style={{ width, flexDirection: "column", flexShrink: 0 }}>
      <box style={{ flexDirection: "row", flexShrink: 0 }}>
        <box style={{ width: 1, flexShrink: 0, flexDirection: "column", backgroundColor: C.surface }}>
          {/* The reference edge is a thin uniform bar, not a painted cell:
              one left-half-block glyph per composer row (top pad, input rows,
              status pad, status row), ending with the box — nothing below. */}
          {Array.from({ length: inputRows.length + 3 }, (_, accentRow) => (
            <text key={accentRow} content="▌" fg={accent} />
          ))}
        </box>
        <box style={{ flexGrow: 1, flexShrink: 0, flexDirection: "column", backgroundColor: C.surface, paddingLeft: 2, paddingRight: 2, paddingTop: 1 }}>
          {inputRows.map((row, lineIndex) => (
            <box key={lineIndex} style={{ flexDirection: "row", flexShrink: 0 }}>
              {row.segs.map((seg, si) => (
                <box key={si} style={{ flexDirection: "row", flexShrink: 0, backgroundColor: seg.sel ? C.accent : undefined }}>
                  {row.glyphIdx === si ? <text content={row.glyph} fg={draft ? C.fg : C.subtle} /> : null}
                  <text content={seg.text} fg={draft ? (seg.sel ? C.bg : C.fg) : C.subtle} />
                </box>
              ))}
              {row.glyphIdx === row.segs.length ? <text content={row.glyph} fg={draft ? C.fg : C.subtle} /> : null}
            </box>
          ))}
          <box style={{ flexDirection: "row", paddingTop: 1, flexShrink: 0 }}>
            <text content={`${label.label} `} fg={accent} />
            {label.auto ? <text content="auto " fg={C.subtle} /> : null}
            <text content={`· ${model} `} fg={leaderActive ? C.subtle : C.fg} />
            <text content={`${provider} · `} fg={C.subtle} />
            <text content={effort} fg={C.warning} />
            {thinkingOff ? <text content=" · thinking off" fg={C.faint} /> : null}
          </box>
        </box>
      </box>
      <box style={{ flexDirection: "row", flexShrink: 0 }}>
        <box style={{ width: 1, flexShrink: 0 }} />
        <text content={"▀".repeat(underline)} fg={C.surface} />
      </box>
    </box>
  );
}

// The optional session sidebar (leader b): title block, the context usage
// block, and the client footer — the OpenCode sidebar arrangement.
function SessionSidebar({
  C,
  title,
  sessionId,
  ctx,
}: {
  C: ThemeTokens;
  title: string;
  sessionId: string;
  ctx: { used: number; window: number } | null;
}) {
  const pct = ctx && ctx.window > 0 ? Math.round((ctx.used / ctx.window) * 100) : 0;
  return (
    <box style={{ width: 42, flexShrink: 0, flexDirection: "column", backgroundColor: C.panel, paddingLeft: 2, paddingRight: 2, paddingTop: 1, paddingBottom: 1 }}>
      <box style={{ flexGrow: 1, flexDirection: "column", flexShrink: 0 }}>
        <box style={{ flexDirection: "column", flexShrink: 0 }}>
          <text content={title} fg={C.fg} attributes={TextAttributes.BOLD} />
          <text content={sessionId.length > 34 ? `${sessionId.slice(0, 34)}…` : sessionId} fg={C.subtle} />
        </box>
        <box style={{ height: 1, flexShrink: 0 }} />
        <box style={{ flexDirection: "column", flexShrink: 0 }}>
          <text content="Context" fg={C.fg} attributes={TextAttributes.BOLD} />
          <text content={ctx ? `${formatTokens(ctx.used)} tokens` : "— tokens"} fg={C.subtle} />
          <text content={`${pct}% used`} fg={C.subtle} />
        </box>
      </box>
      <box style={{ flexDirection: "row", flexShrink: 0 }}>
        <text content="● " fg={C.success} />
        <text content={`zcode-tui ${VERSION}`} fg={C.subtle} />
      </box>
    </box>
  );
}

// Dialog fetch state for the skills / mcp branches (App-level: the OpenTUI
// reconciler remounts wrapper components on every App re-render — see the
// 0.6.23 patch header — so their state lives here, the sessions-dialog shape).
type SkillsDialogState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; skills: { id: string; name: string; description?: string }[] };
type McpDialogState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; servers: { name: string; status: string; error?: string }[] };
type PluginRow = { id: string; name: string; version?: string; enabled: boolean };
type PluginsDialogState =
  | { kind: "idle" | "loading"; plugins: PluginRow[] }
  | { kind: "error"; message: string; plugins: PluginRow[] }
  | { kind: "ready"; plugins: PluginRow[] };

export function App({
  client,
  renderer,
  onQuit,
  resumeId,
  modelId,
  launchMode,
}: {
  client: AppServer;

  renderer?: { suspend?: () => void; resume?: () => void } | null;
  onQuit: () => void;
  resumeId?: string | null;
  modelId?: string | null;
  launchMode?: string | null;
}) {
  const [view, setView] = useState<AppView>("home");
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [sel, setSel] = useState(0);
  const [msgs, setMsgs] = useState<TurnMessage[]>([]);
  // The RAW host records behind the transcript rows (slice 2): the flat
  // TurnMessage list above stays the copy/export/stream voice; this mirror
  // feeds the row model (reduceSessionRows → the row transcript). Every
  // event site patches both, from the same payload, adjacent lines.
  const [rawMsgs, setRawMsgs] = useState<RawMessageRecord[]>([]);
  const rawLocalSeq = useRef(0);
  const normMsgs = useMemo<NormMessage[]>(
    () => rawMsgs.map(normalizeRawMessage).filter((m): m is NormMessage => m !== null),
    [rawMsgs],
  );
  const rows = useMemo<TranscriptRow[]>(() => reduceSessionRows(normMsgs), [normMsgs]);
  const rowsRef = useRef<TranscriptRow[]>([]);
  rowsRef.current = rows;
  const normRef = useRef<NormMessage[]>([]);
  normRef.current = normMsgs;
  const normById = useMemo(() => new Map(normMsgs.map((m) => [m.id, m])), [normMsgs]);
  const [status, setStatus] = useState("connecting…");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [thinking, setThinking] = useState("");
  const thinkingRef = useRef("");
  useEffect(() => {
    thinkingRef.current = thinking;
  }, [thinking]);
  const [dialog, setDialog] = useState<DialogName>(null);
  // v2 prompt.files — the draft's attachment parts. Labels are virtual
  // text: a part lives while its label survives in the draft (the
  // plain-draft equivalent of v2's extmark sync).
  const [promptFiles, setPromptFiles] = useState<PromptFilePart[]>([]);
  const promptFilesRef = useRef<PromptFilePart[]>([]);
  const [previewIdx, setPreviewIdx] = useState(0);
  const [forkOptions, setForkOptions] = useState<DialogOption<string>[]>([]);
  const [theme, setTheme] = useState<ThemeName>("opencode");
  // v2 context/theme.tsx (0.6.32): themeMode is the active color arm,
  // themeLock the config theme.mode pin ("dark"|"light"; null = unlocked —
  // v2 then follows the terminal's reported mode; with no terminal palette
  // plane on this stack the unlocked mode holds its current value, the
  // renderer-less fallback their own init uses).
  const [themeMode, setThemeMode] = useState<ThemeMode>("dark");
  const [themeLock, setThemeLock] = useState<ThemeMode | null>(null);
  const [ask, setAsk] = useState<{ toolName: string; detail: string; riskLevel: string; diff?: string; patch?: string } | null>(null);
  const [askSel, setAskSel] = useState(0);
  // v2 SessionQuestion's fullscreen arm (routes/session/permission.tsx): the
  // expanded ask renders as the full-viewport overlay instead of the inline
  // card; ctrl+f toggles, escape minimizes before it dismisses.
  const [askExpanded, setAskExpanded] = useState(false);
  const askOptionsRef = useRef<{ id: string; response: unknown }[]>([]);
  const askRef = useRef<((v: unknown) => void) | null>(null);
  const [lost, setLost] = useState(false);
  const [mode, setMode] = useState<string>("auto");
  const [history, setHistory] = useState<string[]>([]);
  const historyIdx = useRef(-1);
  const [thoughtLevel, setThoughtLevel] = useState<string>("enabled");
  // Reasoning effort: default matches the runtime catalog's defaultLevel
  // ("max", measured live 2026-09-16); the /effort dialog and state seeding
  // refine it from the UX-state store and the workspace catalog.
  const [effort, setEffort] = useState<(typeof EFFORTS)[number]>("max");
  const [ctx, setCtx] = useState<{ used: number; window: number } | null>(null);
  const [draft, setDraft] = useState("");
  const draftRef = useRef("");
  // Alive parts, and the image-only view the strip and preview show
  // (v2 imageAttachments: dedupe over the data:image/ subset).
  const aliveFiles = promptFiles.filter((f) => draft.includes(f.label));
  const aliveFilesRef = useRef<PromptFilePart[]>([]);
  aliveFilesRef.current = aliveFiles;
  const imageFiles = deduplicatePromptImages(aliveFiles.filter((f) => f.uri.startsWith("data:image/")));
  useEffect(() => {
    const alive = promptFilesRef.current.filter((f) => draftRef.current.includes(f.label));
    if (alive.length !== promptFilesRef.current.length) {
      promptFilesRef.current = alive;
      setPromptFiles(alive);
    }
  }, [draft]);
  // The composer cursor: an index into the draft (default = end). Arrows move
  // it, printable input inserts at it, backspace deletes before it.
  const [cursor, setCursor] = useState<number | null>(null); // null = end
  // Immediate-truth mirror of the cursor (the draftRef discipline): a PTY
  // burst reaches the next key before React commits setCursor, so cursor
  // math must never read the state.
  const cursorRef = useRef<number | null>(null);
  const setCursorBoth = (v: number | null) => {
    cursorRef.current = v;
    setCursor(v);
  };
  const [cursorBlink, setCursorBlink] = useState(true);
  // ---- the input.select.* family (0.6.25): anchor-based selection. The
  // anchor is fixed where a shift-motion starts; any non-shift motion or
  // input collapses it. The ref mirrors the state (draftRef discipline).
  const [selAnchor, setSelAnchor] = useState<number | null>(null);
  const selAnchorRef = useRef<number | null>(null);
  const wrapWidthRef = useRef(76);
  const clearSelection = () => {
    if (selAnchorRef.current === null) return;
    selAnchorRef.current = null;
    setSelAnchor(null);
  };
  const moveSelect = (next: number) => {
    if (selAnchorRef.current === null) {
      selAnchorRef.current = cursorRef.current ?? draftRef.current.length;
      setSelAnchor(selAnchorRef.current);
    }
    setCursorBoth(Math.max(0, Math.min(draftRef.current.length, next)));
  };
  const selectionRange = (): [number, number] | null => {
    const a = selAnchorRef.current;
    if (a === null) return null;
    const c = cursorRef.current ?? draftRef.current.length;
    return a === c ? null : [Math.min(a, c), Math.max(a, c)];
  };
  // Display-row motion over the wrapped composer (v2 input.select.up/down
  // and visual.line.home/end).
  const visualMove = (dir: -1 | 1 | "home" | "end"): number => {
    const rows = wrapRows(draftRef.current, wrapWidthRef.current);
    const cur = cursorRef.current ?? draftRef.current.length;
    let ri = rows.findIndex((r) => cur >= r.start && cur <= r.start + r.text.length);
    if (ri === -1) ri = rows.length - 1;
    const row = rows[ri];
    if (dir === "home") return row.start;
    if (dir === "end") return row.start + row.text.length;
    const target = rows[ri + dir];
    if (!target) return dir === -1 ? 0 : draftRef.current.length;
    return target.start + Math.min(cur - row.start, target.text.length);
  };
  const moveCursor = (delta: number) => {
    clearSelection();
    const cur = cursorRef.current ?? draftRef.current.length;
    setCursorBoth(Math.max(0, Math.min(draftRef.current.length, cur + delta)));
  };
  const [typing, setTyping] = useState(true);

  // Transient status toast — the OpenCode toast overlay (top right, split
  // variant-tinted borders, single slot, 5s / 7s for errors).
  const [toast, setToast] = useState<{ message: string; variant: "info" | "success" | "warning" | "error" } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Deviation queue 3 closed: confirmations ride the v2 toast overlay
  // ONLY — no transient status-line text (the slot was invisible anyway).
  const flashStatus = (message: string, variant: "info" | "success" | "warning" | "error" = "info") => {
    setToast({ message, variant });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), variant === "error" ? 7000 : 5000);
  };
  // Slash-command autocomplete (the OpenCode composer popup): the match list
  // is derived from the draft; idx and dismissal are refs so the keyboard
  // state machine reads immediate truth, exactly like draftRef.
  const [sugIdx, setSugIdx] = useState(0);
  const sugIdxRef = useRef(0);
  const sugDismissed = useRef(false);
  const moveSug = (n: number) => {
    sugIdxRef.current = n;
    setSugIdx(n);
  };
  // Prompts typed while a turn runs queue visibly instead of being dropped or
  // mangled mid-burst; the pump effect sends them when the turn ends.
  const [queue, setQueue] = useState<string[]>([]);
  const queueRef = useRef<string[]>([]);
  // promptStash is a module singleton (port of the v2.0.7 PromptStash
  // provider); dialogs read it during render, so mutations bump this tick.
  const [, bumpStash] = useState(0);
  const stashChanged = () => bumpStash((n) => n + 1);
  // Armed two-stroke delete row of the stash dialog (v2 stash.delete) —
  // App-level for the same reconciler reason as the fetch states below.
  const [stashArm, setStashArm] = useState<number>();
  const [skillsState, setSkillsState] = useState<SkillsDialogState>({ kind: "idle" });
  const [mcpState, setMcpState] = useState<McpDialogState>({ kind: "idle" });
  // Plan-quota Usage section state (0.6.46) — App-level for the same
  // reconciler reason as the fetch states above; StatusDialog stays props-only.
  const [usageState, setUsageState] = useState<UsageDialogState>({ kind: "idle" });
  // opencode v2 plugins dialog (0.6.34, feature-plugins/system/plugins.tsx):
  // rows off plugins/list, enter toggles enabled via plugins/setEnabled (the
  // mapping note lives in docs/parity-v2.md — v2 toggles its TUI arm, ours
  // is the only toggle plane the host offers). Pending ids drive the gutter.
  const [pluginsState, setPluginsState] = useState<PluginsDialogState>({ kind: "idle", plugins: [] });
  const [pluginPending, setPluginPending] = useState<string[]>([]);
  const pluginPendingRef = useRef<string[]>([]);
  // Subagent tab plane (0.6.52): tabs poll session/subagents for the active
  // session; inspectId opens the non-modal inspector card; pickerFilter is
  // the picker's tab active/inactive toggle. The ref mirrors tabs for the
  // composer key closure (the reconciler remount law — closures read refs).
  const [subagentTabs, setSubagentTabs] = useState<SubagentTab[]>([]);
  const subagentTabsRef = useRef<SubagentTab[]>([]);
  const [inspectId, setInspectId] = useState<string | null>(null);
  const [pickerFilter, setPickerFilter] = useState<PickerFilter>("active");
  const togglePlugin = (row: PluginRow) => {
    if (pluginPendingRef.current.includes(row.id)) return;
    const next: string[] = [...pluginPendingRef.current, row.id];
    pluginPendingRef.current = next;
    setPluginPending(next);
    const ws = { workspace: { workspacePath: process.cwd(), workspaceKey: process.cwd() } };
    void client
      .request("plugins/setEnabled", { ...ws, pluginId: row.id, enabled: !row.enabled })
      .then((res) => {
        const updated = (res as { plugin?: { id?: string; enabled?: boolean } }).plugin;
        setPluginsState((prev) => ({
          ...prev,
          plugins: prev.plugins.map((p) =>
            p.id === row.id ? { ...p, enabled: updated?.enabled === true } : p,
          ),
        }));
        flashStatus(`${row.name} ${updated?.enabled === true ? "enabled" : "disabled"}`, "success");
      })
      .catch((e) => {
        flashStatus(errorMessage(e), "error");
      })
      .finally(() => {
        const rest = pluginPendingRef.current.filter((id) => id !== row.id);
        pluginPendingRef.current = rest;
        setPluginPending(rest);
      });
  };
  useEffect(() => {
    if (dialog === "skills") {
      setSkillsState({ kind: "loading" });
      let live = true;
      void client
        .request("skills/referenceCatalog", { workspace: { workspacePath: process.cwd(), workspaceKey: process.cwd() } })
        .then((res) => {
          if (!live) return;
          const skills = ((res as { skills?: { id: string; name: string; description?: string; enabled?: boolean }[] }).skills ?? [])
            .filter((s) => s.enabled !== false)
            .map(({ id, name, description }) => ({ id, name, description }));
          setSkillsState({ kind: "ready", skills });
        })
        .catch((e) => {
          if (!live) return;
          setSkillsState({ kind: "error", message: errorMessage(e) });
        });
      return () => {
        live = false;
      };
    }
    if (dialog === "mcp" || dialog === "status") {
      setMcpState({ kind: "loading" });
      let live = true;
      void client
        .request("mcp/list", { workspace: { workspacePath: process.cwd(), workspaceKey: process.cwd() } })
        .then((res) => {
          if (!live) return;
          const statuses = (res as { statuses?: Record<string, { status?: string }> }).statuses ?? {};
          setMcpState({
            kind: "ready",
            servers: Object.entries(statuses)
              .map(([name, s]) => ({ name, status: s.status ?? "", error: (s as { error?: string }).error }))
              .sort((a, b) => a.name.localeCompare(b.name)),
          });
        })
        .catch(() => {
          if (live) setMcpState({ kind: "ready", servers: [] });
        });
      if (dialog === "status") {
        setUsageState({ kind: "loading" });
        const statsPromise = client
          .request("usage/stats", { range: "7d" })
          .then((res) => parseUsageStats(res))
          .catch(() => null);
        const key = readStoredApiKey();
        const quotaPromise: Promise<PlanQuotaSnapshot | { error: string }> = key
          ? fetchPlanQuota(key).catch((e: unknown) => ({ error: errorMessage(e) }))
          : Promise.resolve({ error: "no plan key synced" });
        void Promise.all([statsPromise, quotaPromise]).then(([stats, quota]) => {
          if (!live) return;
          if ("error" in quota) {
            setUsageState({ kind: "ready", quota: null, quotaError: quota.error, stats });
          } else {
            setUsageState({ kind: "ready", quota, quotaError: null, stats });
          }
        });
      }
      return () => {
        live = false;
      };
    }
    if (dialog === "plugins") {
      setPluginsState({ kind: "loading", plugins: [] });
      let live = true;
      void client
        .request("plugins/list", { workspace: { workspacePath: process.cwd(), workspaceKey: process.cwd() } })
        .then((res) => {
          if (!live) return;
          const rows = ((res as { plugins?: Record<string, unknown>[] }).plugins ?? []).map((p) => ({
            id: String(p.id ?? ""),
            name: String(p.name ?? p.id ?? ""),
            version: typeof p.version === "string" ? p.version : undefined,
            enabled: p.enabled === true,
          })).sort((a, b) => a.name.localeCompare(b.name));
          setPluginsState({ kind: "ready", plugins: rows });
        })
        .catch((e) => {
          if (!live) return;
          setPluginsState({ kind: "error", message: errorMessage(e), plugins: [] });
        });
      return () => {
        live = false;
      };
    }
  }, [dialog, client]);
  const [models, setModels] = useState<ModelChoice[]>(ALLOWED_MODELS.map((m) => ({ ...m })));
  const [modelIdx, setModelIdx] = useState(0);
  // modelsRef backs the push handler (registered once): model/effort patches
  // from the backend must resolve against the live catalog, not a stale one.
  const msgsRef = useRef<TurnMessage[]>([]);
  useEffect(() => {
    msgsRef.current = msgs;
  }, [msgs]);
  const modelsRef = useRef(models);
  useEffect(() => {
    modelsRef.current = models;
  }, [models]);
  // The UX-state store (opencode model.json pattern) — loaded once, saved on
  // every model/effort choice through the v2.0.8 repository (lock-merged
  // writes + live cross-client subscribe).
  const uiState = useRef<UiState>(uiStateRepository.load());
  const [, setUiSyncTick] = useState(0);
  // v2.0.8 client-sync port (upstream #49611): a state.json write from
  // ANOTHER zcode-tui process surfaces here live; our own write re-reads the
  // same content and costs one no-op re-render.
  useEffect(
    () =>
      uiStateRepository.subscribe((next) => {
        uiState.current = next;
        setUiSyncTick((t) => t + 1);
      }),
    [],
  );
  // opencode app.toggle.* surfaces (0.6.24): animations (ours = the cursor
  // blink — the only animation the TUI runs) and the @file context popup.
  // Persisted in state.json; diff wrapping rides DiffPreferences.wrap.
  const [animations, setAnimations] = useState(uiState.current.animations);
  const [fileContext, setFileContext] = useState(uiState.current.fileContext);
  // v2 home.footer status row (0.6.26): the MCP ⊙ count. Fetched on boot
  // and on every return home; the plugins-failed half is omitted (no
  // plugins plane in this TUI).
  const [mcpStatus, setMcpStatus] = useState<{ total: number; failed: number } | null>(null);
  useEffect(() => {
    if (view !== "home") return;
    let live = true;
    client
      .request("mcp/list", { workspace: { workspacePath: process.cwd(), workspaceKey: process.cwd() } })
      .then((res) => {
        if (!live) return;
        const statuses = Object.values((res as { statuses?: Record<string, { status?: string }> }).statuses ?? {});
        setMcpStatus({
          total: statuses.length,
          failed: statuses.filter((s) => s.status === "failed" || s.status === "needs_auth").length,
        });
      })
      .catch(() => {
        if (live) setMcpStatus(null);
      });
    return () => {
      live = false;
    };
  }, [view, client]);
  useEffect(() => {
    if (!typing || !animations) {
      setCursorBlink(true);
      return;
    }
    const timer = setInterval(() => setCursorBlink((b) => !b), 530);
    return () => clearInterval(timer);
  }, [typing, animations]);
  // Subagent tab poll (0.6.52): session/subagents per active session, on a
  // slow interval while a session is open — the payload is small and the
  // host keeps the revision. Kept polling even when idle-ended so the tabs
  // (and the picker) survive turn completion, like upstream's tracker state.
  useEffect(() => {
    if (!activeId) {
      setSubagentTabs([]);
      subagentTabsRef.current = [];
      setInspectId(null);
      return;
    }
    // The inspector selection is per-session — a session switch closes it.
    setInspectId(null);
    let live = true;
    const poll = () => {
      client
        .request("session/subagents", { sessionId: activeId })
        .then((res) => {
          if (!live) return;
          const tabs = mapHostSubagents(res);
          subagentTabsRef.current = tabs;
          setSubagentTabs(tabs);
        })
        .catch(() => {
          /* session not found (closed under us) — keep the last tabs */
        });
    };
    poll();
    const timer = setInterval(poll, 3000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [activeId, client]);

  const rememberModel = (choice: ModelChoice) => {
    uiState.current = uiStateRepository.addRecent({ providerId: choice.providerId, modelId: choice.modelId });
  };
  const toggleFavoriteModel = (choice: ModelChoice) => {
    const key = modelKey(choice);
    const isFav = uiState.current.favorite.some((f) => modelKey(f) === key);
    uiState.current = uiStateRepository.setFavorite(choice, !isFav);
    flashStatus(`${isFav ? "unfavorited" : "favorited"} ${modelLabel(choice)}`);
  };
  // opencode model_cycle_recent: f2 / shift+f2 walk the recent list.
  const cycleRecentModel = (dir: 1 | -1) => {
    const valid = uiState.current.recent.filter((r) => modelsRef.current.some((m) => m.providerId === r.providerId && m.modelId === r.modelId));
    if (valid.length === 0) { flashStatus("no recent models yet"); return; }
    const idx = valid.findIndex((r) => r.providerId === activeModel.providerId && r.modelId === activeModel.modelId);
    const next = valid[(idx + (dir === 1 ? 1 : -1) + valid.length * 2) % valid.length];
    const i = modelsRef.current.findIndex((m) => m.providerId === next.providerId && m.modelId === next.modelId);
    if (i < 0) return;
    setModelIdx(i);
    rememberModel({ providerId: next.providerId, modelId: next.modelId, label: next.modelId });
    if (activeIdRef.current) {
      void client.request("session/setModel", { sessionId: activeIdRef.current, model: { providerId: next.providerId, modelId: next.modelId, variant: effort } })
        .catch(() => {});
    }
    flashStatus(`model → ${next.modelId}`);
  };
  const [pinned, setPinned] = useState<string[]>([]);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<SessionRow | null>(null);
  // Optional sidebar (leader b), armed leader chord, and the session paging.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const leaderArmed = useRef(false);
  const [leaderActive, setLeaderActive] = useState(false);
  const armLeader = () => {
    leaderArmed.current = true;
    setLeaderActive(true);
  };
  const disarmLeader = () => {
    leaderArmed.current = false;
    setLeaderActive(false);
  };
  // Seamless transcript scroll — the OpenCode model, on the scrollbox's
  // NATIVE sticky engine (stickyScroll + stickyStart "bottom"): the tail
  // glues itself, follows streamed growth, and disengages the moment the
  // user scrolls up — re-engaging at the bottom. We only MIRROR that state
  // for the "Jump to latest" affordance, bind the reference extras the box
  // does not (half-page, line, first/last message), and bound the tree with
  // a sliding 200-message window whose older blocks prepend at the content
  // top with scroll anchoring. No forced scrolling anywhere.
  const scrollRef = useRef<{ scrollTop?: number; scrollHeight?: number; viewport?: { height?: number }; scrollBy?: (d: unknown) => void; scrollTo?: (p: unknown) => void; isAtStickyPosition?: () => boolean } | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const atBottomRef = useRef(true);
  const [windowEnd, setWindowEnd] = useState<number | null>(null); // null = live tail
  const windowEndRef = useRef<number | null>(null);
  useEffect(() => {
    windowEndRef.current = windowEnd;
  }, [windowEnd]);
  const anchor = useRef<number | null>(null); // scrollHeight before a prepend
  const SCROLL_WINDOW = 200;
  const jumpToLatest = () => {
    // Negative y travels toward the tail (bottom, scrollTop max) and
    // re-engages the sticky glue.
    scrollRef.current?.scrollBy?.({ y: -99999 });
  };
  const resetToTail = () => {
    setWindowEnd(null);
    windowEndRef.current = null;
    jumpToLatest();
  };
  const syncAtBottom = () => {
    const box = scrollRef.current;
    if (!box) return;
    // Anchor a just-prepended block first (layout has settled by next tick):
    // content grew ABOVE the viewport, so scrollTop grows by the same amount
    // to keep the same text under the eyes.
    if (anchor.current !== null) {
      const grown = (box.scrollHeight ?? 0) - anchor.current;
      anchor.current = null;
      if (grown > 0) box.scrollTop = (box.scrollTop ?? 0) + grown;
    }
    try { (box as { isAtStickyPosition?: () => boolean }).isAtStickyPosition?.(); } catch {}
    // At-tail truth, all three voices OR'd (measured 2026-09-16): the
    // engine's own isAtStickyPosition() (glue engaged), the sticky anchor
    // (scrollTop ~0), and the classic geometric bottom (scrollTop + viewport
    // >= scrollHeight). Whichever coordinate voice the engine is using this
    // frame, the tail is the tail.
    const classicBottom = (box.scrollTop ?? 0) + ((box.viewport?.height as number | undefined) ?? 0) >= (box.scrollHeight ?? 0) - 3;
    const bottom = (typeof box.isAtStickyPosition === "function" && box.isAtStickyPosition())
      || (box.scrollTop ?? 999) <= 2
      || classicBottom;
    if (bottom !== atBottomRef.current) { atBottomRef.current = bottom; setAtBottom(bottom); }
    // At the content top with older messages off-window: prepend a block.
    // (Slice 2: the window counts transcript ROWS, not flat messages.)
    const end = windowEndRef.current ?? rowsRef.current.length;
    const maxScroll = Math.max(0, (box.scrollHeight ?? 0) - (box.viewport?.height ?? 0));
    if ((box.scrollTop ?? 0) <= 2 && end < rowsRef.current.length) {
      anchor.current = box.scrollHeight ?? 0;
      setWindowEnd(Math.max(0, end - SCROLL_WINDOW));
    }
  };
  useEffect(() => {
    if (view !== "session") return;
    const timer = setInterval(syncAtBottom, 300);
    return () => clearInterval(timer);
  }, [view]);
  const activeIdRef = useRef<string | null>(null);
  const resumed = useRef(false);
  // The themes dialog's ORIGIN theme: captured once at open so the ● marker
  // and the esc-restore follow where you STARTED, not the live preview.
  const themesOriginRef = useRef<ThemeName | null>(null);
  // opencode message navigation: the last user-message row we jumped to.
  const userJumpIdxRef = useRef<number | null>(null);
  const openThemes = () => { themesOriginRef.current = theme; setDialog("themes"); };
  const dims = useTerminalDimensions();
  const C = tokensFor(theme, themeMode);
  const mdStyle = useMemo(() => mdStyleFor(theme, themeMode), [theme, themeMode]);
  const spinner = runningMarker(running && view === "session");
  // ctrl+o: the keyboard adapter for upstream's mouse-only tool-row
  // expansion (no mouse plane here) — toggles every expandable row.
  const [toolsExpanded, setToolsExpanded] = useState(false);
  // Group expansion (upstream #48489 persisted per-group state): the map is
  // per-group toggle state, groupsOverride is the ctrl+o global cycle (null
  // = follow the map). In-memory for the TUI lifetime, like the tab strip.
  const [groupExpand, setGroupExpand] = useState<Record<string, boolean>>({});
  const [groupsOverride, setGroupsOverride] = useState<boolean | null>(null);
  const groupsOverrideRef = useRef<boolean | null>(null);
  groupsOverrideRef.current = groupsOverride;
  const toolsExpandedRef = useRef(false);
  toolsExpandedRef.current = toolsExpanded;

  const orderedSessions = [...sessions].sort((a, b) => {
    const ap = pinned.includes(a.sessionId) ? 1 : 0;
    const bp = pinned.includes(b.sessionId) ? 1 : 0;
    return bp - ap || b.updatedAt - a.updatedAt;
  });
  // opencode v2 session tabs (session.tab.*): the open-session strip above
  // the transcript. In-memory for the TUI lifetime, like upstream's
  // context; closed tabs keep a reopen stack, switches a bounded history.
  const [tabs, setTabs] = useState<SessionTab[]>([]);
  const [closedTabs, setClosedTabs] = useState<ClosedSessionTab[]>([]);
  const tabsRef = useRef<SessionTab[]>([]);
  tabsRef.current = tabs;
  const tabHistoryRef = useRef<SessionTabHistory>({ entries: [], index: -1 });
  const openTab = (sessionId: string, title?: string) => {
    setTabs((current) => openSessionTab(current, { sessionID: sessionId, title }));
    tabHistoryRef.current = recordSessionTabHistory(tabHistoryRef.current, sessionId);
  };

  const activeTitle = activeId
    ? displayTitle(sessions.find((s) => s.sessionId === activeId) ?? { sessionId: activeId, title: "", status: "", updatedAt: Date.now() })
    : "";
  const activeModel = models[modelIdx] ?? models[0];
  const promptWidth = Math.max(56, Math.min(86, Math.floor(dims.width * 0.62)));
  wrapWidthRef.current = Math.max(12, promptWidth - 5);
  const selRange = selAnchor === null
    ? null
    : ([Math.min(selAnchor, cursor ?? draft.length), Math.max(selAnchor, cursor ?? draft.length)] as [number, number]);
  const cwdFull = shortCwd(process.cwd());
  const cwd = cwdFull.length > 42 ? `…${cwdFull.slice(-41)}` : cwdFull;
  const cwdFiles = useRef<string[] | null>(null);
  const cwdFileMatches = (token: string): string[] => {
    try {
      if (cwdFiles.current === null) {
        cwdFiles.current = readdirSync(process.cwd()).slice(0, 500);
      }
      const needle = token.toLowerCase();
      return cwdFiles.current.filter((f) => f.toLowerCase().includes(needle)).slice(0, 10);
    } catch {
      return [];
    }
  };

  // Slash `/token` and workspace `@token` triggers; whitespace after the
  // token dismisses the popup, backspace into the token reopens it.
  const lastToken = (prefix: string): string | null => {
    if (!typing) return null;
    const idx = draft.lastIndexOf(prefix);
    if (idx === -1) return null;
    const token = draft.slice(idx + 1);
    return /\S*$/.test(token) && !token.includes(" ") ? token : null;
  };
  const slashToken = lastToken("/");
  const atToken = lastToken("@");
  const sugMatches: SlashCommandSpec[] = slashToken !== null
    ? matchSlashCommands(slashToken)
    : [];
  const fileMatches: string[] = atToken !== null && fileContext
    ? cwdFileMatches(atToken)
    : [];
  const sugOpen = (sugMatches.length > 0 || fileMatches.length > 0) && !sugDismissed.current;

  // Placeholder cycles through the reference example set every 4s while the
  // composer is empty and focused.
  const [placeholderTick, setPlaceholderTick] = useState(0);
  useEffect(() => {
    if (!typing || draft) return;
    const timer = setInterval(() => setPlaceholderTick((t) => t + 1), 4000);
    return () => clearInterval(timer);
  }, [typing, draft]);
  const [gitBranch, setGitBranch] = useState<string>("");
  useEffect(() => {
    const read = () => {
      try {
        const head = readFileSync(`${process.cwd()}/.git/HEAD`, "utf8").trim();
        setGitBranch(head.startsWith("ref:") ? head.slice(16) : head.slice(0, 7));
      } catch { setGitBranch(""); }
    };
    read();
    const timer = setInterval(read, 60000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  // NativeAnnounce (spec §2 cap-2/§3): the phase is DERIVED in one place from
  // the TUI's own state, never scattered through the handlers. Identity (the
  // active session id) rides every frame; the Announcer emits on change and
  // heartbeats the unchanged state. Precedence: backend loss outranks a stale
  // pending ask (a lost TUI must never hold a gate open), then the permission
  // question, then the running turn; no active session yet = StartupGate.
  const announcerRef = useRef<Announcer | null>(null);
  if (announcerRef.current === null) announcerRef.current = new Announcer();
  const phase: AnnouncePhase = lost
    ? "Idle"
    : ask
      ? "QuestionPrompt"
      : running
        ? "Working"
        : activeId
          ? "Idle"
          : "StartupGate";
  useEffect(() => {
    announcerRef.current?.announce(activeId, phase, lost ? "backend-lost" : undefined);
  }, [activeId, phase, lost]);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  // Queue pump: when the live turn ends, send the oldest queued prompt. A
  // prompt typed during a turn is therefore visible (queued row above the
  // composer) and never races the streaming tail.
  useEffect(() => {
    if (running || queue.length === 0 || !activeId) return;
    const [next, ...rest] = queue;
    queueRef.current = rest;
    setQueue(rest);
    void send(next, activeId);
  }, [running, queue, activeId]);

  // The reference editor handoff: suspend the renderer, hand the text to
  // VISUAL||EDITOR over inherit stdio, read back, resume. Resolves null when
  // no editor is configured or the editor failed — callers toast, the draft
  // is untouched.
  const suspendForEditor = (initial: string): Promise<string | null> => {
    const editor = process.env.VISUAL || process.env.EDITOR;
    // NOTE: call renderer.suspend()/resume() as METHODS — caching them in
    // locals detaches `this` and the delegated suspend throws.
    if (!editor || !renderer?.suspend || !renderer.resume) return Promise.resolve(null);
    const file = `/tmp/zcode-tui-${Date.now()}.md`;
    return new Promise((resolve) => {
      try {
        writeFileSync(file, initial);
        renderer?.suspend?.();
      } catch (e) {
        try { appendFileSync("/tmp/zct-keys.log", "suspend THROW " + String(e) + "\n"); } catch {}
        flashStatus(`editor suspend failed: ${errorMessage(e)}`, "error");
        try { unlinkSync(file); } catch {}
        resolve(null);
        return;
      }
      const parts = editor.split(" ");
      const child = spawn(parts[0]!, [...parts.slice(1), file], {
        cwd: process.cwd(),
        stdio: ["inherit", "inherit", "inherit"],
      });
      child.on("error", () => {
        try { renderer?.resume?.(); } catch {}
        resolve(null);
      });
      child.on("exit", (code) => {
        let out: string | null = null;
        try {
          const raw = readFileSync(file, "utf8");
          out = raw.length > 0 ? normalizeEditorContent(raw) : null;
        } catch {}
        try { unlinkSync(file); } catch {}
        try { renderer?.resume?.(); } catch {}
        resolve(out);
      });
    });
  };

  // Theme state rides state.json's theme:{name,mode} — the v2 config.theme
  // voice via the 0.6.29 preference repository (lock-merged writes + live
  // cross-client sync). The legacy ~/.config/zcode-tui/theme flat file is a
  // read-only fallback at boot and is no longer written.
  const persistTheme = (next: ThemeName) => {
    uiStateRepository.update((current) => ({ theme: { ...current.theme, name: next } }));
    setTheme(next);
  };
  // v2 context/theme.tsx setMode/pin/free: setMode guards the active theme's
  // modes, then pins — switching an arm LOCKS it and persists theme.mode;
  // theme.mode.lock / unlock are pin(mode())/free(), and free persists
  // "system". The terminal-follow half of free (renderer.themeMode, the
  // palette probe) has no plane on this stack — recorded in parity-v2.md.
  const pinThemeMode = (next: ThemeMode) => {
    setThemeLock(next);
    setThemeMode(next);
    uiStateRepository.update((current) => ({ theme: { ...current.theme, mode: next } }));
  };
  const freeThemeMode = () => {
    setThemeLock(null);
    uiStateRepository.update((current) => ({ theme: { ...current.theme, mode: "system" } }));
  };
  const switchThemeMode = (requested: ThemeMode): boolean => {
    if (!themeModes(theme).includes(requested)) return false;
    pinThemeMode(requested);
    return true;
  };

  const refresh = async () => {
    try {
      const res = (await client.request("session/list", { limit: 100 })) as { sessions?: Record<string, unknown>[] };
      const rows = (res.sessions ?? [])
        .map(normalizeSession)
        .filter((row) => row.sessionId.length > 0)
        .sort((a, b) => b.updatedAt - a.updatedAt);
      setSessions(rows);
      probe("backend-live", "");
      probe("list-ok", `${rows.length} sessions`);
      setStatus(`${rows.length} sessions`);
    } catch (e) {
      setStatus(`error: ${errorMessage(e)}`);
    }
  };

  // 3.12.x removed workspace/readState — per-model reasoning defaults ride
  // the session create/resume replies (settings.model.available).
  const applyCatalogDefaultLevel = (settings: unknown, chosenModelId: string | undefined) => {
    const catalog = (settings as { model?: { available?: { modelId?: string; reasoning?: { defaultLevel?: string } }[] } } | undefined)?.model;
    const level = catalog?.available?.find((m) => m.modelId === chosenModelId)?.reasoning?.defaultLevel;
    if (isEffort(level)) setEffort(level);
  };

  const loadModels = async () => {
    // The allowlist remains authoritative. It seeds the composer and the
    // dialogs; the catalog's defaultLevel arrives with the first session
    // create/resume reply and is applied there.
    const avail = ALLOWED_MODELS.map((m) => ({ ...m }));
    setModels(avail);
    const requested = modelId ? avail.findIndex((m) => m.modelId === modelId) : -1;
    const remembered = uiState.current.recent.find((r) =>
      avail.some((m) => m.providerId === r.providerId && m.modelId === r.modelId));
    const rememberedIdx = remembered
      ? avail.findIndex((m) => m.providerId === remembered.providerId && m.modelId === remembered.modelId)
      : -1;
    const defaultIndex = avail.findIndex((m) => m.isDefault);
    const idx = requested >= 0 ? requested : rememberedIdx >= 0 ? rememberedIdx : Math.max(0, defaultIndex);
    setModelIdx(idx);
    // Effort precedence (opencode local.tsx): the user's per-model variant
    // from the UX-state store, else the initial default until a session
    // reply refines it from the catalog.
    const localVariant = uiState.current.variant[modelKey(avail[idx])];
    if (isEffort(localVariant)) setEffort(localVariant);
  };

  const subscribe = async (sessionId: string) => {
    try {
      await client.request("session/subscribe", {
        sessionId,
        deliveryKind: "desktop-continuous",
        includeSnapshot: false,
      });
    } catch (e) {
      setStatus(`subscribe failed: ${errorMessage(e)}`);
    }
  };

  // Every session the TUI opens becomes a tab (the v2 model: switching
  // opens tabs; the strip is the tab set, the store stays the full list).
  useEffect(() => {
    if (activeId) openTab(activeId, activeTitle || undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, activeTitle]);

  const open = async (row: SessionRow) => {
    setView("session");
    setTyping(false);
    setDraft("");
    setStatus(`opening ${displayTitle(row)}…`);
    try {
      const res = (await client.request("session/resume", { sessionId: row.sessionId })) as {
        messages?: { info: Record<string, unknown>; parts: unknown }[];
        session?: { model?: { modelId?: string } };
        settings?: unknown;
      };
      const rawMessages = res.messages ?? [];
      const turns: TurnMessage[] = rawMessages.flatMap((m) => partsToTurns(m as Record<string, unknown>));
      setMsgs(turns);
      setRawMsgs(rawMessages as RawMessageRecord[]);
      setActiveId(row.sessionId);
      setMode(row.mode ?? "build");
      // A session whose turn is ALREADY running (desktop or another client
      // started it) must open in the working state — the status patch only
      // fires on change, so subscribing alone never learns about it.
      if ((res.session as Record<string, unknown> | undefined)?.status === "running") {
        setRunning(true);
        probe("resume", `${row.sessionId.slice(0, 18)} · adopts running turn`);
      }
      // Adopt the session's own model and effort (opencode prompt/index.tsx:
      // agent/model/variant re-initialize from the last user message when the
      // session changes).
      if (row.modelId) {
        const i = modelsRef.current.findIndex((m) => m.modelId === row.modelId);
        if (i >= 0) setModelIdx(i);
      }
      const lastModel = rawMessages.at(-1)?.info?.model as Record<string, unknown> | undefined;
      if (isEffort(lastModel?.variant)) setEffort(lastModel.variant);
      else applyCatalogDefaultLevel(res.settings, row.modelId ?? res.session?.model?.modelId);
      resetToTail();
      await subscribe(row.sessionId);
      setStatus(`${displayTitle(row)} · ${turns.length} messages`);
      probe("resume", row.sessionId.slice(0, 18));
    } catch (e) {
      setStatus(`open failed: ${errorMessage(e)}`);
    } finally {
      // The composer is ALWAYS live once the session view settles — this is
      // the bug the owner hit 2026-09-16 ("cannot even type in a zcodetui
      // session after opening it"): the old code left typing=false forever.
      setTyping(true);
    }
  };

  const newSession = async (): Promise<string | null> => {
    setStatus("creating session…");
    try {
      const selected = modelId && models.some((m) => m.modelId === modelId)
        ? models.find((m) => m.modelId === modelId)!
        : activeModel;
      // The chosen model AND its effort variant ride creation — a new session
      // starts with exactly what the composer advertises.
      const res = (await client.request("session/create", {
        workspace: { workspacePath: process.cwd(), workspaceKey: process.cwd() },
        mode: launchMode ?? "build",
        persistence: "immediate",
        model: { providerId: selected.providerId, modelId: selected.modelId, variant: effort },
      })) as { session?: Record<string, unknown>; settings?: unknown };
      // A brand-new model with no remembered variant adopts the catalog's
      // defaultLevel for it (3.12.x: the catalog rides this reply).
      if (!isEffort(uiState.current.variant[modelKey(selected)])) {
        applyCatalogDefaultLevel(res.settings, selected.modelId);
      }
      const raw = res.session;
      if (!raw) throw new Error("create returned no session");
      const row = normalizeSession(raw);
      setSessions((current) => [row, ...current.filter((x) => x.sessionId !== row.sessionId)]);
      setSel(0);
      setMsgs([]);
      setRawMsgs([]);
      setActiveId(row.sessionId);
      setMode(launchMode ?? "build");
      resetToTail();
      setView("session");
      await subscribe(row.sessionId);
      setTyping(true);
      setStatus(`${displayTitle(row)} · ready`);
      return row.sessionId;
    } catch (e) {
      setStatus(`create failed: ${errorMessage(e)}`);
      return null;
    }
  };

  const send = async (content: string, targetId = activeId, parts = promptFilesRef.current.filter((f) => content.includes(f.label))) => {
    if (!targetId || running) return;
    probe("turn-start", content.slice(0, 40));
    // v2 submit: the alive labels leave the text (virtual text), the parts
    // ride as attachments — uploaded begin/chunk/commit, sent by ref. Parts
    // arrive from submitPrompt: the draft clear lets the pruning effect win
    // the newSession await gap, so the refs read empty by the time send
    // runs on the first-turn path.
    const clean = stripAttachmentLabels(content, parts.map((f) => f.label));
    const echoText = parts.length > 0
      ? `${clean}${clean ? "\n" : ""}${parts.map((f) => (f.name ? `${f.label} ${f.name}` : f.label)).join("\n")}`
      : content;
    promptFilesRef.current = [];
    setPromptFiles([]);
    setRunning(true);
    setView("session");
    resetToTail();
    setHistory((h) => [content, ...h.filter((x) => x !== content)]);
    historyIdx.current = -1;
    const rawNow = Date.now();
    setMsgs((m) => [...m, { role: "user", text: echoText }, { role: "assistant", text: "", model: modelLabel(activeModel), turnStart: Date.now() }]);
    // Raw mirror: optimistic user + assistant records. The host never echoes
    // the user prompt back (measured — the flat path has no echo patch), so
    // local ids keep the records unique.
    const seq = ++rawLocalSeq.current;
    setRawMsgs((current) => [
      ...current,
      {
        info: { role: "user", id: `local-u${seq}`, time: { created: rawNow } },
        parts: [{ type: "text", text: echoText }],
      },
      {
        info: { role: "assistant", id: `local-a${seq}`, time: { created: rawNow }, model: { modelId: activeModel?.modelId ?? "" } },
        parts: [],
      },
    ]);
    let attachments: { ref: string; fileName: string; mime: string; bytes: number }[] | undefined;
    if (parts.length > 0) {
      setStatus(`uploading ${parts.length} attachment${parts.length === 1 ? "" : "s"}…`);
      attachments = [];
      for (const f of parts) {
        try {
          const ref = await uploadSessionAttachment(client, targetId, { mime: f.mime, bytes: f.bytes, filename: f.name ?? f.label });
          attachments.push({ ref, fileName: f.name ?? f.label, mime: f.mime, bytes: f.bytes.byteLength });
        } catch (e) {
          setStatus(`attachment upload failed: ${errorMessage(e)}`);
          setRunning(false);
          return;
        }
      }
    }
    setStatus("working…");
    try {
      await client.request("session/send", attachments
        ? { sessionId: targetId, content: clean, attachments }
        : { sessionId: targetId, content: clean });
    } catch (e) {
      setStatus(`send failed: ${errorMessage(e)}`);
      setRunning(false);
    }
  };

  const submitPrompt = async (content: string) => {
    const route = submitRoute(content);
    // The alive parts are captured BEFORE the draft clears — after it,
    // the pruning effect treats the labels as deleted.
    const submitParts = promptFilesRef.current.filter((f) => content.includes(f.label));
    setDraft("");
    draftRef.current = "";
    setCursorBoth(null);
    discardPending();
    sugDismissed.current = false;
    moveSug(0);
    setTyping(true);
    if (route === "command") {
      const command = parseSlashCommand(content);
      if (command === "sessions") { setDeleteId(null); setDialog("sessions"); return; }
      if (command === "home") { setView("home"); return; }
      if (command === "new") { await newSession(); return; }
      if (command === "clear") { clearSession(); return; }
      if (command === "model") { setDialog("model"); return; }
      if (command === "themes") { openThemes(); return; }
      if (command === "commands") { setDialog("palette"); return; }
      if (command === "skills") { setDialog("skills"); return; }
      if (command === "mcps") { setDialog("mcp"); return; }
      if (command === "plugins") { setDialog("plugins"); return; }
      if (command === "variants") { setDialog("effort"); return; }
      if (command === "settings") { setDialog("settings"); return; }
      if (command === "help") { setDialog("help"); return; }
      if (command === "diff") { openDiff(); return; }
      if (command === "timeline") { openTimeline(); return; }
      if (command === "agents") { setDialog("mode"); return; }
      if (command === "status") { setDialog("status"); return; }
      if (command === "effort") { setDialog("effort"); return; }
      if (command === "thinking") { await toggleThinking(); return; }
      if (command === "fork") { openForkDialog(); return; }
      if (command === "compact") { await compactActive(); return; }
      if (command === "copy") { copyTranscript(); return; }
      if (command === "export") { setDialog("export"); return; }
      if (command === "quit") { onQuit(); return; }
      return;
    }
    if (activeId) {
      await send(content, activeId, submitParts);
      return;
    }
    const id = await newSession();
    if (id) await send(content, id, submitParts);
  };

  const openSessions = () => {
    setDeleteId(null);
    setDialog("sessions");
    setTyping(false);
  };

  const closeDialog = () => {
    setTimelineMode(false);
    setDialog(null);
    // The composer is always live once a dialog closes — the old home-only
    // restore left session-view dialogs (palette, model, effort, sessions)
    // draining every keystroke after close. Every dialog select path goes
    // through HERE (not an inline setDialog(null)) so a selection can never
    // leave the composer dead — the 4th instance of the family, found by the
    // PTY driver 2026-09-16.
    setTyping(true);
  };


  // opencode v2 diff viewer (/diff): a full-screen route over the app with
  // its own key grammar; the return view is remembered like v2's
  // returnRoute, and the composer is re-armed on close (closeDialog
  // discipline — the dead-composer family).
  const [diffMode, setDiffMode] = useState<DiffMode>("branch");
  const [diffBase, setDiffBase] = useState<string | null>(null);
  const [diffBranches, setDiffBranches] = useState<string[]>([]);
  const diffApiRef = useRef<DiffViewerApi | null>(null);
  const diffReturnView = useRef<AppView>("home");
  const ggArmedRef = useRef(false);
  const openDiff = () => {
    diffReturnView.current = view;
    setView("diff");
    setTyping(false);
  };
  const closeDiff = () => {
    setView(diffReturnView.current);
    setTyping(true);
  };
  const openDiffSource = () => {
    setDialog("diffsource");
    setTyping(false);
  };
  const openDiffBasePicker = () => {
    void listBranches(process.cwd()).then((names) => setDiffBranches(names));
    setDialog("diffbase");
    setTyping(false);
  };
  const persistDiffPrefs = (value: DiffPreferences) => {
    uiState.current = uiStateRepository.update((cur) => ({ diff: { ...cur.diff, ...value } }));
  };

  // opencode app.toggle.animations (0.6.24): the cursor blink is the TUI's
  // one animation; disabling holds the cursor steady.
  const toggleAnimations = () => {
    const next = !animations;
    setAnimations(next);
    uiState.current = uiStateRepository.update(() => ({ animations: next }));
    flashStatus(next ? "animations enabled" : "animations disabled");
  };

  // opencode app.toggle.file_context (v2 config.prompt.editor): gates the
  // @files popup.
  const toggleFileContext = () => {
    const next = !fileContext;
    setFileContext(next);
    uiState.current = uiStateRepository.update(() => ({ fileContext: next }));
    flashStatus(next ? "file context enabled" : "file context disabled");
  };

  // opencode app.toggle.diffwrap (v2 config.diffs.wrap word|none): the
  // viewer owns the live state and persists through onPreferencesChange.
  const toggleDiffWrap = () => {
    const api = diffApiRef.current;
    if (!api) {
      flashStatus("no diff viewer open", "warning");
      return;
    }
    api.toggleWrap();
    flashStatus((uiState.current.diff.wrap ?? "char") === "char" ? "diff wrapping disabled" : "diff wrapping enabled");
  };

  // opencode v2 session.tab.select.N: leader 1..9/0 select the Nth OPEN
  // TAB (0.6.22 re-point — v2.0.7 owns these keys for tabs, not recency).
  const quickSwitch = (slot: number) => {
    const tab = tabsRef.current[slot - 1];
    if (!tab) { flashStatus(`no tab in slot ${slot}`); return; }
    if (tab.sessionID === activeId) { closeDialog(); setView("session"); return; }
    const row = orderedSessions.find((s) => s.sessionId === tab.sessionID);
    if (row) void open(row);
    else flashStatus("tab session not in the store");
  };

  const tabStatusOf = (id: string): SessionTabStatus => {
    const row = sessions.find((s) => s.sessionId === id);
    const busy = /run|busy|work/i.test(row?.status ?? "");
    if (id !== activeId && /fail|error/i.test(row?.status ?? "")) return { busy: false, unread: "error" };
    if (id !== activeId && busy) return { busy: true, unread: "activity" };
    return { busy };
  };
  const tabOpenSession = (sessionId: string | undefined) => {
    if (!sessionId) return;
    const row = orderedSessions.find((s) => s.sessionId === sessionId);
    if (row) void open(row);
  };
  const tabCycle = (direction: 1 | -1, unreadOnly = false) => {
    const next = cycleSessionTab(
      tabsRef.current,
      activeId ?? undefined,
      direction,
      unreadOnly ? (t) => Boolean(tabStatusOf(t.sessionID).unread) : () => true,
    );
    if (!next) { if (unreadOnly) flashStatus("no unread tabs"); return; }
    tabOpenSession(next.sessionID);
  };
  const tabClose = () => {
    if (!activeId) { flashStatus("no tab to close"); return; }
    const index = tabsRef.current.findIndex((t) => t.sessionID === activeId);
    const result = closeSessionTab(tabsRef.current, activeId);
    setTabs(result.tabs);
    setClosedTabs((stack) => recordClosedSessionTab(stack, { sessionID: activeId, title: activeTitle || undefined }, index));
    if (result.next) tabOpenSession(result.next);
    else setView("home");
  };

  // v2 /clear (session.clear, upstream #50524 — 0.6.50): close the active
  // tab and land on the front page — /new creates, /clear closes. Upstream
  // re-sets model/agent across the route change; ours are app-level, so
  // the composer's model survives by construction.
  const clearSession = () => {
    if (activeId) {
      const index = tabsRef.current.findIndex((t) => t.sessionID === activeId);
      const result = closeSessionTab(tabsRef.current, activeId);
      setTabs(result.tabs);
      setClosedTabs((stack) => recordClosedSessionTab(stack, { sessionID: activeId, title: activeTitle || undefined }, index));
    }
    setView("home");
  };
  const tabReopen = () => {
    const result = reopenSessionTab(closedTabs, tabsRef.current);
    if (!result.tabs || !result.sessionID) { flashStatus("no closed tab to reopen"); return; }
    setClosedTabs(result.stack);
    setTabs(result.tabs);
    tabOpenSession(result.sessionID);
  };
  const tabHistoryForward = () => {
    const result = moveSessionTabHistory(tabHistoryRef.current, tabsRef.current, activeId ?? undefined, 1);
    if (!result.sessionID) { flashStatus("no forward tab history"); return; }
    tabHistoryRef.current = result.history;
    tabOpenSession(result.sessionID);
  };

  // Interrupt the running turn (opencode session_interrupt: escape). An
  // interrupt is a FULL stop: a pending permission ask is denied, queued
  // prompts are dropped — the pump would otherwise start a fresh turn the
  // moment running drops (the owner's "kept on working despite interrupt",
  // 2026-09-17). The draft is untouched — only the turn stops.
  const stopTurn = async () => {
    const id = activeIdRef.current;
    if (!id) return;
    if (askRef.current) {
      const resolve = askRef.current;
      askRef.current = null;
      setAsk(null);
      setTyping(true);
      resolve({ decision: "deny" });
    }
    const dropped = queueRef.current.length;
    if (dropped > 0) {
      queueRef.current = [];
      setQueue([]);
    }
    try {
      await client.request("session/stop", { sessionId: id });
      setRunning(false);
      // v2 marks the stopped turn on the assistant footer (`· interrupted`,
      // duration included) instead of dropping the metrics (0.6.30 port).
      setMsgs((current) => {
        if (current.length === 0) return current;
        const last = current[current.length - 1];
        if (last.role !== "assistant") return current;
        return [...current.slice(0, -1), {
          ...last,
          interrupted: true,
          durationMs: last.durationMs ?? (last.turnStart ? Date.now() - last.turnStart : undefined),
        }];
      });
      // Raw mirror: stamp the interruption + close the open parts.
      setRawMsgs((current) => {
        const created = Number((current[current.length - 1]?.info?.time as Record<string, unknown> | undefined)?.created ?? Date.now());
        return finalizeRawAssistant(current, { interrupted: true, durationMs: Date.now() - created });
      });
      flashStatus(dropped > 0 ? `turn interrupted · ${dropped} queued dropped` : "turn interrupted", "warning");
      probe("turn-stop", id.slice(0, 18));
    } catch (e) {
      flashStatus(`interrupt failed: ${errorMessage(e)}`, "error");
    }
  };

  // v2 session.copy.id ("Copy session ID") — palette-only upstream, keys none.
  const [exportResultPath, setExportResultPath] = useState<string | null>(null);
  const copySessionId = () => {
    if (!activeId) return;
    const ok = osc52Copy(activeId);
    flashStatus(ok ? "Session ID copied to clipboard!" : "Failed to copy session ID", ok ? "success" : "error");
  };
  // v2 session.copy ("/copy"): the full transcript as markdown —
  // formatSessionTranscript(session, messages, thinking=true), the
  // reference call's own arguments — into the clipboard.
  const copyTranscript = () => {
    const row = sessions.find((s) => s.sessionId === activeId);
    if (!activeId || !row) return; // v2: if (!sessionData) return
    const content = formatSessionTranscript(
      { id: activeId, title: row.title || undefined, createdAt: row.createdAt, updatedAt: row.updatedAt },
      msgsRef.current, true,
    );
    const ok = osc52Copy(content);
    flashStatus(ok ? "Session transcript copied to clipboard!" : "Failed to copy session transcript", ok ? "success" : "error");
  };
  // v2 session.export (leader x + /export): the DialogExportOptions flow.
  // The JSON arm (client.api.session.export) has no zcode verb, so the
  // dialog never offers json/sanitize until the host grows one (the 0.6.31
  // Revert-row precedent); the markdown arm is fully local.
  const runExport = async (opts: { action: "copy" | "export"; thinking: boolean; tools: boolean }) => {
    const row = sessions.find((s) => s.sessionId === activeId);
    if (!activeId || !row) return; // v2: if (!sessionData) return
    try {
      const content = formatSessionTranscript(
        { id: activeId, title: row.title || undefined, createdAt: row.createdAt, updatedAt: row.updatedAt },
        msgsRef.current, opts.thinking, opts.tools,
      );
      if (opts.action === "copy") {
        if (!osc52Copy(content)) throw new Error("clipboard unavailable");
        closeDialog();
        flashStatus("Copied to clipboard", "success");
        return;
      }
      // Upstream writeExport: mkdir -p then write.
      const filepath = `${tmpdir()}/session-${randomUUID()}.md`;
      await mkdir(dirname(filepath), { recursive: true });
      await writeFile(filepath, content, "utf8");
      setExportResultPath(filepath);
      setDialog("exportresult");
    } catch {
      closeDialog();
      flashStatus("Failed to export session", "error");
    }
  };
  // opencode session.message.user.* + messages_last_user: jump between the
  // session's USER prompts (alt+up / alt+down walk, alt+end last). The
  // anchor is the last jumped-to row; jump-to-latest clears it.
  // opencode session.message.next/previous (+ user.*): the walk generalized
  // to ALL messages (0.6.24) — the reference ships these as palette-only
  // commands; ours keeps alt+end (last user message) from 0.6.18.
  // Slice 2: the walk runs over transcript ROWS using the message-boundary
  // dedupe (upstream messageBoundaryIDs) — one jump target per message.
  const messageJump = (dir: 1 | -1 | "last", usersOnly: boolean) => {
    const rowList = rowsRef.current;
    const boundaries = messageBoundaryIDs(rowList, normRef.current);
    const rows: number[] = [];
    rowList.forEach((row, i) => {
      const bid = boundaries[i];
      if (!bid) return;
      if (usersOnly) {
        const m = normRef.current.find((x) => x.id === bid);
        if (m?.type !== "user") return;
      }
      rows.push(i);
    });
    if (rows.length === 0) return;
    const at = userJumpIdxRef.current;
    let target: number;
    if (dir === "last" || at === null) target = rows[rows.length - 1];
    else if (dir === -1) {
      const below = rows.filter((u) => u < at);
      target = below.length > 0 ? below[below.length - 1] : rows[0];
    } else {
      const above = rows.filter((u) => u > at);
      if (above.length === 0) { jumpToLatest(); userJumpIdxRef.current = null; syncAtBottom(); return; }
      target = above[0];
    }
    userJumpIdxRef.current = target;
    jumpToMessage(target);
    flashStatus(`${usersOnly ? "user message" : "message"} ${rows.indexOf(target) + 1}/${rows.length}`);
  };

  const userJump = (dir: 1 | -1 | "last") => messageJump(dir, true);

  const jumpToMessage = (idx: number) => {
    const box = scrollRef.current as unknown as { getChildren?: () => unknown[]; viewport?: { y: number }; scrollBy?: (d: { y: number }) => void } | null;
    if (!box) return;
    const ve = windowEndRef.current ?? rowsRef.current.length;
    if (idx < ve - SCROLL_WINDOW) setWindowEnd(idx + 1); // pull it into the window
    // two frames: one for a possible window re-base to commit, one to settle
    setTimeout(() => setTimeout(() => {
      // Prefer the timeline anchor's exact geometry (upstream jumpToMessage);
      // rows mounted before a window re-base fall through to the positional
      // child math below.
      const boundary = messageBoundaryIDs(rowsRef.current, normRef.current)[idx];
      const anchored = boundary ? timelineAnchors.forMessage(boundary) : undefined;
      const vp = (scrollRef.current as unknown as { viewport?: { y: number } } | null)?.viewport?.y ?? 0;
      if (anchored && typeof anchored.node.y === "number" && !anchored.node.isDestroyed) {
        (scrollRef.current as unknown as { scrollBy?: (d: { y: number }) => void } | null)?.scrollBy?.({ y: anchored.node.y - vp });
        syncAtBottom();
        return;
      }
      const children = (scrollRef.current as unknown as { getChildren?: () => unknown[] } | null)?.getChildren?.() ?? [];
      const ve2 = windowEndRef.current ?? rowsRef.current.length;
      const start2 = Math.max(0, ve2 - SCROLL_WINDOW);
      const header = ve2 < rowsRef.current.length ? 1 : 0;
      const child = children[header + (idx - start2)] as { y?: number } | undefined;
      if (child && typeof child.y === "number") {
        (scrollRef.current as unknown as { scrollBy?: (d: { y: number }) => void } | null)?.scrollBy?.({ y: child.y - vp });
        syncAtBottom();
      }
    }, 16, 16));
  };

  // Input undo/redo (opencode input_undo/redo): snapshots pushed before
  // structural edits — word deletes, line deletes, newline, paste bursts.
  const undoStack = useRef<string[]>([]);
  const redoStack = useRef<string[]>([]);
  const pushUndo = () => {
    undoStack.current.push(draftRef.current);
    if (undoStack.current.length > 100) undoStack.current.shift();
    redoStack.current = [];
  };
  const applyDraft = (next: string, cursorAt: number) => {
    draftRef.current = next;
    setDraft(next);
    setCursorBoth(cursorAt);
    sugDismissed.current = false;
    moveSug(0);
  };

  // Effort select: persist per model (opencode variant map) AND carry it to
  // the active session — setModel accepts model.variant (measured live
  // 2026-09-16) and the backend persists it as workspace last-used.
  const applyEffort = (e: (typeof EFFORTS)[number]) => {
    setEffort(e);
    uiState.current = uiStateRepository.update((cur) => ({ variant: { ...cur.variant, [modelKey(activeModel)]: e } }));
    if (!activeId) { flashStatus(`effort → ${e}`); return; }
    void client.request("session/setModel", { sessionId: activeId, model: { providerId: activeModel.providerId, modelId: activeModel.modelId, variant: e } })
      .then(() => flashStatus(`effort → ${e}`))
      .catch((err) => flashStatus(`effort ${e} · stored locally, host refused: ${errorMessage(err)}`));
  };

  const cycleEffort = (dir: 1 | -1 = 1) => {
    const cur = isEffort(effort) ? effort : "max";
    const next = EFFORTS[(EFFORTS.indexOf(cur) + dir + EFFORTS.length) % EFFORTS.length];
    applyEffort(next);
  };

  const cycleMode = async (dir: 1 | -1 = 1) => {
    const cur = MODES.includes(mode as (typeof MODES)[number]) ? mode as (typeof MODES)[number] : "build";
    const next = MODES[(MODES.indexOf(cur) + dir + MODES.length) % MODES.length];
    if (!activeId) {
      setMode(next);
      flashStatus(`mode → ${next}`);
      return;
    }
    try {
      await client.request("session/setMode", { sessionId: activeId, mode: next });
      setMode(next);
      flashStatus(`mode → ${next}`);
    } catch (e) {
      flashStatus(`setMode failed: ${errorMessage(e)}`);
    }
  };

  const toggleThinking = async () => {
    const next = thoughtLevel === "disabled" ? "enabled" : "disabled";
    if (!activeId) {
      setThoughtLevel(next);
      flashStatus(`thinking → ${next}`);
      return;
    }
    try {
      await client.request("session/setThoughtLevel", { sessionId: activeId, thoughtLevel: next });
      setThoughtLevel(next);
      flashStatus(`thinking → ${next}`);
    } catch (e) {
      flashStatus(`setThoughtLevel failed: ${errorMessage(e)}`);
    }
  };

  // The timeline (opencode session_timeline + fork-from-timeline): the
  // session's USER prompts, newest first; selecting one forks the session at
  // that message.
  const [timelineMode, setTimelineMode] = useState(false);
  const [actionMessageId, setActionMessageId] = useState<string | null>(null);
  const openTimeline = () => {
    if (!activeId || running || msgsRef.current.length === 0) { flashStatus("timeline: nothing to show yet"); return; }
    // v2 DialogTimeline: the session's user prompts, newest first, full text
    // with newlines flattened, Locale.time footer; cursor moves live-jump the
    // transcript (onMove → jumpToMessage), enter opens Message Actions.
    const opts = msgsRef.current
      .filter((m) => m.role === "user" && m.messageId)
      .map((m) => ({
        id: m.messageId ?? "",
        value: m.messageId ?? "",
        label: m.text.replace(/\n/g, " "),
        status: m.createdAt ? { text: formatTimeShort(m.createdAt) } : undefined,
      }))
      .reverse();
    if (opts.length === 0) { flashStatus("timeline: no user messages with checkpoints yet"); return; }
    setForkOptions(opts);
    setTimelineMode(true);
    setDialog("fork");
  };

  const openForkDialog = () => {
    if (!activeId || running || msgsRef.current.length === 0) return;
    // v2 DialogFork ("Fork session"): a Full session row, then the user
    // prompts newest-first; selecting forks before that message.
    const opts: DialogOption<string>[] = [
      { id: "full", value: "", label: "Full session" },
      ...msgsRef.current
        .filter((m) => m.role === "user" && m.messageId)
        .map((m) => ({
          id: m.messageId ?? "",
          value: m.messageId ?? "",
          label: m.text.replace(/\n/g, " "),
          status: m.createdAt ? { text: formatTimeShort(m.createdAt) } : undefined,
        }))
        .reverse(),
    ];
    setForkOptions(opts);
    setTimelineMode(false);
    setDialog("fork");
  };

  // v2 DialogFork.fork: fork before the given message (or at the session
  // tail) and navigate with the forked-at user prompt restored into the
  // composer (upstream projectedPromptInput; our drafts are plain text).
  const forkSessionAt = async (messageId?: string) => {
    if (!activeId || running) return;
    setStatus("forking…");
    try {
      const res = (await client.request("session/fork", {
        sessionId: activeId,
        target: messageId ? { kind: "message", messageId } : { kind: "latestCheckpoint" },
      })) as { forkedSessionId?: string };
      const fid = res.forkedSessionId;
      if (!fid) throw new Error("no forkedSessionId in response");
      const src = messageId
        ? msgsRef.current.find((m) => m.messageId === messageId && m.role === "user")
        : undefined;
      setMsgs([]);
      setRawMsgs([]);
      setActiveId(fid);
      await subscribe(fid);
      if (src?.text) setDraft(src.text);
      flashStatus(`fork ${fid.slice(0, 13)} · ready`);
      void refresh();
    } catch (e) {
      flashStatus(`fork failed: ${errorMessage(e)}`);
    }
  };
  const forkActive = () => forkSessionAt();

  // v2 DialogTimeline onMove preview: live-jump the transcript to the row
  // under the dialog cursor. Slice 2: the row index comes from the
  // message-boundary dedupe over transcript ROWS.
  const previewMessage = (messageId: string) => {
    if (!messageId) return;
    const boundaries = messageBoundaryIDs(rowsRef.current, normRef.current);
    const at = boundaries.indexOf(messageId);
    if (at >= 0) jumpToMessage(at);
  };

  // v2 DialogMessage Copy: user message text; an assistant message is its
  // text contents joined with \n (tool/reasoning rows excluded).
  const messageTextById = (messageId: string | null) => {
    if (!messageId) return "";
    return msgsRef.current
      .filter((m) => m.messageId === messageId && (m.role === "user" || m.role === "assistant") && m.text)
      .map((m) => m.text)
      .join("\n");
  };

  const compactActive = async () => {
    if (!activeId || running) return;
    setStatus("compacting…");
    try {
      const res = (await client.request("session/compact", { sessionId: activeId })) as { compact?: { state?: string } };
      flashStatus(`compact: ${res.compact?.state ?? "done"}`);
      void open({ sessionId: activeId, title: activeTitle, status: "", updatedAt: Date.now(), mode });
    } catch (e) {
      flashStatus(`compact failed: ${errorMessage(e)}`);
    }
  };

  const closeSession = async (row: SessionRow) => {
    if (deleteId !== row.sessionId) {
      setDeleteId(row.sessionId);
      flashStatus(`press ctrl+d again to delete ${displayTitle(row)}`);
      return;
    }
    try {
      await client.request("session/close", { sessionId: row.sessionId });
      setSessions((current) => current.filter((x) => x.sessionId !== row.sessionId));
      setPinned((current) => current.filter((id) => id !== row.sessionId));
      setDeleteId(null);
      closeDialog();
      if (activeId === row.sessionId) {
        setActiveId(null);
        setMsgs([]);
        setRawMsgs([]);
        setView("home");
        setTyping(true);
      }
      flashStatus(`deleted ${displayTitle(row)}`);
    } catch (e) {
      flashStatus(`delete failed: ${errorMessage(e)}`);
    }
  };

  const togglePin = (row: SessionRow) => {
    setPinned((current) => current.includes(row.sessionId)
      ? current.filter((id) => id !== row.sessionId)
      : [row.sessionId, ...current]);
    setDeleteId(null);
    flashStatus(`${pinned.includes(row.sessionId) ? "unpinned" : "pinned"} ${displayTitle(row)}`);
  };

  // Live turn updates: subscribe once, mutate the streaming assistant tail.
  useEffect(() => {
    client.onBackendLost(() => {
      setLost(true);
      flashStatus("backend lost · r to reconnect");
    });
    client.onAsk((msg) => {
      const method = String(msg.method);
      const params = (msg.params ?? {}) as Record<string, unknown>;
      if (method === "session/requestRuntimePreferences") return { nativeSearchEnhancementsEnabled: false };
      if (method === "interaction/requestPermission") {
        const input = (params.input ?? {}) as Record<string, unknown>;
        const detail = String(input.command ?? input.file_path ?? input.path ?? input.url ?? JSON.stringify(input).slice(0, 60));
        const toolName = String(params.toolName ?? "tool");
        const riskLevel = String(params.riskLevel ?? "");
        const opts = Array.isArray(params.options) ? params.options as Record<string, unknown>[] : [];
        // v2's EditBody renders the edit's diff (routes/session/permission.tsx);
        // our payloads carry only command/file_path/path/url today — take the
        // fields when a payload ever grows them (the mcp error-field pattern).
        const diff = typeof input.diff === "string" ? input.diff : undefined;
        const patch = typeof input.patch === "string" ? input.patch : undefined;
        askOptionsRef.current = opts.map((o) => ({ id: String(o.optionId), response: o.response }));
        return new Promise((resolve) => {
          probe("permission-ask", `${toolName}:${detail.slice(0, 40)}`);
          askRef.current = resolve as (v: unknown) => void;
          setAsk({ toolName, detail, riskLevel, diff, patch });
          setAskExpanded(false);
          setTyping(false);
          setStatus(`permission · ${toolName}`);
        });
      }
      return {};
    });
    client.onPush((msg) => {
      const method = String(msg.method);
      const params = msg.params as Record<string, unknown> | undefined;
      if (method === "session/event") {
        const payload = (params?.payload ?? {}) as Record<string, unknown>;
        const type = String(payload.type ?? payload.kind ?? "");
        const appendTail = (delta: string) => setMsgs((current) => {
          if (current.length === 0) return current;
          const last = current[current.length - 1];
          if (last.role !== "assistant") return current;
          return [...current.slice(0, -1), { ...last, text: last.text + delta }];
        });
        if (type === "tool_call") {
          const input = payload.input as Record<string, unknown> | undefined;
          setMsgs((current) => [...current, {
            role: "tool",
            text: String(input?.command ?? input?.description ?? JSON.stringify(input ?? {}).slice(0, 80)),
            toolName: String(payload.toolName ?? "tool"),
            toolCallId: String(payload.toolCallId ?? ""),
          }]);
          // Raw mirror: a tool part on the last assistant record (creating
          // the record when the tail is not one — mirrors the flat append).
          setRawMsgs((current) => {
            const part: Record<string, unknown> = {
              type: "tool",
              tool: String(payload.toolName ?? "tool"),
              callID: String(payload.toolCallId ?? ""),
              state: { status: "running", input: input ?? {} },
            };
            if (current.length > 0 && String(current[current.length - 1].info?.role) === "assistant") {
              const last = current[current.length - 1];
              return [...current.slice(0, -1), { ...last, parts: [...last.parts, part] }];
            }
            const seq = ++rawLocalSeq.current;
            return [...current, {
              info: { role: "assistant", id: `local-a${seq}`, time: { created: Date.now() } },
              parts: [part],
            }];
          });
        } else if (type === "result" && payload.toolCallId) {
          const result = (payload.result ?? {}) as Record<string, unknown>;
          setMsgs((current) => current.map((x) => x.toolCallId === payload.toolCallId ? {
            ...x,
            toolOut: String(result.content ?? result.error ?? "").slice(0, 220),
            toolOk: result.success !== false,
            toolMs: Number((result.perf as Record<string, unknown> | undefined)?.totalMs ?? 0) || undefined,
          } : x));
          // Raw mirror: settle the tool part by callID.
          setRawMsgs((current) => patchRawToolResult(current, String(payload.toolCallId), result));
        } else if (type === "text_delta") {
          const delta = (payload.delta ?? payload.text ?? payload.content) as string | undefined;
          if (delta) {
            appendTail(delta);
            // Raw mirror: the text part on the last assistant record. Unlike
            // the flat tail (which drops text following tool rows), the row
            // model keeps content order — upstream's grammar.
            setRawMsgs((current) => appendRawDeltaPart(current, "text", delta));
          }
        } else if (type === "reasoning_delta") {
          const delta = (payload.delta ?? payload.text ?? payload.content) as string | undefined;
          if (delta) {
            setThinking((current) => current + delta);
            // Raw mirror: the reasoning part (the group header + expanded
            // body render from it live).
            setRawMsgs((current) => appendRawDeltaPart(current, "reasoning", delta));
          }
        } else if (typeof payload.content === "string" && payload.stopReason) {
          const usage = payload.usage as Record<string, unknown> | undefined;
          if (typeof payload.contextWindow === "number" && typeof usage?.inputTokens === "number") {
            setCtx({ used: usage.inputTokens, window: payload.contextWindow });
          }
          const outputTokens = Number(usage?.outputTokens ?? usage?.totalTokens ?? 0) || undefined;
          const reasoningTokens = Number(usage?.reasoningTokens ?? 0) || undefined;
          setMsgs((current) => {
            if (current.length === 0) return current;
            const last = current[current.length - 1];
            if (last.role !== "assistant") return current;
            return [...current.slice(0, -1), {
              ...last,
              text: payload.content as string,
              durationMs: last.turnStart ? Date.now() - last.turnStart : undefined,
              outputTokens,
              reasoningTokens,
              thinking: thinkingRef.current || undefined,
              thinkingMs: thinkingRef.current && last.turnStart ? Date.now() - last.turnStart : undefined,
            }];
          });
          // Raw mirror: finalize the record — final text, completed time,
          // usage meta; open parts close (the footer row reads these).
          setRawMsgs((current) => {
            const now = Date.now();
            const created = Number((current[current.length - 1]?.info?.time as Record<string, unknown> | undefined)?.created ?? now);
            return finalizeRawAssistant(current, {
              content: payload.content as string,
              completed: now,
              durationMs: now - created,
              outputTokens,
              reasoningTokens,
            });
          });
          setThinking("");
          setRunning(false);
          if (usage && typeof usage.totalTokens === "number") {
            probe("turn-end", `tokens=${usage.totalTokens}`);
            flashStatus(`turn done · ${usage.totalTokens} tokens`);
          }
        } else if (typeof payload.response === "string" && !payload.usage) {
          setMsgs((current) => {
            if (current.length === 0) return current;
            const last = current[current.length - 1];
            if (last.role !== "assistant" || last.text) return current;
            return [...current.slice(0, -1), { ...last, text: payload.response as string }];
          });
          // Raw mirror: an empty assistant record gains its text part.
          setRawMsgs((current) => {
            if (current.length === 0) return current;
            const last = current[current.length - 1];
            if (String(last.info?.role) !== "assistant") return current;
            if (last.parts.some((p) => (p as { type?: string }).type === "text")) return current;
            return appendRawDeltaPart(current, "text", payload.response as string);
          });
        } else if (payload.title && activeIdRef.current) {
          setSessions((current) => current.map((row) => row.sessionId === activeIdRef.current ? { ...row, title: String(payload.title) } : row));
        }
      } else if (method === "v4/conversation/frame") {
        const frame = (params?.frame ?? {}) as Record<string, unknown>;
        const payload = (frame.payload ?? {}) as Record<string, unknown>;
        const deltas = Array.isArray(payload.deltas) ? payload.deltas as Record<string, unknown>[] : [];
        for (const delta of deltas) {
          const op = String(delta.op);
          if (op.startsWith("session.upserted") && delta.session) {
            const row = normalizeSession(delta.session as Record<string, unknown>);
            setSessions((current) => [row, ...current.filter((x) => x.sessionId !== row.sessionId)].sort((a, b) => b.updatedAt - a.updatedAt));
          } else if (op.startsWith("session.deleted") || op.startsWith("session.removed")) {
            const id = String((delta.session as Record<string, unknown> | undefined)?.sessionId ?? delta.sessionId ?? "");
            setSessions((current) => current.filter((x) => x.sessionId !== id));
          }
        }
      } else if (method === "state.updated") {
        const patch = (params?.patch ?? {}) as Record<string, unknown>;
        const modePatch = patch.mode as Record<string, unknown> | undefined;
        if (typeof modePatch?.current === "string") setMode(modePatch.current);
        const level = patch.thoughtLevel as Record<string, unknown> | undefined;
        if (typeof level?.current === "string") setThoughtLevel(level.current);
        // The model available/current/lastUsed triple: follow the backend's
        // current model and effort variant (a choice made in the desktop or
        // another client keeps this TUI honest).
        const modelPatch = patch.model as Record<string, unknown> | undefined;
        const currentModel = modelPatch?.current as Record<string, unknown> | undefined;
        if (currentModel && typeof currentModel.providerId === "string" && typeof currentModel.modelId === "string") {
          const i = modelsRef.current.findIndex((m) => m.providerId === currentModel.providerId && m.modelId === currentModel.modelId);
          if (i >= 0) setModelIdx(i);
        }
        if (isEffort(currentModel?.variant)) setEffort(currentModel.variant);
        if (patch.status === "running") setRunning(true);
        if (patch.status === "idle" || patch.status === "completed") setRunning(false);
      } else if (method === "v4/telemetry/event" && params?.kind === "turn.terminal") {
        setRunning(false);
        void refresh();
      }
    });
  }, [client]);

  useEffect(() => {
    // theme:{name,mode} from state.json (the v2 config.theme read — name and
    // mode are INDEPENDENT reads upstream, and a mode-only pin with no name
    // is a normal state); the legacy flat file is the pre-0.6.32 name
    // fallback. An unlocked mode holds the dark default — the
    // terminal-follow source has no plane here.
    const savedTheme = uiState.current.theme;
    if (savedTheme.name && THEME_NAMES.includes(savedTheme.name)) {
      setTheme(savedTheme.name);
    } else {
      try {
        const legacy = readFileSync(`${process.env.HOME}/.config/zcode-tui/theme`, "utf8").trim() as ThemeName;
        if (THEME_NAMES.includes(legacy)) setTheme(legacy);
      } catch { /* first run */ }
    }
    if (savedTheme.mode === "dark" || savedTheme.mode === "light") {
      setThemeLock(savedTheme.mode);
      setThemeMode(savedTheme.mode);
    }
    try {
      const saved = JSON.parse(readFileSync(`${process.env.HOME}/.config/zcode-tui/pinned.json`, "utf8")) as unknown;
      if (Array.isArray(saved)) setPinned(saved.filter((x): x is string => typeof x === "string"));
    } catch { /* first run */ }
    setHistory(recentInputs(process.cwd(), 50));
    void refresh();
    void loadModels();
    if (process.env.ZCODE_TUI_DISABLE_V4 !== "1") {
      client.request("v4/conversation/subscribe", {
        topic: `sessions-index/${process.cwd()}`,
        connectionId: `tui-${Math.random().toString(36).slice(2, 10)}`,
        clientMode: "desktop-continuous",
      }).catch(() => {});
    }
    const poll = setInterval(() => void refresh(), 20000);
    return () => clearInterval(poll);
  }, [client]);

  useEffect(() => {
    if (!resumeId || resumed.current) return;
    resumed.current = true;
    void open({ sessionId: resumeId, title: "Resuming session", status: "", updatedAt: Date.now() })
      .then(() => {
        if (!launchMode) return;
        void client.request("session/setMode", { sessionId: resumeId, mode: launchMode })
          .then(() => setMode(launchMode))
          .catch((e) => flashStatus(`setMode failed: ${errorMessage(e)}`));
      });
  }, [resumeId]);

  useEffect(() => {
    try {
      mkdirSync(`${process.env.HOME}/.config/zcode-tui`, { recursive: true });
      writeFileSync(`${process.env.HOME}/.config/zcode-tui/pinned.json`, JSON.stringify(pinned));
    } catch { /* best effort */ }
  }, [pinned]);

  // Paste pipeline — the OpenCode input logic. The renderer arms bracketed
  // paste (?2004h), so a bracketing terminal delivers the whole paste as one
  // PasteEvent; a terminal that does not bracket sends the same bytes as a
  // keystroke burst, which the printable branch coalesces. Both paths land in
  // ONE atomic insert at the immediate cursor with CRLF normalized at the
  // boundary — and the popups never see pasted content, because they are
  // driven only by the typed-key state machine.
  const insertAtCursor = (text: string) => {
    const sel = selectionRange();
    if (sel) {
      // v2 selection semantics: typed text REPLACES the selection.
      pushUndo();
      const next = draftRef.current.slice(0, sel[0]) + text + draftRef.current.slice(sel[1]);
      draftRef.current = next;
      setDraft(next);
      selAnchorRef.current = null;
      setSelAnchor(null);
      setCursorBoth(sel[0] + text.length);
      return;
    }
    const cur = cursorRef.current ?? draftRef.current.length;
    const next = draftRef.current.slice(0, cur) + text + draftRef.current.slice(cur);
    draftRef.current = next;
    setDraft(next);
    setCursorBoth(cur + text.length);
  };
  // v2 pasteAttachment: the label inserts at the cursor and the part
  // rides in prompt.files; the same uri+name reuses its label.
  const attachFile = (item: { uri: string; mime: string; bytes: Uint8Array; filename: string }) => {
    const kind = attachmentKind(item.mime);
    if (!kind) return;
    const current = promptFilesRef.current;
    const existing = current.find((f) => f.uri === item.uri && (f.name ?? null) === (item.filename ?? null) && draftRef.current.includes(f.label));
    const label = existing?.label ?? nextAttachmentLabel(current.map((f) => f.label), kind);
    insertAtCursor(`${label} `);
    promptFilesRef.current = [...current, { uri: item.uri, mime: item.mime, bytes: item.bytes, name: item.filename, label }];
    setPromptFiles(promptFilesRef.current);
  };
  // v2 openImagePreview: dialog.replace(DialogImagePreview) at the index.
  const openImagePreview = (index: number) => {
    const images = aliveFilesRef.current.filter((f) => f.uri.startsWith("data:image/"));
    if (images.length === 0) { flashStatus("no image attachments"); return; }
    setPreviewIdx(Math.max(0, Math.min(index, images.length - 1)));
    setDialog("imagepreview");
  };
  const pendingBuf = useRef("");
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const discardPending = () => {
    if (pendingTimer.current !== null) {
      clearTimeout(pendingTimer.current);
      pendingTimer.current = null;
    }
    pendingBuf.current = "";
  };
  const flushPending = () => {
    const chunk = pendingBuf.current;
    discardPending();
    if (chunk) insertAtCursor(chunk);
  };
  usePaste((event) => {
    const text = decodePasteBytes(event.bytes).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    if (!text) return;
    if (!typing) {
      // Pasting from a nav surface starts composing — and keeps pasted bytes
      // out of the nav verbs (a pasted "q" must not quit the TUI).
      draftRef.current = "";
      setDraft("");
      setCursorBoth(null);
      setTyping(true);
    }
    sugDismissed.current = false;
    moveSug(0);
    // v2 pasteInputText: a paste that IS an attachment path (image/pdf,
    // or a multi-path paste) becomes prompt parts — labels insert, not
    // the text. Typed-while-resolving falls back to the plain insert.
    const beforePaste = draftRef.current;
    void (async () => {
      const resolved = await resolvePastedAttachments(text).catch(() => undefined);
      if (!resolved || draftRef.current !== beforePaste) {
        insertAtCursor(text);
        return;
      }
      for (const item of resolved) {
        if (item.type === "text") insertAtCursor(item.content);
        else attachFile(item);
      }
    })();
  });

  useKeyboard((key) => {
    if (dialog !== null) return;

    if (askRef.current) {
      const resolve = askRef.current;
      // v2 SessionQuestion: ctrl+f is the fullscreen toggle (keybind
      // permission.prompt.fullscreen, ctrl+f default); with the ask expanded
      // escape MINIMIZES first — only a collapsed escape dismisses (the
      // deny+stop branch below, our interrupt law).
      if (key.ctrl && key.name === "f") { setAskExpanded((v) => !v); return; }
      if (askExpanded && key.name === "escape") { setAskExpanded(false); return; }
      // Every resolve path hands typing back to the composer — the banner
      // took it, and an unresolved typing gate eats all further input.
      if (key.name === "y") {
        askRef.current = null;
        setAsk(null);
        setTyping(true);
        resolve({ decision: "allow" });
        probe("permission-answered", "allow");
        flashStatus("permission allowed");
      } else if (key.name === "a") {
        askRef.current = null;
        setAsk(null);
        setTyping(true);
        const always = askOptionsRef.current.find((x) => /always|project|allow/i.test(x.id));
        resolve(always?.response ?? { decision: "allow" });
        probe("permission-answered", "always");
        flashStatus("permission allowed · always");
      } else if (key.name === "n" || key.name === "escape") {
        askRef.current = null;
        setAsk(null);
        setTyping(true);
        resolve({ decision: "deny" });
        probe("permission-answered", "deny");
        if (key.name === "escape") {
          // Esc on the permission card means INTERRUPT: deny this tool AND
          // stop the turn (a bare deny lets the model keep working — the
          // owner's "kept on working despite permission popup", 2026-09-17).
          // [n] stays the model-continues deny.
          void stopTurn();
          return;
        }
        flashStatus("permission denied");
      }
      return;
    }

    // The permission card's selection cursor: arrows move, enter executes,
    // y/a/n/escape answer directly (handled in the askRef block above).
    if (ask) {
      if (key.name === "up") { setAskSel((v) => Math.max(0, v - 1)); return; }
      if (key.name === "down") { setAskSel((v) => Math.min(2, v + 1)); return; }
      if (key.name === "return") {
        // TS flow-narrows askRef.current to null through the y/a/n block
        // above; the ref is the runtime truth, so read it past the narrow.
        const resolve = askRef.current as ((v: unknown) => void) | null;
        if (!resolve) return;
        askRef.current = null;
        setAsk(null);
        setTyping(true);
        if (askSel === 0) { resolve({ decision: "allow" }); probe("permission-answered", "allow"); flashStatus("permission allowed"); }
        else if (askSel === 1) {
          const always = askOptionsRef.current.find((x) => /always|project|allow/i.test(x.id));
          resolve(always?.response ?? { decision: "allow" });
          probe("permission-answered", "always");
          flashStatus("permission allowed · always");
        } else { resolve({ decision: "deny" }); probe("permission-answered", "deny"); flashStatus("permission denied"); }
        return;
      }
      return;
    }

    // The v2 diff viewer's keymap layer: while the diff route is up, its
    // grammar owns the keyboard (diff-binding precedence — ctrl+d scrolls
    // instead of quitting, escape/q close the route).
    if (view === "diff") {
      if (key.name === "escape" || key.name === "q") { closeDiff(); return; }
      const api = diffApiRef.current;
      if (!api) return;
      if (key.name === "j" || key.name === "down") { api.scrollLine(1); return; }
      if (key.name === "k" || key.name === "up") { api.scrollLine(-1); return; }
      if (key.name === "pagedown" || (key.ctrl && key.name === "f")) { api.scrollPage(1); return; }
      if (key.name === "pageup" || (key.ctrl && key.name === "b")) { api.scrollPage(-1); return; }
      if (key.ctrl && key.name === "d") { api.scrollHalfPage(1); return; }
      if (key.ctrl && key.name === "u") { api.scrollHalfPage(-1); return; }
      if (key.name === "home") { api.scrollToStart(); return; }
      if (key.name === "end") { api.scrollToEnd(); return; }
      if (key.name === "g" && ggArmedRef.current) { api.scrollToStart(); ggArmedRef.current = false; return; }
      ggArmedRef.current = key.name === "g";
      if (key.name === "G" || (key.name === "g" && (key as { shift?: boolean }).shift)) { api.scrollToEnd(); return; }
      if (key.name === "]") { api.jumpHunk(1); return; }
      if (key.name === "[") { api.jumpHunk(-1); return; }
      if (key.name === "n" || ((key as { meta?: boolean }).meta && key.name === "down")) { api.jumpFile(1); return; }
      if (key.name === "p" || ((key as { meta?: boolean }).meta && key.name === "up")) { api.jumpFile(-1); return; }
      if (key.name === "b") { api.toggleFileTree(); return; }
      if (key.name === "s") { api.toggleSinglePatch(); return; }
      if (key.name === "v") { api.toggleView(); return; }
      if (key.name === "m") { api.markReviewed(); return; }
      if (key.name === "d") { openDiffSource(); return; }
      if (key.sequence === "?" || key.name === "?") { setDialog("diffhelp"); return; }
      return;
    }

    // Leader chord (ctrl+x then a key), the OpenCode navigation grammar:
    // b sidebar · t themes · l sessions · n new · c compact · q quit.
    // The armed leader consumes the next key unconditionally — no timeout —
    // so a slow chord can never leak its second key into the composer draft.
    if (leaderArmed.current) {
      disarmLeader();
      if (key.name === "b") { if (view === "session") setSidebarOpen((s) => !s); return; }
      if (key.name === "a") { setDialog("mode"); return; }
      if (key.name === "m") { setDialog("model"); return; }
      // opencode editor_open: the draft goes to VISUAL||EDITOR and comes
      // back as the new draft (empty editor output = no change).
      if (key.name === "e") {
        void suspendForEditor(draftRef.current).then((text) => {
          if (text === null) { flashStatus(process.env.VISUAL || process.env.EDITOR ? "editor failed" : "no $EDITOR set", "warning"); return; }
          applyDraft(text, text.length);
          flashStatus("draft loaded from editor");
        });
        return;
      }
      // opencode session.export (v2.0.8): leader x opens the
      // DialogExportOptions flow (markdown + thinking/tools toggles, Copy or
      // tmp-file export and the DialogExportResult path dialog). v2 kept the
      // "to editor" description from v1 but the flow never touches an
      // editor — the v1 editor-export retires with this.
      if (key.name === "x" && view === "session") { setDialog("export"); return; }
      // opencode prompt.images.view (leader i): the DialogImagePreview
      // over the draft's image attachments.
      if (key.name === "i") { openImagePreview(0); return; }
      // opencode messages_copy: the last assistant message, via OSC 52.
      // opencode session_queued_prompts: manage the prompts queued behind a
      // running turn (enter removes the selected entry).
      if (key.name === "q" && queueRef.current.length > 0) { setDialog("queue"); return; }
      // opencode session_timeline: the user prompts of the session, fork at
      // any of them.
      if (key.name === "g") { openTimeline(); return; }
      if (key.name === "y" && view === "session") {
        const last = [...msgsRef.current].reverse().find((m) => m.role === "assistant" && m.text);
        if (!last) { flashStatus("nothing to copy yet"); return; }
        flashStatus(osc52Copy(last.text) ? `copied ${last.text.length} chars` : "copy failed (terminal)");
        return;
      }
      if (key.name === "t") { openThemes(); return; }
      if (key.name === "l") { openSessions(); return; }
      if (key.name === "n") { void newSession(); return; }
        if (key.name === "c") { void compactActive(); return; }
        if (key.name === "s") { setDialog("status"); return; }
        if (key.name === "w") { tabClose(); return; }
        if (/^[0-9]$/.test(key.name ?? "")) { quickSwitch(key.name === "0" ? 10 : Number(key.name)); return; }
        if (key.name === "q") { onQuit(); return; }
        return;
    }
    if (key.ctrl && key.name === "x") {
      armLeader();
      return;
    }
    if (key.ctrl && key.name === "p") {
      setTyping(false);
      setDialog("palette");
      return;
    }
    // opencode session_interrupt: escape stops the running turn, wherever
    // focus is. The composer's own escape semantics live in the typing branch.
    if (running && key.name === "escape" && view === "session") {
      void stopTurn();
      return;
    }
    // opencode v2 session.tab.reopen (ctrl+shift+t) + session.tab.history.
    // forward (ctrl+i) — bound BEFORE plain ctrl+t (variant cycle).
    if (key.ctrl && key.name === "t" && (key as { shift?: boolean }).shift) { tabReopen(); return; }
    if (key.ctrl && key.name === "i") { tabHistoryForward(); return; }
    // opencode variant_cycle: ctrl+t cycles the reasoning effort.
    if (key.ctrl && key.name === "t") {
      cycleEffort();
      return;
    }
    // opencode model_cycle_recent: f2 / shift+f2 walk the recent models.
    if (key.name === "f2") { cycleRecentModel(1); return; }
    if (key.name === "f2" && (key as { shift?: boolean }).shift) { cycleRecentModel(-1); return; }
    // opencode help_show: `?` opens the keybind help overlay.
    if (key.sequence === "?" || key.name === "?") { setDialog("help"); return; }
    // opencode v2 session.tab.next/previous: ctrl+tab walks the open tabs.
    if (key.ctrl && key.name === "tab") { tabCycle((key as { shift?: boolean }).shift ? -1 : 1); return; }
    // shift+tab cycles the mode — the OpenCode agent-cycle slot.
    if ((key.name === "tab" && (key as { shift?: boolean }).shift && !key.ctrl) || (key.sequence === "\x1b[Z" && !key.ctrl)) {
      void cycleMode();
      return;
    }
    if (key.ctrl && key.name === "s") {
      openSessions();
      return;
    }
    // ctrl+o: the deviation-queue-1 keyboard adapter, evolved for slice 2 —
    // one cycle over collapsed → groups open → groups+tool outputs open →
    // collapsed (upstream expands groups and tool rows by mouse only).
    if (key.ctrl && key.name === "o") {
      const stage = groupsOverrideRef.current === true ? (toolsExpandedRef.current ? 2 : 1) : 0;
      if (stage === 0) { setGroupsOverride(true); setToolsExpanded(false); }
      else if (stage === 1) { setGroupsOverride(true); setToolsExpanded(true); }
      else { setGroupsOverride(null); setToolsExpanded(false); }
      return;
    }
    // The OpenCode messages_* scroll grammar (pageup/pagedown, half-page,
    // line, first/last) — these keys can never be composer input, so they are
    // handled before the typing branch and work mid-draft.
    if (view === "session" && rowsRef.current.length > 0 && scrollRef.current) {
      // The reference messages_* scroll grammar. pageup/pagedown and these
      // extras can never be composer input, so they work mid-draft.
      const vp = ((scrollRef.current.viewport?.height as number | undefined) ?? 26) - 2;
      const pageScroll = (pages: number) => { scrollRef.current?.scrollBy?.({ y: pages * Math.max(3, vp) }); syncAtBottom(); };
      if (key.name === "pageup") { pageScroll(-1); return; }
      if (key.name === "pagedown") { pageScroll(1); return; }
      if (key.ctrl && (key as { meta?: boolean }).meta && key.name === "u") { pageScroll(-0.5); return; }
      if (key.ctrl && (key as { meta?: boolean }).meta && key.name === "d") { pageScroll(0.5); return; }
      if (key.ctrl && (key as { meta?: boolean }).meta && key.name === "y") { scrollRef.current?.scrollBy?.({ y: -2 }); syncAtBottom(); return; }
      if (key.ctrl && (key as { meta?: boolean }).meta && key.name === "e") { scrollRef.current?.scrollBy?.({ y: 2 }); syncAtBottom(); return; }
      if (key.ctrl && key.name === "g") { scrollRef.current?.scrollBy?.({ y: -99999 }); syncAtBottom(); return; }
      if (key.ctrl && (key as { meta?: boolean }).meta && key.name === "g") { jumpToLatest(); userJumpIdxRef.current = null; syncAtBottom(); return; }
      // opencode session.message.user.previous/next + messages_last_user.
      // v2.0.7 re-point: alt+up/down now walk session TABS (session.tab.
      // previous/next; shift = the unread walk). The user-message walk
      // keeps alt+end (messages_last_user); its prev/next are palette
      // commands upstream.
      if ((key as { meta?: boolean }).meta && (key as { shift?: boolean }).shift && key.name === "down") { tabCycle(1, true); return; }
      if ((key as { meta?: boolean }).meta && (key as { shift?: boolean }).shift && key.name === "up") { tabCycle(-1, true); return; }
      if ((key as { meta?: boolean }).meta && key.name === "down") { tabCycle(1); return; }
      if ((key as { meta?: boolean }).meta && key.name === "up") { tabCycle(-1); return; }
      if ((key as { meta?: boolean }).meta && key.name === "end") { userJump("last"); return; }
    }
    if (key.ctrl && key.name === "q" || key.ctrl && key.name === "d") {
      onQuit();
      return;
    }
    if (key.ctrl && key.name === "c") {
      if (typing) { draftRef.current = ""; setDraft(""); setCursorBoth(null); clearSelection(); discardPending(); return; }
      onQuit();
      return;
    }

    if (typing) {
// A parser that delivers a printable keystroke with only key.name set
      // (no sequence) must still compose — a single-char name is printable.
      // Everything else keeps the unicode sequence grammar.
      const printable = key.sequence && !key.ctrl && /^[^\x00-\x1f\x7f]+$/u.test(key.sequence)
        ? key.sequence
        : !key.ctrl && !key.meta && key.name && key.name.length === 1 && key.name >= " "
          ? key.name
          : undefined;
      // A burst mid-flight settles before any structural key touches the draft.
      if (!printable && pendingBuf.current) flushPending();
      // Slash autocomplete reads the immediate draft ref: while the draft is a
      // single "/token", up/down/tab/enter belong to the popup, not to
      // history or submission. A paste riding the raw burst path never opens
      // it — the token is withheld while a chunk is pending, and a flushed
      // pasted path does not command-match.
      const token = draftRef.current.startsWith("/") && !draftRef.current.includes(" ") && !pendingBuf.current
        ? draftRef.current.slice(1)
        : null;
      const sugMatches = token === null ? [] : matchSlashCommands(token);
      const sugOpenNow = sugMatches.length > 0 && !sugDismissed.current;
      if (key.name === "escape") {
        if (sugOpenNow) { sugDismissed.current = true; return; }
        if (running) { void stopTurn(); return; }
        // The reference escape clears nothing (input_clear is ctrl+c) and
        // never leaves the composer.
        return;
      }
      if (key.name === "backspace" || key.sequence === "\x7f" || key.sequence === "\b") {
        const selNow = selectionRange();
        if (selNow) {
          pushUndo();
          applyDraft(draftRef.current.slice(0, selNow[0]) + draftRef.current.slice(selNow[1]), selNow[0]);
          clearSelection();
          return;
        }
        const cur = cursorRef.current ?? draftRef.current.length;
        if (cur === 0) return;
        const next = draftRef.current.slice(0, cur - 1) + draftRef.current.slice(cur);
        draftRef.current = next;
        setDraft(next);
        setCursorBoth(cur - 1);
        sugDismissed.current = false;
        moveSug(0);
        return;
      }
      // @ trigger reads the immediate draft ref, same burst-safety rule as
      // the slash token above.
      const atIdx = draftRef.current.lastIndexOf("@");
      const atTokenNow = atIdx !== -1 && !draftRef.current.slice(atIdx + 1).includes(" ")
        ? draftRef.current.slice(atIdx + 1)
        : null;
      const fileMatchesNow = atTokenNow !== null ? cwdFileMatches(atTokenNow) : [];
      const atOpenNow = atTokenNow !== null && fileMatchesNow.length > 0 && !sugDismissed.current;
      if (sugOpenNow && (key.name === "up" || key.name === "down")) {
        const delta = key.name === "up" ? -1 : 1;
        const total = sugMatches.length || fileMatchesNow.length;
        moveSug(Math.max(0, Math.min(total - 1, sugIdxRef.current + delta)));
        return;
      }
      // opencode agent_cycle: tab cycles agents when the popup is not open
      // (with the popup up, tab completes).
      if (key.name === "tab" && !sugOpenNow) { void cycleMode(); return; }
      if (sugOpenNow && key.name === "tab") {
        if (sugMatches.length > 0) {
          const picked = `${sugMatches[sugIdxRef.current].name} `;
          const idx = draftRef.current.lastIndexOf("/");
          draftRef.current = `${draftRef.current.slice(0, idx + 1)}${picked}`;
        } else {
          const picked = `${fileMatchesNow[Math.min(sugIdxRef.current, fileMatchesNow.length - 1)]} `;
          draftRef.current = `${draftRef.current.slice(0, atIdx + 1)}${picked}`;
        }
        setDraft(draftRef.current);
        sugDismissed.current = false;
        moveSug(0);
        return;
      }
      // Newline insertion: shift+enter, alt+enter, ctrl+j — the reference
      // grammar. Plain enter still submits.
      if ((key.name === "return" && (key as { shift?: boolean }).shift)
        || (key.name === "return" && (key as { meta?: boolean }).meta)
        || (key.ctrl && key.name === "j")) {
        clearSelection();
        pushUndo();
        const cur = cursorRef.current ?? draftRef.current.length;
        const next = `${draftRef.current.slice(0, cur)}\n${draftRef.current.slice(cur)}`;
        draftRef.current = next;
        setDraft(next);
        setCursorBoth(cur + 1);
        return;
      }
      const multilineNow = draftRef.current.includes("\n");
      // ---- input.select.* (v2): shift extends the selection from the
      // anchor; the plain motions below collapse it (moveCursor clears).
      const shiftK = (key as { shift?: boolean }).shift;
      const metaK = (key as { meta?: boolean }).meta;
      const superK = (key as { super?: boolean }).super;
      const curK = cursorRef.current ?? draftRef.current.length;
      const textK = draftRef.current;
      if (superK && key.name === "a") {
        selAnchorRef.current = 0;
        setSelAnchor(0);
        setCursorBoth(textK.length);
        return;
      }
      if (shiftK && !key.ctrl && key.name === "left") { moveSelect(curK - 1); return; }
      if (shiftK && !key.ctrl && key.name === "right") { moveSelect(curK + 1); return; }
      if (shiftK && !key.ctrl && !metaK && (key.name === "up" || key.name === "down")) {
        moveSelect(visualMove(key.name === "up" ? -1 : 1));
        return;
      }
      if (key.ctrl && shiftK && key.name === "a") { moveSelect(lineStart(textK, curK)); return; }
      if (key.ctrl && shiftK && key.name === "e") { moveSelect(lineEnd(textK, curK)); return; }
      if (metaK && shiftK && key.name === "a") { moveSelect(visualMove("home")); return; }
      if (metaK && shiftK && key.name === "e") { moveSelect(visualMove("end")); return; }
      if (shiftK && key.name === "home") { moveSelect(0); return; }
      if (shiftK && key.name === "end") { moveSelect(textK.length); return; }
      if (metaK && shiftK && (key.name === "f" || key.name === "right")) { moveSelect(wordForward(textK, curK)); return; }
      if (metaK && shiftK && (key.name === "b" || key.name === "left")) { moveSelect(wordBackward(textK, curK)); return; }
      if (key.name === "left") { clearSelection(); moveCursor(-1); return; }
      if (key.name === "right") { clearSelection(); moveCursor(1); return; }
      if (key.name === "home") { clearSelection(); setCursorBoth(0); return; }
      if (key.name === "end") { clearSelection(); setCursorBoth(draftRef.current.length); return; }
      // ---- the OpenCode input_* editing grammar ----
      const meta = (key as { meta?: boolean }).meta;
      const cur0 = cursorRef.current ?? draftRef.current.length;
      const text0 = draftRef.current;
      if (key.name === "left" && key.ctrl) { setCursorBoth(wordBackward(text0, cur0)); return; }
      if (key.name === "right" && key.ctrl) { setCursorBoth(wordForward(text0, cur0)); return; }
      if (meta && (key.name === "left" || key.name === "b")) { clearSelection(); setCursorBoth(wordBackward(text0, cur0)); return; }
      if (meta && (key.name === "right" || key.name === "f")) { clearSelection(); setCursorBoth(wordForward(text0, cur0)); return; }
      if (key.ctrl && (key.name === "b")) { moveCursor(-1); return; }
      if (key.ctrl && (key.name === "f") && !sugOpenNow) { moveCursor(1); return; }
      if (key.ctrl && key.name === "a") { clearSelection(); setCursorBoth(lineStart(text0, cur0)); return; }
      if (key.ctrl && key.name === "e") { clearSelection(); setCursorBoth(lineEnd(text0, cur0)); return; }
      // Deletes push an undo snapshot first.
      if (key.ctrl && key.name === "k") { pushUndo(); applyDraft(text0.slice(0, cur0), cur0); return; }
      if (key.ctrl && key.name === "u") { pushUndo(); const ls = lineStart(text0, cur0); applyDraft(text0.slice(0, ls) + text0.slice(cur0), ls); return; }
      if ((meta && key.name === "d") || (key.ctrl && key.name === "delete")) { pushUndo(); const wf = wordForward(text0, cur0); applyDraft(text0.slice(0, cur0) + text0.slice(wf), cur0); return; }
      if (key.ctrl && key.name === "w" || meta && key.name === "backspace" || key.ctrl && key.name === "backspace") {
        pushUndo();
        const wb = wordBackward(text0, cur0);
        applyDraft(text0.slice(0, wb) + text0.slice(cur0), wb);
        return;
      }
      if (key.ctrl && (key.name === "-" || key.sequence === "\x1f")) {
        const prev = undoStack.current.pop();
        if (prev !== undefined) { redoStack.current.push(text0); applyDraft(prev, prev.length); }
        return;
      }
      if (key.ctrl && (key.name === "." || key.sequence === "\x1e")) {
        const next = redoStack.current.pop();
        if (next !== undefined) { undoStack.current.push(text0); applyDraft(next, next.length); }
        return;
      }
      if (key.name === "down" && !key.ctrl && !key.meta && !key.shift && !draftRef.current && subagentTabsRef.current.length > 0) {
        // session.child.first (v2 keybind "down", Toggle subagent picker):
        // fires only where the history walk below is a no-op — an empty
        // single-line draft — and only when subagent tabs exist.
        setPickerFilter("active");
        setDialog("subagents");
        return;
      }
      if (key.name === "up" || key.name === "down") {
        // Multiline drafts move the cursor across lines; single-line drafts
        // walk the prompt history.
        if (multilineNow) {
          clearSelection();
          const cur = cursorRef.current ?? draftRef.current.length;
          const starts = [0, ...[...draftRef.current].reduce<number[]>((acc, ch, i) => ch === "\n" ? [...acc, i + 1] : acc, [])];
          const lineIdx = starts.reduce((acc, start, i) => cur >= start ? i : acc, 0);
          const col = cur - starts[lineIdx];
          const target = key.name === "up" ? lineIdx - 1 : lineIdx + 1;
          if (target < 0 || target >= starts.length) return;
          const lineEnd = target + 1 < starts.length ? starts[target + 1] - 1 : draftRef.current.length;
          setCursorBoth(Math.min(starts[target] + col, lineEnd));
          return;
        }
        if (history.length === 0) return;
        clearSelection();
        const next = key.name === "up"
          ? Math.min(historyIdx.current + 1, history.length - 1)
          : Math.max(historyIdx.current - 1, -1);
        historyIdx.current = next;
        const restored = next >= 0 ? history[next] : "";
        draftRef.current = restored;
        setDraft(restored);
        setCursorBoth(null);
        discardPending();
        return;
      }
      if (key.name === "return") {
        clearSelection();
        // A PTY can deliver a fast text burst and the Enter stroke before
        // React has committed the previous setState. The ref is the immediate
        // keyboard truth; it keeps `/sessions\r` equivalent to two human
        // keystrokes while the rendered draft remains state-controlled.
        if (sugOpenNow && sugMatches.length > 0) {
          const content = `/${sugMatches[Math.min(sugIdxRef.current, sugMatches.length - 1)].name}`;
          draftRef.current = "";
          setDraft("");
          sugDismissed.current = false;
          moveSug(0);
          if (!running) void submitPrompt(content);
          return;
        }
        if (sugOpenNow && fileMatchesNow.length > 0) {
          const picked = fileMatchesNow[Math.min(sugIdxRef.current, fileMatchesNow.length - 1)];
          const base = draftRef.current.slice(0, draftRef.current.lastIndexOf("@") + 1);
          draftRef.current = `${base}${picked} `;
          setDraft(draftRef.current);
          sugDismissed.current = true;
          return;
        }
        const content = draftRef.current.trim();
        if (!content) return;
        if (running) {
          // Never drop or mangle a prompt typed mid-turn: queue it visibly.
          const next = [...queueRef.current, content];
          queueRef.current = next;
          setQueue(next);
          draftRef.current = "";
          setDraft("");
          flashStatus("queued · sends when the turn finishes");
          return;
        }
        void submitPrompt(content);
        return;
      }
      // Any printable non-control sequence composes the draft — unicode
      // included. The old ASCII-only filter silently dropped non-Latin input
      // (the "mid-turn truncation" suspect), which is a correctness bug for
      // every language that is not English.
      //
      // Bursts (a non-bracketing terminal's paste, key repeat) coalesce into
      // ONE atomic insert on the next tick: order and offsets live in the
      // refs, so React commit timing can no longer scramble the draft.
      if (printable) {
        pendingBuf.current += printable;
        if (pendingTimer.current === null) {
          pendingTimer.current = setTimeout(flushPending, 8);
        }
        sugDismissed.current = false;
        moveSug(0);
      }
      return;
    }

    if (key.name === "escape") {
      // Our home nav surface is an extension; escape there returns to the
      // composer. The reference never quits on escape.
      setTyping(true);
    } else if (key.name === "q") onQuit();
    else if (key.name === "i") { setTyping(true); setDraft(""); }
    else if (key.name === "s") openSessions();
    else if (key.name === "a") void newSession();
    else if (key.name === "m") setDialog("model");
    else if (key.name === "t") openThemes();
    else if (key.name === "o") void cycleMode();
    else if (key.name === "e") setDialog("effort");
    else if (key.name === "f") void forkActive();
    else if (key.name === "b") {
      if (view === "session") setSidebarOpen((s) => !s);
    }
    else if (key.name === "c") void compactActive();
    else if (key.name === "r") {
      if (lost) {
        setStatus("reconnecting backend…");
        client.respawn();
        setLost(false);
      }
      void refresh();
    } else if (key.name === "[") {
      scrollRef.current?.scrollBy?.({ y: -10 });
      syncAtBottom();
    } else if (key.name === "]") {
      scrollRef.current?.scrollBy?.({ y: 10 });
      syncAtBottom();
    } else if (key.name === "return" && view === "home") setTyping(true);
  });

  // Session rows follow the reference picker (dialog-session-list.tsx):
  // pinned sessions lead in their own Pinned category, the rest group under
  // date headings; the title is the row — no "idle · mode · age" clutter.
  // The list paints through the footer-menu grammar (0.6.49): the gutter
  // column becomes the menu icon cell (busy spinner, else the session's
  // OPEN-TAB slot — leader N opens tab N, v2.0.7 session.tab.select), and
  // the CURRENT session marks itself with the menu's footer cell ("current"
  // in the selection tone, suppressed while the row is selected — the
  // reference agent-panel pattern). The armed delete keeps its destructive
  // background and confirm label (v2 dialog-session-list bg — the one field
  // the menu grammar gains).
  const tabSlotOf = (sessionId: string) => {
    const at = tabsRef.current.findIndex((t) => t.sessionID === sessionId);
    return at >= 0 && at < 9 ? String(at + 1) : undefined;
  };
  const sessionRowOption = (row: SessionRow, group: string): DialogOption<SessionRow> => {
    const busy = /run|busy|work/i.test(row.status);
    const slot = tabSlotOf(row.sessionId);
    const current = row.sessionId === activeId;
    return {
      id: row.sessionId,
      label: deleteId === row.sessionId ? "Press ctrl+d again to confirm" : displayTitle(row),
      group,
      icon: busy
        ? (color) => <text content="⠋" fg={color} />
        : slot
          ? (color) => <text content={slot} fg={color} />
          : undefined,
      footer: current ? "current" : undefined,
      footerTone: current ? "selection" : undefined,
      bg: deleteId === row.sessionId ? C.error : undefined,
      value: row,
    };
  };
  const pinnedSet = new Set(pinned);
  const sessionOptions: DialogOption<SessionRow>[] = [
    ...orderedSessions.filter((row) => pinnedSet.has(row.sessionId)).map((row) => sessionRowOption(row, "Pinned")),
    ...orderedSessions
      .filter((row) => !pinnedSet.has(row.sessionId))
      .map((row) => sessionRowOption(row, formatDateHeading(row.updatedAt))),
  ];

  if (dialog === "diffsource") {
    return (
      <SelectDialog
        title="Diff source"
        theme={C}
        options={[
          { id: "branch", label: diffSourceLabel("branch"), description: "Branch + local changes", value: "branch" },
          { id: "committed", label: diffSourceLabel("committed"), description: "Branch commits only", value: "committed" },
          { id: "working", label: diffSourceLabel("working"), description: "Local changes only", value: "working" },
          { id: "base", label: "Base", description: diffBase ?? "Choose…", value: "base" },
        ]}
        currentId={diffMode}
        onSelect={(value) => {
          if (value === "base") { openDiffBasePicker(); return; }
          setDiffMode(value as DiffMode);
          closeDialog();
        }}
        onClose={closeDialog}
      />
    );
  }
  if (dialog === "diffbase") {
    return (
      <SelectDialog
        title="Base branch"
        size="large"
        theme={C}
        options={diffBranches.map((name) => ({ id: name, label: name, value: name }))}
        currentId={diffBase ?? undefined}
        onSelect={(name) => { setDiffBase(name); closeDialog(); }}
        onClose={closeDialog}
      />
    );
  }
  if (dialog === "diffhelp") {
    return <DiffHelpDialog C={C} width={dims.width} height={dims.height} onClose={closeDialog} />;
  }
  if (view === "diff" && dialog === null) {
    return (
      <DiffViewer
        C={C}
        D={diffFor(theme, themeMode)}
        syntaxStyle={mdStyle}
        cwd={process.cwd()}
        mode={diffMode}
        base={diffBase}
        preferences={uiState.current.diff}
        onPreferencesChange={persistDiffPrefs}
        onSwitchSourceDialog={openDiffSource}
        onHelpDialog={() => { setDialog("diffhelp"); setTyping(false); }}
        apiRef={(api) => { diffApiRef.current = api; }}
      />
    );
  }
  if (dialog === "sessions") {
    return (
      <SelectDialog
        title="Sessions"
        size="large"
        menu
        options={sessionOptions}
        currentId={activeId ?? undefined}
        theme={C}
        footerHints={[
          { key: "enter", label: "open" },
          { key: "ctrl+f", label: "pin" },
          { key: "ctrl+d", label: "delete" },
          { key: "ctrl+r", label: "rename" },
          // v2 renders the quick-switch hint only when slots exist
          // (quickSwitchFooterHints — no slots, no hint).
          ...(tabsRef.current.length > 0 ? [{ key: "ctrl+1-9", label: "switch" }] : []),
          { key: "esc", label: "close" },
        ]}
        onMove={() => setDeleteId(null)}
        emptyLabel="No sessions available"
        onAction={(action, option) => {
          if (!option) return;
          if (action === "pin") togglePin(option.value);
          else if (action === "delete") void closeSession(option.value);
          else if (action === "all") flashStatus("all projects · showing every available session");
          else if (action === "rename") {
            setRenameTarget(option.value);
            setDialog("rename");
          }
        }}
        onSelect={(row) => { closeDialog(); void open(row); }}
        onClose={closeDialog}
      />
    );
  }
  if (dialog === "subagents") {
    // RunSubagentSelectBody (0.6.52): the searchable subagent picker; tab
    // toggles running vs ended (the reference active/inactive signal).
    const visible = pickerTabs(subagentTabs, pickerFilter);
    return (
      <SelectDialog
        title="Select subagent"
        size="large"
        menu
        theme={C}
        options={visible.map((t) => ({
          id: t.sessionID,
          label: t.description || t.title || t.label,
          description: t.subagentType,
          footer: subagentStatusLabel(t.status),
          footerTone: t.status === "running" || t.status === "error" ? t.status : t.status === "completed" ? ("success" as const) : undefined,
          icon: () => (
            <text content={subagentStatusIcon(t.status)} fg={subagentStatusColor(C, t.status)} />
          ),
          value: t.sessionID,
        }))}
        currentId={inspectId ?? undefined}
        footerHints={[
          { key: "tab", label: pickerFilter === "active" ? "show inactive" : "show active" },
          { key: "enter", label: "inspect" },
          { key: "esc", label: "close" },
        ]}
        emptyLabel="No subagents found"
        onExtraKey={(key) => {
          if (key.name === "tab" && !key.ctrl && !key.meta) {
            setPickerFilter((f) => (f === "active" ? "inactive" : "active"));
            return true;
          }
          return false;
        }}
        onSelect={(sessionId) => { setInspectId(sessionId); closeDialog(); }}
        onClose={closeDialog}
      />
    );
  }
  if (dialog === "model") {
    // Reference model dialog (0.6.53, component/dialog-model.tsx): the
    // Favorites / Recent / provider-group sections through the menu grammar,
    // groups collapsing to a flat list while filtering (their flatten).
    const modelOpts = modelDialogOptions(
      models.map((m) => ({ ...m, label: modelLabel(m) })),
      uiState.current.favorite,
      uiState.current.recent,
    );
    return (
      <SelectDialog
        title="Select model"
        size="large"
        menu
        options={modelOpts}
        footerHints={[
          { key: "enter", label: "select" },
          { key: "ctrl+f", label: "favorite" },
          { key: "esc", label: "close" },
        ]}
        currentId={activeModel ? `${activeModel.providerId}/${activeModel.modelId}` : undefined}
        theme={C}
        countLabel="model"
        onAction={(action, option) => {
          if (action === "pin" && option) toggleFavoriteModel(option.value);
        }}
        onSelect={(choice) => {
          const index = models.findIndex((m) => m.modelId === choice.modelId);
          setModelIdx(Math.max(0, index));
          rememberModel(choice);
          closeDialog();
          if (!activeId) { flashStatus(`model → ${modelLabel(choice)}`); return; }
          void client.request("session/setModel", { sessionId: activeId, model: { providerId: choice.providerId, modelId: choice.modelId } })
            .then(() => flashStatus(`model → ${modelLabel(choice)}`))
            .catch((e) => flashStatus(`setModel failed: ${errorMessage(e)}`));
        }}
        onClose={closeDialog}
      />
    );
  }
  if (dialog === "mode") {
    // Reference dialog-agent.tsx (v2.0.16): a flat dialog titled "Select
    // agent" whose rows render the agent id verbatim with its description,
    // the current agent marked. Ours rides the same surface over the zcode
    // protocol permission modes (the agents<->modes mapping is
    // protocol-bound); the descriptions are our data-slot stand-in for
    // agent.description. Painted through the menu grammar like the
    // sessions (0.6.49) and models (0.6.54) migrations.
    return (
      <SelectDialog
        title="Select agent"
        menu
        options={MODES.map((m) => ({ id: m, label: m, description: m === "auto" ? "ride the default agent (Build)" : m === "yolo" ? "no permission prompts" : "agent mode", value: m }))}
        currentId={mode}
        theme={C}
        countLabel="mode"
        footerHints={[
          { key: "enter", label: "select" },
          { key: "esc", label: "close" },
        ]}
        onSelect={(m) => {
          closeDialog();
          if (!activeId) { setMode(m); flashStatus(`mode → ${m}`); return; }
          void client.request("session/setMode", { sessionId: activeId, mode: m })
            .then(() => { setMode(m); flashStatus(`mode → ${m}`); })
            .catch((e) => flashStatus(`setMode failed: ${errorMessage(e)}`));
        }}
        onClose={closeDialog}
      />
    );
  }
  if (dialog === "effort") {
    return (
      <SelectDialog
        title="Reasoning effort"
        options={EFFORTS.map((e) => ({
          id: e,
          label: e.charAt(0).toUpperCase() + e.slice(1),
          description: e === "low" ? "fastest · minimal reasoning" : e === "high" ? "balanced depth" : "deepest reasoning · slowest",
          value: e,
        }))}
        currentId={effort}
        theme={C}
        countLabel="effort"
footerHints={[
          { key: "enter", label: "select" },
          { key: "esc", label: "close" },
        ]}
        onSelect={(e) => { closeDialog(); applyEffort(e); }}
        onClose={closeDialog}
      />
    );
  }
  if (dialog === "themes") {
    // Reference dialog-theme-list: bare rows, the ● marks the ORIGIN theme
    // while you arrow around, every highlighted row repaints the TUI live
    // (onMove/onFilter), esc restores the origin, enter persists.
    const initialTheme = themesOriginRef.current ?? theme;
    return (
      <SelectDialog
        title="Themes"
        size="large"
        options={sortedThemes().map((name) => ({ id: name, label: name, value: name }))}
        currentId={initialTheme}
        theme={C}
        countLabel="theme"
        onHighlight={(opt) => { const n = opt?.id as ThemeName | undefined; if (n) setTheme(n); }}
        footerHints={[
          { key: "enter", label: "select" },
          { key: "esc", label: "close" },
        ]}
        onSelect={(name) => { themesOriginRef.current = null; persistTheme(name as ThemeName); closeDialog(); flashStatus(`theme → ${name}`); }}
        onClose={() => { setTheme(initialTheme); themesOriginRef.current = null; closeDialog(); }}
      />
    );
  }
  if (dialog === "fork") {
    return (
      <SelectDialog
        title={timelineMode ? "Timeline" : "Fork session"}
        options={forkOptions}
        theme={C}
        currentId={timelineMode ? (actionMessageId ?? undefined) : undefined}
        footerHints={[
          { key: "enter", label: "select" },
          { key: "esc", label: "close" },
        ]}
        countLabel="message"
        onHighlight={(option) => { if (option) previewMessage(String(option.value)); }}
        onSelect={(messageId) => {
          if (timelineMode) { setActionMessageId(String(messageId)); setDialog("msgactions"); return; }
          closeDialog();
          void forkSessionAt(messageId || undefined);
        }}
        onClose={() => { setTimelineMode(false); setActionMessageId(null); closeDialog(); }}
      />
    );
  }
  if (dialog === "msgactions") {
    // v2 DialogMessage ("Message Actions") opened from the timeline's enter:
    // Jump to / Revert / Copy / Fork. Revert needs the session/revert host
    // verb (filed blocked-on-host) — its row is omitted here, like the mcp
    // connect/disconnect gap.
    const text = messageTextById(actionMessageId);
    return (
      <SelectDialog
        title="Message Actions"
        theme={C}
        options={[
          { id: "jump", label: "Jump to", description: "view message in session", value: "jump" },
          { id: "copy", label: "Copy", description: "message text to clipboard", value: "copy" },
          { id: "fork", label: "Fork", description: "create a new session", value: "fork" },
        ]}
        footerHints={[
          { key: "enter", label: "select" },
          { key: "esc", label: "back" },
        ]}
        onSelect={(action) => {
          if (action === "jump") { setTimelineMode(false); setActionMessageId(null); closeDialog(); if (actionMessageId) previewMessage(actionMessageId); return; }
          if (action === "copy") {
            setTimelineMode(false); setActionMessageId(null); closeDialog();
            flashStatus(osc52Copy(text) ? `copied ${text.length} chars` : "copy failed (terminal)");
            return;
          }
          if (action === "fork") { setTimelineMode(false); const mid = actionMessageId; setActionMessageId(null); closeDialog(); void forkSessionAt(mid ?? undefined); return; }
        }}
        onClose={() => { setDialog("fork"); }}
      />
    );
  }
  if (dialog === "rename" && renameTarget) {
    return (
      <TextPromptDialog
        title={`Rename ${displayTitle(renameTarget)}`}
        initialValue={displayTitle(renameTarget)}
        placeholder="session title"
        theme={C}
        onSubmit={(value) => {
          // The standalone protocol has no rename method yet. Keep this
          // honest instead of pretending a local title survived a refresh.
          closeDialog();
          flashStatus(`rename pending host support · ${value}`);
        }}
        onClose={closeDialog}
      />
    );
  }


// The keybind help overlay (opencode help_show): a flat panel of the
// implemented grammar. Owns its keyboard — escape/enter close — because the
// App-level hook goes silent while a dialog is open.
// Ported from opencode v2.0.7 component/dialog-status.tsx: leader s — the
// status view. Title row "Status" + the subdued esc hint (v2 verbatim; esc
// only — enter does nothing in the reference dialog), then the MCP server
// list on the same mcp/list payload the /mcps dialog reads: the "No MCP
// servers" empty state, the "{n} MCP server(s)" header, rows
// "• <name> <status>" with v2's status→colour map. v2 prints the payload's
// error text on failed/needs_auth rows — the zcode protocol carries no
// error text (host gap recorded 0.6.23), so the suffix renders only when a
// payload ever provides one.
type UsageDialogState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; quota: PlanQuotaSnapshot | null; quotaError: string | null; stats: UsageStatsSummary | null };

// The plan-quota Usage section (owner directive 2026-09-20; fork (b) —
// the TUI reads the desktop monitor endpoints with the synced coding-plan
// key, live-probed; see docs/parity-v2.md 0.6.46). Module top-level per
// the remount hazard law; state lives in App, this stays props-only.
function UsageSection({ C, state }: { C: ThemeTokens; state: UsageDialogState }) {
  if (state.kind !== "ready") {
    return (
      <box style={{ flexDirection: "column", flexShrink: 0 }}>
        <text content="PLAN QUOTA" fg={C.faint} />
        <text content={state.kind === "loading" ? "Reading usage ..." : "Usage unavailable"} fg={C.subtle} />
      </box>
    );
  }
  const now = Date.now();
  const pctColor = (pct: number) => (pct >= 85 ? C.error : pct >= 60 ? C.warning : C.success);
  const limits = state.quota?.limits ?? [];
  return (
    <box style={{ flexDirection: "column", flexShrink: 0 }}>
      <text content="PLAN QUOTA" fg={C.faint} />
      {state.quota?.planName ? (
        <box style={{ height: 1, flexDirection: "row", flexShrink: 0 }}>
          <text content={state.quota.planName} fg={C.fg} attributes={TextAttributes.BOLD} />
          <text content={(state.quota.level ? " · " + state.quota.level : "") + (state.quota.planRenews ? " · renews " + state.quota.planRenews : "")} fg={C.subtle} />
        </box>
      ) : null}
      {limits.map((limit, i) => (
        <box key={limit.label + String(i)} style={{ height: 1, flexDirection: "row", flexShrink: 0 }}>
          <text content={(limit.label + " ").padEnd(9)} fg={C.fg} />
          <text content={quotaBar(limit.percentage)} fg={pctColor(limit.percentage)} />
          <text content={" " + String(limit.percentage).padStart(3) + "%  " + formatCompact(limit.used) + "/" + formatCompact(limit.total) + (limit.nextResetMs !== null ? " · resets " + formatReset(limit.nextResetMs, now) : "")} fg={C.subtle} />
        </box>
      ))}
      {state.quota === null ? (
        <text content={"Plan quota unavailable: " + (state.quotaError ?? "unknown")} fg={C.faint} />
      ) : null}
      {state.stats ? (
        <text content={"Usage 7d  " + formatCompact(state.stats.totalTokens) + " tok · " + formatCompact(state.stats.totalSessions) + " sessions · " + formatCompact(state.stats.totalTurns) + " turns · " + String(state.stats.activeDays) + " active day" + (state.stats.activeDays === 1 ? "" : "s")} fg={C.subtle} />
      ) : null}
    </box>
  );
}

function StatusDialog({ C, onClose, mcpState, usageState, width, height }: { C: ThemeTokens; onClose: () => void; mcpState: McpDialogState; usageState: UsageDialogState; width: number; height: number }) {
  useKeyboard((key) => {
    if (key.name === "escape" || (key.ctrl && key.name === "c")) { onClose(); return; }
  });
  const statusColor = (status: string) =>
    status === "connected" ? C.success
    : status === "failed" ? C.error
    : status === "needs_auth" ? C.warning
    : C.subtle;
  const statusText = (server: { status: string; error?: string }) => {
    if (server.status === "connected") return "Connected";
    if (server.status === "failed") return server.error ? `Failed: ${server.error}` : "Failed";
    if (server.status === "disabled") return "Disabled in configuration";
    if (server.status === "needs_auth") return server.error ? `Needs authentication: ${server.error}` : "Needs authentication";
    return server.status;
  };
  const servers = mcpState.kind === "ready" ? mcpState.servers : null;
  return (
    <ModalBackdrop C={C} width={width} height={height}>
      <box
        style={{
          width: Math.min(72, Math.max(30, width - 4)),
          flexDirection: "column",
          flexShrink: 0,
          backgroundColor: C.panel,
          paddingTop: 1,
          paddingBottom: 1,
          paddingLeft: 2,
          paddingRight: 2,
        }}
      >
        <box style={{ height: 1, flexDirection: "row", justifyContent: "space-between", flexShrink: 0 }}>
          <text content="Status" fg={C.fg} attributes={TextAttributes.BOLD} />
          <text content="esc" fg={C.faint} />
        </box>
        <box style={{ height: 1, flexShrink: 0 }} />
        <UsageSection C={C} state={usageState} />
        <box style={{ height: 1, flexShrink: 0 }} />
        {servers === null ? (
          <text content="Connecting …" fg={C.subtle} />
        ) : servers.length === 0 ? (
          <text content="No MCP servers" fg={C.fg} />
        ) : (
          <box style={{ flexDirection: "column", flexShrink: 0 }}>
            <text content={`${servers.length} MCP server${servers.length === 1 ? "" : "s"}`} fg={C.fg} />
            {servers.map((server) => (
              <box key={server.name} style={{ height: 1, flexDirection: "row", flexShrink: 0 }}>
                <text content="• " fg={statusColor(server.status)} />
                <text content={server.name} fg={C.fg} attributes={TextAttributes.BOLD} />
                <text content={" " + statusText(server)} fg={C.subtle} />
              </box>
            ))}
          </box>
        )}
      </box>
    </ModalBackdrop>
  );
}

function HelpDialog({ C, onClose, width, height }: { C: ThemeTokens; onClose: () => void; width: number; height: number }) {
  useKeyboard((key) => {
    if (key.name === "escape" || key.name === "return" || (key.ctrl && key.name === "c")) { onClose(); return; }
  });
  const rows: [string, string][] = [
    ["ctrl+x then b / t / l / n / c / s / q", "sidebar · themes · sessions · new · compact · status · quit"],
    ["ctrl+x then a / m / e / x / y", "agents · model · effort · export · copy last message"],
    ["ctrl+x then 1-9 / e", "quick-switch session · external editor"],
    ["ctrl+x then q (turn running)", "queued prompts manager"],
    ["ctrl+p", "command palette"],
    ["escape (turn running)", "interrupt the turn"],
    ["tab / shift+tab", "cycle agent mode"],
    ["ctrl+t / f2 / shift+f2", "cycle effort · cycle recent models"],
    ["ctrl+f (model dialog)", "toggle favorite"],
    ["ctrl+a / ctrl+e / ctrl+k / ctrl+u", "line home / line end / delete to line end / to line start"],
    ["alt+b / alt+f / ctrl+arrows", "word backward / forward"],
    ["ctrl+w / alt+d", "delete word backward / forward"],
    ["ctrl+- / ctrl+.", "input undo / redo"],
    ["ctrl+c", "clear the draft"],
    ["pageup / pagedown / ctrl+alt+u,d,y,e", "scroll transcript"],
    ["ctrl+g / ctrl+alt+g", "first message / jump to latest"],
    ["alt+up / alt+down / alt+end", "previous / next / last user message"],
    ["ctrl+o", "expand / collapse tool output"],
    ["alt+up/down · ctrl+tab", "previous / next session tab (shift = unread)"],
    ["ctrl+x then w / ctrl+shift+t", "close tab · reopen closed tab"],
    ["ctrl+x then 1-9 / 0", "select session tab"],
    ["/skills · /mcps · /status", "insert a skill · MCP server dialogs"],
    ["ctrl+p → stash", "stash · pop · list the draft"],
    ["ctrl+p → toggles", "animations · file context · diff wrapping"],
    ["ctrl+p → messages", "next / previous (user) message jump"],
    ["shift+arrows · alt+shift+b/f", "select text · typing replaces it"],
    ["/settings · ←/→", "settings dialog · change a value"],
  ];
  return (
    <ModalBackdrop C={C} width={width} height={height}>
      <box
        style={{
          width: Math.min(96, Math.max(30, width - 4)),
          flexDirection: "column",
          flexShrink: 0,
          backgroundColor: C.panel,
          paddingTop: 1,
          paddingBottom: 1,
          paddingLeft: 2,
          paddingRight: 2,
        }}
      >
        <box style={{ height: 1, flexDirection: "row", justifyContent: "space-between", flexShrink: 0 }}>
          <text content="Help — keybinds" fg={C.fg} attributes={TextAttributes.BOLD} />
          <text content="esc / enter" fg={C.faint} />
        </box>
        <box style={{ height: 1, flexShrink: 0 }} />
        {rows.map(([k, d]) => (
          <box key={k} style={{ height: 1, flexDirection: "row", flexShrink: 0 }}>
            <text content={k} fg={C.accent} />
            <text content={"  " + d} fg={C.subtle} />
          </box>
        ))}
        <box style={{ height: 1, flexShrink: 0 }} />
        <text content="enter / esc close · ctrl+p lists every command" fg={C.faint} />
      </box>
    </ModalBackdrop>
  );
}

// The diff viewer's shortcut overlay — port of v2 DiffViewerHelpDialog
// (medium panel, Review / Scroll / View groups, shortcut column 17). The
// right-click file-menu row is omitted: this binding has no mouse plane.
function DiffHelpDialog({ C, onClose, width, height }: { C: ThemeTokens; onClose: () => void; width: number; height: number }) {
  useKeyboard((key) => {
    if (key.name === "escape" || key.name === "return" || (key.ctrl && key.name === "c")) { onClose(); return; }
  });
  const groups: { title: string; rows: [string, string][] }[] = [
    {
      title: "Review",
      rows: [
        ["n / alt+down", "Next file"],
        ["p / alt+up", "Previous file"],
        ["m", "Review + collapse / reopen"],
        ["] / [", "Next / previous change"],
      ],
    },
    {
      title: "Scroll",
      rows: [
        ["j / k / arrows", "Down / up"],
        ["ctrl+d / ctrl+u", "Half page down / up"],
        ["pagedown / pageup", "Page down / up"],
        ["gg / shift+g", "First / last"],
      ],
    },
    {
      title: "View",
      rows: [
        ["v", "Split / unified"],
        ["s", "All files / single file"],
        ["b", "Show / hide file tree"],
        ["d", "Switch diff source"],
        ["escape / q", "Close diff viewer"],
      ],
    },
  ];
  return (
    <ModalBackdrop C={C} width={width} height={height}>
      <box
        style={{
          width: Math.min(60, Math.max(30, width - 4)),
          flexDirection: "column",
          flexShrink: 0,
          backgroundColor: C.panel,
          paddingTop: 1,
          paddingBottom: 1,
          paddingLeft: 2,
          paddingRight: 2,
        }}
      >
        <box style={{ height: 1, flexDirection: "row", justifyContent: "space-between", flexShrink: 0 }}>
          <text content="Diff shortcuts" fg={C.fg} attributes={TextAttributes.BOLD} />
          <text content="esc close" fg={C.faint} />
        </box>
        {groups.map((group) => (
          <box key={group.title} style={{ flexDirection: "column", flexShrink: 0, paddingTop: 1 }}>
            <text content={group.title} fg={C.fg} attributes={TextAttributes.BOLD} />
            {group.rows.map(([k, label]) => (
              <box key={k} style={{ height: 1, flexDirection: "row", flexShrink: 0 }}>
                <text content={k} fg={C.fg} width={17} />
                <text content={label} fg={C.subtle} />
              </box>
            ))}
          </box>
        ))}
      </box>
    </ModalBackdrop>
  );
}

  if (dialog === "queue") {
    return (
      <SelectDialog
        title="Queued prompts"
        size="large"
        options={queue.map((q, i) => ({ id: String(i), label: q, value: i }))}
        theme={C}
        footerHints={[
          { key: "enter", label: "remove" },
          { key: "ctrl+d", label: "delete" },
          { key: "esc", label: "close" },
        ]}
        onSelect={(i) => {
          const next = queue.filter((_, j) => j !== i);
          queueRef.current = next;
          setQueue(next);
          if (next.length === 0) closeDialog();
        }}
        onAction={(action, option) => {
          // queued_prompt.delete (v2 ctrl+d). v2's enter=steer needs a
          // mid-turn injection verb the zcode protocol lacks (-32010 on
          // send-while-running) — recorded host gap; enter stays remove.
          if (action !== "delete" || !option) return;
          const next = queue.filter((_, j) => j !== option.value);
          queueRef.current = next;
          setQueue(next);
          if (next.length === 0) closeDialog();
        }}
        onClose={closeDialog}
      />
    );
  }
  if (dialog === "settings") {
    // Ported from opencode v2.0.16 component/dialog-config.tsx onto the menu
    // grammar (0.6.57, third small-wave dialog migration): rows = title +
    // category header + the CURRENT VALUE in the menu footer cell (their
    // option.footer = display(setting)); keywords are SEARCH-ONLY (their
    // searchText — the filter reads title/category/searchText, matched text
    // never renders); one footer hint (left/right = change); enter steps
    // forward, arrows cycle. OUR rows map only to real setters
    // (state.json + live session state — the 0.6.27 owner law); the v2 rows
    // without a plane here (scrollbar, markdown, TPS, permissions,
    // notifications…) stay out.
    type SettingRow = {
      id: string;
      title: string;
      group: string;
      hint: string;
      value: string;
      change: (dir: 1 | -1) => void;
    };
    const rows: SettingRow[] = [
      {
        id: "theme",
        title: "Theme",
        group: "Appearance",
        hint: "color scheme",
        value: theme,
        change: (dir) => {
          const i = THEME_NAMES.indexOf(theme);
          const next = THEME_NAMES[(i + dir + THEME_NAMES.length) % THEME_NAMES.length] as ThemeName;
          persistTheme(next);
          flashStatus(`theme → ${next}`);
        },
      },
      {
        // v2 dialog-config "Color mode" row: values system/dark/light,
        // ←/→ cycles, "system" = the unlock. dark/light pin and persist the
        // lock (v2 setMode semantics).
        id: "color-mode",
        title: "Color mode",
        group: "Appearance",
        hint: "dark mode · light mode · system theme",
        value: themeLock ?? "system",
        change: (dir) => {
          const values = ["system", "dark", "light"];
          const next = values[(values.indexOf(themeLock ?? "system") + dir + values.length) % values.length];
          if (next === "system") freeThemeMode();
          else pinThemeMode(next as ThemeMode);
          flashStatus(`color mode → ${next}`);
        },
      },
      { id: "animations", title: "Animations", group: "Appearance", hint: "cursor blink · motion", value: animations ? "on" : "off", change: () => toggleAnimations() },
      { id: "file-context", title: "Editor context", group: "Input", hint: "the @files popup", value: fileContext ? "on" : "off", change: () => toggleFileContext() },
      {
        id: "diff-wrap",
        title: "Diff wrapping",
        group: "Input",
        hint: "diff viewer lines",
        value: (uiState.current.diff.wrap ?? "char") === "char" ? "word" : "none",
        change: () => {
          const next = (uiState.current.diff.wrap ?? "char") === "char" ? "none" : "char";
          persistDiffPrefs({ wrap: next });
          flashStatus(next === "char" ? "diff wrapping enabled" : "diff wrapping disabled");
        },
      },
      { id: "thinking", title: "Thinking", group: "Session", hint: "reasoning visibility", value: thoughtLevel === "disabled" ? "hide" : "show", change: () => void toggleThinking() },
      { id: "sidebar", title: "Sidebar", group: "Session", hint: "the session side panel", value: sidebarOpen ? "shown" : "hidden", change: () => setSidebarOpen((v) => !v) },
      { id: "mode", title: "Mode", group: "Session", hint: "agent mode", value: mode, change: (dir) => void cycleMode(dir) },
      { id: "effort", title: "Effort", group: "Session", hint: "reasoning effort", value: effort, change: (dir) => cycleEffort(dir) },
      { id: "tool-output", title: "Tool output", group: "Session", hint: "expansion · ctrl+o", value: toolsExpanded ? "expanded" : "collapsed", change: () => setToolsExpanded((v) => !v) },
    ];
    return (
      <SelectDialog
        title="Settings"
        size="large"
        menu
        options={rows.map((row) => ({
          id: row.id,
          label: row.title,
          group: row.group,
          footer: row.value,
          searchText: row.hint,
          value: row.id,
        }))}
        theme={C}
        footerHints={[{ key: "←/→", label: "change" }]}
        onHorizontal={(dir, option) => {
          const row = rows.find((r) => r.id === option?.id);
          if (row) row.change(dir);
        }}
        onSelect={(_, id) => {
          const row = rows.find((r) => r.id === id);
          if (row) row.change(1);
        }}
        onClose={closeDialog}
      />
    );
  }
  if (dialog === "stash") {
    const entries = promptStash.list();
    // Ported from opencode v2.0.16 component/dialog-stash.tsx onto the menu
    // grammar (0.6.58, fourth small-wave dialog migration): rows newest
    // first, first-line preview + relative age keep their slots, the ~N
    // lines count rides the menu FOOTER cell (their option.footer), the
    // two-stroke delete keeps the destructive row colour (the field the
    // menu grammar gains) and DISARMS on selection move (their onMove ->
    // setToDelete(undefined)). Restore is take-on-select (the entry leaves
    // the stash — a stale copy never shadows newer input).
    const stashOptions: DialogOption<number>[] = entries
      .map((entry, index) => ({ entry, index }))
      .slice()
      .reverse()
      .map(({ entry, index }) => {
        const lineCount = (entry.prompt.text.match(/\n/g)?.length ?? 0) + 1;
        return {
          id: String(index),
          label: stashArm === index ? "Press ctrl+d again to confirm" : getStashPreview(entry.prompt.text),
          description: getRelativeTime(entry.timestamp),
          footer: lineCount > 1 ? `~${lineCount} lines` : undefined,
          bg: stashArm === index ? C.error : undefined,
          value: index,
        };
      });
    return (
      <SelectDialog
        title="Stash"
        menu
        options={stashOptions}
        theme={C}
        footerHints={[
          { key: "ctrl+d", label: "delete" },
          { key: "enter", label: "restore" },
          { key: "esc", label: "close" },
        ]}
        onMove={() => setStashArm(undefined)}
        onAction={(action, option) => {
          if (action !== "delete" || !option) return;
          if (stashArm === option.value) {
            promptStash.remove(option.value);
            stashChanged();
            setStashArm(undefined);
            return;
          }
          setStashArm(option.value);
        }}
        onSelect={(_, id) => {
          const index = Number(id);
          const entry = entries[index];
          if (!entry) return;
          promptStash.remove(index);
          stashChanged();
          setDraft(entry.prompt.text);
          setCursorBoth(null);
          closeDialog();
        }}
        onClose={closeDialog}
      />
    );
  }
  if (dialog === "skills") {
    // Ported from opencode v2.0.7 component/dialog-skill.tsx: /skills —
    // name column padded to the widest row, whitespace-collapsed
    // description, loading / error / empty views verbatim. Selecting
    // inserts an @name mention (the v2 extmark decoration is
    // composer-internal and not portable to our plain-text draft).
    // Disabled skills stay out: the catalog marks them and the runtime
    // would not run them.
    const skillsOptions: DialogOption<string | null>[] =
      skillsState.kind === "idle" || skillsState.kind === "loading"
        ? [{ id: "loading", label: "Loading skills…", value: null }]
        : skillsState.kind === "error"
          ? [
              { id: "err", label: "Could not load skills", description: skillsState.message, value: null },
              { id: "err2", label: "Close and reopen Skills to try again.", value: null },
            ]
          : skillsState.skills.length === 0
            ? [{ id: "empty", label: "No skills available", value: null }]
            : skillsState.skills.map((skill) => ({
                id: skill.id,
                label: skill.name.padEnd(Math.max(0, ...skillsState.skills.map((s) => s.name.length))),
                description: skill.description?.replace(/\s+/g, " ").trim(),
                value: skill.name,
              }));
    return (
      <SelectDialog
        title="Skills"
        size="large"
        options={skillsOptions}
        theme={C}
        footerHints={[
          { key: "enter", label: "insert" },
          { key: "esc", label: "close" },
        ]}
        onSelect={(value) => {
          if (typeof value === "string") insertAtCursor(`@${value} `);
          closeDialog();
        }}
        onClose={closeDialog}
      />
    );
  }
  if (dialog === "mcp") {
    // Ported from opencode v2.0.7 component/dialog-mcp.tsx: /mcps — sorted
    // by name, the status footer grammar verbatim (Connecting … · Connected
    // ✓ · Failed ! · Sign in required → · Disabled ○) with the reference
    // colours. The v2 space toggle (dialog.mcp.toggle) and the
    // enter-to-error detail view are HOST GAPS: the zcode protocol exposes
    // mcp/list but no connect/disconnect verbs, and the status payload
    // carries no error text — recorded in docs/parity-v2.md, not hacked
    // around.
    const statusCell = (status: string): { text: string; color?: string; bold?: boolean } => {
      if (status === "connected") return { text: "Connected ✓", color: C.success, bold: true };
      if (status === "failed") return { text: "Failed !", color: C.error };
      if (status === "needs_auth") return { text: "Sign in required →", color: C.warning };
      if (status === "pending" || status === "connecting") return { text: "Connecting …", color: C.subtle };
      return { text: "Disabled ○", color: C.subtle };
    };
    const mcpOptions: DialogOption<string | null>[] =
      mcpState.kind === "idle" || mcpState.kind === "loading"
        ? [{ id: "loading", label: "Connecting …", value: null }]
        : mcpState.servers.length === 0
          ? [{ id: "none", label: "No MCP servers configured", value: null }]
          : mcpState.servers.map((server) => ({
              id: server.name,
              label: server.name,
              status: statusCell(server.status),
              value: null,
            }));
    return (
      <SelectDialog
        title="MCP servers"
        options={mcpOptions}
        theme={C}
        footerHints={[{ key: "esc", label: "close" }]}
        onSelect={() => closeDialog()}
        onClose={closeDialog}
      />
    );
  }
  if (dialog === "plugins") {
    // Ported from opencode v2.0.8 feature-plugins/system/plugins.tsx (0.6.34):
    // the Plugins select — rows off plugins/list sorted by name, the v2
    // footer grammar (status word when not active, then the version; hash
    // versions shortened to 7) with subdued colour, pending rows wear a
    // gutter mark while the toggle is in flight. Enter toggles
    // plugins/setEnabled (v2 toggles its TUI arm — ours is the only toggle
    // plane the host offers; mapping note in docs/parity-v2.md). The v2
    // ctrl+a internal-plugins toggle, dialog.plugins.error/-check/-update
    // have no plane here (no TUI-runtime arm, no error/outdated payloads) —
    // omitted per the Revert-row precedent, not hacked around.
    const pluginOptions: DialogOption<string | null>[] =
      pluginsState.kind === "idle" || pluginsState.kind === "loading"
        ? [{ id: "loading", label: "Loading plugins…", value: null }]
        : pluginsState.kind === "error"
          ? [
              { id: "err", label: "Could not load plugins", description: pluginsState.message, value: null },
              { id: "err2", label: "Close and reopen Plugins to try again.", value: null },
            ]
          : pluginsState.plugins.length === 0
            ? [{ id: "empty", label: "No plugins available", value: null }]
            : pluginsState.plugins.map((plugin) => {
                const footerParts = [
                  ...(plugin.enabled ? [] : ["disabled"]),
                  ...(plugin.version ? [shortVersion(plugin.version)] : []),
                ];
                return {
                  id: plugin.id,
                  label: plugin.name,
                  status: footerParts.length > 0 ? { text: footerParts.join(", "), color: C.subtle } : undefined,
                  gutter: pluginPending.includes(plugin.id) ? "…" : undefined,
                  value: plugin.id,
                };
              });
    return (
      <SelectDialog
        title="Plugins"
        size="large"
        options={pluginOptions}
        theme={C}
        footerHints={[
          { key: "enter", label: "toggle" },
          { key: "esc", label: "close" },
        ]}
        onSelect={(value) => {
          if (typeof value === "string") {
            const row = pluginsState.plugins.find((p) => p.id === value);
            if (row) togglePlugin(row);
            return;
          }
          closeDialog();
        }}
        onClose={closeDialog}
      />
    );
  }
  if (dialog === "status") {
    return <StatusDialog C={C} mcpState={mcpState} usageState={usageState} onClose={closeDialog} width={dims.width} height={dims.height} />;
  }
  if (dialog === "export") {
    return <ExportDialog C={C} onClose={closeDialog} onConfirm={(opts) => void runExport(opts)} width={dims.width} height={dims.height} />;
  }
  if (dialog === "exportresult") {
    return <ExportResultDialog C={C} path={exportResultPath ?? ""} onClose={closeDialog} width={dims.width} height={dims.height} />;
  }
  if (dialog === "imagepreview") {
    return <ImagePreviewDialog C={C} images={imageFiles} initial={previewIdx} onClose={closeDialog} width={dims.width} height={dims.height} />;
  }
  if (dialog === "help") {
    return <HelpDialog C={C} onClose={closeDialog} width={dims.width} height={dims.height} />;
  }
  if (dialog === "palette") {
    const commands: DialogOption<() => void>[] = [
      { id: "sessions", label: "sessions", description: "browse and resume conversations", value: openSessions },
      { id: "new", label: "new session", description: "start a fresh ZCode session", value: () => void newSession() },
      { id: "clear", label: "clear session", description: "close this tab · v2 /clear", value: clearSession },
      { id: "model", label: "switch model…", description: "choose from the safe model allowlist", value: () => setDialog("model") },
      { id: "effort", label: "reasoning effort…", description: "low · high · max", value: () => setDialog("effort") },
      { id: "mode", label: "switch mode…", description: "plan · build · edit · yolo · auto", value: () => setDialog("mode") },
      { id: "thinking", label: "toggle thinking", value: () => void toggleThinking() },
      { id: "fork", label: "fork session", description: "latest checkpoint", value: () => void forkActive() },
      { id: "fork-message", label: "fork at message…", value: openForkDialog },
      { id: "compact", label: "compact session", value: () => void compactActive() },
      { id: "copy-transcript", label: "Copy session transcript", description: "markdown · v2 session.copy · /copy", value: copyTranscript },
      { id: "copy-session-id", label: "Copy session ID", description: "v2 session.copy.id", value: copySessionId },
      { id: "export", label: "Export session transcript…", description: "markdown · leader x · /export", value: () => setDialog("export") },
      { id: "images-view", label: "View image attachments", description: "v2 prompt.images.view · leader i", value: () => openImagePreview(0) },
      { id: "stash", label: "stash prompt", description: "park the draft · v2 prompt.stash", value: () => { if (!draft) return; promptStash.push({ prompt: { text: stripAttachmentLabels(draft, promptFilesRef.current.map((f) => f.label)) } }); setDraft(""); setCursorBoth(null); stashChanged(); } },
      { id: "stash-pop", label: "stash pop", description: "restore the newest stashed draft", value: () => { const e = promptStash.pop(); if (!e) return; setDraft(e.prompt.text); setCursorBoth(null); stashChanged(); } },
      { id: "stash-list", label: "stash list…", description: "restore or delete stashed drafts", value: () => { setStashArm(undefined); setDialog("stash"); } },
      { id: "skills", label: "skills…", description: "insert a skill mention · /skills", value: () => setDialog("skills") },
      { id: "mcp", label: "MCP servers", description: "connection status · /mcps", value: () => setDialog("mcp") },
      { id: "plugins", label: "Plugins", description: "enable or disable plugins · /plugins", value: () => setDialog("plugins") },
      { id: "status", label: "View status", description: "MCP server status · leader s", value: () => setDialog("status") },
      { id: "msg-next", label: "next message", description: "jump the transcript · v2 session.message.next", value: () => messageJump(1, false) },
      { id: "msg-prev", label: "previous message", value: () => messageJump(-1, false) },
      { id: "msg-user-next", label: "next user message", value: () => messageJump(1, true) },
      { id: "msg-user-prev", label: "previous user message", value: () => messageJump(-1, true) },
      { id: "toggle-animations", label: animations ? "disable animations" : "enable animations", description: "cursor blink · v2 app.toggle.animations", value: toggleAnimations },
      { id: "toggle-file-context", label: fileContext ? "disable file context" : "enable file context", description: "the @files popup", value: toggleFileContext },
      { id: "toggle-diffwrap", label: (uiState.current.diff.wrap ?? "char") === "char" ? "disable diff wrapping" : "enable diff wrapping", description: "in the diff viewer", value: toggleDiffWrap },
      { id: "settings", label: "Open settings", description: "· /settings", value: () => setDialog("settings") },
      { id: "themes", label: "themes…", description: "the full OpenCode palette set", value: () => openThemes() },
      { id: "sidebar", label: "toggle sidebar", description: "leader b", value: () => { if (view === "session") setSidebarOpen((s) => !s); } },
      { id: "refresh", label: "refresh sessions", value: () => void refresh() },
      { id: "home", label: "home", description: "return to the zcodetui front page", value: () => { setView("home"); setTyping(true); } },
      { id: "quit", label: "quit", value: onQuit },
    ];
    return (
      <SelectDialog
        title="Commands"
        size="large"
        options={commands}
        theme={C}
        countLabel="command"
footerHints={[
          { key: "enter", label: "select" },
          { key: "esc", label: "close" },
        ]}
        onSelect={(fn) => { closeDialog(); setTimeout(fn, 30); }}
        onClose={closeDialog}
      />
    );
  }

  // v2 imagePreviewHeight: clamp(4, 8, quarter of the terminal rows).
  const stripHeight = Math.max(4, Math.min(8, Math.floor(dims.height / 4)));
  const PLACEHOLDERS = [
    'Ask anything…  "What is the tech stack of this project?"',
    'Ask anything…  "How do I run the test suite?"',
    'Ask anything…  "Find where authentication is configured"',
    'Ask anything…  "Explain this repository layout"',
    'Ask anything…  "Fix the failing build"',
  ];
  const promptPlaceholder = view === "home"
    ? PLACEHOLDERS[placeholderTick % PLACEHOLDERS.length]
    : activeId ? "Ask anything…" : "a new session · type a prompt";
  const promptText = draft || promptPlaceholder;
  const providerLabel = activeModel?.providerId ?? "zai";
  const composerProps = {
    C,
    typing,
    mode,
    model: modelLabel(activeModel),
    provider: (activeModel as { providerLabel?: string })?.providerLabel ?? providerLabel,
    effort,
    thinkingOff: thoughtLevel === "disabled",
    leaderActive,
  };
  // The v2 contextHintCandidates row: the subagent entry appears only when
  // tabs exist (footer.view.tsx — activeTabs > 0 && shortcut).
  const hintBits = subagentTabs.length > 0
    ? `shift+tab agents   ctrl+p commands   down ${subagentTabs.length} subs`
    : "shift+tab agents   ctrl+p commands";
  const ctxLabel = ctx && ctx.window > 0 ? `${formatContextLabel(ctx.used, ctx.window)}  ` : "";

  if (view === "home") {
    return (
      <box style={{ flexDirection: "column", backgroundColor: C.bg, width: "100%", flexGrow: 1 }}>
        <box style={{ flexDirection: "column", alignItems: "center", flexGrow: 1, paddingLeft: 2, paddingRight: 2 }}>
          <box style={{ flexGrow: 1 }} />
          <box style={{ height: 3, flexShrink: 0 }} />
          <ZCodeLogo C={C} />
          <box style={{ height: 1, flexShrink: 0 }} />
          <box style={{ width: promptWidth, flexShrink: 0 }}>
            <AttachmentStrip C={C} files={imageFiles} more={(index) => openImagePreview(index)} height={stripHeight} />
            {sugOpen ? <SlashPopup commands={sugMatches} files={fileMatches} idx={sugIdx} C={C} width={promptWidth} /> : null}
            <Composer C={C} width={promptWidth} underlineWidth={promptWidth - 1} draft={draft} placeholder={promptPlaceholder} cursor={cursor} selection={selRange} cursorBlink={cursorBlink} typing={typing} mode={mode} model={modelLabel(activeModel)} provider={(activeModel as { providerLabel?: string })?.providerLabel ?? providerLabel} effort={effort} thinkingOff={thoughtLevel === "disabled"} leaderActive={leaderActive} />
          </box>
          <box style={{ width: promptWidth, flexDirection: "row", justifyContent: "space-between", flexShrink: 0, paddingLeft: 1, paddingRight: 1 }}>
            <text content={`${cwd.length > 26 ? `…${cwd.slice(-25)}` : cwd}${gitBranch ? `:${gitBranch}` : ""}`} fg={C.subtle} />
            {mcpStatus && mcpStatus.total > 0 ? (
              <box style={{ width: promptWidth, flexDirection: "row", justifyContent: "space-between", flexShrink: 0, paddingLeft: 1, paddingRight: 1 }}>
                <text
                  content={"⊙ " + (mcpStatus.failed > 0 ? `${mcpStatus.failed} MCP failed` : `${mcpStatus.total} MCP`)}
                  fg={mcpStatus.failed > 0 ? C.error : C.success}
                />
                {dims.width >= 64 ? <text content="/mcps" fg={C.subtle} /> : null}
              </box>
            ) : null}
            <box style={{ flexDirection: "row", flexShrink: 0 }}>
              <HintBits text={hintBits} C={C} />
              <text content={`   ${VERSION}`} fg={C.faint} />
            </box>
          </box>
          <box style={{ flexGrow: 1 }} />
        </box>
        {toast ? <Toast C={C} message={toast.message} variant={toast.variant} width={dims.width} /> : null}
      </box>
    );
  }

  // Slice 2: the transcript renders ROWS — the slice-2 row model
  // (reduceSessionRows over the raw records) with groups, part views and
  // footer rows; the window counts rows; the flat list stays the
  // copy/export voice.
  const visibleEnd = windowEnd ?? rows.length;
  const visibleStart = Math.max(0, visibleEnd - SCROLL_WINDOW);
  const visibleRows = rows.slice(visibleStart, visibleEnd);
  const groupCtx: GroupViewCtx = {
    C,
    mdStyle,
    width: dims.width,
    spinnerChar: spinner,
    toolsExpanded,
    expanded: (id) => (groupsOverride !== null ? groupsOverride : groupExpand[id] ?? false),
    toggle: (id) => setGroupExpand((cur) => ({ ...cur, [id]: !(groupsOverride ?? cur[id] ?? false) })),
    message: (messageID) => normById.get(messageID),
    entry: (entry) => (
      <TranscriptRowView
        row={entry}
        norms={normMsgs}
        normById={normById}
        groupCtx={groupCtx}
        running={running}
        isTail={false}
        C={C}
        mdStyle={mdStyle}
        width={dims.width}
        toolsExpanded={toolsExpanded}
        spinnerChar={spinner}
      />
    ),
  };
  return (
    <box style={{ flexDirection: "column", backgroundColor: C.bg, width: "100%", flexGrow: 1 }}>
      {view === "session" && tabs.length > 0 ? (
        <SessionTabsStrip
          C={C}
          tabs={tabs}
          activeId={activeId ?? undefined}
          width={dims.width}
          spinnerChar={spinner}
          statusOf={tabStatusOf}
          titles={(id) => sessions.find((s) => s.sessionId === id)?.title}
        />
      ) : null}
      <box style={{ flexDirection: "row", flexGrow: 1, minHeight: 0 }}>
        {rows.length === 0 ? (
          <box style={{ flexGrow: 1, flexDirection: "column", paddingLeft: 3, paddingRight: 3, paddingTop: 2 }}>
            <text content="No messages yet." fg={C.subtle} />
            <text content="i to type · Enter sends · /sessions opens the session browser" fg={C.faint} />
          </box>
        ) : (
          <scrollbox
            ref={scrollRef as never}
            style={{ flexGrow: 1, flexDirection: "column", paddingTop: 1 }}
            scrollbarOptions={{ visible: false }}
            stickyScroll
            stickyStart="bottom"
          >
            {visibleEnd < rows.length ? (
              <text content={`… ${rows.length - visibleEnd} older messages — scroll up to load`} fg={C.faint} />
            ) : null}
            {visibleRows.map((row, index) => (
              <TranscriptRowView
                key={rowKey(row, visibleStart + index)}
                row={row}
                norms={normMsgs}
                normById={normById}
                groupCtx={groupCtx}
                running={running}
                isTail={index === visibleRows.length - 1}
                C={C}
                mdStyle={mdStyle}
                width={dims.width}
                toolsExpanded={toolsExpanded}
                spinnerChar={spinner}
              />
            ))}
          </scrollbox>
        )}
        {sidebarOpen && view === "session" && activeId ? (
          <SessionSidebar C={C} title={activeTitle || "zcode-tui"} sessionId={activeId} ctx={ctx} />
        ) : null}
      </box>
      {/* Always-reserved row: a structural unmount leaves stale cells in the
          renderer (measured 2026-09-16), a content swap repaints cleanly. */}
      {view === "session" ? (
        <box style={{ flexDirection: "row", flexShrink: 0, paddingLeft: 2, height: 1 }}>
          {!atBottom && msgs.length > 0 ? (
            <>
              <text content="Jump to latest " fg={C.subtle} />
              <text content="↓" fg={C.accent} />
              <text content="  ctrl+alt+g" fg={C.faint} />
            </>
          ) : (
            <text content=" " fg={C.subtle} />
          )}
        </box>
      ) : null}
      {ask ? (
        <box
          style={
            askExpanded
              ? // v2 expanded arm: full-viewport overlay, the status row
                // reserved (bottom: 1 upstream) and 2-col insets — Portal +
                // absolute upstream; explicit width/height per our
                // ModalBackdrop idiom; ABOVE the toast (2000) — a modal ask outranks a
                // transient toast — under the dialogs (3000).
                {
                  position: "absolute",
                  top: 0,
                  left: 2,
                  width: dims.width - 4,
                  height: dims.height - 1,
                  zIndex: 2500,
                  flexDirection: "row",
                }
              : { flexDirection: "row", paddingLeft: 2, paddingRight: 2, flexShrink: 0 }
          }
        >
          <box
            style={{
              flexGrow: 1,
              flexShrink: 0,
              flexDirection: "column",
              backgroundColor: C.panel,
              paddingLeft: 2,
              paddingRight: 2,
              paddingTop: 1,
              paddingBottom: 1,
              borderStyle: "single",
              border: ["left"],
              borderColor: ask.riskLevel === "high" ? C.error : C.warning,
              ...(askExpanded ? { height: dims.height - 1 } : {}),
            }}
          >
            <box style={{ height: 1, flexDirection: "row", flexShrink: 0 }}>
              {/* opencode v2 permission.tsx, verbatim shape: "△ Permission
                  required" header row is TITLE-ONLY, the payload lives in
                  the body under the tool meta; select options keep the
                  reference labels; escape = Reject. */}
              <text content="△ Permission required" fg={C.warning} attributes={TextAttributes.BOLD} />
            </box>
            <box style={{ flexDirection: "row", flexShrink: 0, paddingRight: 2 }}>
              <box style={{ flexGrow: 1, backgroundColor: C.surface, paddingLeft: 1, paddingRight: 1 }}>
                <text content={`${ask.toolName}${ask.riskLevel ? ` · ${ask.riskLevel}` : ""}`} fg={C.subtle} wrapMode="word" />
              </box>
            </box>
            <box style={{ flexDirection: "column", flexShrink: 0, marginTop: 1, ...(askExpanded ? {} : { maxHeight: 10 }) }}>
              <text content={ask.detail} fg={C.fg} wrapMode="word" />
            </box>
            {ask.diff ? (
              // v2 EditBody's diff branch (PatchDiff, unified under our card
              // width) — fires only when a permission payload carries a diff.
              <box style={{ flexDirection: "column", flexShrink: 0, marginTop: 1, ...(askExpanded ? {} : { maxHeight: 10 }) }}>
                <PatchDiff
                  diff={ask.diff}
                  hunkFg={diffFor(theme, themeMode).diffHunkHeader}
                  view="unified"
                  filetype={filetypeOf(ask.detail)}
                  syntaxStyle={mdStyle}
                  showLineNumbers
                  wrapMode="none"
                  fg={C.fg}
                  addedBg={diffFor(theme, themeMode).diffAddedBg}
                  removedBg={diffFor(theme, themeMode).diffRemovedBg}
                  contextBg={diffFor(theme, themeMode).diffContextBg}
                  addedSignColor={diffFor(theme, themeMode).diffHighlightAdded}
                  removedSignColor={diffFor(theme, themeMode).diffHighlightRemoved}
                  lineNumberFg={diffFor(theme, themeMode).diffLineNumber}
                  lineNumberBg={diffFor(theme, themeMode).diffContextBg}
                  addedLineNumberBg={diffFor(theme, themeMode).diffAddedLineNumberBg}
                  removedLineNumberBg={diffFor(theme, themeMode).diffRemovedLineNumberBg}
                />
              </box>
            ) : ask.patch ? (
              // v2 EditBody's raw-patch branch: subdued patch text.
              <box style={{ flexDirection: "column", flexShrink: 0, marginTop: 1, ...(askExpanded ? {} : { maxHeight: 10 }) }}>
                <text content={ask.patch} fg={C.faint} />
              </box>
            ) : null}
            {[
              { id: "once", label: "Allow once" },
              { id: "always", label: "Always allow" },
              { id: "reject", label: "Reject" },
            ].map((opt, index) => {
              const selected = askSel === index;
              return (
                <box
                  key={opt.id}
                  style={{
                    height: 1,
                    flexDirection: "row",
                    flexShrink: 0,
                    paddingLeft: 1,
                    backgroundColor: selected ? C.accent : undefined,
                  }}
                >
                  <text content={opt.label} fg={selected ? C.accentText : C.fg} />
                </box>
              );
            })}
            {/* v2 SessionQuestion footer grammar: the fullscreen hint flips
                with the expanded arm; the spacer parks it at the card foot
                when expanded. */}
            <box style={{ flexGrow: askExpanded ? 1 : 0, flexShrink: 0 }} />
            <box style={{ flexDirection: "row", flexShrink: 0, paddingTop: 1 }}>
              <HintBits
                text={
                  askExpanded
                    ? "ctrl+f minimize   ⇆ select   enter confirm"
                    : "ctrl+f fullscreen   ⇆ select   enter confirm"
                }
                C={C}
              />
            </box>
          </box>
        </box>
      ) : null}
      {queue.length > 0 ? (
        <box style={{ height: 1, flexDirection: "row", paddingLeft: 3, paddingRight: 3, flexShrink: 0 }}>
          <text content={`⧗ ${queue.length} queued · next: ${queue[0].slice(0, 48)}`} fg={C.warning} />
        </box>
      ) : null}
      <AttachmentStrip C={C} files={imageFiles} more={(index) => openImagePreview(index)} height={stripHeight} />
      {sugOpen ? <SlashPopup commands={sugMatches} files={fileMatches} idx={sugIdx} C={C} /> : null}
      {inspectId ? (
        // The subagent inspector (0.6.52): the RunFooterSubagentBody header
        // plane above the composer — esc back, tab cycles the tabs.
        <SubagentInspector
          C={C}
          tab={subagentTabs.find((t) => t.sessionID === inspectId)}
          index={subagentTabIndex(subagentTabs, inspectId)}
          total={subagentTabs.length}
          spinner={spinner}
          width={dims.width}
          onClose={() => setInspectId(null)}
          onCycle={(dir) => {
            const n = subagentTabs.length;
            if (n === 0) return;
            const at = subagentTabIndex(subagentTabs, inspectId);
            const next = ((at < 0 ? 0 : at + dir) + n) % n;
            setInspectId(subagentTabs[next].sessionID);
          }}
        />
      ) : null}
      <box style={{ flexDirection: "row", paddingLeft: 2, paddingRight: 2, flexShrink: 0 }}>
        <Composer C={C} width="100%" underlineWidth={Math.max(10, dims.width - 5)} draft={draft} placeholder={promptPlaceholder} cursor={cursor} selection={selRange} cursorBlink={cursorBlink} typing={typing} mode={mode} model={modelLabel(activeModel)} provider={(activeModel as { providerLabel?: string })?.providerLabel ?? providerLabel} effort={effort} thinkingOff={thoughtLevel === "disabled"} leaderActive={leaderActive} />
      </box>
      <box style={{ height: 1, flexDirection: "row", justifyContent: "space-between", paddingLeft: 3, paddingRight: 2, flexShrink: 0 }}>
        {running ? (
          // v2 busy statusline grammar: the static spinner group then the
          // status text `{interruptLabel()} stop` — "esc stop" here (our
          // single-esc stop); the invented "Working…" retired 0.6.30.
          <text content={`${spinner} esc stop`} fg={C.fg} />
        ) : (
          <text content={lost ? "backend lost · r to reconnect" : `${cwd}${gitBranch ? `:${gitBranch}` : ""}`} fg={C.subtle} />
        )}
        {running ? (
          <text content={ctxLabel} fg={C.subtle} />
        ) : (
          <box style={{ flexDirection: "row", flexShrink: 0 }}>
            {ctxLabel ? <text content={ctxLabel} fg={C.subtle} /> : null}
            <HintBits text={hintBits} C={C} />
          </box>
        )}
      </box>
      {toast ? <Toast C={C} message={toast.message} variant={toast.variant} width={dims.width} /> : null}
    </box>
  );
}
