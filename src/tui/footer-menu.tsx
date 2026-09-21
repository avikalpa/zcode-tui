// Port of the reference mini/footer.menu.tsx (vendored at
// tools/opencode-reference/tui/mini/footer.menu.tsx, MIT) — the v2.0.8+
// footer-menu grammar: categorized header/item/spacer rows over an 8-row
// viewport; items carry icon, current-marker, description, category and a
// footer tone of selection|running|error|success; a compact-width mode
// drops headers and spacers and clamps the paddings. The Solid
// signals/effects of the reference map to React state/effects; the
// selection/window arithmetic stays in ./select-controller (verbatim).
// Theme mapping (RunFooterTheme -> ThemeTokens): shade=surface,
// border=border, muted=subtle, actionFocusedBg=accent,
// actionFocusedText=accentText, formfieldText=fg, running=accent (the
// interactive hue), success/error=success/error.
import { useEffect, useRef, useState } from "react";
import { TextAttributes } from "@opentui/core";
import { stringWidth } from "./diff/string-width";
import {
  moveSelection,
  moveSelectionOffset,
  reconcileSelection,
  revealSelectionOffset,
} from "./select-controller";
import type { ThemeTokens } from "./design";

export const FOOTER_MENU_ROWS = 8;
export const FOOTER_COMPACT_WIDTH = 40;

// Reference util/locale takeWidth/truncateWidth: grapheme-aware cut, the
// truncate flavor appending an ellipsis inside the budget.
function takeWidth(str: string, width: number): string {
  if (width <= 0) return "";
  if (stringWidth(str) <= width) return str;
  const result: string[] = [];
  let used = 0;
  for (const segment of Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(str))) {
    const next = stringWidth(segment.segment);
    if (used + next > width) break;
    result.push(segment.segment);
    used += next;
  }
  return result.join("");
}

function truncateWidth(str: string, width: number): string {
  if (width <= 0) return "";
  if (stringWidth(str) <= width) return str;
  if (width === 1) return "…";
  return takeWidth(str, width - 1) + "…";
}

export function footerMenuText(text: string, width: number, mono = false) {
  if (!mono) return truncateWidth(text, width);
  if (stringWidth(text) <= width) return text;
  const suffix = ".".repeat(Math.min(3, Math.max(0, width)));
  return takeWidth(text, width - suffix.length) + suffix;
}

export type FooterMenuTone = "selection" | "running" | "error" | "success";

export type FooterMenuItem = {
  display: string;
  icon?: (color: string) => React.ReactNode;
  current?: boolean;
  description?: string;
  category?: string;
  footer?: string;
  footerTone?: FooterMenuTone;
  // Carry-over from the v2 sessions list (DialogSessionList): the armed
  // delete wears the destructive background. The reference menu item has no
  // bg field; this is the one field the grammar GAINS, sourced from v2's own
  // sibling surface rather than invented.
  bg?: string;
};

type FooterMenuRow =
  | { type: "header"; label: string }
  | { type: "item"; item: FooterMenuItem; index: number }
  | { type: "spacer" };

// Categorized display rows (reference groupedRows memo): one header per
// non-empty category change plus a spacer before every group but the first;
// compact mode drops both. Exported for the unit checks.
export function buildMenuRows(items: FooterMenuItem[], compact = false): FooterMenuRow[] {
  const all: FooterMenuRow[] = [];
  let category = "";
  items.forEach((item, index) => {
    if (item.category && item.category !== category) {
      if (all.length > 0 && !compact) {
        all.push({ type: "spacer" });
      }
      category = item.category;
      if (!compact) all.push({ type: "header", label: item.category });
    }
    all.push({ type: "item", item, index });
  });
  return all;
}

// Reference createFooterMenuState as a React hook: selection clamps (the
// footer-menu move policy — dialogs wrap at their own layer), the window
// reveal/margins ride the shared select-controller arithmetic, and the
// reconcile effect re-windows on every count change.
export function useFooterMenuState(input: { count: number; limit?: number }) {
  const [selected, setSelected] = useState(0);
  const [offset, setOffset] = useState(0);
  const limit = Math.max(1, input.limit ?? FOOTER_MENU_ROWS);
  const rows = Math.max(1, Math.min(limit, input.count));

  const reveal = (index: number) => {
    const count = input.count;
    const next = reconcileSelection(index, count);
    setSelected(next);
    setOffset((value) => revealSelectionOffset(value, { count, limit, selected: next }));
  };

  const reset = () => {
    setSelected(0);
    setOffset(0);
  };

  useEffect(() => {
    const count = input.count;
    const next = reconcileSelection(selected, count);
    setSelected(next);
    setOffset((value) => revealSelectionOffset(value, { count, limit, selected: next }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input.count, limit]);

  const move = (dir: -1 | 1) => {
    const count = input.count;
    const next = moveSelection(selected, { count, delta: dir, policy: "clamp" });
    setSelected(next);
    setOffset((value) => moveSelectionOffset(value, { count, limit, selected: next, direction: dir }));
  };

  return { selected, offset, rows, limit, reveal, reset, move };
}

const TONE_WARN = "footerTone must be selection | running | error | success";

export function footerToneColor(C: ThemeTokens, tone: FooterMenuTone | undefined): string {
  switch (tone) {
    case "selection":
    case "running":
      return C.accent;
    case "error":
      return C.error;
    case "success":
      return C.success;
    case undefined:
      return C.subtle;
    default: {
      const exhaustive: never = tone;
      throw new Error(`${TONE_WARN}: ${String(exhaustive)}`);
    }
  }
}

export function FooterMenu(props: {
  C: ThemeTokens;
  items: FooterMenuItem[];
  selected: number;
  offset: number;
  rows: number;
  limit?: number;
  empty?: string;
  border?: boolean;
  paddingLeft?: number;
  paddingRight?: number;
  grouped?: boolean;
  compact?: boolean;
  background?: boolean;
  headerColor?: string;
  mono?: boolean;
  /** Content width of the surface the menu paints into (the reference reads
   * the terminal width; a card-hosted menu takes its card width). */
  width: number;
}) {
  const C = props.C;
  const limit = Math.max(1, Math.min(props.rows, props.limit ?? FOOTER_MENU_ROWS));
  const border = props.border ?? true;
  const compactSurface = props.width < FOOTER_COMPACT_WIDTH;
  const paddingLeft = Math.min(props.paddingLeft ?? 1, compactSurface ? 1 : Infinity);
  const paddingRight = Math.min(props.paddingRight ?? 0, compactSurface ? 1 : Infinity);
  const width = Math.max(0, props.width - (border ? 1 : 0) - paddingLeft - paddingRight);
  const [groupOffset, setGroupOffset] = useState(0);
  const previous = useRef(-1);
  const all = buildMenuRows(props.items, props.compact);

  // Reference grouped effect: the selected ITEM maps into display-row space
  // and the window follows with the shared margin/reveal arithmetic; a
  // non-adjacent jump reveals, an adjacent step nudges.
  {
    const at = props.grouped
      ? all.findIndex((row) => row.type === "item" && row.index === props.selected)
      : -1;
    const settled = useRef(-2);
    if (props.grouped && (all.length === 0 || at === -1)) {
      if (settled.current !== -1) {
        setGroupOffset(0);
        previous.current = props.selected;
        settled.current = -1;
      }
    } else if (props.grouped) {
      const dir =
        props.selected === previous.current + 1 ? 1 : props.selected === previous.current - 1 ? -1 : undefined;
      const next = dir
        ? moveSelectionOffset(groupOffset, { count: all.length, limit, selected: at, direction: dir })
        : revealSelectionOffset(groupOffset, { count: all.length, limit, selected: at });
      if (next !== groupOffset || previous.current !== props.selected || settled.current !== at) {
        setGroupOffset(next);
        previous.current = props.selected;
        settled.current = at;
      }
    }
  }

  const rows: FooterMenuRow[] = (() => {
    if (!props.grouped) {
      return props.items
        .slice(props.offset, props.offset + limit)
        .map((item, index) => ({ type: "item" as const, item, index: index + props.offset }));
    }
    const start = Math.max(0, Math.min(groupOffset, all.length - limit));
    return all.slice(start, start + limit);
  })();

  const descriptionColumn = (() => {
    const widest = Math.max(0, ...props.items.filter((item) => item.description).map((item) => stringWidth(item.display)));
    return widest === 0 ? 0 : widest + 2;
  })();

  const rowBackground = (item: FooterMenuItem, active: boolean) =>
    active ? C.accent : (item.bg ?? (props.background ? C.surface : undefined));

  const emptyRow = (
    <box style={{ paddingRight: 0, flexDirection: "row", height: 1, flexShrink: 0 }}>
      {border ? <text content={props.mono ? "|" : "┃"} fg={C.border} /> : null}
      <box style={{ flexGrow: 1, flexShrink: 1, paddingLeft, paddingRight }}>
        <text content={props.empty ?? "No matching items"} fg={C.subtle} />
      </box>
    </box>
  );

  return (
    <box
      style={{
        width: "100%",
        height: props.rows,
        flexShrink: 0,
        backgroundColor: props.background ? C.surface : undefined,
        flexDirection: "column",
      }}
    >
      {rows.length === 0
        ? emptyRow
        : rows.map((row, viewIdx) => {
            const key = `menu-${groupOffset + viewIdx}-${row.type}`;
            if (row.type === "spacer") {
              return <box key={key} style={{ height: 1, flexShrink: 0 }} />;
            }
            if (row.type === "header") {
              return (
                <box key={key} style={{ height: 1, flexShrink: 0, paddingLeft, paddingRight }}>
                  <text content={row.label} fg={props.headerColor ?? C.subtle} attributes={TextAttributes.BOLD} />
                </box>
              );
            }
            const item = row.item;
            const active = row.index === props.selected;
            const available = Math.max(0, width - (item.icon ? 2 : 0));
            const attributes = active ? TextAttributes.BOLD | (props.mono ? TextAttributes.INVERSE : 0) : undefined;
            const background = rowBackground(item, active);
            // Reference footer cell: a tone other than "selection" on the
            // current row keeps a short primary cell (icon 4 / plain 8); the
            // current+selection pair suppresses entirely (the highlight
            // already marks the row).
            const footer = (() => {
              if (!item.footer) return undefined;
              const title = stringWidth(item.display);
              const primary = !!(item.footerTone && !(item.current && item.footerTone === "selection"));
              return (primary ? Math.min(item.icon ? 4 : 8, title) : title) + 1 + stringWidth(item.footer) <=
                available
                ? item.footer
                : undefined;
            })();
            const description = (() => {
              if (!item.description) return undefined;
              const remaining = available - descriptionColumn - (footer ? stringWidth(footer) + 1 : 0);
              if (remaining < Math.min(12, stringWidth(item.description))) return undefined;
              return footerMenuText(item.description, remaining, props.mono);
            })();
            const display = footerMenuText(
              item.display,
              available - (footer ? stringWidth(footer) + 1 : 0),
              props.mono,
            );
            return (
              <box
                key={key}
                style={{ height: 1, flexShrink: 0, paddingRight: 0, flexDirection: "row", backgroundColor: background }}
              >
                {border ? (
                  <text
                    content={active ? (props.mono ? ">" : "▌") : " "}
                    fg={C.accentText}
                    bg={background}
                  />
                ) : null}
                <box style={{ flexGrow: 1, flexShrink: 1, paddingLeft, paddingRight, backgroundColor: background }}>
                  <box style={{ width: "100%", flexDirection: "row", justifyContent: "space-between" }}>
                    <box style={{ flexDirection: "row", flexGrow: 1, flexShrink: 1 }}>
                      {item.icon ? (
                        <box style={{ width: 2, flexShrink: 0 }}>
                          {item.icon(active ? C.accentText : C.fg)}
                        </box>
                      ) : null}
                      <text
                        content={display}
                        fg={active ? C.accentText : C.fg}
                        attributes={attributes}
                      />
                      {description ? (
                        <>
                          <text
                            content={" ".repeat(Math.max(1, descriptionColumn - stringWidth(item.display)))}
                            fg={active ? C.accentText : C.subtle}
                          />
                          <text content={description} fg={active ? C.accentText : C.subtle} />
                        </>
                      ) : null}
                    </box>
                    {footer ? (
                      <text
                        content={footer}
                        fg={active ? C.accentText : footerToneColor(C, item.footerTone)}
                        attributes={attributes}
                      />
                    ) : null}
                  </box>
                </box>
              </box>
            );
          })}
    </box>
  );
}
