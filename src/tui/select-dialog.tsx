// opencode2-style select dialog (React, global-key variant).
// No focused <input>: while open, the dialog's own useKeyboard consumes
// printable chars (filter), Up/Down (selection), Enter (select), Esc
// (cancel). This avoids OpenTUI focus routing entirely — a focused input
// that unmounts leaves a zombie focus target and eats all later keys.
import { useState } from "react";
import { useKeyboard } from "@opentui/react";

export interface DialogOption<T> {
  id: string;
  label: string;
  description?: string;
  value: T;
}

export function SelectDialog<T>({
  title,
  options,
  currentId,
  onSelect,
  onClose,
  width = 64,
}: {
  title: string;
  options: DialogOption<T>[];
  currentId?: string;
  onSelect: (value: T, id: string) => void;
  onClose: () => void;
  width?: number;
}) {
  const [filter, setFilter] = useState("");
  const [idx, setIdx] = useState(0);

  const shown = options.filter((o) =>
    `${o.label} ${o.description ?? ""}`.toLowerCase().includes(filter.toLowerCase()),
  );
  const sel = Math.min(idx, Math.max(0, shown.length - 1));
  const winStart = Math.max(0, Math.min(sel - 8, shown.length - 12));
  const visible = shown.slice(winStart, winStart + 12);

  useKeyboard((key) => {
    if (key.name === "escape") { onClose(); return; }
    if (key.name === "return") { select(); return; }
    if (key.name === "up") { setIdx((i) => Math.max(0, i - 1)); return; }
    if (key.name === "down") { setIdx((i) => Math.min(shown.length - 1, i + 1)); return; }
    if (key.name === "backspace") { setFilter((f) => f.slice(0, -1)); setIdx(0); return; }
    if (key.sequence && !key.ctrl && /^[\x20-\x7E]+$/.test(key.sequence)) {
      setFilter((f) => f + key.sequence);
      setIdx(0);
      return;
    }
  });

  const select = () => {
    const o = shown[sel];
    if (o) onSelect(o.value, o.id);
    else onClose();
  };

  return (
    <box
      style={{
        flexDirection: "column", borderStyle: "rounded", borderColor: "#ffffff33",
        backgroundColor: "#161616", flexGrow: 1,
      }}
      title={title}
    >
      <box style={{ height: 1, flexShrink: 0, backgroundColor: "#202020" }}>
        <text content={` ${filter || "type to filter…"}▏`} fg={filter ? "#ffffff" : "#6b6b6b"} />
      </box>
      {visible.map((o, i) => {
        const abs = winStart + i;
        return (
          <box
            key={o.id}
            style={{
              flexDirection: "column", paddingLeft: 1, height: 2, flexShrink: 0,
              backgroundColor: abs === sel ? "#ffffff1a" : undefined,
            }}
          >
            <text
              content={`${abs === sel ? "› " : "  "}${o.label}${o.id === currentId ? "  ●" : ""}`}
              fg={abs === sel ? "#ffffff" : "#d4d4d4"}
            />
            {o.description ? (
              <text content={`    ${o.description.slice(0, width - 8)}`} fg="#6b6b6b" />
            ) : (
              <text content=" " />
            )}
          </box>
        );
      })}
      {visible.length === 0 ? <text content="  no match" fg="#6b6b6b" /> : null}
    </box>
  );
}
