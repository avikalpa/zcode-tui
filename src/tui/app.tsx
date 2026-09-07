// zcode-tui v0 — the ZCode sessions surface on OpenTUI.
// zai-dark tokens from zcodereversed FINDINGS.md (bg #161616, chrome #202020,
// border white 10%, fg neutral-300).
import { useEffect, useRef, useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { SyntaxStyle } from "@opentui/core";
import type { AppServer } from "../protocol/client";

const MD_STYLE = SyntaxStyle.create();

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
}

// zai arms from zcodereversed FINDINGS.md (desktop 3.11.2 theme tokens)
const THEMES = {
  "zai-dark": {
    bg: "#161616", chrome: "#202020", border: "#ffffff1a",
    fg: "#d4d4d4", subtle: "#a3a3a3", faint: "#6b6b6b",
    brand: "#ffffff", user: "#60a5fa", assistant: "#2dd4bf",
    selected: "#ffffff1a",
  },
  "zai-light": {
    bg: "#f8f8f8", chrome: "#ffffff", border: "#0d0d0d1a",
    fg: "#262626", subtle: "#595959", faint: "#8c8c8c",
    brand: "#000000", user: "#2563eb", assistant: "#0f766e",
    selected: "#0d0d0d0d",
  },
} as const;
type ThemeName = keyof typeof THEMES;

function relTime(ts: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function extractText(parts: unknown): string {
  if (!Array.isArray(parts)) return "";
  const out: string[] = [];
  for (const p of parts as Record<string, unknown>[]) {
    if (typeof p.text === "string") out.push(p.text);
    else if (typeof p.content === "string") out.push(p.content);
  }
  return out.join("");
}

export function App({ client, onQuit }: { client: AppServer; onQuit: () => void }) {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [sel, setSel] = useState(0);
  const [msgs, setMsgs] = useState<TurnMessage[]>([]);
  const [status, setStatus] = useState("connecting…");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [thinking, setThinking] = useState("");
  const [filter, setFilter] = useState<string | null>(null);
  const [theme, setTheme] = useState<ThemeName>("zai-dark");
  const [ask, setAsk] = useState<{ toolName: string; detail: string; riskLevel: string } | null>(null);
  const askRef = useRef<((v: unknown) => void) | null>(null);
  const [models, setModels] = useState<{ label: string; providerId: string; modelId: string }[]>([]);
  const scrollRef = useRef<{ scrollTop?: number } | null>(null);
  const [modelIdx, setModelIdx] = useState(-1);
  const dims = useTerminalDimensions();
  const C = THEMES[theme];
  const sideInner = 34 - 2; // sidebar width minus borders
  const maxTitle = sideInner - 1 /* pad */ - 2 /* cursor */;
  const maxRows = Math.max(1, Math.floor((dims.height - 4) / 2));
  const shown = sessions.filter(
    (s) => filter === null || (s.title ?? "").toLowerCase().includes(filter.toLowerCase()),
  );
  const start = Math.min(Math.max(0, sel - Math.floor(maxRows / 2)), Math.max(0, shown.length - maxRows));
  const activeTitle = activeId ? (sessions.find((s) => s.sessionId === activeId)?.title ?? "") : "";
  const visible = shown.slice(start, start + maxRows);

  const refresh = async () => {
    try {
      const res = (await client.request("session/list", { limit: 100 })) as {
        sessions?: SessionRow[];
      };
      const rows = (res.sessions ?? []).sort((a, b) => b.updatedAt - a.updatedAt);
      setSessions(rows);
      setStatus(`${rows.length} sessions`);
    } catch (e) {
      setStatus(`error: ${e instanceof Error ? e.message : e}`);
    }
  };

  const loadModels = async () => {
    try {
      const ws = { workspacePath: process.cwd(), workspaceKey: process.cwd() };
      const res = (await client.request("workspace/readState", { workspace: ws })) as {
        modelCatalog?: { available?: { label: string; ref: { providerId: string; modelId: string } }[] };
      };
      const avail = (res.modelCatalog?.available ?? []).map((m) => ({
        label: m.label, providerId: m.ref.providerId, modelId: m.ref.modelId,
      }));
      setModels(avail);
      if (avail.length > 0) setModelIdx(0);
    } catch {
      // catalog is optional polish; the status line already says why
    }
  };

  const cycleModel = async () => {
    if (!activeId || models.length === 0) return;
    const next = (modelIdx + 1) % models.length;
    const m = models[next];
    try {
      await client.request("session/setModel", {
        sessionId: activeId,
        model: { providerId: m.providerId, modelId: m.modelId },
      });
      setModelIdx(next);
      setStatus(`model → ${m.label} (${m.modelId})`);
    } catch (e) {
      setStatus(`setModel failed: ${e instanceof Error ? e.message : e}`);
    }
  };

  const forkActive = async () => {
    if (!activeId || running) return;
    setStatus("forking…");
    try {
      const res = (await client.request("session/fork", {
        sessionId: activeId,
        target: { kind: "latestCheckpoint" },
      })) as { forkedSessionId?: string };
      const fid = res.forkedSessionId;
      if (!fid) throw new Error("no forkedSessionId in response");
      setMsgs([]);
      setActiveId(fid);
      await subscribe(fid);
      setStatus(`fork ${fid.slice(0, 13)} · i to type`);
      void refresh();
    } catch (e) {
      setStatus(`fork failed: ${e instanceof Error ? e.message : e}`);
    }
  };

  const compactActive = async () => {
    if (!activeId || running) return;
    setStatus("compacting…");
    try {
      const res = (await client.request("session/compact", { sessionId: activeId })) as {
        compact?: { state?: string };
      };
      setStatus(`compact: ${res.compact?.state ?? "done"}`);
      void open({ sessionId: activeId, title: activeTitle, status: "", updatedAt: 0 });
    } catch (e) {
      setStatus(`compact failed: ${e instanceof Error ? e.message : e}`);
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
    setStatus(`opening ${row.sessionId.slice(0, 13)}…`);
    try {
      const res = (await client.request("session/resume", { sessionId: row.sessionId })) as {
        messages?: { info: Record<string, unknown>; parts: unknown }[];
      };
      const turns: TurnMessage[] = (res.messages ?? []).map((m) => ({
        role: String(m.info?.role ?? "?"),
        text: extractText(m.parts),
        model: String((m.info?.model as Record<string, unknown> | undefined)?.modelId ?? ""),
      }));
      setMsgs(turns);
      setActiveId(row.sessionId);
      await subscribe(row.sessionId);
      setStatus(`${row.title || row.sessionId.slice(0, 13)} — ${turns.length} messages · i to type`);
    } catch (e) {
      setStatus(`open failed: ${e instanceof Error ? e.message : e}`);
    }
  };

  const newSession = async () => {
    setStatus("creating session…");
    try {
      const res = (await client.request("session/create", {
        workspace: {
          workspacePath: process.cwd(),
          workspaceKey: process.cwd(),
        },
        mode: "build",
        persistence: "immediate",
      })) as { session?: SessionRow };
      const row = res.session;
      if (!row) throw new Error("create returned no session");
      setSessions((s) => [row as SessionRow, ...s]);
      setSel(0);
      setMsgs([]);
      setActiveId(row.sessionId);
      await subscribe(row.sessionId);
      setStatus(`new ${row.sessionId.slice(0, 13)} · i to type`);
    } catch (e) {
      setStatus(`create failed: ${e instanceof Error ? e.message : e}`);
    }
  };

  const send = async (content: string) => {
    if (!activeId || running) return;
    setRunning(true);
    setMsgs((m) => [...m, { role: "user", text: content }, { role: "assistant", text: "" }]);
    setStatus("streaming…");
    try {
      await client.request("session/send", { sessionId: activeId, content });
    } catch (e) {
      setStatus(`send failed: ${e instanceof Error ? e.message : e}`);
      setRunning(false);
    }
  };

  // Live turn updates: subscribe once, mutate the streaming assistant tail.
  useEffect(() => {
    client.onAsk((msg) => {
      const method = String(msg.method);
      const params = (msg.params ?? {}) as Record<string, unknown>;
      if (method === "session/requestRuntimePreferences") {
        return { nativeSearchEnhancementsEnabled: false };
      }
      if (method === "interaction/requestPermission") {
        const input = (params.input ?? {}) as Record<string, unknown>;
        const detail = String(input.command ?? input.file_path ?? input.path ?? input.url ?? JSON.stringify(input).slice(0, 60));
        const toolName = String(params.toolName ?? "tool");
        const riskLevel = String(params.riskLevel ?? "");
        return new Promise((resolve) => {
          askRef.current = resolve as (v: unknown) => void;
          setAsk({ toolName, detail, riskLevel });
          setStatus(`permission: ${toolName}`);
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
        const appendTail = (delta: string) =>
          setMsgs((m) => {
            if (m.length === 0) return m;
            const last = m[m.length - 1];
            if (last.role !== "assistant") return m;
            return [...m.slice(0, -1), { ...last, text: last.text + delta }];
          });
        if (type === "tool_call") {
          setMsgs((m) => [...m, {
            role: "tool",
            text: String((payload.input as Record<string, unknown>)?.command ?? (payload.input as Record<string, unknown>)?.description ?? JSON.stringify(payload.input ?? {}).slice(0, 80)),
            toolName: String(payload.toolName ?? "tool"),
            toolCallId: String(payload.toolCallId ?? ""),
          }]);
        } else if (type === "result" && payload.toolCallId) {
          const result = (payload.result ?? {}) as Record<string, unknown>;
          setMsgs((m) => m.map((x) => x.toolCallId === payload.toolCallId ? {
            ...x,
            toolOut: String(result.content ?? result.error ?? "").slice(0, 200),
            toolOk: result.success !== false,
            toolMs: Number((result.perf as Record<string, unknown> | undefined)?.totalMs ?? 0) || undefined,
          } : x));
        } else if (type === "text_delta") {
          const d = (payload.delta ?? payload.text ?? payload.content) as string | undefined;
          if (typeof d === "string" && d) appendTail(d);
        } else if (type === "reasoning_delta") {
          const d = (payload.delta ?? payload.text ?? payload.content) as string | undefined;
          if (typeof d === "string" && d) setThinking((t) => t + d);
        } else if (typeof payload.content === "string" && payload.stopReason) {
          // final authoritative turn content + usage
          const usage = payload.usage as Record<string, unknown> | undefined;
          setMsgs((m) => {
            if (m.length === 0) return m;
            const last = m[m.length - 1];
            if (last.role !== "assistant") return m;
            return [...m.slice(0, -1), { ...last, text: payload.content as string }];
          });
          setThinking("");
          if (usage && typeof usage.totalTokens === "number") {
            setStatus(`turn done · ${usage.totalTokens} tokens · i to type`);
          }
        } else if (typeof payload.response === "string" && !payload.usage) {
          setMsgs((m) => {
            if (m.length === 0) return m;
            const last = m[m.length - 1];
            if (last.role !== "assistant" || last.text) return m;
            return [...m.slice(0, -1), { ...last, text: payload.response as string }];
          });
        } else if (payload.title && payload.previousTitle === "") {
          setStatus(`${String(payload.title).slice(0, 40)}`);
        }
      } else if (method === "v4/conversation/frame") {
        const frame = (params?.frame ?? {}) as Record<string, unknown>;
        const payload = (frame.payload ?? {}) as Record<string, unknown>;
        const deltas = Array.isArray(payload.deltas) ? (payload.deltas as Record<string, unknown>[]) : [];
        for (const d of deltas) {
          const op = String(d.op);
          if (op.startsWith("session.upserted") && d.session) {
            const s = d.session as Record<string, unknown>;
            const row: SessionRow = {
              sessionId: String(s.sessionId),
              title: String(s.title ?? ""),
              status: String(s.phase ?? s.status ?? "idle"),
              mode: s.mode as string | undefined,
              updatedAt: Number(s.lastActivityAt ?? Date.now()),
            };
            setSessions((prev) => {
              const rest = prev.filter((x) => x.sessionId !== row.sessionId);
              return [row, ...rest].sort((a, b) => b.updatedAt - a.updatedAt);
            });
          } else if (op.startsWith("session.deleted") || op.startsWith("session.removed")) {
            const id = String((d.session as Record<string, unknown> | undefined)?.sessionId ?? d.sessionId ?? "");
            setSessions((prev) => prev.filter((x) => x.sessionId !== id));
          }
        }
      } else if (method === "state.updated") {
        const patch = (params?.patch ?? {}) as Record<string, unknown>;
        if (patch.status === "running") setRunning(true);
        if (patch.status === "idle" || patch.status === "completed") setRunning(false);
      } else if (method === "v4/telemetry/event" && params?.kind === "turn.terminal") {
        setRunning(false);
        void refresh();
      }
    });
  }, [client]);

  useEffect(() => {
    void refresh();
    void loadModels();
    // v4 sessions-index subscription: delivers a snapshot at boot; cross-
    // instance live deltas are desktop-host-only (measured — see docs).
    client
      .request("v4/conversation/subscribe", {
        topic: `sessions-index/${process.cwd()}`,
        connectionId: `tui-${Math.random().toString(36).slice(2, 10)}`,
        clientMode: "desktop-continuous",
      })
      .catch(() => {});
    // freshness: light poll (the desktop gets push via its host gateway)
    const poll = setInterval(() => void refresh(), 20000);
    return () => clearInterval(poll);
  }, []);

  useKeyboard((key) => {
    if (askRef.current) {
      const resolve = askRef.current;
      if (key.name === "y") {
        askRef.current = null;
        setAsk(null);
        resolve({ decision: "allow" });
        setStatus("allowed");
      } else if (key.name === "n" || key.name === "escape") {
        askRef.current = null;
        setAsk(null);
        resolve({ decision: "deny" });
        setStatus("denied");
      }
      return;
    }
    if (filter !== null) {
      // filter capture mode: printable keys append, backspace deletes
      if (key.name === "escape") setFilter(null);
      else if (key.name === "backspace") setFilter((f) => ((f ?? "").length > 0 ? (f ?? "").slice(0, -1) : f));
      else if (key.sequence && !key.ctrl && /^[\x20-\x7E]+$/.test(key.sequence)) {
        setFilter((f) => (f ?? "") + key.sequence);
        setSel(0);
      }
      return;
    }
    if (key.name === "q" || key.name === "escape") onQuit();
    else if (key.name === "/") setFilter("");
    else if (key.name === "[") { const sb = scrollRef.current; if (sb?.scrollTop !== undefined) sb.scrollTop = Math.max(0, (sb.scrollTop ?? 0) - 10); }
    else if (key.name === "]") { const sb = scrollRef.current; if (sb?.scrollTop !== undefined) sb.scrollTop = (sb.scrollTop ?? 0) + 10; }
    else if (key.name === "r") void refresh();
    else if (key.name === "a") void newSession();
    else if (key.name === "m") void cycleModel();
    else if (key.name === "t") setTheme((t) => (t === "zai-dark" ? "zai-light" : "zai-dark"));
    else if (key.name === "f") void forkActive();
    else if (key.name === "c") void compactActive();
    else if (key.name === "i") inputRef.current?.focus();
    else if (key.name === "down" || key.name === "j") setSel((s) => Math.min(s + 1, shown.length - 1));
    else if (key.name === "up" || key.name === "k") setSel((s) => Math.max(s - 1, 0));
    else if (key.name === "return" && shown[sel]) void open(shown[sel]);
  });

  const inputRef = useRef<{ focus: () => void; blur: () => void } | null>(null);

  return (
    <box style={{ flexDirection: "column", backgroundColor: C.bg, width: "100%", flexGrow: 1 }}>
      <box style={{ flexDirection: "row", flexGrow: 1 }}>
        {/* sidebar */}
        <box
          style={{
            width: 34, flexDirection: "column", backgroundColor: C.bg,
            borderStyle: "single", borderColor: C.border, flexGrow: 0,
          }}
          title="sessions"
        >
          {visible.map((s, vi) => {
            const i = start + vi;
            const title = `${i === sel ? "› " : "  "}${(s.title || s.sessionId.slice(0, 16)).slice(0, maxTitle)}`;
            const meta = `    ${s.status}${s.mode ? ` · ${s.mode}` : ""} · ${relTime(s.updatedAt)} ago`;
            return (
              <box
                key={s.sessionId}
                style={{
                  flexDirection: "column", paddingLeft: 1, height: 2,
                  flexShrink: 0,
                  backgroundColor: i === sel ? C.selected : undefined,
                }}
              >
                <text content={title.slice(0, maxTitle + 2)} fg={i === sel ? C.brand : C.fg} />
                <text content={meta.slice(0, maxTitle + 2)} fg={C.faint} />
              </box>
            );
          })}
        </box>
        {/* conversation */}
        <box
          style={{ flexGrow: 1, flexDirection: "column", borderStyle: "single", borderColor: C.border }}
          title="conversation"
        >
          {activeTitle ? (
            <text content={` ${activeTitle.slice(0, 60)}`} fg={C.subtle} />
          ) : null}
          {msgs.length === 0 ? (
            <text content="  a new session · Enter open · i type · r refresh · q quit" fg={C.faint} />
          ) : (
            <scrollbox ref={scrollRef as never} style={{ flexGrow: 1, flexDirection: "column" }}>
              {msgs.map((m, i) => {
                const isTail = i === msgs.length - 1;
                return (
                  <box key={i} style={{ flexDirection: "column", paddingLeft: 1, paddingRight: 1 }}>
                    {m.role === "tool" ? (
                      <text
                        content={`⚙ ${m.toolName}: ${(m.toolOut ?? m.text).slice(0, 70)}${m.toolOk !== undefined ? (m.toolOk ? ` ✓${m.toolMs ? ` ${m.toolMs}ms` : ""}` : " ✗") : " …"}`}
                        fg={m.toolOk === false ? C.user : C.faint}
                      />
                    ) : (
                      <text
                        content={`${m.role === "user" ? "you" : m.role}${m.model ? ` (${m.model})` : ""}`}
                        fg={m.role === "user" ? C.user : C.assistant}
                      />
                    )}
                    {m.role === "assistant" && !(running && isTail) ? (
                      <markdown content={m.text || "∅"} syntaxStyle={MD_STYLE} />
                    ) : (
                      <text content={m.text || (running && isTail ? "…" : "∅")} fg={C.fg} />
                    )}
                    {running && isTail && thinking ? (
                      <text content={thinking.slice(-200)} fg={C.faint} />
                    ) : null}
                  </box>
                );
              })}
            </scrollbox>
          )}
        </box>
      </box>
      {/* composer */}
      <box style={{ height: 3, flexDirection: "column", flexShrink: 0 }}>
        <box style={{ height: 1, backgroundColor: C.chrome, flexShrink: 0 }}>
          <input
            ref={inputRef as never}
            placeholder={activeId ? "i focused · type a prompt, Enter sends" : "a new session · Enter opens selected · i to type"}
            onSubmit={((value: string) => {
              const text = String(value).trim();
              inputRef.current?.blur?.();
              if (!text) return;
              if (activeId) void send(text);
            }) as never}
            style={{ backgroundColor: C.chrome, focusedBackgroundColor: C.chrome, textColor: C.fg }}
          />
        </box>
        <box style={{ height: 1, backgroundColor: C.chrome, flexDirection: "row" }}>
          <text content={running ? " ● running" : " ○ idle"} fg={running ? C.user : C.faint} />
          <text content={` ${activeId ? activeId.slice(0, 18) : "no active session"}`} fg={C.faint} />
        </box>
      </box>
      {ask ? (
        <box style={{ height: 1, backgroundColor: C.chrome, flexDirection: "row" }}>
          <text content={` ⚠ ${ask.toolName}${ask.riskLevel ? ` (${ask.riskLevel})` : ""}: ${ask.detail.slice(0, 55)} — y allow / n deny`} fg={C.user} />
        </box>
      ) : null}
      {filter !== null ? (
        <box style={{ height: 1, backgroundColor: C.chrome, flexDirection: "row" }}>
          <text content={` filter: ${filter}▏ (Esc clears · type to match titles)`} fg={C.brand} />
        </box>
      ) : null}
      {/* status bar */}
      <box style={{ height: 1, backgroundColor: C.chrome, flexDirection: "row" }}>
        <text content={` zcode-tui · ${status}${modelIdx >= 0 && models[modelIdx] ? ` · ${models[modelIdx].label}` : ""} `} fg={C.subtle} />
      </box>
    </box>
  );
}
