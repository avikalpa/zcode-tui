// OpenCode-shaped selection primitives.
//
// Dialogs deliberately use the global keyboard hook instead of a focused
// InputRenderable. OpenTUI can retain focus on a component that has already
// been reconciled away; keeping filter and draft state here makes every modal
// deterministic under fast PTY typing.
import { useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { THEMES, type ThemeTokens } from "./design";

export interface DialogOption<T> {
  id: string;
  label: string;
  description?: string;
  meta?: string;
  group?: string;
  value: T;
}

type DialogAction<T> = (
  action: "pin" | "delete" | "rename" | "all",
  option: DialogOption<T> | undefined,
) => void;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function truncate(value: string, width: number): string {
  if (value.length <= width) return value;
  if (width <= 1) return value.slice(0, width);
  return `${value.slice(0, width - 1)}…`;
}

export function SelectDialog<T>({
  title,
  options,
  currentId,
  onSelect,
  onClose,
  onAction,
  footer,
  countLabel,
  theme,
}: {
  title: string;
  options: DialogOption<T>[];
  currentId?: string;
  onSelect: (value: T, id: string) => void;
  onClose: () => void;
  onAction?: DialogAction<T>;
  footer?: string;
  countLabel?: string;
  theme?: ThemeTokens;
}) {
  const [filter, setFilter] = useState("");
  const [idx, setIdx] = useState(0);
  const dims = useTerminalDimensions();
  const C = theme ?? THEMES.opencode;
  const cardWidth = Math.max(56, Math.min(88, dims.width - 8));
  const cardHeight = Math.max(14, Math.min(36, dims.height - 8));

  const shown = options.filter((o) =>
    `${o.label} ${o.description ?? ""} ${o.meta ?? ""} ${o.group ?? ""}`
      .toLowerCase()
      .includes(filter.toLowerCase()),
  );
  const sel = clamp(idx, 0, Math.max(0, shown.length - 1));
  const visibleCount = Math.max(5, Math.min(22, cardHeight - 7));
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
    if (key.name === "escape") { onClose(); return; }
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
    if (key.sequence && !key.ctrl && /^[\x20-\x7E]+$/.test(key.sequence)) {
      setFilter((f) => f + key.sequence);
      setIdx(0);
    }
  });

  return (
    <box style={{ flexDirection: "column", flexGrow: 1, backgroundColor: C.bg }}>
      <box style={{ flexGrow: 1 }} />
      <box style={{ height: cardHeight, flexDirection: "row", flexShrink: 0 }}>
        <box style={{ flexGrow: 1 }} />
        <box
          style={{
            width: cardWidth,
            height: cardHeight,
            flexDirection: "column",
            flexShrink: 0,
            backgroundColor: C.bg,
            borderStyle: "rounded",
            borderColor: C.border,
            paddingLeft: 1,
            paddingRight: 1,
          }}
        >
          <box style={{ height: 1, flexDirection: "row", justifyContent: "space-between", flexShrink: 0 }}>
            <text content={title} fg={C.brand} />
            <text content="esc" fg={C.faint} />
          </box>
          <box style={{ height: 1, flexDirection: "row", backgroundColor: C.panel, flexShrink: 0 }}>
            <text content={`${filter ? "▌ " : "⌕ "}${filter || "Search"}${filter ? "▏" : ""}`} fg={filter ? C.fg : C.faint} />
          </box>
          <box style={{ height: 1, flexShrink: 0 }}>
            <text content={`${shown.length} ${countLabel ?? "session"}${shown.length === 1 ? "" : "s"}`} fg={C.faint} />
          </box>
          {visible.map((o, visibleIndex) => {
            const abs = shown.indexOf(o);
            const selected = abs === sel;
            const previous = visible[visibleIndex - 1];
            const group = o.group && o.group !== previous?.group ? o.group : undefined;
            const labelWidth = Math.max(16, cardWidth - 8);
            return (
              <box key={o.id} style={{ flexDirection: "column", flexShrink: 0 }}>
                {group ? <text content={` ${group}`} fg={C.accent} /> : null}
                <box
                  style={{
                    height: 1,
                    flexDirection: "row",
                    flexShrink: 0,
                    paddingLeft: 1,
                    paddingRight: 1,
                    backgroundColor: selected ? C.selected : undefined,
                  }}
                >
                  <text
                    content={`${selected ? "›" : " "} ${truncate(o.label, labelWidth)}${o.id === currentId ? "  ●" : ""}${o.meta ? `  ${o.meta}` : ""}`}
                    fg={selected ? C.brand : C.fg}
                  />
                </box>
              </box>
            );
          })}
          {visible.length === 0 ? <text content="  no matches" fg={C.faint} /> : null}
          <box style={{ flexGrow: 1 }} />
          <box style={{ height: 1, flexDirection: "row", flexShrink: 0 }}>
            <text content={footer ?? "↑↓ navigate   enter select   esc close"} fg={C.faint} />
          </box>
        </box>
        <box style={{ flexGrow: 1 }} />
      </box>
      <box style={{ flexGrow: 1 }} />
    </box>
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
  const cardWidth = Math.max(48, Math.min(72, dims.width - 8));

  useKeyboard((key) => {
    if (key.name === "escape") { onClose(); return; }
    if (key.name === "return") {
      const next = value.trim();
      if (next) onSubmit(next);
      return;
    }
    if (key.name === "backspace") { setValue((v) => v.slice(0, -1)); return; }
    if (key.sequence && !key.ctrl && /^[\x20-\x7E]+$/.test(key.sequence)) {
      setValue((v) => v + key.sequence);
    }
  });

  return (
    <box style={{ flexDirection: "column", flexGrow: 1, backgroundColor: C.bg }}>
      <box style={{ flexGrow: 1 }} />
      <box style={{ height: 9, flexDirection: "row", flexShrink: 0 }}>
        <box style={{ flexGrow: 1 }} />
        <box style={{ width: cardWidth, height: 9, flexDirection: "column", backgroundColor: C.bg, borderStyle: "rounded", borderColor: C.border, paddingLeft: 2, paddingRight: 2 }}>
          <box style={{ height: 1, flexDirection: "row", justifyContent: "space-between" }}>
            <text content={title} fg={C.brand} />
            <text content="esc" fg={C.faint} />
          </box>
          <box style={{ height: 1, flexShrink: 0 }} />
          <box style={{ height: 3, flexDirection: "column", borderStyle: "rounded", borderColor: C.borderActive, backgroundColor: C.panel, paddingLeft: 1, paddingRight: 1 }}>
            <text content={`› ${value || placeholder || "type a value"}▏`} fg={value ? C.fg : C.faint} />
          </box>
          <box style={{ flexGrow: 1 }} />
          <text content="enter save   esc cancel" fg={C.faint} />
        </box>
        <box style={{ flexGrow: 1 }} />
      </box>
      <box style={{ flexGrow: 1 }} />
    </box>
  );
}
