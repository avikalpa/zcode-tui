// Ported from opencode v2ref b084acc55ea2cdb50e9c2ec49a8d9ab3608d43ad:
// routes/session/index.tsx (SessionGroupView) and routes/session/grouping/
// {session,tree}.ts — consecutive read/glob/grep tool parts collapse into ONE
// exploration row ("Explored — 2 searches, 1 read"), gated by
// config.session?.grouping !== "none" (the reference default).
//
// zcode wiring adaptations (recorded in docs/parity-v2.md deviation queue):
// tool identity comes from TurnMessage-shaped entries via canonicalToolName
// instead of part refs, and expansion is keyboard-driven (ctrl+o) because
// this binding has no mouse plane — the same deviation the tool-row
// expansion already carries.

import { canonicalToolName, toolDisplay } from "./tool-parts";

const EXPLORATION_TOOLS = new Set(["read", "glob", "grep"]);

export type ExplorationTool = {
  role: string;
  toolName?: string;
  toolStatus?: string;
  toolOk?: boolean;
};

export function isExplorationTool(name: string | undefined): boolean {
  return EXPLORATION_TOOLS.has(canonicalToolName(name ?? ""));
}

// grouping/session.ts label(): counts by display name with grep/glob folded
// into "search", plurals `1 read` / `2 reads` / `1 search` / `2 searches`,
// joined ", " in first-seen order.
export function explorationCountLabel(names: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const raw of names) {
    const tool = toolDisplay(raw);
    const name = tool === "grep" || tool === "glob" ? "search" : tool;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => `${count} ${count === 1 ? name : name === "search" ? "searches" : `${name}s`}`)
    .join(", ");
}

export function explorationLabel(names: readonly string[], completed: boolean): string {
  return `${completed ? "Explored" : "Exploring"} — ${explorationCountLabel(names)}`;
}

// A part is settled when its status reached a terminal state (the reference
// reads part.time.completed, which is set for error parts too).
export function isSettledTool(tool: { toolStatus?: string; toolOk?: boolean }): boolean {
  if (tool.toolStatus === "completed" || tool.toolStatus === "error") return true;
  return tool.toolStatus === undefined && tool.toolOk !== undefined;
}

export type ExplorationRow<T> =
  | { kind: "message"; m: T }
  | { kind: "exploration"; tools: T[]; completed: boolean; label: string };

// Adjacent-only merge (grouping/tree.ts appendEntry joins a new part into the
// previous node only when it is a group of the same kind): any non-tool row —
// including an assistant text message — breaks the run.
export function groupExplorationRows<T extends ExplorationTool>(msgs: readonly T[]): ExplorationRow<T>[] {
  const rows: ExplorationRow<T>[] = [];
  for (const m of msgs) {
    const last = rows.at(-1);
    if (m.role === "tool" && isExplorationTool(m.toolName)) {
      if (last?.kind === "exploration") {
        last.tools.push(m);
        last.completed = last.completed && isSettledTool(m);
        last.label = explorationLabel(last.tools.map((t) => t.toolName ?? ""), last.completed);
      } else {
        rows.push({
          kind: "exploration",
          tools: [m],
          completed: isSettledTool(m),
          label: explorationLabel([m.toolName ?? ""], isSettledTool(m)),
        });
      }
      continue;
    }
    rows.push({ kind: "message", m });
  }
  return rows;
}
