// The subagent tab plane (0.6.52) — our wiring of the reference
// FooterSubagentTab surface (mini/types.ts:302) onto the zcode host verb
// session/subagents (live-probed 0.6.52, tools/r42-subagents-probe*.ts):
//   { revision, childSessionIds: [], running: [{ childSessionId, agentId,
//     toolCallId, subagentType, title, startedAt, status: "running" }],
//     ended: { total, items: [...same, status: "success", summary, endedAt] } }
// Field mapping (the wiring is ours; the display formulas stay upstream):
//   host title -> label (the stable primary), host summary -> summary
//   (the inspector body), host subagentType -> subagentType (the picker
//   row's secondary slot). Upstream statuses are running | completed |
//   cancelled | error; the host vocabulary measured is running | success —
//   success maps to completed, cancelled/canceled to cancelled, and any
//   unmeasured status maps to error conservatively.
export type SubagentStatus = "running" | "completed" | "cancelled" | "error";

export type SubagentTab = {
  sessionID: string;
  label: string;
  description: string;
  title?: string;
  status: SubagentStatus;
  summary?: string;
  subagentType?: string;
  startedAt?: number;
  endedAt?: number;
};

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function mapStatus(v: unknown): SubagentStatus {
  if (v === "running") return "running";
  if (v === "success") return "completed";
  if (v === "cancelled" || v === "canceled") return "cancelled";
  return "error";
}

function mapItem(raw: unknown): SubagentTab | undefined {
  if (!isRecord(raw)) return undefined;
  const sessionID = asString(raw.childSessionId);
  if (!sessionID) return undefined;
  const tab: SubagentTab = {
    sessionID,
    label: asString(raw.title) || "Subagent",
    description: "",
    status: mapStatus(raw.status),
  };
  const summary = asString(raw.summary);
  if (summary) tab.summary = summary;
  const subagentType = asString(raw.subagentType);
  if (subagentType) tab.subagentType = subagentType;
  if (typeof raw.startedAt === "number") tab.startedAt = raw.startedAt;
  if (typeof raw.endedAt === "number") tab.endedAt = raw.endedAt;
  return tab;
}

/** Host session/subagents payload -> the tab list, running items first then
 * ended items, each group in host order (the revision state is authoritative;
 * we never re-sort). */
export function mapHostSubagents(payload: unknown): SubagentTab[] {
  if (!isRecord(payload)) return [];
  const running = Array.isArray(payload.running) ? payload.running : [];
  const ended = isRecord(payload.ended) && Array.isArray(payload.ended.items) ? payload.ended.items : [];
  return [...running, ...ended].map(mapItem).filter((t): t is SubagentTab => t !== undefined);
}

/** The reference status cell (footer.command.tsx subagentStatusLabel). */
export function subagentStatusLabel(status: SubagentStatus): string {
  if (status === "completed") return "done";
  if (status === "cancelled") return "cancelled";
  if (status === "error") return "error";
  return "running";
}

export type PickerFilter = "active" | "inactive";

/** RunSubagentSelectBody's entries(): the tab key filters running vs
 * not-running; display = description || title || label; the row's secondary
 * slot carries our subagentType; tone running/error -> status, completed ->
 * success. */
export function pickerTabs(tabs: SubagentTab[], filter: PickerFilter): SubagentTab[] {
  return tabs.filter((t) => (filter === "active" ? t.status === "running" : t.status !== "running"));
}

/** The inspector's cycle index math: the selected tab's position across ALL
 * tabs (footer.view.tsx openTab + the i of n count). */
export function tabIndex(tabs: SubagentTab[], sessionID: string): number {
  return tabs.findIndex((t) => t.sessionID === sessionID);
}
