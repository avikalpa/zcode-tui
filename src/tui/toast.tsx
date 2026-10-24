// Adapted from MIT OpenCode b084acc packages/tui/src/ui/toast.tsx and
// ui/border.ts. See THIRD-PARTY-NOTICES.md.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRenderer } from "@opentui/react";
import { TextAttributes } from "@opentui/core";
import type { ThemeTokens } from "./design";

export type ToastOptions = {
  title?: string; message: string; variant: "info" | "success" | "warning" | "error";
  duration?: number; action?: { label: string; run: () => void };
};
type ToastEntry = ToastOptions & { duration: number };
type Clock = { now: () => number; set: (run: () => void, delay: number) => unknown; clear: (handle: unknown) => void };
const clock: Clock = { now: Date.now, set: (run, delay) => setTimeout(run, delay).unref(), clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) };

export function createToastStore(timer: Clock = clock) {
  let current: ToastEntry | null = null;
  let queue: ToastEntry[] = [];
  let snapshot = { currentToast: current as ToastEntry | null, pending: 0 };
  let handle: unknown;
  let paused = false;
  let startedAt = 0;
  let remaining = 0;
  const listeners = new Set<() => void>();
  const emit = () => { snapshot = { currentToast: current, pending: queue.length }; listeners.forEach((listener) => listener()); };
  const clear = () => { if (handle !== undefined) timer.clear(handle); handle = undefined; };
  const start = (duration: number) => {
    clear(); remaining = duration; startedAt = timer.now();
    handle = timer.set(dismiss, duration);
  };
  function dismiss() {
    clear(); current = queue.shift() ?? null;
    if (!current) paused = false;
    else { remaining = current.duration; if (!paused) start(remaining); }
    emit();
  }
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => snapshot,
    show(input: ToastOptions) {
      const entry = { ...input, duration: input.duration ?? 5000 };
      if (current && (paused || queue.length)) queue.push(entry);
      else { current = entry; start(entry.duration); }
      emit();
    },
    pause() {
      if (!current || paused) return;
      paused = true; remaining = Math.max(0, remaining - (timer.now() - startedAt)); clear();
    },
    resume() { if (!current || !paused) return; paused = false; start(remaining); },
    dismiss,
    activate() { const action = current?.action; dismiss(); action?.run(); },
    dispose: clear,
  };
}

export function useToast() {
  const ref = useRef<ReturnType<typeof createToastStore> | null>(null);
  if (!ref.current) ref.current = createToastStore();
  const controller = ref.current;
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useEffect(() => () => controller.dispose(), [controller]);
  return { ...snapshot, controller };
}

export function Toast({ C, width, toast, pending, onHover, onActivate }: {
  C: ThemeTokens; width: number; toast: ToastOptions; pending?: number;
  onHover: (hovered: boolean) => void; onActivate: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const renderer = useRenderer();
  const hover = (value: boolean) => { setHovered(value); onHover(value); };
  const border = toast.variant === "success" ? C.success : toast.variant === "warning" ? C.warning : toast.variant === "error" ? C.error : C.user;
  const affordance = <text fg={hovered ? C.accent : C.subtle} wrapMode="none"
    attributes={hovered && toast.action ? TextAttributes.BOLD : undefined} style={{ marginLeft: 2, flexShrink: 0 }}
    content={toast.action ? `› ${toast.action.label}` : "x"} />;
  return <box style={{ position: "absolute", top: 1, right: 2, zIndex: 2000,
    maxWidth: Math.max(1, Math.min(60, width - 6)), flexDirection: "column", border: ["left", "right"], borderColor: border,
    customBorderChars: { topLeft: "", bottomLeft: "", vertical: "┃", topRight: "", bottomRight: "", horizontal: " ", bottomT: "", topT: "", cross: "", leftT: "", rightT: "" } }}
    onMouseOver={() => hover(true)} onMouseOut={() => hover(false)}
    onMouseUp={() => { if (!renderer.getSelection()?.getSelectedText()) onActivate(); }}>
    <box style={{ width: "100%", flexDirection: "column", paddingLeft: 2, paddingRight: 2, paddingTop: 1, paddingBottom: 1, backgroundColor: C.panel }}>
      {toast.title ? <box style={{ flexDirection: "row", marginBottom: 1 }}>
        <text content={toast.title} fg={C.fg} attributes={TextAttributes.BOLD} />
        <box style={{ flexGrow: 1 }} />{affordance}
      </box> : null}
      <box style={{ flexDirection: "row", width: "100%" }}>
        <text content={toast.message} fg={C.fg} wrapMode="word" style={{ flexGrow: 1, flexShrink: 1 }} />
        {!toast.title ? affordance : null}
      </box>
      {pending ? <text content={`+${pending} more`} fg={C.subtle} style={{ marginTop: 1 }} /> : null}
    </box>
  </box>;
}
