// OpenCode-shaped selection primitives.
//
// The dialog container follows the reference modal recipe (consult
// 2026-09-13, item 1): a flat, borderless panel on a dimmed backdrop — no
// rounded borders, no recessed search box. Selection is a full-width primary
// bar with background-coloured text; the current item wears a filled dot.
// Group headers are accent + bold with a spacer row between groups, and the
// dialog carries the reference footer hint row (bold key + muted label) —
// owner ruling 2026-09-16 ("the sessions overlay of opencode is more
// polished; copy it") supersedes the earlier no-footer consult line.
// Dialogs deliberately use the global keyboard hook instead of a focused
// InputRenderable: OpenTUI can retain focus on a component that has already
// been reconciled away, so keeping filter state here makes every modal
// deterministic under fast PTY typing.
import { useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { TextAttributes } from "@opentui/core";
import { THEMES, type ThemeTokens } from "./design";

export interface DialogOption<T> {
  id: string;
  label: string;
  description?: string;
  meta?: string;
  group?: string;
  bg?: string;
  gutter?: string;
  value: T;
}

type DialogAction<T> = (
  action: "pin" | "delete" | "rename" | "all",
  option: DialogOption<T> | undefined,
) => void;

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

function ModalBackdrop({
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
  size,
  countLabel,
  footerHints,
  theme,
}: {
  title: string;
  options: DialogOption<T>[];
  currentId?: string;
  onSelect: (value: T, id: string) => void;
  onClose: () => void;
  onAction?: DialogAction<T>;
  size?: "medium" | "large" | "xlarge";
  countLabel?: string;
  footerHints?: { key: string; label: string }[];
  theme?: ThemeTokens;
}) {
  const [filter, setFilter] = useState("");
  const [idx, setIdx] = useState(0);
  const dims = useTerminalDimensions();
  const C = theme ?? THEMES.opencode;
  const cardWidth = tierWidth(size, dims.width);

  const shown = options.filter((o) =>
    `${o.label} ${o.description ?? ""} ${o.meta ?? ""} ${o.group ?? ""}`
      .toLowerCase()
      .includes(filter.toLowerCase()),
  );
  const sel = clamp(idx, 0, Math.max(0, shown.length - 1));
  // One row per option plus group headings; the modal grows to content, capped
  // by the viewport so long lists scroll the window rather than the screen.
  const visibleCount = Math.max(5, Math.min(22, dims.height - Math.floor(dims.height / 4) - 6));
  const winStart = Math.max(
    0,
    Math.min(sel - Math.floor(visibleCount / 2), Math.max(0, shown.length - visibleCount)),
  );
  const visible = shown.slice(winStart, winStart + visibleCount);

  const select = () => {
    const option = shown[sel];
    if (option) onSelect(option.value, option.id);
    else onClose();
  };

  useKeyboard((key) => {
    if (key.name === "escape" || (key.ctrl && key.name === "c")) { onClose(); return; }
    if (key.ctrl && key.name === "f") { onAction?.("pin", shown[sel]); return; }
    if (key.ctrl && key.name === "d") { onAction?.("delete", shown[sel]); return; }
    if (key.ctrl && key.name === "r") { onAction?.("rename", shown[sel]); return; }
    if (key.ctrl && key.name === "a") { onAction?.("all", shown[sel]); return; }
    if (key.name === "return") { select(); return; }
    if (key.name === "up") { setIdx((i) => Math.max(0, i - 1)); return; }
    if (key.name === "down") {
      setIdx((i) => Math.min(Math.max(0, shown.length - 1), i + 1));
      return;
    }
    if (key.name === "backspace") { setFilter((f) => f.slice(0, -1)); setIdx(0); return; }
    if (key.sequence && !key.ctrl && /^[^\x00-\x1f\x7f]+$/u.test(key.sequence)) {
      setFilter((f) => f + key.sequence);
      setIdx(0);
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
          <text content={filter ? `${filter}` : "search"} fg={filter ? C.fg : C.faint} />
          <text content={filter ? "█" : ""} fg={C.accent} />
        </box>
        {visible.map((o) => {
          const abs = shown.indexOf(o);
          const selected = abs === sel;
          const previous = visible[visible.indexOf(o) - 1];
          const group = o.group && o.group !== previous?.group ? o.group : undefined;
          const groupSpacer = visible.indexOf(o) > 0;
          const labelWidth = Math.max(16, cardWidth - 10);
          return (
            <box key={o.id} style={{ flexDirection: "column", flexShrink: 0 }}>
              {group && groupSpacer ? <box style={{ height: 1, flexShrink: 0 }} /> : null}
              {group ? <text content={` ${group}`} fg={C.accent} attributes={TextAttributes.BOLD} /> : null}
              <box
                style={{
                  height: 1,
                  flexDirection: "row",
                  flexShrink: 0,
                  paddingLeft: 1,
                  paddingRight: 1,
                  backgroundColor: selected ? C.accent : o.bg,
                }}
              >
                {o.gutter ? <text content={`${o.gutter} `} fg={selected ? C.accentText : C.accent} /> : null}
                <text
                  content={`${truncate(o.label, labelWidth)}${o.id === currentId ? "  ●" : ""}${o.meta ? `  ${o.meta}` : ""}`}
                  fg={selected ? C.accentText : C.fg}
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
        })}
        {visible.length === 0 ? <text content=" No matching items" fg={C.faint} /> : null}
        {footerHints && footerHints.length > 0 ? (
          <box style={{ height: 1, flexDirection: "row", flexShrink: 0 }}>
            {footerHints.map((hint) => (
              <box key={hint.key} style={{ flexDirection: "row", flexShrink: 0 }}>
                <text content={`  ${hint.key}`} fg={C.fg} />
                <text content={` ${hint.label}`} fg={C.faint} />
              </box>
            ))}
          </box>
        ) : null}
        {shown.length > visible.length ? (
          <box style={{ height: 1, flexShrink: 0 }}>
            <text content={` ${winStart + 1}-${winStart + visible.length} / ${shown.length} ${countLabel ?? ""}`} fg={C.faint} />
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
        <box style={{ height: 1, flexDirection: "row", flexShrink: 0 }}>
          <text content={value || placeholder || ""} fg={value ? C.fg : C.faint} />
          <text content="█" fg={C.accent} />
        </box>
      </box>
    </ModalBackdrop>
  );
}
