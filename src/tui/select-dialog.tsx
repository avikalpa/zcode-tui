// opencode2-style select dialog: filter input + option list (React).
// Typing filters natively via the input; Up/Down move the selection;
// Enter selects; Esc cancels. App renders it in place of the main pane.
import { useState } from "react";

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
        <input
          ref={(r: never) => (r as { focus?: () => void })?.focus?.()}
          placeholder="type to filter…"
          onChange={(v: string) => {
            setFilter(v);
            setIdx(0);
          }}
          onKeyDown={((key: { name?: string }) => {
            if (key.name === "up") { setIdx((i) => Math.max(0, i - 1)); return; }
            if (key.name === "down") { setIdx((i) => Math.min(shown.length - 1, i + 1)); return; }
            if (key.name === "escape") { onClose(); return; }
          }) as never}
          onSubmit={(() => select()) as never}
          style={{ backgroundColor: "#202020", focusedBackgroundColor: "#202020", textColor: "#d4d4d4" }}
        />
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
