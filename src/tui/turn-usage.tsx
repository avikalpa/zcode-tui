// Adapted from MIT OpenCode b084acc packages/tui/src/routes/session/rows.ts
// (the turn-usage flush in reduceSessionRows, cacheReuseDrop, hasTokenUsage,
// tokenTotal) and routes/session/index.tsx TurnTokenUsage +
// turnTokenToolSummary. See THIRD-PARTY-NOTICES.md.
import { useState } from "react";
import { useRenderer } from "@opentui/react";
import { TextAttributes } from "@opentui/core";
import type { ThemeTokens } from "./design";
import type { TurnMessage } from "./app";

// The per-step token counts (payload info.tokens voice — verified against a
// real session/resume dump 2026-10-26: {input, output, reasoning,
// cache:{read, write}}, all-zero rows present on empty steps).
export type TurnTokens = {
  input: number;
  output: number;
  reasoning: number;
  cache: { read: number; write: number };
};

// The model identity the cache-reuse law compares (rows.ts cacheReuseDrop
// reads providerID/id/variant; the zcode payload carries providerId/modelId
// and no variant — both spellings extract, variant stays optional).
export type UsageModel = { providerId: string; modelId: string; variant?: string };

export type CacheUsage = { read: number; model: UsageModel };

export type UsageStep = {
  finish: string;
  tools: { name: string; input: unknown }[];
  newTokens: number;
  cached: number;
  total: number;
  reuseDrop?: number;
};

export type TurnUsage = {
  steps: UsageStep[];
  count: number;
  newTokens: number;
  cached: number;
  total: number;
  reuseDrops: number;
};

export function tokenTotal(tokens: TurnTokens): number {
  return tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write;
}

// rows.ts hasTokenUsage: a step counts only when its WHOLE token total is
// above zero — the payload's all-zero token objects (empty steps) drop out.
export function hasTokenUsage(message: { tokens?: TurnTokens }): boolean {
  return message.tokens !== undefined && tokenTotal(message.tokens) > 0;
}

// rows.ts terminal law (reduceSessionRows 326): terminal by finish (anything
// but tool-calls/unknown) OR by error.
function isTerminalStep(message: TurnMessage): boolean {
  return (message.finish !== undefined && !["tool-calls", "unknown"].includes(message.finish)) || Boolean(message.error);
}

// rows.ts cacheReuseDrop: consecutive steps of the same model whose cached
// count DROPPED report the drop as a likely cache bust. A model switch
// resets the baseline (undefined), and OpenAI cache reads may lawfully move
// between one and two 1,024-token buckets, which never reads as a bust.
export function cacheReuseDrop(previous: CacheUsage | undefined, current: CacheUsage): number | undefined {
  if (previous === undefined) return undefined;
  if (
    previous.model.providerId !== current.model.providerId ||
    previous.model.modelId !== current.model.modelId ||
    previous.model.variant !== current.model.variant
  )
    return undefined;
  const drop = previous.read - current.read;
  if (current.model.providerId === "openai" && drop >= 1_024 && drop <= 2_048) return undefined;
  return drop > 0 ? drop : undefined;
}

const FINISH_LABELS: Record<string, string> = { "tool-calls": "tool-call" };

function finishLabel(finish: string | undefined): string {
  return (finish && (FINISH_LABELS[finish] ?? finish)) || "unknown";
}

// The legacy flush law (rows.ts reduceSessionRows with no idle markers —
// our payload has none): usage steps accumulate until a terminal step, the
// flush filters to token-bearing steps, and a turn with none produces no
// row and leaves the cross-turn cache baseline untouched. The baseline
// persists ACROSS turns: the first step of a turn busts against the last
// token-bearing step of the previous one. Rows key on the terminal
// message's id — except when the terminal step's own tool rows trail it in
// the flat stream (partsToTurns emits a message's tool rows after it), in
// which case the row anchors on the last trailing tool row so it renders
// AFTER the whole turn, the reference's part-rows → footer → usage order.
// Fixture rows without ids or call ids produce no row.
export function turnUsageRows(turns: TurnMessage[]): Map<string, TurnUsage> {
  const rows = new Map<string, TurnUsage>();
  let pending: { message: TurnMessage; tools: UsageStep["tools"] }[] = [];
  let previousTurnCache: CacheUsage | undefined;
  let settled: { messageId?: string; usage: TurnUsage } | null = null;
  let trailingToolIds: string[] = [];
  let lastFlushedTools: UsageStep["tools"][] = [];
  const register = () => {
    if (settled) {
      const anchor = trailingToolIds.at(-1) ?? settled.messageId;
      if (anchor) rows.set(anchor, settled.usage);
      settled = null;
    }
    trailingToolIds = [];
  };
  for (const turn of turns) {
    if (turn.role === "tool") {
      // partsToTurns emits a message's tool rows directly after it, so a
      // tool row attaches to the nearest open assistant step — or, after a
      // flush, to the terminal step that just closed.
      const open = pending.at(-1);
      if (open) open.tools.push({ name: turn.toolName ?? "tool", input: turn.toolInput });
      else {
        lastFlushedTools.at(-1)?.push({ name: turn.toolName ?? "tool", input: turn.toolInput });
        if (turn.toolCallId) trailingToolIds.push(turn.toolCallId);
      }
      continue;
    }
    if (turn.role !== "assistant") {
      register();
      continue;
    }
    register();
    pending.push({ message: turn, tools: [] });
    if (!isTerminalStep(turn)) continue;
    const steps: UsageStep[] = [];
    let cacheCursor = previousTurnCache;
    let lastCache: CacheUsage | undefined;
    for (const { message, tools } of pending) {
      if (!hasTokenUsage(message)) continue;
      const tokens = message.tokens as TurnTokens;
      const total = tokenTotal(tokens);
      const currentCache: CacheUsage = {
        read: tokens.cache.read,
        model: message.usageModel ?? { providerId: "", modelId: message.model ?? "" },
      };
      const reuseDrop = cacheReuseDrop(cacheCursor, currentCache);
      cacheCursor = currentCache;
      lastCache = currentCache;
      steps.push({
        finish: finishLabel(message.finish),
        tools,
        newTokens: total - tokens.cache.read,
        cached: tokens.cache.read,
        total,
        reuseDrop,
      });
    }
    pending = [];
    const last = steps.at(-1);
    if (last) previousTurnCache = lastCache;
    lastFlushedTools = steps.map((step) => step.tools);
    settled = last
      ? {
          messageId: turn.messageId,
          usage: {
            steps,
            count: steps.length,
            newTokens: steps.reduce((sum, step) => sum + step.newTokens, 0),
            cached: steps.reduce((sum, step) => sum + step.cached, 0),
            total: steps.reduce((sum, step) => sum + step.total, 0),
            reuseDrops: steps.filter((step) => step.reuseDrop !== undefined).length,
          },
        }
      : null;
  }
  register();
  return rows;
}

// The expanded table's column widths (TurnTokenUsage columns memo): the
// header labels set the floor, the widest cell wins per column.
export function turnUsageColumns(steps: UsageStep[]) {
  return {
    step: Math.max("Step".length, ...steps.map((step) => step.finish.length)),
    newTokens: Math.max("New".length, ...steps.map((step) => step.newTokens.toLocaleString().length)),
    cached: Math.max("Cached".length, ...steps.map((step) => step.cached.toLocaleString().length)),
    total: Math.max("Total".length, ...steps.map((step) => step.total.toLocaleString().length)),
  };
}

// TurnTokenToolCalls' row summary (turnTokenToolSummary): a string input is
// itself; otherwise the primary key's scalar value leads and every other
// scalar entry follows as `key: value`, double-space joined.
export function turnTokenToolSummary(tool: { name: string; input: unknown }): string {
  const data = tool.input;
  if (typeof data === "string") return data;
  if (!data || typeof data !== "object") return "";
  const record = data as Record<string, unknown>;
  const primaryKey = ["command", "id", "pattern", "url", "query", "path", "description", "code"].find(
    (key) => key in record,
  );
  const scalars = Object.entries(record).filter(([, value]) => ["string", "number", "boolean"].includes(typeof value));
  const primary = scalars.find(([key]) => key === primaryKey)?.[1];
  const details = scalars.filter(([key]) => key !== primaryKey).map(([key, value]) => `${key}: ${String(value)}`);
  return [primary === undefined ? "" : String(primary), ...details].filter(Boolean).join("  ");
}

function TurnUsageTools({ tools, C }: { tools: UsageStep["tools"]; C: ThemeTokens }) {
  const nameWidth = Math.max(0, ...tools.map((tool) => tool.name.length)) + 2;
  return (
    <box style={{ paddingLeft: 2, flexDirection: "column", flexShrink: 0 }}>
      {tools.map((tool, index) => (
        <box key={index} style={{ flexDirection: "row", flexShrink: 0 }}>
          <text width={nameWidth} style={{ flexShrink: 0 }} fg={C.subtle} attributes={TextAttributes.BOLD}>
            {tool.name}
          </text>
          <text fg={C.subtle} attributes={TextAttributes.DIM} wrapMode="word" style={{ flexGrow: 1, minWidth: 0 }}>
            {turnTokenToolSummary(tool)}
          </text>
        </box>
      ))}
    </box>
  );
}

// The reference row (routes/session/index.tsx TurnTokenUsage): a subdued
// summary line that brightens on hover and expands on click into the
// per-step table — Step/New/Cached/Total with the new count bold, tool
// inputs only in verbose mode, and a warning line under a busting step.
// The row gap rides the SessionRowView wrapper (our paddingTop 1 block in
// the transcript map), the body itself indents 3 like every session row.
export function TurnUsageRow({ usage, C, verbose = false }: { usage: TurnUsage; C: ThemeTokens; verbose?: boolean }) {
  const renderer = useRenderer();
  const [expanded, setExpanded] = useState(false);
  const [hover, setHover] = useState(false);
  const columns = turnUsageColumns(usage.steps);
  return (
    <box style={{ paddingLeft: 3, flexDirection: "column", flexShrink: 0 }}>
      <box
        style={{ flexDirection: "row", flexShrink: 0 }}
        onMouseOver={() => setHover(true)}
        onMouseOut={() => setHover(false)}
        onMouseUp={() => {
          if (!renderer.getSelection()?.getSelectedText()) setExpanded((value) => !value);
        }}
      >
        <text fg={hover ? C.fg : C.subtle} wrapMode="none">
          <span>{expanded ? "- " : "+ "}</span>
          <span attributes={TextAttributes.BOLD}>Tokens</span>
          <span>
            : {usage.count} {usage.count === 1 ? "step" : "steps"} · {usage.newTokens.toLocaleString()} new ·{" "}
            {usage.cached.toLocaleString()} cached · {usage.total.toLocaleString()} total
          </span>
          {usage.reuseDrops > 0 ? (
            <span fg={C.warning}>
              {" · ! "}
              {usage.reuseDrops} likely cache {usage.reuseDrops === 1 ? "bust" : "busts"}
            </span>
          ) : null}
        </text>
      </box>
      {expanded ? (
        <>
          <box style={{ paddingLeft: 2, flexShrink: 0 }}>
            <text fg={C.subtle} attributes={TextAttributes.ITALIC}>
              {"Step".padEnd(columns.step + 2)}
              {"New".padStart(columns.newTokens)}
              {"  "}
              {"Cached".padStart(columns.cached)}
              {"  "}
              {"Total".padStart(columns.total)}
            </text>
          </box>
          {usage.steps.map((item, index) => (
            <box key={index} style={{ paddingLeft: 2, flexDirection: "column", flexShrink: 0 }}>
              <text fg={verbose && item.finish === "tool-call" ? C.fg : C.subtle}>
                {item.finish.padEnd(columns.step + 2)}
                <span attributes={TextAttributes.BOLD}>
                  {item.newTokens.toLocaleString().padStart(columns.newTokens)}
                </span>
                {"  "}
                {item.cached.toLocaleString().padStart(columns.cached)}
                {"  "}
                {item.total.toLocaleString().padStart(columns.total)}
              </text>
              {verbose && item.tools.length > 0 ? <TurnUsageTools tools={item.tools} C={C} /> : null}
              {item.reuseDrop !== undefined ? (
                <text fg={C.warning}>
                  ! Likely cache bust: {item.reuseDrop.toLocaleString()} fewer cached tokens than the previous step
                </text>
              ) : null}
            </box>
          ))}
        </>
      ) : null}
    </box>
  );
}
