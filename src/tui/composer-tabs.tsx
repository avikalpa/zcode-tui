// The composer tab overlay (0.6.73) — the reference routes/session/composer
// plane (index.tsx + context.ts + subagents-tab.tsx + shell-tab.tsx, vendored
// at tools/opencode-reference, MIT) ported onto the React stack. The overlay
// replaces the composer while open: a tab-label header ("Subagents  Shell" +
// esc), the active tab's row list (5-row window), and the hints footer;
// left/right switch tabs, up/down move (up at the top closes, verbatim),
// ctrl+a toggles active/inactive, enter inspects, esc/ctrl+c close.
// session.child.first ("Toggle subagent picker", down on an empty draft)
// opens it — the 0.6.52 SelectDialog picker retires with the wave.
//
// Data mapping (the host plane is session/subagents, unchanged since 0.6.52):
// agent = titlecased subagentType (our stand-in for upstream's
// session.agent), title = the host title with an "@agent subagent" prefix
// stripped (their agentMatch), status cell "Running" only while running.
// Upstream's enter NAVIGATES to the child transcript and ctrl+d interrupts
// the child — both stay host gaps (no child-transcript verb, probed 0.6.52;
// session/stop on a child id errors "Session is not active", re-probed live
// 0.6.73, tools/r63-child-stop-probe.ts), so enter opens the inspector card
// (the picker's documented adaptation) and the interrupt hint is omitted
// exactly per upstream's hint-when-binding-exists rule. The Shell tab
// registers with its verbatim empty state: the zcode protocol exposes no
// shell list/kill plane, entries are always empty (upstream's data.shell).
import { useEffect, useRef, useState } from "react";
import { useKeyboard } from "@opentui/react";
import { TextAttributes } from "@opentui/core";
import { footerMenuText } from "./footer-menu";
import type { ThemeTokens } from "./design";
import { pickerTabs, type PickerFilter, type SubagentTab } from "./session/subagents";

export type ComposerTabId = "subagents" | "shell";

export const COMPOSER_TABS: { id: ComposerTabId; label: string }[] = [
  { id: "subagents", label: "Subagents" },
  { id: "shell", label: "Shell" },
];

/** How many entry rows the overlay shows at once (the reference scrollbox's
 * maxHeight). */
export const COMPOSER_OVERLAY_ROWS = 5;

export type ComposerSubagentEntry = {
  sessionID: string;
  agent: string;
  title: string;
  running: boolean;
  current: boolean;
};

/** Locale.titlecase (util/locale.ts) verbatim: every word-initial \w upcased. */
export function titlecaseAgent(str: string): string {
  return str.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** The reference agentMatch: an "@agent subagent" prefix is the agent name;
 * the title is what remains (the whole title when no match). */
export function splitAgentTitle(label: string): { agent: string; title: string } {
  const match = label.match(/@(\w+) subagent/);
  if (!match) return { agent: "", title: label };
  const rest = label.replace(match[0], "").trim();
  return { agent: titlecaseAgent(match[1]), title: rest || label };
}

/** SubagentsTab entries(): the same running/inactive predicate as the
 * picker's filter, shaped for the overlay row (agent/title/running/current).
 * current = the row IS the session being viewed (upstream route.sessionID). */
export function composerSubagentEntries(
  tabs: SubagentTab[],
  filter: PickerFilter,
  currentSessionId?: string | null,
): ComposerSubagentEntry[] {
  return pickerTabs(tabs, filter).map((t) => {
    const { agent, title } = splitAgentTitle(t.description || t.title || t.label);
    return {
      sessionID: t.sessionID,
      agent: t.subagentType ? titlecaseAgent(t.subagentType) : agent || "Subagent",
      title,
      running: t.status === "running",
      current: t.sessionID === currentSessionId,
    };
  });
}

/** The overlay hints row (subagents-tab.tsx hints()): the show-toggle always;
 * the interrupt hint ONLY when the binding exists — it does not here (host
 * gap, header note), so a running selection shows just the toggle. */
export function composerHints(
  entries: ComposerSubagentEntry[],
  selected: number,
  filter: PickerFilter,
): { label: string; shortcut: string }[] {
  void entries;
  void selected;
  return [{ label: `show ${filter === "active" ? "inactive" : "active"}`, shortcut: "ctrl+a" }];
}

/** The 5-row window start: follow the selection past either edge. */
export function windowStart(selected: number, count: number, limit = COMPOSER_OVERLAY_ROWS): number {
  if (count <= limit) return 0;
  return Math.min(Math.max(0, selected - (limit - 1)), count - limit);
}

/** The overlay row label: "Agent: title" (subagents-tab.tsx). */
export function composerRowLabel(entry: ComposerSubagentEntry): string {
  return `${entry.agent}: ${entry.title}`;
}

export function ComposerOverlay({
  C,
  width,
  tabs,
  activeTab,
  subagentTabs,
  currentSessionId,
  onSwitchTab,
  onClose,
  onInspect,
}: {
  C: ThemeTokens;
  /** Content budget for truncation (the app passes the padded body width). */
  width: number;
  tabs: { id: ComposerTabId; label: string }[];
  activeTab: ComposerTabId;
  subagentTabs: SubagentTab[];
  currentSessionId?: string | null;
  onSwitchTab: (dir: -1 | 1) => void;
  onClose: () => void;
  onInspect: (entry: ComposerSubagentEntry) => void;
}) {
  // Per-tab selection (the reference keeps a store per tab component); the
  // ref mirrors for the key closure (the reconciler remount law).
  const [selected, setSelected] = useState<Record<string, number>>({ subagents: 0, shell: 0 });
  const selectedRef = useRef(selected);
  const setBoth = (next: Record<string, number>) => {
    selectedRef.current = next;
    setSelected(next);
  };
  const [filter, setFilter] = useState<PickerFilter>("active");
  const filterRef = useRef(filter);

  const entries =
    activeTab === "subagents" ? composerSubagentEntries(subagentTabs, filter, currentSessionId) : [];
  const at = Math.min(selectedRef.current[activeTab] ?? 0, Math.max(0, entries.length - 1));

  // Clamp past the end when the list shrinks under a poll refresh.
  useEffect(() => {
    if ((selectedRef.current[activeTab] ?? 0) > Math.max(0, entries.length - 1)) {
      setBoth({ ...selectedRef.current, [activeTab]: Math.max(0, entries.length - 1) });
    }
  });

  useKeyboard((key) => {
    if (key.name === "escape" || (key.ctrl && key.name === "c")) {
      onClose();
      return;
    }
    if (key.name === "left" && !key.ctrl && !key.meta && !key.shift) {
      onSwitchTab(-1);
      return;
    }
    if (key.name === "right" && !key.ctrl && !key.meta && !key.shift) {
      onSwitchTab(1);
      return;
    }
    if (key.ctrl && (key.name === "a" || key.name === "A") && activeTab === "subagents") {
      const next = filterRef.current === "active" ? "inactive" : "active";
      filterRef.current = next;
      setFilter(next);
      setBoth({ ...selectedRef.current, subagents: 0 });
      return;
    }
    if (key.name === "up" && !key.ctrl && !key.meta && !key.shift) {
      if ((selectedRef.current[activeTab] ?? 0) === 0) {
        onClose();
        return;
      }
      setBoth({ ...selectedRef.current, [activeTab]: (selectedRef.current[activeTab] ?? 0) - 1 });
      return;
    }
    if (key.name === "down" && !key.ctrl && !key.meta && !key.shift) {
      if (entries.length === 0) return;
      setBoth({
        ...selectedRef.current,
        [activeTab]: ((selectedRef.current[activeTab] ?? 0) + 1) % entries.length,
      });
      return;
    }
    if (key.name === "return" && activeTab === "subagents") {
      const entry = entries[at];
      if (entry) onInspect(entry);
    }
  });

  const labelOf = (id: ComposerTabId) => tabs.find((t) => t.id === id)?.label ?? id;
  const hints = activeTab === "subagents" ? composerHints(entries, at, filter) : [];
  const start = windowStart(at, entries.length);
  const rows = entries.slice(start, start + COMPOSER_OVERLAY_ROWS);
  const emptyLabel =
    activeTab === "subagents"
      ? `No ${filter === "active" ? "active" : "inactive"} subagents`
      : "No shell commands";

  return (
    <box style={{ flexDirection: "row", flexGrow: 1, flexShrink: 0 }}>
      <box style={{ width: 1, flexShrink: 0, backgroundColor: C.border }} />
      <box
        style={{
          flexGrow: 1,
          flexShrink: 1,
          flexDirection: "column",
          backgroundColor: C.panel,
          paddingLeft: 1,
          paddingRight: 2,
        }}
      >
        <box style={{ height: 1, flexDirection: "row", justifyContent: "space-between", flexShrink: 0 }}>
          <box style={{ flexDirection: "row", flexShrink: 0 }}>
            {tabs.map((t, i) => (
              <text
                key={t.id}
                content={t.label + (i < tabs.length - 1 ? "  " : "")}
                fg={t.id === activeTab ? C.fg : C.subtle}
                attributes={t.id === activeTab ? TextAttributes.BOLD : undefined}
              />
            ))}
          </box>
          <text content="esc" fg={C.subtle} />
        </box>
        <box style={{ flexDirection: "column", flexShrink: 0 }}>
          {rows.length === 0 ? (
            <text content={` ${emptyLabel}`} fg={C.subtle} />
          ) : (
            rows.map((entry, i) => {
              const idx = start + i;
              const isSelected = idx === at;
              const bg = isSelected ? C.accent : entry.current ? C.surface : undefined;
              const fg = isSelected ? C.accentText : entry.current ? C.brand : C.fg;
              const runningCell = entry.running ? "Running" : "";
              const label = footerMenuText(
                composerRowLabel(entry),
                Math.max(8, width - (runningCell ? runningCell.length + 1 : 0)),
              );
              return (
                <box
                  key={entry.sessionID}
                  style={{
                    height: 1,
                    flexDirection: "row",
                    flexShrink: 0,
                    paddingLeft: 1,
                    paddingRight: 1,
                    backgroundColor: bg,
                  }}
                >
                  <text content={label} fg={fg} attributes={isSelected ? TextAttributes.BOLD : undefined} />
                  {runningCell ? <text content={` ${runningCell}`} fg={C.subtle} bg={bg} /> : null}
                </box>
              );
            })
          )}
        </box>
        {hints.length > 0 ? (
          <box style={{ height: 1, flexDirection: "row", flexShrink: 0, paddingLeft: 1 }}>
            {hints.map((h, i) => (
              <box key={h.label} style={{ flexDirection: "row", flexShrink: 0 }}>
                <text content={`${i > 0 ? "  " : ""}${h.label} `} fg={C.fg} attributes={TextAttributes.BOLD} />
                <text content={h.shortcut} fg={C.subtle} />
              </box>
            ))}
          </box>
        ) : null}
      </box>
    </box>
  );
}
