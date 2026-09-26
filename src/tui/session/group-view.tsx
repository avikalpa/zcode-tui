// React translation of the vendored opencode v2.0.16 reference
// (tui/routes/session/group-view.tsx) — slice 2 of the transcript-render
// refactor family. The recursive grammar is upstream's: reasoning groups
// collapse to a "Thought · N steps · duration" row, exploration groups to
// "Explored — N searches", both expandable with persisted per-group state
// (#48489); children render through the same recursive walker. Solid
// accessors become props, <Show>/<For> become JSX conditionals and map, and
// the theme reads ride a ctx prop the app builds once per render.
// Adaptations (wiring, not grammar): no mouse plane on this stack, so the
// hover state and the tool-image slot have no arm here (ledgered deviation
// queue 1 — the app-level ctrl+o cycle is the expansion keyboard adapter);
// the muted-warning alpha drop renders as plain warning; the thinking body
// renders as muted wrapped text (the voice our streaming tail always had);
// upstream's running-title memo (keep the last known step title) rides a ref.
import { useRef, type ReactNode } from "react";
import type { SyntaxStyle } from "@opentui/core";
import type { ThemeTokens } from "../design";
import { SplitBorder, ToolPart, toolDisplay } from "./tool-parts";
import { GroupAnchor, EntryAnchor, visitEntries } from "./anchor-view";
import { groupID } from "./anchors";
import type { NormMessage, NormPart } from "./rows";
import { resolvePart } from "./rows";
import type { PartRef, SessionEntry, SessionGroup, SessionNode } from "./grouping/session";

export type GroupViewCtx = {
  C: ThemeTokens;
  mdStyle: SyntaxStyle;
  width: number;
  spinnerChar: string;
  /** ToolPart output blocks (the ctrl+o cycle's outer arm). */
  toolsExpanded: boolean;
  /** Resolved per-group expansion: override ?? persisted map ?? false. */
  expanded: (groupID: string) => boolean;
  toggle: (groupID: string) => void;
  message: (messageID: string) => NormMessage | undefined;
  /** The app's entry view: part/message entries outside groups. */
  entry: (entry: SessionEntry, images?: boolean) => ReactNode;
};

export function SessionGroupView(props: { ctx: GroupViewCtx; row: SessionGroup }) {
  return (
    <Group
      ctx={props.ctx}
      node={props.row}
      level={0}
      completed={props.row.completed}
      pending={props.row.kind === "exploration" ? props.row.pending : []}
    />
  );
}

type GroupProps = {
  ctx: GroupViewCtx;
  node: Extract<SessionNode, { type: "group" }>;
  level: number;
  completed: boolean;
  pending: readonly PartRef[];
  pendingOutside?: boolean;
  imagesOutside?: boolean;
};

function Group(props: GroupProps) {
  // Keep kind-specific state isolated during reconciliation (upstream's
  // keyed <Show> on node.kind — the React idiom is a keyed wrapper).
  return <GroupContent key={props.node.kind} {...props} />;
}

function GroupContent(props: GroupProps) {
  const ctx = props.ctx;
  const latestRef = useRef<string | null>(null);
  const id = groupID(props.node, props.level);
  const expanded = id ? ctx.expanded(id) : false;
  const entries: SessionEntry[] = [];
  visitEntries(props.node.children, (entry) => entries.push(entry));
  const refs = entries.flatMap((entry) =>
    entry.type === "part" && !isPending(entry, props.pending) ? [entry.ref] : [],
  );
  const thoughts =
    props.node.kind !== "reasoning"
      ? []
      : refs.flatMap((ref) => {
          const message = ctx.message(ref.messageID);
          if (message?.type !== "assistant") return [];
          const part = resolvePart(message, ref.partID);
          if (part?.type !== "reasoning" || !reasoningContent(part)) return [];
          return [{ message, part }];
        });
  const tools =
    props.node.kind !== "exploration"
      ? []
      : refs.flatMap((ref) => {
          const message = ctx.message(ref.messageID);
          if (message?.type !== "assistant") return [];
          const part = resolvePart(message, ref.partID);
          return part?.type === "tool" ? [part] : [];
        });
  // Upstream keeps the last known step title while a run continues even when
  // the newest step has none yet (createMemo(previous)).
  const newest = thoughts.at(-1);
  if (newest) {
    const title = reasoningSummary(reasoningContent(newest.part)).title;
    if (title) latestRef.current = title;
    else if (newest.part.time?.completed !== undefined || newest.message.time.completed !== undefined)
      latestRef.current = null;
  }
  const latest = latestRef.current;
  const duration = thoughts.reduce((total, item) => {
    const start = item.part.time?.created;
    const end = item.part.time?.completed;
    return total + (start === undefined || end === undefined ? 0 : Math.max(0, end - start));
  }, 0);
  const grouped = props.node.kind === "reasoning"; // thinkingMode "hide" is our default voice
  const completed =
    props.node.kind === "reasoning"
      ? props.completed
      : props.completed || (tools.length > 0 && tools.every(toolComplete));
  const label = explorationLabel(tools, completed);
  // v2.0.18 #51175: any errored tool marks the whole group failed —
  // the plain ✗ replaces the →/✱ run icon (no error tint upstream).
  const failed = tools.some((part) => part.state.status === "error");
  const toggle = () => {
    if (id) ctx.toggle(id);
  };
  const children = (mode: "normal" | "thought" | "tool") => (
    <Children {...props} nodes={props.node.children} mode={mode} />
  );

  if (props.node.kind !== "reasoning") {
    return (
      <GroupAnchor groupID={id} active={grouped && tools.length > 0}>
        {grouped ? (
          <>
            {tools.length > 0 ? (
              <InlineToolRow
                ctx={ctx}
                icon={failed ? "✗" : completed ? "→" : "✱"}
                color={ctx.C.subtle}
                complete={completed}
                spinner={!completed}
                onToggle={toggle}
                label={label}
              />
            ) : null}
            {expanded && tools.length > 0 ? children("tool") : null}
          </>
        ) : (
          children("normal")
        )}
        <PendingEntries
          pending={props.pending}
          entries={entries}
          outside={props.pendingOutside}
          entry={ctx.entry}
        />
      </GroupAnchor>
    );
  }

  const header = (() => {
    if (!props.completed) return latest ? `Thinking: ${latest}` : "Thinking";
    const parts = [`Thought${!expanded && latest ? `: ${latest}` : ""}`];
    if (thoughts.length > 1) parts.push(`${thoughts.length} steps`);
    if (duration > 0) parts.push(fmtDuration(duration));
    return parts.join(" · ");
  })();

  return (
    <GroupAnchor groupID={id} active={grouped && thoughts.length > 0}>
      {thoughts.length > 0 ? (
        grouped ? (
          <>
            <InlineToolRow
              ctx={ctx}
              icon={expanded ? "-" : "+"}
              color={!props.completed ? ctx.C.fg : ctx.C.warning}
              complete={props.completed}
              spinner={!props.completed}
              onToggle={toggle}
              label={header}
            />
            {expanded ? <box style={{ paddingLeft: 3 }}>{children("thought")}</box> : null}
          </>
        ) : (
          children("normal")
        )
      ) : null}
      <PendingEntries
        pending={props.pending}
        entries={entries}
        outside={props.pendingOutside}
        entry={ctx.entry}
      />
    </GroupAnchor>
  );
}

function PendingEntries(props: {
  pending: readonly PartRef[];
  entries: readonly SessionEntry[];
  outside?: boolean;
  entry: (entry: SessionEntry, images?: boolean) => ReactNode;
}) {
  if (props.outside) return null;
  return (
    <>
      {props.pending.map((ref) => {
        const leaf = props.entries.find(
          (entry) =>
            entry.type === "part" && entry.ref.messageID === ref.messageID && entry.ref.partID === ref.partID,
        );
        return leaf ? (
          <EntryAnchor key={`${ref.messageID}:${ref.partID}`} entry={leaf}>
            {props.entry(leaf)}
          </EntryAnchor>
        ) : null;
      })}
    </>
  );
}

function Children(props: GroupProps & { nodes: readonly SessionNode[]; mode: "normal" | "thought" | "tool" }) {
  return (
    <>
      {props.nodes.map((node, index) => {
        if (node.type === "group") {
          return (
            <Group
              key={groupID(node, props.level + 1) ?? index}
              {...props}
              node={node}
              level={props.level + 1}
              pendingOutside
              imagesOutside={props.imagesOutside || props.mode === "tool"}
              completed={
                props.completed ||
                props.nodes
                  .slice(index + 1)
                  .some((next) => next.type === "group" || !isPending(next.entry, props.pending)) ||
                (node.kind === "reasoning" && reasoningCompleted(node.children, props.ctx.message))
              }
            />
          );
        }
        if (isPending(node.entry, props.pending)) return null;
        if (props.mode === "thought") {
          return <ThoughtEntry key={index} entry={node.entry} ctx={props.ctx} />;
        }
        return (
          <EntryAnchor key={index} entry={node.entry}>
            {props.ctx.entry(node.entry, props.mode === "tool" ? false : undefined)}
          </EntryAnchor>
        );
      })}
    </>
  );
}

function ThoughtEntry(props: { entry: SessionEntry; ctx: GroupViewCtx }) {
  const ctx = props.ctx;
  if (props.entry.type !== "part") return null;
  const message = ctx.message(props.entry.ref.messageID);
  if (message?.type !== "assistant") return null;
  const part = resolvePart(message, props.entry.ref.partID);
  if (part?.type !== "reasoning") return null;
  const content = reasoningContent(part);
  if (!content) return null;
  return (
    <EntryAnchor entry={props.entry} marginTop={1}>
      <box
        style={{
          borderStyle: "single",
          border: ["left"],
          customBorderChars: SplitBorder.customBorderChars,
          borderColor: ctx.C.surface,
          paddingLeft: 1,
          flexShrink: 0,
        }}
      >
        <text content={content} fg={ctx.C.subtle} wrapMode="word" />
      </box>
    </EntryAnchor>
  );
}

export function isPending(entry: SessionEntry, pending: readonly PartRef[]) {
  return (
    entry.type === "part" &&
    pending.some((ref) => ref.messageID === entry.ref.messageID && ref.partID === entry.ref.partID)
  );
}

export function reasoningCompleted(
  nodes: readonly SessionNode[],
  message: (messageID: string) => NormMessage | undefined,
): boolean {
  return nodes.every((node) => {
    if (node.type === "group") return reasoningCompleted(node.children, message);
    if (node.entry.type !== "part") return false;
    const item = message(node.entry.ref.messageID);
    if (item?.type !== "assistant") return false;
    const part = resolvePart(item, node.entry.ref.partID);
    return part?.type === "reasoning" && part.time?.completed !== undefined;
  });
}

function toolComplete(part: Extract<NormPart, { type: "tool" }>): boolean {
  // Our tool state vocabulary: running | completed | error (measured on the
  // live events); only the settled statuses complete a group.
  return part.state.status === "completed" || part.state.status === "error";
}

/** Upstream's label: counts by display name (grep/glob fold into "search"),
 * pluralized, joined — "Explored — 2 searches, 1 read". */
export function explorationLabel(tools: Extract<NormPart, { type: "tool" }>[], completed: boolean): string {
  const counts = tools.reduce<Record<string, number>>((result, part) => {
    const tool = toolDisplay(part.name);
    const name = tool === "grep" || tool === "glob" ? "search" : tool;
    result[name] = (result[name] ?? 0) + 1;
    return result;
  }, {});
  const names = Object.entries(counts).map(
    ([name, count]) => `${count} ${count === 1 ? name : name === "search" ? "searches" : `${name}s`}`,
  );
  return `${completed ? "Explored" : "Exploring"} — ${names.join(", ")}`;
}

/** Upstream context/thinking.ts: a leading **bold** line titles the step. */
export function reasoningSummary(text: string) {
  const content = text.replace("[REDACTED]", "").trim();
  const match = content.match(/^\*\*([^*\n]+)\*\*(?:\r?\n\r?\n|$)/);
  if (!match) return { title: null as string | null, body: content };
  return { title: match[1].trim(), body: content.slice(match[0].length).trimEnd() };
}

export function reasoningContent(part: Extract<NormPart, { type: "reasoning" }>): string {
  return part.text.replace("[REDACTED]", "").trim();
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rest = Math.round(s % 60);
  if (m < 60) return rest > 0 ? `${m}m ${rest}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/** The InlineToolRow port (upstream message-parts.tsx): one dim line — icon
 * cell, label, spinner while running. The box carries the mouse-up toggle
 * wiring point for a future mouse plane; on this stack the app-level ctrl+o
 * cycle is the expansion adapter (ledgered deviation queue 1). */
function InlineToolRow(props: {
  ctx: GroupViewCtx;
  icon: string;
  color: string;
  complete: boolean;
  spinner: boolean;
  onToggle: () => void;
  label: string;
}) {
  const ctx = props.ctx;
  return (
    <box style={{ paddingLeft: 3, flexShrink: 0 }} onMouseUp={props.onToggle}>
      <box style={{ flexDirection: "row" }}>
        {props.spinner ? (
          <text content={`${ctx.spinnerChar} `} fg={ctx.C.accent} />
        ) : (
          <text content={`${props.icon} `} fg={props.color} />
        )}
        <text content={props.label} fg={props.color} />
      </box>
    </box>
  );
}
