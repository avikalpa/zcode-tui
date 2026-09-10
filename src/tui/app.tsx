// zcode-tui — an OpenCode-shaped ZCode client.
//
// The runtime and protocol stay ZCode's. This file owns the presentation
// layer: home, sessions picker, session transcript, composer, themes, and the
// small keyboard state machines that make those surfaces feel like one TUI.
import { memo, useEffect, useRef, useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { SyntaxStyle } from "@opentui/core";
import { SelectDialog, TextPromptDialog, type DialogOption } from "./select-dialog";
import type { AppServer } from "../protocol/client";
import { recentInputs } from "../store/history";
import { probe } from "./probes";
import { Announcer, type AnnouncePhase } from "./announce";
import {
  formatDateHeading,
  parseSlashCommand,
  shortCwd,
  THEMES,
  THEME_NAMES,
  type ThemeName,
  type ThemeTokens,
} from "./design";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const MD_STYLE = SyntaxStyle.create();

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
}

// A compact block mark that keeps the same proportions as OpenCode's logo.
// ZCode's mark is split into a quiet wordmark and a brighter TUI suffix.
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

const TurnView = memo(function TurnView({
  m,
  running,
  thinking,
  C,
  isTail,
}: {
  m: TurnMessage;
  running: boolean;
  thinking: string;
  C: ThemeTokens;
  isTail: boolean;
}) {
  if (m.role === "tool") {
    const output = (m.toolOut ?? m.text).replace(/\s+/g, " ").slice(0, 110);
    const result = m.toolOk === undefined ? " …" : m.toolOk ? ` ✓${m.toolMs ? ` ${m.toolMs}ms` : ""}` : " ✗";
    return (
      <box style={{ flexDirection: "row", paddingLeft: 2, paddingRight: 2, height: 1, flexShrink: 0, backgroundColor: C.surface }}>
        <text content={`⚙ ${m.toolName ?? "tool"}  ${output}${result}`} fg={m.toolOk === false ? C.error : C.tool} />
      </box>
    );
  }

  const isUser = m.role === "user";
  return (
    <box style={{ flexDirection: "column", paddingLeft: 2, paddingRight: 2, paddingTop: 1 }}>
      <text content={`${isUser ? "› you" : "◆ assistant"}${m.model ? ` · ${m.model}` : ""}`} fg={isUser ? C.user : C.assistant} />
      <box style={{ paddingLeft: 2, paddingRight: 1 }}>
        {!isUser && !running ? (
          <markdown content={m.text || "∅"} syntaxStyle={MD_STYLE} />
        ) : (
          <text content={m.text || (running ? "…" : "∅")} fg={C.fg} />
        )}
        {running && isTail && thinking ? <text content={thinking.slice(-220)} fg={C.faint} /> : null}
      </box>
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
  const [models, setModels] = useState<ModelChoice[]>(ALLOWED_MODELS.map((m) => ({ ...m })));
  const [modelIdx, setModelIdx] = useState(0);
  const [pinned, setPinned] = useState<string[]>([]);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<SessionRow | null>(null);
  const scrollRef = useRef<{ scrollTop?: number } | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const resumed = useRef(false);
  const dims = useTerminalDimensions();
  const C = THEMES[theme];

  const orderedSessions = [...sessions].sort((a, b) => {
    const ap = pinned.includes(a.sessionId) ? 1 : 0;
    const bp = pinned.includes(b.sessionId) ? 1 : 0;
    return bp - ap || b.updatedAt - a.updatedAt;
  });
  const activeTitle = activeId
    ? displayTitle(sessions.find((s) => s.sessionId === activeId) ?? { sessionId: activeId, title: "", status: "", updatedAt: Date.now() })
    : "";
  const activeModel = models[modelIdx] ?? models[0];
  const promptWidth = Math.max(44, Math.min(86, Math.floor(dims.width * 0.68)));
  const cwd = shortCwd(process.cwd());

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
    setMsgs((m) => [...m, { role: "user", text: content }, { role: "assistant", text: "" }]);
    setStatus("working…");
    try {
      await client.request("session/send", { sessionId: targetId, content });
    } catch (e) {
      setStatus(`send failed: ${e instanceof Error ? e.message : e}`);
      setRunning(false);
    }
  };

  const submitPrompt = async (content: string) => {
    const command = parseSlashCommand(content);
    setDraft("");
    setTyping(false);
    if (command === "sessions") {
      setDeleteId(null);
      setDialog("sessions");
      return;
    }
    if (command === "home") {
      setView("home");
      setTyping(true);
      return;
    }
    if (command === "new") {
      await newSession();
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
      setStatus(`mode → ${next}`);
      return;
    }
    try {
      await client.request("session/setMode", { sessionId: activeId, mode: next });
      setMode(next);
      setStatus(`mode → ${next}`);
    } catch (e) {
      setStatus(`setMode failed: ${e instanceof Error ? e.message : e}`);
    }
  };

  const cycleEffort = () => {
    const next = EFFORTS[(EFFORTS.indexOf(effort) + 1) % EFFORTS.length];
    setEffort(next);
    setStatus(`effort → ${next}`);
  };

  const toggleThinking = async () => {
    const next = thoughtLevel === "disabled" ? "enabled" : "disabled";
    if (!activeId) {
      setThoughtLevel(next);
      setStatus(`thinking → ${next}`);
      return;
    }
    try {
      await client.request("session/setThoughtLevel", { sessionId: activeId, thoughtLevel: next });
      setThoughtLevel(next);
      setStatus(`thinking → ${next}`);
    } catch (e) {
      setStatus(`setThoughtLevel failed: ${e instanceof Error ? e.message : e}`);
    }
  };

  const openForkDialog = () => {
    if (!activeId || running || msgs.length === 0) return;
    const opts = msgs
      .map((m) => ({ id: m.messageId ?? "", value: m.messageId ?? "", label: `${m.role}: ${m.text.replace(/\s+/g, " ").slice(0, 70)}` }))
      .filter((o) => o.id.length > 0);
    if (opts.length === 0) {
      setStatus("no message ids available for fork target");
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
      setStatus(`fork ${fid.slice(0, 13)} · ready`);
      void refresh();
    } catch (e) {
      setStatus(`fork failed: ${e instanceof Error ? e.message : e}`);
    }
  };

  const compactActive = async () => {
    if (!activeId || running) return;
    setStatus("compacting…");
    try {
      const res = (await client.request("session/compact", { sessionId: activeId })) as { compact?: { state?: string } };
      setStatus(`compact: ${res.compact?.state ?? "done"}`);
      void open({ sessionId: activeId, title: activeTitle, status: "", updatedAt: Date.now(), mode });
    } catch (e) {
      setStatus(`compact failed: ${e instanceof Error ? e.message : e}`);
    }
  };

  const closeSession = async (row: SessionRow) => {
    if (deleteId !== row.sessionId) {
      setDeleteId(row.sessionId);
      setStatus(`press ctrl+d again to delete ${displayTitle(row)}`);
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
      setStatus(`deleted ${displayTitle(row)}`);
    } catch (e) {
      setStatus(`delete failed: ${e instanceof Error ? e.message : e}`);
    }
  };

  const togglePin = (row: SessionRow) => {
    setPinned((current) => current.includes(row.sessionId)
      ? current.filter((id) => id !== row.sessionId)
      : [row.sessionId, ...current]);
    setDeleteId(null);
    setStatus(`${pinned.includes(row.sessionId) ? "unpinned" : "pinned"} ${displayTitle(row)}`);
  };

  // Live turn updates: subscribe once, mutate the streaming assistant tail.
  useEffect(() => {
    client.onBackendLost(() => {
      setLost(true);
      setStatus("backend lost · r to reconnect");
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
          setMsgs((current) => {
            if (current.length === 0) return current;
            const last = current[current.length - 1];
            if (last.role !== "assistant") return current;
            return [...current.slice(0, -1), { ...last, text: payload.content as string }];
          });
          setThinking("");
          setRunning(false);
          if (usage && typeof usage.totalTokens === "number") {
            probe("turn-end", `tokens=${usage.totalTokens}`);
            setStatus(`turn done · ${usage.totalTokens} tokens`);
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
        setStatus("permission allowed");
      } else if (key.name === "a") {
        askRef.current = null;
        setAsk(null);
        const always = askOptionsRef.current.find((x) => /always|project|allow/i.test(x.id));
        resolve(always?.response ?? { decision: "allow" });
        probe("permission-answered", "always");
        setStatus("permission allowed · always");
      } else if (key.name === "n" || key.name === "escape") {
        askRef.current = null;
        setAsk(null);
        resolve({ decision: "deny" });
        probe("permission-answered", "deny");
        setStatus("permission denied");
      }
      return;
    }

    if (key.ctrl && key.name === "k") {
      setTyping(false);
      setDialog("palette");
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
      if (key.name === "escape") { setTyping(false); draftRef.current = ""; setDraft(""); return; }
      if (key.name === "backspace") {
        const next = draftRef.current.slice(0, -1);
        draftRef.current = next;
        setDraft(next);
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
        const content = draftRef.current.trim();
        if (content && !running) void submitPrompt(content);
        return;
      }
      if (key.sequence && !key.ctrl && /^[\x20-\x7E]+$/.test(key.sequence)) {
        const next = draftRef.current + key.sequence;
        draftRef.current = next;
        setDraft(next);
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
    else if (key.name === "b") openForkDialog();
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
          else if (action === "all") setStatus("all projects · showing every available session");
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
          if (!activeId) { setStatus(`model → ${modelLabel(choice)}`); return; }
          void client.request("session/setModel", { sessionId: activeId, model: { providerId: choice.providerId, modelId: choice.modelId } })
            .then(() => setStatus(`model → ${modelLabel(choice)}`))
            .catch((e) => setStatus(`setModel failed: ${e instanceof Error ? e.message : e}`));
        }}
        onClose={closeDialog}
      />
    );
  }
  if (dialog === "themes") {
    return (
      <SelectDialog
        title="Themes"
        options={sortedThemes().map((name) => ({ id: name, label: name, description: name === "opencode" ? "OpenCode reference palette" : "terminal colour arm", value: name }))}
        currentId={theme}
        theme={C}
        countLabel="theme"
        onSelect={(name) => { persistTheme(name); setDialog(null); setStatus(`theme → ${name}`); }}
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
              setStatus(`fork ${fid.slice(0, 13)} · ready`);
              void refresh();
            })
            .catch((e) => setStatus(`fork failed: ${e instanceof Error ? e.message : e}`));
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
          setStatus(`rename pending host support · ${value}`);
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
      { id: "themes", label: "themes…", description: "OpenCode plus terminal colour arms", value: () => setDialog("themes") },
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
  const modelLine = `${mode === "auto" ? "Build" : mode}  ${mode} · ${modelLabel(activeModel)} · ${effort}`;
  const footerHints = view === "home"
    ? "esc shortcuts   /sessions history   ctrl+k commands"
    : "i type   /sessions   m model   t themes   ctrl+k commands";
  const statusLine = `${lost ? "backend lost" : running ? "working" : activeId ? "ready" : "idle"} · ${status}`;

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
          <box
            style={{
              width: promptWidth,
              height: 4,
              flexDirection: "column",
              flexShrink: 0,
              borderStyle: "rounded",
              borderColor: typing ? C.borderActive : C.border,
              backgroundColor: C.panel,
              paddingLeft: 2,
              paddingRight: 2,
            }}
          >
            <text content={`› ${promptText}${typing ? "▏" : ""}`} fg={draft ? C.fg : C.faint} />
            <text content={modelLine} fg={C.subtle} />
          </box>
          <box style={{ flexGrow: 1 }} />
        </box>
        <box style={{ width: "100%", height: 1, flexDirection: "row", justifyContent: "space-between", paddingLeft: 2, paddingRight: 2, backgroundColor: C.panel, flexShrink: 0 }}>
          <text content={cwd} fg={C.subtle} />
          <text content={footerHints} fg={C.faint} />
        </box>
        <box style={{ height: 1, flexDirection: "row", paddingLeft: 2, paddingRight: 2, backgroundColor: C.panel, flexShrink: 0 }}>
          <text content={`${statusLine} · ${sessions.length} sessions`} fg={C.faint} />
        </box>
      </box>
    );
  }

  const end = Math.max(30, msgs.length - page * 30);
  const start = Math.max(0, end - 30);
  return (
    <box style={{ flexDirection: "column", backgroundColor: C.bg, width: "100%", flexGrow: 1 }}>
      <box style={{ height: 1, flexDirection: "row", justifyContent: "space-between", paddingLeft: 2, paddingRight: 2, backgroundColor: C.panel, flexShrink: 0 }}>
        <text content={activeTitle || "zcode-tui"} fg={C.brand} />
        <text content={`${page > 0 ? `page ${page + 1} · ` : ""}${msgs.length} messages`} fg={C.faint} />
      </box>
      {msgs.length === 0 ? (
        <box style={{ flexGrow: 1, flexDirection: "column", paddingLeft: 3, paddingRight: 3, paddingTop: 2 }}>
          <text content="No messages yet." fg={C.subtle} />
          <text content="i to type · Enter sends · /sessions opens the session browser" fg={C.faint} />
        </box>
      ) : (
        <scrollbox ref={scrollRef as never} style={{ flexGrow: 1, flexDirection: "column", paddingTop: 1 }}>
          {msgs.slice(start, end).map((m, index) => (
            <TurnView
              key={`${m.messageId ?? index}-${m.role}`}
              m={m}
              running={running}
              thinking={thinking}
              C={C}
              isTail={page === 0 && start + index === msgs.length - 1}
            />
          ))}
        </scrollbox>
      )}
      {ask ? (
        <box style={{ height: 1, flexDirection: "row", paddingLeft: 2, paddingRight: 2, backgroundColor: C.panel, flexShrink: 0 }}>
          <text content={`⚠ ${ask.toolName}${ask.riskLevel ? ` (${ask.riskLevel})` : ""}: ${ask.detail.slice(0, 52)} · y allow · a always · n deny`} fg={C.warning} />
        </box>
      ) : null}
      <box style={{ height: 5, flexDirection: "column", paddingLeft: 2, paddingRight: 2, flexShrink: 0 }}>
        <box style={{ height: 3, flexDirection: "column", borderStyle: "rounded", borderColor: typing ? C.borderActive : C.border, backgroundColor: C.panel, paddingLeft: 1, paddingRight: 1 }}>
          <text content={`› ${promptText}${typing ? "▏" : ""}`} fg={draft ? C.fg : C.faint} />
          <text content={`${mode} · ${modelLabel(activeModel)} · ${effort}${thoughtLevel === "disabled" ? " · thinking off" : ""}`} fg={C.subtle} />
        </box>
        <box style={{ height: 1, flexDirection: "row", justifyContent: "space-between" }}>
          <text content={typing ? "esc cancel · enter send" : "i to type · enter sends"} fg={C.faint} />
          <text content={footerHints} fg={C.faint} />
        </box>
      </box>
      <box style={{ height: 1, flexDirection: "row", justifyContent: "space-between", paddingLeft: 2, paddingRight: 2, backgroundColor: C.panel, flexShrink: 0 }}>
        <text content={`${cwd} · ${statusLine}`} fg={C.subtle} />
        <text content={`${ctx ? `ctx ${(ctx.used / 1000).toFixed(0)}k/${(ctx.window / 1000).toFixed(0)}k · ` : ""}zcode-tui`} fg={C.faint} />
      </box>
    </box>
  );
}
