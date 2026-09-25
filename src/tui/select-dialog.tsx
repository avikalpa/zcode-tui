// OpenCode-shaped selection primitives.
//
// The dialog container follows the reference modal recipe (consult
// 2026-09-13, item 1): a flat, borderless panel on a dimmed backdrop — no
// rounded borders, no recessed search box. Selection is a full-width primary
// bar with background-coloured text; the current item wears a filled dot.
// Group headers are accent + bold with a spacer row between groups, and the
// dialog carries the reference footer hint row in v2's FooterAction grammar
// (bold word first, subdued key after; 0.6.30 re-port fixed the inverted
// key-first rendering) — owner ruling 2026-09-16 ("the sessions overlay of
// opencode is more polished; copy it") supersedes the earlier no-footer
// consult line.
// Dialogs deliberately use the global keyboard hook instead of a focused
// InputRenderable: OpenTUI can retain focus on a component that has already
// been reconciled away, so keeping filter state here makes every modal
// deterministic under fast PTY typing.
// 0.6.48 — the selection/window arithmetic moved onto the reference
// ui/select-controller grammar (verbatim in ./select-controller): moves wrap
// at the ends (v2 dialog.select.prev/next run policy "wrap"), the row window
// scrolls with the reference reveal margin (moveSelectionOffset/reveal),
// display rows include the group headers and spacers (a window counts real
// rows, like the reference scrollbox), empty and no-match states split
// (v2 emptyView vs noMatchView fallbacks), and an onMove hook fires on
// user-driven selection moves (the reference moveTo path — the sessions
// picker clears its armed delete there).
// 0.6.49 — the menu paint path: `menu` renders the list body through the
// reference mini/footer.menu.tsx grammar (ported in ./footer-menu) —
// categorized header/item rows, icon column, aligned descriptions, and a
// footer tone cell (current markers ride footer "current" + selection,
// like the reference agent panel). The legacy scrollbox-style rows stay for
// the surfaces that have not migrated yet (the carry-over audit in
// docs/parity-v2.md tracks them).
import { useEffect, useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { TextAttributes } from "@opentui/core";
import { THEMES, type ThemeTokens } from "./design";
import { FooterMenu, type FooterMenuTone } from "./footer-menu";
import {
  moveSelection,
  moveSelectionOffset,
  reconcileSelection,
  revealSelectionOffset,
} from "./select-controller";

export interface DialogOption<T> {
  id: string;
  label: string;
  description?: string;
  meta?: string;
  /** Search-only keywords (v2 dialog-select searchText: the filter reads
   * title + category + searchText — matched text never renders). */
  searchText?: string;
  /** Menu-grammar fields (footer.menu.tsx item shape) for the surfaces
   * painted through the menu path: a 2-column icon cell, and a footer cell
   * carrying a tone (current markers ride footer "current" + selection,
   * like the reference agent panel). */
  icon?: (color: string) => React.ReactNode;
  footer?: string;
  footerTone?: FooterMenuTone;
  group?: string;
  bg?: string;
  gutter?: string;
  value: T;
}

type DialogAction<T> = (
  action: "pin" | "delete" | "rename" | "all",
  option: DialogOption<T> | undefined,
) => void;

// Display rows mirror the reference grouped render (dialog-select.tsx): one
// header row per non-empty group plus a spacer row before every group but
// the first, options otherwise in given order.
type DisplayRow<T> =
  | { kind: "spacer" }
  | { kind: "header"; label: string }
  | { kind: "item"; opt: DialogOption<T>; itemIndex: number };

function buildRows<T>(shown: DialogOption<T>[]): DisplayRow<T>[] {
  const rows: DisplayRow<T>[] = [];
  let group = "";
  shown.forEach((opt, itemIndex) => {
    const next = opt.group ?? "";
    if (next && next !== group) {
      if (rows.length > 0) rows.push({ kind: "spacer" });
      rows.push({ kind: "header", label: next });
      group = next;
    }
    rows.push({ kind: "item", opt, itemIndex });
  });
  return rows;
}

// Width tiers from the reference modal: medium 60, large 88, xlarge 116.
function tierWidth(size: "medium" | "large" | "xlarge" | undefined, width: number): number {
  const base = size === "xlarge" ? 116 : size === "large" ? 88 : 60;
  return Math.min(base, Math.max(20, width - 2));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function truncate(value: string, width: number): string {
  if (value.length <= width) return value;
  if (width <= 1) return value.slice(0, width);
  return `${value.slice(0, width - 1)}…`;
}

export function ModalBackdrop({
  C,
  width,
  height,
  children,
}: {
  C: ThemeTokens;
  width: number;
  height: number;
  children: React.ReactNode;
}) {
  return (
    <box
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width,
        height,
        zIndex: 3000,
        backgroundColor: "#00000096",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      <box style={{ flexGrow: 0, width: "100%", height: Math.floor(height / 4), flexShrink: 0 }} />
      {children}
    </box>
  );
}

export function SelectDialog<T>({
  title,
  options,
  currentId,
  onSelect,
  onClose,
  onAction,
  onHighlight,
  onHorizontal,
  onMove,
  size,
  countLabel,
  footerHints,
  emptyLabel,
  noMatchLabel,
  menu,
  onExtraKey,
  theme,
}: {
  title: string;
  options: DialogOption<T>[];
  currentId?: string;
  onSelect: (value: T, id: string) => void;
  onClose: () => void;
  onAction?: DialogAction<T>;
  /** v2 dialog.select paging: pageup/pagedown move ±10, home/end jump to
   * the first/last row (dialog.select.page_up/page_down/home/end). */
  onHorizontal?: (dir: -1 | 1, option: DialogOption<T> | undefined) => void;
  /** Live-preview hook (reference onMove/onFilter): fires whenever the
   * highlighted row changes — arrows and typing both count. */
  onHighlight?: (option: DialogOption<T> | undefined) => void;
  /** User-driven selection moves only (reference moveTo → props.onMove):
   * arrows, paging, ends, and filter-driven reselection — not mount, not
   * external option refreshes. */
  onMove?: (option: DialogOption<T> | undefined) => void;
  size?: "medium" | "large" | "xlarge";
  countLabel?: string;
  /** v2 footerHints grammar (dialog-select.tsx FooterAction): the WORD is
   * bold and leads, the KEY rides subdued after it ("open enter"), pairs
   * space 2 apart, left group left / side:"right" group right across a
   * space-between footer row. */
  footerHints?: { key: string; label: string; side?: "left" | "right" }[];
  /** v2 emptyView / noMatchView fallbacks (dialog-select.tsx): the empty
   * list speaks "No items available", a filtered-out list "No results
   * found". */
  emptyLabel?: string;
  noMatchLabel?: string;
  /** Paint the list body through the v2 footer-menu grammar (./footer-menu)
   * instead of the legacy dialog-select rows — the sessions-surface
   * rebuild (owner dogfood directive, docs/parity-v2.md sessions line). */
  menu?: boolean;
  /** Surface-specific key hook (reference onKey in the searchable panel
   * controller): fired after escape/quit, before the shared grammar; return
   * true when the key was consumed. The subagents picker's tab
   * active/inactive toggle rides this. */
  onExtraKey?: (key: { name: string; shift?: boolean; ctrl?: boolean; meta?: boolean; sequence?: string }) => boolean;
  theme?: ThemeTokens;
}) {
  const [filter, setFilter] = useState("");
  // The reference opens with the selection ON the current row (DialogSelect
  // moves to props.current on mount) — otherwise the ● origin marker can sit
  // outside the initial window for long lists like the 35 themes.
  const currentStartIndex = () => {
    const at = currentId ? options.findIndex((o) => o.id === currentId) : -1;
    return at >= 0 ? at : 0;
  };
  const [idx, setIdx] = useState(currentStartIndex);
  const [offset, setOffset] = useState(0);
  const dims = useTerminalDimensions();
  const C = theme ?? THEMES.opencode;
  const cardWidth = tierWidth(size, dims.width);

  const shown = options.filter((o) =>
    `${o.label} ${o.description ?? ""} ${o.meta ?? ""} ${o.group ?? ""} ${o.searchText ?? ""}`
      .toLowerCase()
      .includes(filter.toLowerCase()),
  );
  // The reference flatten (dialog-select.tsx): a non-empty query collapses
  // the grouped view into one flat list — no headers, no spacers (0.6.53).
  const rows = filter ? shown.map((opt, itemIndex) => ({ kind: "item" as const, opt, itemIndex })) : buildRows(shown);
  const sel = reconcileSelection(idx, shown.length);
  // The card must FIT its own maxHeight: pad(2) + title + search + hints row
  // + every group header (with its spacer) is chrome the list cannot eat, or
  // the footer hints get clipped off the bottom (measured 2026-09-16,
  // 30-row renderer). The row window shrinks to leave that room.
  const backdropRows = Math.floor(dims.height / 4);
  const maxHeight = Math.max(8, dims.height - backdropRows - 2);
  const chromeRows = 5 + (footerHints && footerHints.length > 0 ? 1 : 0);
  const groupCount = new Set(shown.filter((o) => o.group).map((o) => o.group)).size;
  const headerRows = groupCount > 0 ? groupCount * 2 - 1 : 0;
  const visibleCount = Math.max(3, Math.min(22, maxHeight - chromeRows - headerRows));
  const rowOfItem = (itemIndex: number) => {
    const at = rows.findIndex((r) => r.kind === "item" && r.itemIndex === itemIndex);
    return at >= 0 ? at : 0;
  };
  const winStart = clamp(offset, 0, Math.max(0, rows.length - 1));
  const visible = rows.slice(winStart, winStart + visibleCount);
  const visibleItems = visible.filter((r): r is Extract<DisplayRow<T>, { kind: "item" }> => r.kind === "item");
  const firstVisibleItem = visibleItems.length > 0 ? visibleItems[0].itemIndex + 1 : 0;
  const lastVisibleItem = visibleItems.length > 0 ? visibleItems[visibleItems.length - 1].itemIndex + 1 : 0;

  // The window must always hold the selection: any list-shape change
  // (filter, options refresh, dialog open) re-reveals through the reference
  // arithmetic. Explicit moves nudge it beforehand (margin scroll) — this
  // effect is the reconcile net.
  useEffect(() => {
    setOffset((value) =>
      revealSelectionOffset(value, {
        count: rows.length,
        limit: visibleCount,
        selected: rowOfItem(sel),
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length, visibleCount, sel, filter, options]);

  // Fire the preview whenever the highlighted row moves (arrows, typing,
  // backspace — anything that re-filters). No onHighlight → no-op.
  useEffect(() => {
    if (onHighlight) onHighlight(shown[sel]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, filter, options]);

  // v2 move(): dialog.select.prev/next/page_up/page_down all wrap
  // (policy "wrap"), the window nudges with the reference margin scroll.
  const moveBy = (delta: number) => {
    if (shown.length === 0) return;
    const next = moveSelection(sel, { count: shown.length, delta, policy: "wrap" });
    setIdx(next);
    setOffset((value) =>
      moveSelectionOffset(value, {
        count: rows.length,
        limit: visibleCount,
        selected: rowOfItem(next),
        direction: delta < 0 ? -1 : 1,
      }),
    );
    if (onMove) onMove(shown[next]);
  };

  // v2 moveTo(): home/end and filter-driven reselection jump and reveal.
  const jumpTo = (target: number) => {
    if (shown.length === 0) return;
    const next = reconcileSelection(target, shown.length);
    setIdx(next);
    setOffset((value) =>
      revealSelectionOffset(value, {
        count: rows.length,
        limit: visibleCount,
        selected: rowOfItem(next),
      }),
    );
    if (onMove) onMove(shown[next]);
  };

  useKeyboard((key) => {
    if (key.name === "escape" || (key.ctrl && key.name === "c")) { onClose(); return; }
    if (onExtraKey?.(key)) return;
    if (key.ctrl && key.name === "f") { onAction?.("pin", shown[sel]); return; }
    if (key.ctrl && key.name === "d") { onAction?.("delete", shown[sel]); return; }
    if (key.ctrl && key.name === "r") { onAction?.("rename", shown[sel]); return; }
    if (key.ctrl && key.name === "a") { onAction?.("all", shown[sel]); return; }
    if (key.name === "return") {
      const option = shown[sel];
      if (option) onSelect(option.value, option.id);
      else onClose();
      return;
    }
    if (key.name === "up") { moveBy(-1); return; }
    if (key.name === "down") { moveBy(1); return; }
    if (key.name === "pageup") { moveBy(-10); return; }
    if (key.name === "pagedown") { moveBy(10); return; }
    if (key.name === "home") { jumpTo(0); return; }
    if (key.name === "end") { jumpTo(shown.length - 1); return; }
    if (onHorizontal && (key.name === "left" || key.name === "right") && !key.ctrl && !key.meta) {
      onHorizontal(key.name === "left" ? -1 : 1, shown[sel]);
      return;
    }
    if (key.name === "backspace") {
      setFilter((f) => f.slice(0, -1));
      // Emptying the query restores the selection to the current row
      // (reference onFilter: query.length === 0 → back to where you started).
      jumpTo(filter.length <= 1 ? currentStartIndex() : 0);
      return;
    }
    if (key.sequence && !key.ctrl && /^[^\x00-\x1f\x7f]+$/u.test(key.sequence)) {
      setFilter((f) => f + key.sequence);
      jumpTo(0);
    }
  });

  return (
    <ModalBackdrop C={C} width={dims.width} height={dims.height}>
      <box
        style={{
          width: cardWidth,
          maxHeight: dims.height - Math.floor(dims.height / 4) - 2,
          flexDirection: "column",
          flexShrink: 0,
          backgroundColor: C.panel,
          paddingTop: 1,
          paddingBottom: 1,
          paddingLeft: 2,
          paddingRight: 2,
        }}
      >
        <box style={{ height: 1, flexDirection: "row", justifyContent: "space-between", flexShrink: 0 }}>
          <text content={title} fg={C.fg} attributes={TextAttributes.BOLD} />
          <text content="esc" fg={C.faint} />
        </box>
        <box style={{ height: 1, flexDirection: "row", flexShrink: 0 }}>
          {filter ? (
            <>
              <text content={filter} fg={C.fg} />
              <text content="█" fg={C.accent} />
            </>
          ) : (
            <>
              <text content="█" fg={C.accent} />
              <text content="Search" fg={C.faint} />
            </>
          )}
        </box>
        {options.length === 0 ? (
          <text content={` ${emptyLabel ?? "No items available"}`} fg={C.faint} />
        ) : visible.length === 0 ? (
          <text content={` ${noMatchLabel ?? "No results found"}`} fg={C.faint} />
        ) : menu ? (
          <FooterMenu
            C={C}
            items={shown.map((o) => ({
              display: o.meta ? `${o.label}  ${o.meta}` : o.label,
              icon: o.icon,
              current: o.id === currentId,
              description: o.description,
              category: o.group || undefined,
              footer: o.footer,
              footerTone: o.footerTone,
              bg: o.bg,
            }))}
            selected={sel}
            offset={offset}
            rows={Math.max(1, Math.min(visibleCount, rows.length))}
            limit={visibleCount}
            grouped
            background={false}
            border={false}
            paddingLeft={1}
            paddingRight={1}
            width={cardWidth - 4}
          />
        ) : (
          visible.map((row, viewIdx) => {
            if (row.kind === "spacer") {
              return <box key={`row-${winStart + viewIdx}`} style={{ height: 1, flexShrink: 0 }} />;
            }
            if (row.kind === "header") {
              return (
                <text
                  key={`row-${winStart + viewIdx}`}
                  content={` ${row.label}`}
                  fg={C.accent}
                  attributes={TextAttributes.BOLD}
                />
              );
            }
            const o = row.opt;
            const selected = row.itemIndex === sel;
            const current = o.id === currentId;
            // Width budget: the label column fits the longest label (+meta)
            // actually present, capped so the description always keeps a
            // readable remainder — cardWidth-10 starved every hint to ~8
            // chars in large dialogs (0.6.45 fix).
            const labelWidth = Math.min(
              Math.max(16, ...shown.map((o) => o.label.length + (o.meta ? o.meta.length + 2 : 0))),
              Math.max(16, cardWidth - 18),
            );
            // Reference row shape (dialog-select.tsx): titles align at column 3;
            // the CURRENT row donates its gutter to a ● so its title stays put,
            // and its label wears the accent when not selected.
            const rowFg = selected ? C.accentText : current ? C.accent : C.fg;
            return (
              <box key={`row-${winStart + viewIdx}`} style={{ flexDirection: "column", flexShrink: 0 }}>
                <box
                  style={{
                    height: 1,
                    flexDirection: "row",
                    flexShrink: 0,
                    paddingLeft: current || o.gutter ? 1 : 3,
                    paddingRight: 1,
                    backgroundColor: selected ? C.accent : o.bg,
                  }}
                >
                  {current && !o.gutter ? <text content="● " fg={rowFg} /> : null}
                  {o.gutter ? <text content={`${o.gutter} `} fg={selected ? C.accentText : C.accent} /> : null}
                  <text
                    content={`${truncate(o.label, labelWidth)}${o.meta ? `  ${o.meta}` : ""}`}
                    fg={rowFg}
                  />
                  {o.description ? (
                    <text
                      content={`  ${truncate(o.description, Math.max(8, cardWidth - labelWidth - 8))}`}
                      fg={selected ? C.accentText : C.subtle}
                    />
                  ) : null}
                </box>
              </box>
            );
          })
        )}
        {footerHints && footerHints.length > 0 ? (
          <box style={{ height: 1, flexDirection: "row", justifyContent: "space-between", flexShrink: 0, paddingLeft: 1, paddingRight: 1 }}>
            <box style={{ flexDirection: "row", flexShrink: 0 }}>
              {footerHints.filter((h) => h.side !== "right").map((hint) => (
                <box key={hint.key} style={{ flexDirection: "row", flexShrink: 0 }}>
                  <text content={hint.label} fg={C.fg} attributes={TextAttributes.BOLD} />
                  <text content={` ${hint.key}`} fg={C.faint} />
                  <text content="  " fg={C.faint} />
                </box>
              ))}
            </box>
            {footerHints.some((h) => h.side === "right") ? (
              <box style={{ flexDirection: "row", flexShrink: 0 }}>
                {footerHints.filter((h) => h.side === "right").map((hint) => (
                  <box key={hint.key} style={{ flexDirection: "row", flexShrink: 0 }}>
                    <text content={hint.label} fg={C.fg} attributes={TextAttributes.BOLD} />
                    <text content={` ${hint.key}`} fg={C.faint} />
                    {hint !== footerHints.filter((h) => h.side === "right").at(-1) ? (
                      <text content="  " fg={C.faint} />
                    ) : null}
                  </box>
                ))}
              </box>
            ) : null}
          </box>
        ) : null}
        {!menu && shown.length > visibleItems.length ? (
          <box style={{ height: 1, flexShrink: 0 }}>
            <text
              content={` ${firstVisibleItem}-${lastVisibleItem} / ${shown.length} ${countLabel ?? ""}`}
              fg={C.faint}
            />
          </box>
        ) : null}
      </box>
    </ModalBackdrop>
  );
}

export function TextPromptDialog({
  title,
  initialValue,
  placeholder,
  onSubmit,
  onClose,
  theme,
}: {
  title: string;
  initialValue?: string;
  placeholder?: string;
  onSubmit: (value: string) => void;
  onClose: () => void;
  theme?: ThemeTokens;
}) {
  const [value, setValue] = useState(initialValue ?? "");
  const dims = useTerminalDimensions();
  const C = theme ?? THEMES.opencode;
  const cardWidth = Math.min(60, Math.max(20, dims.width - 2));

  useKeyboard((key) => {
    if (key.name === "escape" || (key.ctrl && key.name === "c")) { onClose(); return; }
    if (key.name === "return") {
      const next = value.trim();
      if (next) onSubmit(next);
      return;
    }
    if (key.name === "backspace") { setValue((v) => v.slice(0, -1)); return; }
    if (key.sequence && !key.ctrl && /^[^\x00-\x1f\x7f]+$/u.test(key.sequence)) {
      setValue((v) => v + key.sequence);
    }
  });

  return (
    <ModalBackdrop C={C} width={dims.width} height={dims.height}>
      <box
        style={{
          width: cardWidth,
          flexDirection: "column",
          flexShrink: 0,
          backgroundColor: C.panel,
          paddingTop: 1,
          paddingBottom: 1,
          paddingLeft: 2,
          paddingRight: 2,
        }}
      >
        <box style={{ height: 1, flexDirection: "row", justifyContent: "space-between", flexShrink: 0 }}>
          <text content={title} fg={C.fg} />
          <text content="esc" fg={C.faint} />
        </box>
        <box style={{ height: 1, flexDirection: "row" }}>
          <text content={value || placeholder || ""} fg={value ? C.fg : C.faint} />
          <text content="█" fg={C.accent} />
        </box>
      </box>
    </ModalBackdrop>
  );
}
