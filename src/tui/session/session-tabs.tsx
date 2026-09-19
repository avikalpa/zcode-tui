// Ported from opencode v2.0.10 packages/tui/src/component/session-tabs.tsx
// (HorizontalSessionTabs + TabIndicator) onto our React binding — the tab
// strip above the transcript: adaptive widths, the number gutter (number /
// running spinner / "!" permission / "?" question / • unread), elevated
// active tab, ‹N / N› overflow markers, titles truncated to their slot.
//
// Upstream's v2.0.10 hue swap (unread/attention take hue.accent, running
// takes hue.interactive) is ported through our two-token adaptation: C.accent
// stands for hue.accent, C.warning stands for hue.interactive — the same
// mapping the 0.6.22 port made when the roles were the other way around.
//
// Not ported (the binding has no plane for them, ledger deviation queue):
// the animation framework (springs/marquee/shimmer/glow), mouse drag
// reorder + close-hold + the " + " add button (mouse affordances), and the
// vertical sidebar rail (our sidebar keeps its own shape).

import { TextAttributes } from "@opentui/core";
import type { ThemeTokens } from "../design";
import { stringWidth } from "../diff/string-width";
import {
  adaptiveSessionTabLayout,
  sessionTabNumberLabel,
  type SessionTab,
  type SessionTabUnread,
} from "./session-tabs-model";

export type SessionTabStatus = {
  busy: boolean;
  unread?: SessionTabUnread;
  attention?: "permission" | "question";
};

// theme/color.ts tint, over hex tokens (the diff tree carries the same math).
function tint(baseHex: string, overlayHex: string, alpha: number): string {
  const parse = (hex: string) => {
    const h = hex.replace("#", "");
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    ] as const;
  };
  const [r1, g1, b1] = parse(baseHex);
  const [r2, g2, b2] = parse(overlayHex);
  const mix = (a: number, b: number) => Math.round(a + (b - a) * alpha).toString(16).padStart(2, "0");
  return `#${mix(r1, r2)}${mix(g1, g2)}${mix(b1, b2)}`;
}

const TAB_UNREAD_MARKERS: Record<string, string> = {
  "small-dot": "•",
  dot: "●",
  square: "▪",
  "large-square": "■",
};

export function SessionTabsStrip(props: {
  C: ThemeTokens;
  tabs: readonly SessionTab[];
  activeId: string | undefined;
  width: number;
  statusOf: (sessionId: string) => SessionTabStatus;
  spinnerChar: string;
  titles: (sessionId: string) => string | undefined;
}) {
  const C = props.C;
  const layout = adaptiveSessionTabLayout(props.tabs, props.activeId, props.width);
  if (layout.tabs.length === 0) return null;
  const numberWidth = Math.max(2, String(props.tabs.length).length);

  const cell = (tab: SessionTab, index: number) => {
    const width = Math.max(1, layout.widths[index] ?? 1);
    const selected = tab.sessionID === props.activeId;
    const status = props.statusOf(tab.sessionID);
    const background = selected ? tint(C.bg, C.surface, 1) : tint(C.bg, C.surface, 0.4);
    // The gutter: number / spinner / attention / unread — the reference's
    // TabIndicator label order (attention beats busy beats unread).
    let gutter = sessionTabNumberLabel(index);
    let gutterFg = selected ? C.accent : tint(C.subtle, C.bg, 0.55);
    if (status.attention === "permission") { gutter = "!"; gutterFg = C.accent; }
    else if (status.attention === "question") { gutter = "?"; gutterFg = C.accent; }
    else if (status.busy) { gutter = props.spinnerChar || "◌"; gutterFg = C.warning; }
    else if (status.unread) { gutter = TAB_UNREAD_MARKERS["small-dot"]; gutterFg = status.unread === "error" ? C.error : C.accent; }
    const title = props.titles(tab.sessionID) || tab.title || "Untitled session";
    const titleWidth = Math.max(1, width - 1 - numberWidth);
    const shown = title.length > titleWidth ? title.slice(0, Math.max(1, titleWidth - 1)) + "…" : title;
    return (
      <box
        key={tab.sessionID}
        style={{
          width,
          height: 1,
          flexShrink: 0,
          flexDirection: "row",
          backgroundColor: background,
        }}
      >
        <text content={gutter} fg={gutterFg} width={numberWidth} wrapMode="none" />
        <text
          content={shown.length > titleWidth ? shown.slice(0, titleWidth) : shown}
          fg={selected ? C.fg : C.subtle}
          attributes={selected ? TextAttributes.BOLD : undefined}
          wrapMode="none"
        />
      </box>
    );
  };

  return (
    <box style={{ height: 1, flexShrink: 0, flexDirection: "row", width: "100%" }}>
      {layout.before > 0 ? (
        <text content={`‹${layout.before}`} width={String(layout.before).length + 2} fg={C.subtle} wrapMode="none" />
      ) : null}
      {layout.tabs.map((tab, index) => cell(tab, index))}
      {layout.after > 0 ? (
        <text content={`${layout.after}›`} width={String(layout.after).length + 2} fg={C.subtle} wrapMode="none" />
      ) : null}
    </box>
  );
}

// Re-exported so the app can type its status callback without importing the
// model directly.
export type { SessionTab, SessionTabUnread };
