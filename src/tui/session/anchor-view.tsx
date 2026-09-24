// React translation of the vendored opencode v2.0.16 reference
// (tui/routes/session/anchor-view.tsx) — slice 2 of the transcript-render
// refactor family. Upstream registers each mounted entry/group renderable
// into a timeline-anchors registry through Solid effects; React does the same
// with refs + useLayoutEffect. The registry is a module singleton: keys are
// session-unique (messageID-scoped) and destroyed renderables filter out of
// list()/get(), which is upstream's ctx-per-session isolation to the same
// effect (wiring, not grammar).
import { useLayoutEffect, useRef, type ReactNode } from "react";
import type { Renderable } from "@opentui/core";
import type { SessionEntry, SessionNode } from "./grouping/session";
import { createTimelineAnchors, entryRef } from "./anchors";

export const timelineAnchors = createTimelineAnchors();

export function visitEntries(nodes: readonly SessionNode[], visit: (entry: SessionEntry) => void) {
  nodes.forEach((node) => {
    if (node.type === "entry") visit(node.entry);
    if (node.type === "group") visitEntries(node.children, visit);
  });
}

export function EntryAnchor(props: { entry: SessionEntry; children: ReactNode; marginTop?: number }) {
  const ref = useRef<Renderable | null>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    const target = entryRef(props.entry);
    if (!node || !target) return;
    return timelineAnchors.register({ target: { type: "part", ref: target }, node });
    // The anchor identity rides the entry; re-register only when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.entry]);
  return (
    <box ref={ref as never} style={{ marginTop: props.marginTop ?? 0, flexShrink: 0, flexDirection: "column" }}>
      {props.children}
    </box>
  );
}

export function GroupAnchor(props: { groupID: string | undefined; active: boolean; children: ReactNode }) {
  const ref = useRef<Renderable | null>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || !props.groupID || !props.active) return;
    return timelineAnchors.register({ target: { type: "group", groupID: props.groupID }, node });
  }, [props.groupID, props.active]);
  return (
    <box ref={ref as never} style={{ flexDirection: "column", flexShrink: 0 }}>
      {props.children}
    </box>
  );
}
