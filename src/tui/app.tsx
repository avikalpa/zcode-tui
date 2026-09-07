// zcode-tui v0 — the ZCode sessions surface on OpenTUI.
// zai-dark tokens from zcodereversed FINDINGS.md (bg #161616, chrome #202020,
// border white 10%, fg neutral-300).
import { useEffect, useRef, useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import type { AppServer } from "../protocol/client";

export interface SessionRow {
  sessionId: string;
  title: string;
  status: string;
  mode?: string;
  updatedAt: number;
  modelId?: string;
}

export interface TurnMessage {
  role: string;
  text: string;
  model?: string;
}

const C = {
  bg: "#161616",
  chrome: "#202020",
  border: "#ffffff1a",
  fg: "#d4d4d4",
  subtle: "#a3a3a3",
  faint: "#6b6b6b",
  brand: "#ffffff",
  user: "#60a5fa",
  assistant: "#2dd4bf",
  selected: "#ffffff1a",
};

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
  const dims = useTerminalDimensions();
  const sideInner = 34 - 2; // sidebar width minus borders
  const maxTitle = sideInner - 1 /* pad */ - 2 /* cursor */;
  const maxRows = Math.max(1, Math.floor((dims.height - 4) / 2));
  const start = Math.min(Math.max(0, sel - Math.floor(maxRows / 2)), Math.max(0, sessions.length - maxRows));
  const visible = sessions.slice(start, start + maxRows);

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
    client.onPush((msg) => {
      const method = String(msg.method);
      const params = msg.params as Record<string, unknown> | undefined;
      if (method === "session/event") {
        const payload = (params?.payload ?? {}) as Record<string, unknown>;
        if (typeof payload.content === "string") {
          setMsgs((m) => {
            if (m.length === 0) return m;
            const last = m[m.length - 1];
            if (last.role !== "assistant") return m;
            return [...m.slice(0, -1), { ...last, text: last.text + payload.content }];
          });
        } else if (typeof payload.response === "string") {
          setMsgs((m) => {
            if (m.length === 0) return m;
            const last = m[m.length - 1];
            if (last.role !== "assistant" || last.text) return m;
            return [...m.slice(0, -1), { ...last, text: payload.response as string }];
          });
        }
      } else if (method === "state.updated") {
        const patch = (params?.patch ?? {}) as Record<string, unknown>;
        if (patch.status === "running") setRunning(true);
        if (patch.status === "idle" || patch.status === "completed") setRunning(false);
      } else if (method === "v4/telemetry/event" && params?.kind === "turn.terminal") {
        setRunning(false);
        setStatus("turn complete · i to type");
        void refresh();
      }
    });
  }, [client]);

  useEffect(() => {
    void refresh();
  }, []);

  useKeyboard((key) => {
    if (key.name === "q" || key.name === "escape") onQuit();
    else if (key.name === "r") void refresh();
    else if (key.name === "a") void newSession();
    else if (key.name === "i") inputRef.current?.focus();
    else if (key.name === "down" || key.name === "j") setSel((s) => Math.min(s + 1, sessions.length - 1));
    else if (key.name === "up" || key.name === "k") setSel((s) => Math.max(s - 1, 0));
    else if (key.name === "return" && sessions[sel]) void open(sessions[sel]);
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
          {msgs.length === 0 ? (
            <text content="  select a session · Enter to open · r refresh · q quit" fg={C.faint} />
          ) : (
            msgs.map((m, i) => (
              <box key={i} style={{ flexDirection: "column", paddingLeft: 1, paddingRight: 1 }}>
                <text
                  content={`${m.role === "user" ? "you" : m.role}${m.model ? ` (${m.model})` : ""}`}
                  fg={m.role === "user" ? C.user : C.assistant}
                />
                <text content={m.text.slice(0, 2000) || "∅"} fg={C.fg} />
              </box>
            ))
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
      {/* status bar */}
      <box style={{ height: 1, backgroundColor: C.chrome, flexDirection: "row" }}>
        <text content={` zcode-tui · ${status} `} fg={C.subtle} />
      </box>
    </box>
  );
}
