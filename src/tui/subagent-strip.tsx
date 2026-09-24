// The subagent strip (0.6.52) — the reference surfaces RunSubagentSelectBody
// (mini/footer.command.tsx) + RunFooterSubagentBody's header plane
// (mini/footer.subagent.tsx) wired to our host session/subagents payload.
// The picker rides SelectDialog's menu grammar (the entries built here); the
// inspector is the non-modal header card + body. Upstream's inspector body is
// the child's live transcript (their 1141-line stream-v2.subagent transport);
// the zcode host exposes no child-transcript verb (session/messages on a
// child id fails "Session is not active", probed 0.6.52) — so the body
// renders the host's summary line for ended tabs and the upstream empty
// state for running ones. Per-child interrupt rides the same gap: upstream
// shows the hint only when the keymap binding exists, and ours does not.
import { useKeyboard } from "@opentui/react";
import type { ThemeTokens } from "./design";
import { footerMenuText } from "./footer-menu";
import type { SubagentStatus, SubagentTab } from "./session/subagents";

/** statusColor (footer.subagent.tsx): completed success, cancelled muted,
 * error error, running the live tone. Our token map per the R39 footer
 * mapping: muted -> subtle, running -> accent. */
export function subagentStatusColor(C: ThemeTokens, status: SubagentStatus): string {
  if (status === "completed") return C.success;
  if (status === "cancelled") return C.subtle;
  if (status === "error") return C.error;
  return C.accent;
}

/** statusIcon (footer.subagent.tsx): the four glyphs and their mono
 * fallbacks, verbatim. */
export function subagentStatusIcon(status: SubagentStatus, mono = false): string {
  if (status === "completed") return mono ? "*" : "●";
  if (status === "cancelled") return mono ? "-" : "○";
  if (status === "error") return mono ? "!" : "◍";
  return mono ? "." : "◔";
}

/** The i-of-n count cell (RunFooterSubagentBody): shown only past the first
 * tab of several. */
export function subagentCountLabel(index: number, total: number): string {
  return total > 1 && index > 0 ? `${index} of ${total}` : "";
}

/** The inspector header card + body (RunFooterSubagentBody's non-transcript
 * plane). Props-only; state (which tab, open/closed) lives in App beside the
 * other dialog state. The running header paints the same spinner frame the
 * busy statusline cycles. App renders this only while open, so the key
 * handler is live exactly when the card is visible. */
export function SubagentInspector({
  C,
  tab,
  index,
  total,
  spinner,
  width,
  onClose,
  onCycle,
  mono,
}: {
  C: ThemeTokens;
  tab: SubagentTab | undefined;
  index: number;
  total: number;
  /** The App's current spinner frame (running header cell). */
  spinner: string;
  width: number;
  onClose: () => void;
  onCycle: (dir: -1 | 1) => void;
  mono?: boolean;
}) {
  useKeyboard((key) => {
    if (key.name === "escape") {
      onClose();
      return;
    }
    if (key.name === "tab") {
      onCycle(key.shift ? -1 : 1);
    }
  });

  if (!tab) return null;
  const title = tab.description || tab.title || tab.label;
  const subtitle = title === tab.label ? "" : tab.label;
  const count = subagentCountLabel(index, total);
  const titleWidth = Math.max(1, width - 6 - (count ? count.length + 1 : 0));
  const color = subagentStatusColor(C, tab.status);

  return (
    <box
      style={{
        flexDirection: "column",
        flexShrink: 0,
        paddingLeft: 3,
        paddingRight: 3,
      }}
    >
      <box style={{ height: 1, flexDirection: "row", flexShrink: 0 }}>
        <text
          content={tab.status === "running" ? spinner : subagentStatusIcon(tab.status, mono)}
          fg={color}
          style={{ flexShrink: 0 }}
        />
        <text
          content={footerMenuText(count ? `${title} ${count}` : title, titleWidth, mono)}
          fg={C.fg}
          style={{ flexGrow: 1, flexShrink: 1 }}
        />
        {subtitle && titleWidth >= title.length + subtitle.length + 2 ? (
          <text content={`  ${subtitle}`} fg={C.subtle} style={{ flexShrink: 0 }} />
        ) : null}
      </box>
      <box style={{ height: 1, flexDirection: "row", flexShrink: 0 }}>
        <text
          content={tab.summary ?? "No subagent activity yet"}
          fg={tab.summary ? C.fg : C.subtle}
          style={{ flexGrow: 1 }}
        />
        <text content="esc back" fg={C.subtle} style={{ flexShrink: 0 }} />
        {total > 1 ? <text content="  tab next" fg={C.subtle} style={{ flexShrink: 0 }} /> : null}
      </box>
    </box>
  );
}
