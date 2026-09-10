// zcode-tui — an OpenCode-shaped ZCode client.
//
// The runtime and protocol stay ZCode's. This file owns the presentation
// layer: home, sessions picker, session transcript, composer, sidebar, themes,
// and the small keyboard state machines that make those surfaces feel like one
// TUI. The surfaces follow the OpenCode reference UI (surfaces, spacing and
// status grammar measured against its published TUI components), not its code.
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { SyntaxStyle, TextAttributes } from "@opentui/core";
import { SelectDialog, TextPromptDialog, type DialogOption } from "./select-dialog";
import type { AppServer } from "../protocol/client";
import { recentInputs } from "../store/history";
import { probe } from "./probes";
import {
  formatDateHeading,
  formatContextLabel,
  formatTokens,
  formatTurnFooter,
  matchSlashCommands,
  mdFor,
  modeAccent,
  modeLabel,
  parseSlashCommand,
  shortCwd,
  SLASH_COMMANDS,
  THEMES,
  THEME_NAMES,
  type SlashCommandSpec,
  type ThemeName,
  type ThemeTokens,
} from "./design";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const VERSION = "0.6.0";

// Markdown tinting per active theme: the assistant transcript renders through
// these styles so headings, code and links colour exactly like the reference
// TUI does under the same palette. Unknown style names are simply unused, so
// both naming conventions are registered.
const mdStyleCache = new Map<ThemeName, SyntaxStyle>();
function mdStyleFor(theme: ThemeName): SyntaxStyle {
  const cached = mdStyleCache.get(theme);
  if (cached) return cached;
  const md = mdFor(theme);
  const style = SyntaxStyle.fromStyles({
    text: { fg: md.mdText },
    paragraph: { fg: md.mdText },
    heading: { fg: md.mdHeading, bold: true },
    h1: { fg: md.mdHeading, bold: true },
    h2: { fg: md.mdHeading, bold: true },
    h3: { fg: md.mdHeading, bold: true },
    h4: { fg: md.mdHeading, bold: true },
    link: { fg: md.mdLink },
    linkText: { fg: md.mdLinkText },
    code: { fg: md.mdCode },
    inlineCode: { fg: md.mdCode },
    codeBlock: { fg: md.mdText },
    blockquote: { fg: md.mdQuote, italic: true },
    emph: { fg: md.mdEmph, italic: true },
    strong: { fg: md.mdStrong, bold: true },
    listItem: { fg: md.mdListItem },
    listEnumeration: { fg: md.mdListEnum },
    // Syntax colour arms for fenced code blocks.
    comment: { fg: md.synComment },
    keyword: { fg: md.synKeyword },
    function: { fg: md.synFunction },
    variable: { fg: md.synVariable },
    string: { fg: md.synString },
    number: { fg: md.synNumber },
    type: { fg: md.synType },
    operator: { fg: md.synOperator },
    punctuation: { fg: md.synPunct },
  });
  mdStyleCache.set(theme, style);
  return style;
}

// ⛔ MODEL ALLOWLIST (owner ruling 2026-09-08): exactly these two on the zai
// provider. The runtime catalog must never re-introduce the paid login models.
// The wire ids intentionally preserve the desktop's canonical capitalization.
const ALLOWED_MODELS = [
  { label: "GLM-5.3-Flash", providerId: "zai", modelId: "GLM-5.3-Flash", isDefault: true },
  { label: "GLM-5.3", providerId: "zai", modelId: "GLM-5.3", isDefault: false },
] as const;

const MODES = ["plan", "build", "edit", "yolo", "auto"] as const;
const EFFORTS = ["low", "high", "max"] as const;

type ModelChoice = { label: string; providerId: string; modelId: string; isDefault?: boolean };
type AppView = "home" | "session";
type DialogName = "sessions" | "model" | "palette" | "fork" | "themes" | "rename" | null;

export interface SessionRow {
  sessionId: string;
  title: string;
  status: string;
  mode?: string;
  updatedAt: number;
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
  messageId?: string;
  // Turn metrics for the per-message footer (OpenCode's
  // `Build · model · 4.2s · 19.8 tok/s` line).
  turnStart?: number;
  durationMs?: number;
  outputTokens?: number;
  // Reasoning is collapsed once the turn completes; the streaming tail shows
  // it live until then.
  thinking?: string;
  thinkingMs?: number;
}

// A compact block mark that keeps the same proportions as OpenCode's logo.
// ZCode's mark is split into a quiet wordmark and a brighter TUI suffix.
// (The mark itself is Astra's lane — hands off in visual waves.)
const LOGO_LINES: [string, string][] = [
  ["█▀▀▀ █▀▀▀ █▀▀█ █▀▀▄ █▀▀▀", "▀█▀ █  █ ▀█▀"],
  ["  ▄  █    █  █ █  █ █▀▀ ", " █  █  █  █ "],
  [" █   █    █  █ █  █ █   ", " █  █  █  █ "],
  ["▀▀▀  ▀▀▀▀ ▀▀▀  ▀▀▀▀ ▀▀▀ ", "▀▀▀ ▀▀▀  ▀▀▀"],
];

function ZCodeLogo({ C }: { C: ThemeTokens }) {
  return (
    <box style={{ flexDirection: "column", flexShrink: 0 }}>
      {LOGO_LINES.map(([left, right], index) => (
        <box key={index} style={{ flexDirection: "row" }}>
          <text content={left} fg={C.subtle} />
          <text content={` ${right}`} fg={C.brand} />
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
  return {
    sessionId: String(value.sessionId ?? value.id ?? ""),
    title: String(value.title ?? ""),
    status: String(value.status ?? value.phase ?? "idle"),
    mode: typeof value.mode === "string" ? value.mode : undefined,
    updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : Date.now(),
    modelId: typeof value.modelId === "string" ? value.modelId : undefined,
  };
}

// Braille spinner for the running state — OpenCode mounts a block spinner on
// the composer underline while a turn runs; this is the same slot.
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
function useSpinner(active: boolean): string {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), 80);
    return () => clearInterval(timer);
  }, [active]);
  return SPINNER_FRAMES[frame];
}

// The message transcript voice, measured off the OpenCode reference: the user
// block is a filled panel with a bright left edge, the assistant speaks as
// plain markdown with a metrics footer, tools are single dim lines.
const MessageView = memo(function MessageView({
  m,
  running,
  thinking,
  C,
  mdStyle,
  isTail,
}: {
  m: TurnMessage;
  running: boolean;
  thinking: string;
  C: ThemeTokens;
  mdStyle: SyntaxStyle;
  isTail: boolean;
}) {
  if (m.role === "tool") {
    const output = (m.toolOut ?? m.text).replace(/\s+/g, " ").slice(0, 110);
    const result = m.toolOk === undefined ? " …" : m.toolOk ? ` ✓${m.toolMs ? ` ${m.toolMs}ms` : ""}` : " ✗";
    return (
      <box style={{ flexDirection: "row", paddingLeft: 3, paddingRight: 3, height: 1, flexShrink: 0 }}>
        <text content={`● ${m.toolName ?? "tool"} `} fg={C.tool} />
        <text content={output} fg={C.subtle} />
        <text content={result} fg={m.toolOk === false ? C.error : C.success} />
      </box>
    );
  }

  const isUser = m.role === "user";
  if (isUser) {
    return (
      <box style={{ flexDirection: "column", paddingLeft: 2, paddingRight: 2, paddingTop: 1, flexShrink: 0 }}>
        <box style={{ flexDirection: "row", flexShrink: 0 }}>
          <box style={{ width: 1, flexShrink: 0, backgroundColor: C.user }} />
          <box style={{ flexGrow: 1, flexShrink: 0, backgroundColor: C.panel, paddingLeft: 2, paddingRight: 2 }}>
            <text content={m.text} fg={C.fg} />
          </box>
        </box>
      </box>
    );
  }

  const streaming = running && isTail;
  const footer = m.durationMs !== undefined && !streaming
    ? formatTurnFooter("auto", m.model, m.durationMs, m.outputTokens)
    : null;
  return (
    <box style={{ flexDirection: "column", paddingLeft: 3, paddingRight: 3, paddingTop: 1, flexShrink: 0 }}>
      {m.thinkingMs && m.thinking ? (
        <text content={`+ Thought · ${(m.thinkingMs / 1000).toFixed(1)}s`} fg={C.faint} />
      ) : null}
      {streaming && thinking ? (
        <text content={thinking.slice(-160)} fg={C.faint} />
      ) : null}
      {!streaming ? (
        <markdown content={m.text || "∅"} syntaxStyle={mdStyle} />
      ) : (
        <text content={m.text || "…"} fg={C.fg} />
      )}
      {footer ? (
        <box style={{ flexDirection: "row", paddingTop: 0, flexShrink: 0 }}>
          <text content={footer.head} fg={C.user} />
          <text content={footer.rest ? ` · ${footer.rest}` : ""} fg={C.subtle} />
        </box>
      ) : null}
    </box>
  );
});

function extractText(parts: unknown): string {
  if (!Array.isArray(parts)) return "";
  const out: string[] = [];
  for (const p of parts as Record<string, unknown>[]) {
    if (typeof p.text === "string") out.push(p.text);
    else if (typeof p.content === "string") out.push(p.content);
  }
  return out.join("");
}

function sortedThemes(): ThemeName[] {
  return [...THEME_NAMES].sort((a, b) => a.localeCompare(b));
}

// The composer autocomplete popup — the OpenCode convention this TUI mirrors:
// typing "/" lists every command filtered as you type, directly above the
// composer, with enter running the highlighted command. Borderless block,
// selected row carries the primary highlight with background-coloured text.
function SlashPopup({
  matches,
  idx,
  C,
  width,
}: {
  matches: SlashCommandSpec[];
  idx: number;
  C: ThemeTokens;
  width?: number;
}) {
  const sel = Math.min(idx, matches.length - 1);
  const win = Math.max(0, Math.min(sel - 2, Math.max(0, matches.length - 6)));
  const visible = matches.slice(win, win + 6);
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
      {visible.map((c) => {
        const selected = matches.indexOf(c) === sel;
        return (
          <box key={c.name} style={{ height: 1, flexDirection: "row", flexShrink: 0, backgroundColor: selected ? C.selected : undefined }}>
            <text content={` /${c.name.padEnd(11)}`} fg={selected ? C.accentText : C.fg} />
            <text content={c.description} fg={selected ? C.accentText : C.subtle} />
          </box>
        );
      })}
    </box>
  );
}

// The OpenCode composer: a left accent edge tinted by the active mode, the
// input row, and the status grammar `Build auto · model provider · Low` inside
// the box; a thin detached underline row; then the hint line below on the
// background. No full border — the reference keeps the box open-faced.
function Composer({
  C,
  width,
  underlineWidth,
  promptText,
  isPlaceholder,
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
  promptText: string;
  isPlaceholder: boolean;
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
  return (
    <box style={{ width, flexDirection: "column", flexShrink: 0 }}>
      <box style={{ flexDirection: "row", flexShrink: 0 }}>
        <box style={{ width: 1, flexShrink: 0, flexDirection: "column", backgroundColor: accent }}>
          <box style={{ flexGrow: 1 }} />
          <text content="╹" fg={accent} />
        </box>
        <box style={{ flexGrow: 1, flexShrink: 0, flexDirection: "column", backgroundColor: C.surface, paddingLeft: 2, paddingRight: 2, paddingTop: 1 }}>
          <text content={`${promptText}${typing ? "▏" : ""}`} fg={isPlaceholder ? C.subtle : C.fg} />
          <box style={{ flexDirection: "row", paddingTop: 1, flexShrink: 0 }}>
            <text content={`${label.label} `} fg={accent} />
            {label.auto ? <text content="auto " fg={C.subtle} /> : null}
            <text content={`· ${model} `} fg={leaderActive ? C.subtle : C.fg} />
            <text content={`${provider} · `} fg={C.subtle} />
            <text content={effort.charAt(0).toUpperCase() + effort.slice(1)} fg={C.warning} />
            {thinkingOff ? <text content=" · thinking off" fg={C.faint} /> : null}
          </box>
        </box>
      </box>
      <box style={{ flexDirection: "row", flexShrink: 0 }}>
        <box style={{ width: 1, flexShrink: 0 }}>
          <text content="╹" fg={accent} />
        </box>
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

export function App({
  client,
  onQuit,
  resumeId,
  modelId,
}: {
  client: AppServer;
  onQuit: () => void;
  resumeId?: string | null;
  modelId?: string | null;
}) {
  const [view, setView] = useState<AppView>("home");
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [sel, setSel] = useState(0);
  const [msgs, setMsgs] = useState<TurnMessage[]>([]);
  const [status, setStatus] = useState("connecting…");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [thinking, setThinking] = useState("");
  const thinkingRef = useRef("");
  useEffect(() => {
    thinkingRef.current = thinking;
  }, [thinking]);
  const [dialog, setDialog] = useState<DialogName>(null);
  const [forkOptions, setForkOptions] = useState<DialogOption<string>[]>([]);
  const [theme, setTheme] = useState<ThemeName>("opencode");
  const [ask, setAsk] = useState<{ toolName: string; detail: string; riskLevel: string } | null>(null);
  const askOptionsRef = useRef<{ id: string; response: unknown }[]>([]);
  const askRef = useRef<((v: unknown) => void) | null>(null);
  const [lost, setLost] = useState(false);
  const [page, setPage] = useState(0);
  const [mode, setMode] = useState<string>("auto");
  const [history, setHistory] = useState<string[]>([]);
  const historyIdx = useRef(-1);
  const [thoughtLevel, setThoughtLevel] = useState<string>("enabled");
  const [effort, setEffort] = useState<(typeof EFFORTS)[number]>("low");
  const [ctx, setCtx] = useState<{ used: number; window: number } | null>(null);
  const [draft, setDraft] = useState("");
  const draftRef = useRef("");
  const [typing, setTyping] = useState(true);
  // Transient status toast — OpenCode surfaces these as toasts, never as a
  // permanent bar. The message rides the composer hint slot for a few seconds.
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashStatus = (message: string) => {
    setStatus(message);
    setFlash(message);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 4000);
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
  const [models, setModels] = useState<ModelChoice[]>(ALLOWED_MODELS.map((m) => ({ ...m })));
  const [modelIdx, setModelIdx] = useState(0);
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
  const scrollRef = useRef<{ scrollTop?: number } | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const resumed = useRef(false);
  const dims = useTerminalDimensions();
  const C = THEMES[theme];
  const mdStyle = useMemo(() => mdStyleFor(theme), [theme]);
  const spinner = useSpinner(running && view === "session");

  const orderedSessions = [...sessions].sort((a, b) => {
    const ap = pinned.includes(a.sessionId) ? 1 : 0;
    const bp = pinned.includes(b.sessionId) ? 1 : 0;
    return bp - ap || b.updatedAt - a.updatedAt;
  });
  const activeTitle = activeId
    ? displayTitle(sessions.find((s) => s.sessionId === activeId) ?? { sessionId: activeId, title: "", status: "", updatedAt: Date.now() })
    : "";
  const activeModel = models[modelIdx] ?? models[0];
  const promptWidth = Math.max(56, Math.min(86, Math.floor(dims.width * 0.62)));
  const cwdFull = shortCwd(process.cwd());
  const cwd = cwdFull.length > 42 ? `…${cwdFull.slice(-41)}` : cwdFull;
  const slashToken = typing && draft.startsWith("/") && !draft.includes(" ") ? draft.slice(1) : null;
  const sugMatches = slashToken === null ? [] : matchSlashCommands(slashToken);
  const sugOpen = sugMatches.length > 0 && !sugDismissed.current;

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

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

  const persistTheme = (next: ThemeName) => {
    try {
      mkdirSync(`${process.env.HOME}/.config/zcode-tui`, { recursive: true });
      writeFileSync(`${process.env.HOME}/.config/zcode-tui/theme`, next);
    } catch { /* best effort */ }
    setTheme(next);
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
      setStatus(`error: ${e instanceof Error ? e.message : e}`);
    }
  };

  const loadModels = async () => {
    try {
      const ws = { workspacePath: process.cwd(), workspaceKey: process.cwd() };
      await client.request("workspace/readState", { workspace: ws });
      // The allowlist remains authoritative. The response is only a backend
      // liveness check; it cannot add paid or stale catalog entries.
      const avail = ALLOWED_MODELS.map((m) => ({ ...m }));
      setModels(avail);
      const requested = modelId ? avail.findIndex((m) => m.modelId === modelId) : -1;
      const defaultIndex = avail.findIndex((m) => m.isDefault);
      setModelIdx(requested >= 0 ? requested : Math.max(0, defaultIndex));
    } catch {
      // The home screen remains usable while optional catalog polish is down.
    }
  };

  const subscribe = async (sessionId: string) => {
    try {
      await client.request("session/subscribe", {
        sessionId,
        deliveryKind: "desktop-continuous",
        includeSnapshot: false,
      });
    } catch (e) {
      setStatus(`subscribe failed: ${e instanceof Error ? e.message : e}`);
    }
  };

  const open = async (row: SessionRow) => {
    setView("session");
    setTyping(false);
    setDraft("");
    setStatus(`opening ${displayTitle(row)}…`);
    try {
      const res = (await client.request("session/resume", { sessionId: row.sessionId })) as {
        messages?: { info: Record<string, unknown>; parts: unknown }[];
      };
      const turns: TurnMessage[] = (res.messages ?? []).map((m) => ({
        role: String(m.info?.role ?? "?"),
        text: extractText(m.parts),
        model: String((m.info?.model as Record<string, unknown> | undefined)?.modelId ?? "") || undefined,
        messageId: String(m.info?.id ?? m.info?.messageId ?? "") || undefined,
      }));
      setMsgs(turns);
      setActiveId(row.sessionId);
      setMode(row.mode ?? "build");
      setPage(0);
      await subscribe(row.sessionId);
      setStatus(`${displayTitle(row)} · ${turns.length} messages`);
      probe("resume", row.sessionId.slice(0, 18));
    } catch (e) {
      setStatus(`open failed: ${e instanceof Error ? e.message : e}`);
    }
  };

  const newSession = async (): Promise<string | null> => {
    setStatus("creating session…");
    try {
      const selected = modelId && models.some((m) => m.modelId === modelId)
        ? modelId
        : activeModel?.modelId ?? "GLM-5.3-Flash";
      const res = (await client.request("session/create", {
        workspace: { workspacePath: process.cwd(), workspaceKey: process.cwd() },
        mode: "build",
        persistence: "immediate",
        model: { providerId: "zai", modelId: selected },
      })) as { session?: Record<string, unknown> };
      const raw = res.session;
      if (!raw) throw new Error("create returned no session");
      const row = normalizeSession(raw);
      setSessions((current) => [row, ...current.filter((x) => x.sessionId !== row.sessionId)]);
      setSel(0);
      setMsgs([]);
      setActiveId(row.sessionId);
      setMode("build");
      setPage(0);
      setView("session");
      await subscribe(row.sessionId);
      setTyping(true);
      setStatus(`${displayTitle(row)} · ready`);
      return row.sessionId;
    } catch (e) {
      setStatus(`create failed: ${e instanceof Error ? e.message : e}`);
      return null;
    }
  };

  const send = async (content: string, targetId = activeId) => {
    if (!targetId || running) return;
    probe("turn-start", content.slice(0, 40));
    setRunning(true);
    setView("session");
    setPage(0);
    setHistory((h) => [content, ...h.filter((x) => x !== content)]);
    historyIdx.current = -1;
    setMsgs((m) => [...m, { role: "user", text: content }, { role: "assistant", text: "", model: modelLabel(activeModel), turnStart: Date.now() }]);
    setStatus("working…");
    try {
      await client.request("session/send", { sessionId: targetId, content });
    } catch (e) {
      setStatus(`send failed: ${e instanceof Error ? e.message : e}`);
      setRunning(false);
    }
  };

  const submitPrompt = async (content: string) => {
    if (content.startsWith("/") && parseSlashCommand(content) === null) {
      // Refuse locally instead of feeding the model a typo (owner law:
      // unknown slash commands must never become a billed chat turn).
      // Astra correction (2026-09-08): keep the rejected draft on screen so
      // the user edits rather than retypes.
      flashStatus(`unknown command ${content.split(/\s+/, 1)[0]} · type / for the command list`);
      return;
    }
    setDraft("");
    draftRef.current = "";
    sugDismissed.current = false;
    moveSug(0);
    setTyping(true);
    if (content.startsWith("/")) {
      const command = parseSlashCommand(content);
      if (command === "sessions") { setDeleteId(null); setDialog("sessions"); return; }
      if (command === "home") { setView("home"); return; }
      if (command === "new") { await newSession(); return; }
      if (command === "model") { setDialog("model"); return; }
      if (command === "themes") { setDialog("themes"); return; }
      if (command === "commands") { setDialog("palette"); return; }
      if (command === "mode") { await cycleMode(); return; }
      if (command === "effort") { cycleEffort(); return; }
      if (command === "thinking") { await toggleThinking(); return; }
      if (command === "fork") { await forkActive(); return; }
      if (command === "compact") { await compactActive(); return; }
      if (command === "quit") { onQuit(); return; }
      return;
    }
    if (activeId) {
      await send(content, activeId);
      return;
    }
    const id = await newSession();
    if (id) await send(content, id);
  };

  const openSessions = () => {
    setDeleteId(null);
    setDialog("sessions");
    setTyping(false);
  };

  const closeDialog = () => {
    setDialog(null);
    if (view === "home") setTyping(true);
  };

  const cycleMode = async () => {
    const cur = MODES.includes(mode as (typeof MODES)[number]) ? mode as (typeof MODES)[number] : "build";
    const next = MODES[(MODES.indexOf(cur) + 1) % MODES.length];
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
      flashStatus(`setMode failed: ${e instanceof Error ? e.message : e}`);
    }
  };

  const cycleEffort = () => {
    const next = EFFORTS[(EFFORTS.indexOf(effort) + 1) % EFFORTS.length];
    setEffort(next);
    flashStatus(`effort → ${next}`);
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
      flashStatus(`setThoughtLevel failed: ${e instanceof Error ? e.message : e}`);
    }
  };

  const openForkDialog = () => {
    if (!activeId || running || msgs.length === 0) return;
    const opts = msgs
      .map((m) => ({ id: m.messageId ?? "", value: m.messageId ?? "", label: `${m.role}: ${m.text.replace(/\s+/g, " ").slice(0, 70)}` }))
      .filter((o) => o.id.length > 0);
    if (opts.length === 0) {
      flashStatus("no message ids available for fork target");
      return;
    }
    setForkOptions(opts);
    setDialog("fork");
  };

  const forkActive = async () => {
    if (!activeId || running) return;
    setStatus("forking…");
    try {
      const res = (await client.request("session/fork", { sessionId: activeId, target: { kind: "latestCheckpoint" } })) as { forkedSessionId?: string };
      const fid = res.forkedSessionId;
      if (!fid) throw new Error("no forkedSessionId in response");
      setMsgs([]);
      setActiveId(fid);
      await subscribe(fid);
      flashStatus(`fork ${fid.slice(0, 13)} · ready`);
      void refresh();
    } catch (e) {
      flashStatus(`fork failed: ${e instanceof Error ? e.message : e}`);
    }
  };

  const compactActive = async () => {
    if (!activeId || running) return;
    setStatus("compacting…");
    try {
      const res = (await client.request("session/compact", { sessionId: activeId })) as { compact?: { state?: string } };
      flashStatus(`compact: ${res.compact?.state ?? "done"}`);
      void open({ sessionId: activeId, title: activeTitle, status: "", updatedAt: Date.now(), mode });
    } catch (e) {
      flashStatus(`compact failed: ${e instanceof Error ? e.message : e}`);
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
      setDialog(null);
      if (activeId === row.sessionId) {
        setActiveId(null);
        setMsgs([]);
        setView("home");
        setTyping(true);
      }
      flashStatus(`deleted ${displayTitle(row)}`);
    } catch (e) {
      flashStatus(`delete failed: ${e instanceof Error ? e.message : e}`);
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
        askOptionsRef.current = opts.map((o) => ({ id: String(o.optionId), response: o.response }));
        return new Promise((resolve) => {
          probe("permission-ask", `${toolName}:${detail.slice(0, 40)}`);
          askRef.current = resolve as (v: unknown) => void;
          setAsk({ toolName, detail, riskLevel });
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
        } else if (type === "result" && payload.toolCallId) {
          const result = (payload.result ?? {}) as Record<string, unknown>;
          setMsgs((current) => current.map((x) => x.toolCallId === payload.toolCallId ? {
            ...x,
            toolOut: String(result.content ?? result.error ?? "").slice(0, 220),
            toolOk: result.success !== false,
            toolMs: Number((result.perf as Record<string, unknown> | undefined)?.totalMs ?? 0) || undefined,
          } : x));
        } else if (type === "text_delta") {
          const delta = (payload.delta ?? payload.text ?? payload.content) as string | undefined;
          if (delta) appendTail(delta);
        } else if (type === "reasoning_delta") {
          const delta = (payload.delta ?? payload.text ?? payload.content) as string | undefined;
          if (delta) setThinking((current) => current + delta);
        } else if (typeof payload.content === "string" && payload.stopReason) {
          const usage = payload.usage as Record<string, unknown> | undefined;
          if (typeof payload.contextWindow === "number" && typeof usage?.inputTokens === "number") {
            setCtx({ used: usage.inputTokens, window: payload.contextWindow });
          }
          const outputTokens = Number(usage?.outputTokens ?? usage?.totalTokens ?? 0) || undefined;
          setMsgs((current) => {
            if (current.length === 0) return current;
            const last = current[current.length - 1];
            if (last.role !== "assistant") return current;
            return [...current.slice(0, -1), {
              ...last,
              text: payload.content as string,
              durationMs: last.turnStart ? Date.now() - last.turnStart : undefined,
              outputTokens,
              thinking: thinkingRef.current || undefined,
              thinkingMs: thinkingRef.current && last.turnStart ? Date.now() - last.turnStart : undefined,
            }];
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
        if (patch.status === "running") setRunning(true);
        if (patch.status === "idle" || patch.status === "completed") setRunning(false);
      } else if (method === "v4/telemetry/event" && params?.kind === "turn.terminal") {
        setRunning(false);
        void refresh();
      }
    });
  }, [client]);

  useEffect(() => {
    try {
      const saved = readFileSync(`${process.env.HOME}/.config/zcode-tui/theme`, "utf8").trim() as ThemeName;
      if (THEME_NAMES.includes(saved)) setTheme(saved);
    } catch { /* first run */ }
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
    void open({ sessionId: resumeId, title: "Resuming session", status: "", updatedAt: Date.now() });
  }, [resumeId]);

  useEffect(() => {
    try {
      mkdirSync(`${process.env.HOME}/.config/zcode-tui`, { recursive: true });
      writeFileSync(`${process.env.HOME}/.config/zcode-tui/pinned.json`, JSON.stringify(pinned));
    } catch { /* best effort */ }
  }, [pinned]);

  useKeyboard((key) => {
    if (dialog !== null) return;

    if (askRef.current) {
      const resolve = askRef.current;
      if (key.name === "y") {
        askRef.current = null;
        setAsk(null);
        resolve({ decision: "allow" });
        probe("permission-answered", "allow");
        flashStatus("permission allowed");
      } else if (key.name === "a") {
        askRef.current = null;
        setAsk(null);
        const always = askOptionsRef.current.find((x) => /always|project|allow/i.test(x.id));
        resolve(always?.response ?? { decision: "allow" });
        probe("permission-answered", "always");
        flashStatus("permission allowed · always");
      } else if (key.name === "n" || key.name === "escape") {
        askRef.current = null;
        setAsk(null);
        resolve({ decision: "deny" });
        probe("permission-answered", "deny");
        flashStatus("permission denied");
      }
      return;
    }

    // Leader chord (ctrl+x then a key), the OpenCode navigation grammar:
    // b sidebar · t themes · l sessions · n new · c compact · q quit.
    // The armed leader consumes the next key unconditionally — no timeout —
    // so a slow chord can never leak its second key into the composer draft.
    if (leaderArmed.current) {
      disarmLeader();
      if (key.name === "b") { if (view === "session") setSidebarOpen((s) => !s); return; }
      if (key.name === "t") { setDialog("themes"); return; }
      if (key.name === "l") { openSessions(); return; }
      if (key.name === "n") { void newSession(); return; }
      if (key.name === "c") { void compactActive(); return; }
      if (key.name === "q") { onQuit(); return; }
      return;
    }
    if (key.ctrl && key.name === "x") {
      armLeader();
      return;
    }
    if (key.ctrl && key.name === "k" || key.ctrl && key.name === "p") {
      setTyping(false);
      setDialog("palette");
      return;
    }
    // shift+tab cycles the mode — the OpenCode agent-cycle slot.
    if ((key.name === "tab" && (key as { shift?: boolean }).shift) || key.sequence === "\x1b[Z") {
      void cycleMode();
      return;
    }
    if (key.ctrl && key.name === "s") {
      openSessions();
      return;
    }
    if (key.ctrl && key.name === "q") {
      onQuit();
      return;
    }
    if (key.ctrl && key.name === "c") {
      if (typing) { draftRef.current = ""; setDraft(""); return; }
      onQuit();
      return;
    }

    if (typing) {
      // Slash autocomplete reads the immediate draft ref: while the draft is a
      // single "/token", up/down/tab/enter belong to the popup, not to
      // history or submission.
      const token = draftRef.current.startsWith("/") && !draftRef.current.includes(" ")
        ? draftRef.current.slice(1)
        : null;
      const sugMatches = token === null ? [] : matchSlashCommands(token);
      const sugOpenNow = sugMatches.length > 0 && !sugDismissed.current;
      if (key.name === "escape") {
        if (sugOpenNow) { sugDismissed.current = true; return; }
        setTyping(false); draftRef.current = ""; setDraft(""); return;
      }
      if (key.name === "backspace" || key.sequence === "\x7f" || key.sequence === "\b") {
        const next = draftRef.current.slice(0, -1);
        draftRef.current = next;
        setDraft(next);
        sugDismissed.current = false;
        moveSug(0);
        return;
      }
      if (sugOpenNow && (key.name === "up" || key.name === "down")) {
        const delta = key.name === "up" ? -1 : 1;
        moveSug(Math.max(0, Math.min(sugMatches.length - 1, sugIdxRef.current + delta)));
        return;
      }
      if (sugOpenNow && key.name === "tab") {
        const picked = `${sugMatches[sugIdxRef.current].name} `;
        draftRef.current = `/${picked}`;
        setDraft(`/${picked}`);
        sugDismissed.current = false;
        moveSug(0);
        return;
      }
      if (key.name === "up" || key.name === "down") {
        if (history.length === 0) return;
        const next = key.name === "up"
          ? Math.min(historyIdx.current + 1, history.length - 1)
          : Math.max(historyIdx.current - 1, -1);
        historyIdx.current = next;
        const restored = next >= 0 ? history[next] : "";
        draftRef.current = restored;
        setDraft(restored);
        return;
      }
      if (key.name === "return") {
        // A PTY can deliver a fast text burst and the Enter stroke before
        // React has committed the previous setState. The ref is the immediate
        // keyboard truth; it keeps `/sessions\r` equivalent to two human
        // keystrokes while the rendered draft remains state-controlled.
        if (sugOpenNow) {
          const content = `/${sugMatches[Math.min(sugIdxRef.current, sugMatches.length - 1)].name}`;
          draftRef.current = "";
          setDraft("");
          sugDismissed.current = false;
          moveSug(0);
          if (!running) void submitPrompt(content);
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
      if (key.sequence && !key.ctrl && /^[^\x00-\x1f\x7f]+$/u.test(key.sequence)) {
        const next = draftRef.current + key.sequence;
        draftRef.current = next;
        setDraft(next);
        sugDismissed.current = false;
        moveSug(0);
      }
      return;
    }

    if (key.name === "escape") {
      if (view === "session") { setView("home"); setTyping(true); }
      else onQuit();
    } else if (key.name === "q") onQuit();
    else if (key.name === "i") { setTyping(true); setDraft(""); }
    else if (key.name === "s") openSessions();
    else if (key.name === "a") void newSession();
    else if (key.name === "m") setDialog("model");
    else if (key.name === "t") setDialog("themes");
    else if (key.name === "o") void cycleMode();
    else if (key.name === "e") cycleEffort();
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
      if (page * 30 < msgs.length) setPage((p) => p + 1);
      if (scrollRef.current?.scrollTop !== undefined) scrollRef.current.scrollTop = Math.max(0, scrollRef.current.scrollTop - 10);
    } else if (key.name === "]") {
      if (page > 0) setPage((p) => p - 1);
      if (scrollRef.current?.scrollTop !== undefined) scrollRef.current.scrollTop += 10;
    } else if (key.name === "return" && view === "home") setTyping(true);
  });

  const sessionOptions: DialogOption<SessionRow>[] = orderedSessions.map((row) => ({
    id: row.sessionId,
    label: displayTitle(row),
    meta: pinned.includes(row.sessionId) ? "pinned" : undefined,
    group: formatDateHeading(row.updatedAt),
    description: statusMeta(row),
    value: row,
  }));

  if (dialog === "sessions") {
    return (
      <SelectDialog
        title="Sessions for zcode-tui"
        options={sessionOptions}
        currentId={activeId ?? undefined}
        theme={C}
        footer="pin/unpin ctrl+f   delete ctrl+d   rename ctrl+r   all projects ctrl+a"
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
        onSelect={(row) => { setDialog(null); void open(row); }}
        onClose={closeDialog}
      />
    );
  }
  if (dialog === "model") {
    return (
      <SelectDialog
        title="Model"
        options={models.map((m) => ({ id: m.modelId, label: modelLabel(m), description: `${m.providerId}/${m.modelId}`, value: m }))}
        currentId={activeModel?.modelId}
        theme={C}
        countLabel="model"
        onSelect={(choice) => {
          const index = models.findIndex((m) => m.modelId === choice.modelId);
          setModelIdx(Math.max(0, index));
          setDialog(null);
          if (!activeId) { flashStatus(`model → ${modelLabel(choice)}`); return; }
          void client.request("session/setModel", { sessionId: activeId, model: { providerId: choice.providerId, modelId: choice.modelId } })
            .then(() => flashStatus(`model → ${modelLabel(choice)}`))
            .catch((e) => flashStatus(`setModel failed: ${e instanceof Error ? e.message : e}`));
        }}
        onClose={closeDialog}
      />
    );
  }
  if (dialog === "themes") {
    return (
      <SelectDialog
        title="Themes"
        options={sortedThemes().map((name) => ({ id: name, label: name, description: name === "opencode" ? "OpenCode reference palette" : name === "zai-dark" || name === "zai-light" ? "ZCode brand arm" : "OpenCode palette", value: name }))}
        currentId={theme}
        theme={C}
        countLabel="theme"
        onSelect={(name) => { persistTheme(name); setDialog(null); flashStatus(`theme → ${name}`); }}
        onClose={closeDialog}
      />
    );
  }
  if (dialog === "fork") {
    return (
      <SelectDialog
        title="Fork at message"
        options={forkOptions}
        theme={C}
        countLabel="message"
        onSelect={(messageId) => {
          setDialog(null);
          if (!activeId) return;
          setStatus("forking…");
          void client.request("session/fork", { sessionId: activeId, target: { kind: "message", messageId } })
            .then(async (res) => {
              const fid = (res as { forkedSessionId?: string }).forkedSessionId;
              if (!fid) throw new Error("no forkedSessionId");
              setMsgs([]);
              setActiveId(fid);
              await subscribe(fid);
              flashStatus(`fork ${fid.slice(0, 13)} · ready`);
              void refresh();
            })
            .catch((e) => flashStatus(`fork failed: ${e instanceof Error ? e.message : e}`));
        }}
        onClose={closeDialog}
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
          setDialog(null);
          flashStatus(`rename pending host support · ${value}`);
        }}
        onClose={closeDialog}
      />
    );
  }
  if (dialog === "palette") {
    const commands: DialogOption<() => void>[] = [
      { id: "sessions", label: "sessions", description: "browse and resume conversations", value: openSessions },
      { id: "new", label: "new session", description: "start a fresh ZCode session", value: () => void newSession() },
      { id: "model", label: "switch model…", description: "choose from the safe model allowlist", value: () => setDialog("model") },
      { id: "effort", label: "cycle reasoning effort", description: "low · high · max", value: cycleEffort },
      { id: "mode", label: "cycle mode", description: "plan · build · edit · yolo · auto", value: () => void cycleMode() },
      { id: "thinking", label: "toggle thinking", value: () => void toggleThinking() },
      { id: "fork", label: "fork session", description: "latest checkpoint", value: () => void forkActive() },
      { id: "fork-message", label: "fork at message…", value: openForkDialog },
      { id: "compact", label: "compact session", value: () => void compactActive() },
      { id: "themes", label: "themes…", description: "the full OpenCode palette set", value: () => setDialog("themes") },
      { id: "sidebar", label: "toggle sidebar", description: "leader b", value: () => { if (view === "session") setSidebarOpen((s) => !s); } },
      { id: "refresh", label: "refresh sessions", value: () => void refresh() },
      { id: "home", label: "home", description: "return to the zcodetui front page", value: () => { setView("home"); setTyping(true); } },
      { id: "quit", label: "quit", value: onQuit },
    ];
    return (
      <SelectDialog
        title="Commands"
        options={commands}
        theme={C}
        countLabel="command"
        footer="↑↓ navigate   enter run   esc close"
        onSelect={(fn) => { setDialog(null); setTimeout(fn, 30); }}
        onClose={closeDialog}
      />
    );
  }

  const promptPlaceholder = view === "home"
    ? 'Ask anything…  "What is the tech stack of this project?"'
    : activeId ? "Ask anything…" : "a new session · type a prompt";
  const promptText = draft || promptPlaceholder;
  const providerLabel = activeModel?.providerId ?? "zai";
  const composerProps = {
    C,
    typing,
    mode,
    model: modelLabel(activeModel),
    provider: providerLabel,
    effort,
    thinkingOff: thoughtLevel === "disabled",
    leaderActive,
  };
  const hintBits = "shift+tab mode   ctrl+p commands";
  const ctxLabel = ctx && ctx.window > 0 ? `${formatContextLabel(ctx.used, ctx.window)}  ` : "";

  if (view === "home") {
    return (
      <box style={{ flexDirection: "column", backgroundColor: C.bg, width: "100%", flexGrow: 1 }}>
        <box style={{ flexDirection: "column", alignItems: "center", flexGrow: 1, paddingLeft: 2, paddingRight: 2 }}>
          <box style={{ flexGrow: 1 }} />
          <box style={{ height: 3, flexShrink: 0 }} />
          <ZCodeLogo C={C} />
          <box style={{ height: 1, flexShrink: 0 }} />
          <text content="zcodetui" fg={C.faint} />
          <box style={{ height: 1, flexShrink: 0 }} />
          <text content="/sessions  to browse conversations" fg={C.accent} />
          <box style={{ height: 1, flexShrink: 0 }} />
          <box style={{ width: promptWidth, flexShrink: 0 }}>
            {sugOpen ? <SlashPopup matches={sugMatches} idx={sugIdx} C={C} width={promptWidth} /> : null}
            <Composer width={promptWidth} underlineWidth={promptWidth - 1} promptText={promptText} isPlaceholder={!draft} {...composerProps} />
          </box>
          <box style={{ width: promptWidth, flexDirection: "row", justifyContent: "space-between", flexShrink: 0, paddingLeft: 1, paddingRight: 1 }}>
            <text content={cwd.length > 26 ? `…${cwd.slice(-25)}` : cwd} fg={C.subtle} />
            <text content={flash ?? hintBits} fg={C.subtle} />
          </box>
          <box style={{ flexGrow: 1 }} />
        </box>
      </box>
    );
  }

  const end = Math.max(30, msgs.length - page * 30);
  const start = Math.max(0, end - 30);
  return (
    <box style={{ flexDirection: "column", backgroundColor: C.bg, width: "100%", flexGrow: 1 }}>
      <box style={{ flexDirection: "row", flexGrow: 1, minHeight: 0 }}>
        {msgs.length === 0 ? (
          <box style={{ flexGrow: 1, flexDirection: "column", paddingLeft: 3, paddingRight: 3, paddingTop: 2 }}>
            <text content="No messages yet." fg={C.subtle} />
            <text content="i to type · Enter sends · /sessions opens the session browser" fg={C.faint} />
          </box>
        ) : (
          <scrollbox ref={scrollRef as never} style={{ flexGrow: 1, flexDirection: "column", paddingTop: 1 }}>
            {msgs.slice(start, end).map((m, index) => (
              <MessageView
                key={`${m.messageId ?? index}-${m.role}`}
                m={m}
                running={running}
                thinking={thinking}
                C={C}
                mdStyle={mdStyle}
                isTail={page === 0 && start + index === msgs.length - 1}
              />
            ))}
          </scrollbox>
        )}
        {sidebarOpen && view === "session" && activeId ? (
          <SessionSidebar C={C} title={activeTitle || "zcode-tui"} sessionId={activeId} ctx={ctx} />
        ) : null}
      </box>
      {ask ? (
        <box style={{ height: 1, flexDirection: "row", paddingLeft: 3, paddingRight: 3, flexShrink: 0 }}>
          <text content={`△ ${ask.toolName}${ask.riskLevel ? ` (${ask.riskLevel})` : ""}: ${ask.detail.slice(0, 52)} · y allow · a always · n deny`} fg={C.warning} />
        </box>
      ) : null}
      {queue.length > 0 ? (
        <box style={{ height: 1, flexDirection: "row", paddingLeft: 3, paddingRight: 3, flexShrink: 0 }}>
          <text content={`⧗ ${queue.length} queued · next: ${queue[0].slice(0, 48)}`} fg={C.warning} />
        </box>
      ) : null}
      {sugOpen ? <SlashPopup matches={sugMatches} idx={sugIdx} C={C} /> : null}
      <box style={{ flexDirection: "row", paddingLeft: 2, paddingRight: 2, flexShrink: 0 }}>
        <Composer width="100%" underlineWidth={Math.max(10, dims.width - 5)} promptText={promptText} isPlaceholder={!draft} {...composerProps} />
      </box>
      <box style={{ height: 1, flexDirection: "row", justifyContent: "space-between", paddingLeft: 3, paddingRight: 2, flexShrink: 0 }}>
        {running ? (
          <text content={`${spinner} Working…`} fg={modeAccent(mode, C)} />
        ) : (
          <text content={lost ? "backend lost · r to reconnect" : cwd} fg={C.subtle} />
        )}
        <text content={running ? `${ctxLabel} ` : `${ctxLabel}${flash ?? hintBits}`} fg={C.subtle} />
      </box>
    </box>
  );
}
