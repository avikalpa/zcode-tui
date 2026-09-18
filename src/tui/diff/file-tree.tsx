// Port of the reference DiffViewerFileTree (opencode v2.0.6
// diff-viewer-file-tree.tsx): the left rail of the diff viewer — source
// header, then the changed-file tree with directory rails, expand markers,
// status letters and the reviewed ✓. Upstream rows are mouse-interactive;
// this binding has no mouse plane (P2 ledger line), so the rows render
// identically and selection/reveal stays keyboard-driven.

import { RGBA, TextAttributes, type ScrollBoxRenderable } from "@opentui/core";
import { useEffect, useRef } from "react";
import type { ThemeTokens } from "../design";
import { buildFileTree, flattenFileTree, type FileTreeItem, type FileTreeRow } from "./file-tree-utils";
import { stringWidth } from "./string-width";
import { truncateFilePath } from "./file-path";

const FILE_TREE_STATUS_WIDTH = 1;

function tint(baseHex: string, overlayHex: string, alpha: number): string {
  const base = RGBA.fromHex(baseHex);
  const overlay = RGBA.fromHex(overlayHex);
  const mix = (a: number, b: number) => Math.round((a + (b - a) * alpha) * 255);
  const toHex = (v: number) => v.toString(16).padStart(2, "0");
  return `#${toHex(mix(base.r, overlay.r))}${toHex(mix(base.g, overlay.g))}${toHex(mix(base.b, overlay.b))}`;
}

export type DiffViewerFileTreeProps = {
  readonly width: number
  readonly files: readonly FileTreeItem[]
  readonly loading: boolean
  readonly error: unknown
  readonly selectedFileIndex?: number
  readonly reviewedFileNames?: ReadonlySet<string>
  readonly expandedNodes?: ReadonlySet<number>
  readonly source?: string
  readonly sourceDetail?: string
  readonly footer?: React.ReactNode
  readonly diffText: { added: string; removed: string }
  readonly C: ThemeTokens
}

export function DiffViewerFileTree(props: DiffViewerFileTreeProps) {
  const C = props.C;
  const tree = buildFileTree(props.files);
  const rows = flattenFileTree(tree, props.expandedNodes);
  // Quieter than subdued text: markers are affordances, not content.
  const faint = tint(C.faint, C.bg, 0.45);
  // Rails are pure texture; keep them barely above the surface.
  const rail = tint(C.faint, C.bg, 0.7);
  const reviewedCount = props.files.filter((file) => props.reviewedFileNames?.has(file.file)).length;
  const contentWidth = Math.max(0, props.width - 4 - FILE_TREE_STATUS_WIDTH - 1);
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);

  useEffect(() => {
    const index = rows.findIndex((row) => row.fileIndex !== undefined && row.fileIndex === props.selectedFileIndex);
    if (index === -1) return;
    const top = index;
    const scrollSelectedIntoView = () => scrollFileTreeRowIntoView(scrollRef.current, top);
    scrollSelectedIntoView();
    const timer = setTimeout(scrollSelectedIntoView, 0);
    return () => clearTimeout(timer);
  }, [props.selectedFileIndex]);

  return (
    <box style={{ width: props.width, height: "100%", minWidth: 0, minHeight: 0, flexShrink: 0, flexDirection: "column" }}>
      <box style={{ height: 1, flexShrink: 0, backgroundColor: C.bg }} />
      <box style={{ flexGrow: 1, minWidth: 0, minHeight: 0, paddingBottom: 1, paddingLeft: 2, paddingRight: 2, backgroundColor: C.bg, flexDirection: "column" }}>
        <box style={{ height: 1, flexShrink: 0, flexDirection: "row", marginBottom: 1, gap: 1 }}>
          <text content={props.source ?? "Files"} fg={C.user} attributes={TextAttributes.BOLD} wrapMode="none" />
          {props.sourceDetail ? <text content={` · ${props.sourceDetail}`} fg={C.subtle} wrapMode="none" /> : null}
          <text content={`${reviewedCount}/${props.files.length}`} fg={C.subtle} wrapMode="none" />
        </box>
        <scrollbox
          ref={(element: ScrollBoxRenderable) => { scrollRef.current = element; }}
          style={{ flexGrow: 1, minHeight: 0 }}
          scrollbarOptions={{ visible: false }}
        >
          {props.loading || props.error ? <text content=" " /> : null}
          {!props.loading && !props.error && props.files.length === 0 ? <text content="No files" fg={C.subtle} /> : null}
          {!props.loading && !props.error && props.files.length > 0 ? (
            <box style={{ flexShrink: 0, flexDirection: "column" }}>
              {rows.map((row) => {
                const selected = row.fileIndex !== undefined && props.selectedFileIndex === row.fileIndex;
                const reviewed =
                  row.fileIndex !== undefined && (props.reviewedFileNames?.has(props.files[row.fileIndex].file) ?? false);
                const foreground = row.kind === "directory" ? C.subtle : reviewed ? C.subtle : C.fg;
                const marker = row.kind !== "directory" ? "≡ " : props.expandedNodes && !props.expandedNodes.has(row.id) ? "▸ " : "▾ ";
                const indent = "│ ".repeat(Math.max(0, Math.min(row.depth, Math.floor((contentWidth - 3) / 2))));
                const status = fileTreeRowStatus(row, props.files, reviewed);
                const statusColor = reviewed
                  ? C.subtle
                  : row.fileIndex === undefined
                    ? C.subtle
                    : props.files[row.fileIndex].status === "added"
                      ? props.diffText.added
                      : props.files[row.fileIndex].status === "deleted"
                        ? props.diffText.removed
                        : C.subtle;
                const name = (() => {
                  const width = contentWidth - stringWidth(indent) - stringWidth(marker);
                  if (row.kind === "directory") return truncateDirectoryChain(row.name, width);
                  return truncateFilePath(row.name, width);
                })();
                return (
                  <box
                    key={row.id}
                    style={{ flexDirection: "row", width: "100%", height: 1, flexShrink: 0, backgroundColor: C.bg }}
                  >
                    <text content={indent} fg={rail} wrapMode="none" />
                    <text content={marker} fg={faint} wrapMode="none" />
                    <box style={{ flexGrow: 1, minWidth: 0, marginRight: 1, flexDirection: "row" }}>
                      <text
                        content={name}
                        fg={foreground}
                        attributes={selected ? TextAttributes.BOLD : undefined}
                        wrapMode="none"
                      />
                    </box>
                    <text content={status} fg={statusColor} wrapMode="none" width={FILE_TREE_STATUS_WIDTH} />
                  </box>
                );
              })}
            </box>
          ) : null}
        </scrollbox>
        {props.footer ? (
          <box style={{ flexShrink: 0, paddingTop: 1, paddingBottom: 1 }}>{props.footer}</box>
        ) : null}
      </box>
    </box>
  );
}

function scrollFileTreeRowIntoView(scroll: ScrollBoxRenderable | null | undefined, top: number) {
  if (!scroll || scroll.isDestroyed) return;
  const viewportHeight = scroll.viewport?.height ?? 0;
  if (top < scroll.scrollTop) {
    scroll.scrollTo(top);
    return;
  }
  if (top + 1 > scroll.scrollTop + viewportHeight) {
    scroll.scrollTo(top + 1 - viewportHeight);
  }
}

function fileTreeRowStatus(row: FileTreeRow, files: readonly FileTreeItem[], reviewed: boolean) {
  if (row.fileIndex === undefined) return "";
  if (reviewed) return "✓";
  const status = files[row.fileIndex]?.status;
  return status === "modified" ? "M" : status === "added" ? "A" : status === "deleted" ? "D" : "?";
}

// Collapsed chains drop whole leading segments instead of squeezing
// mid-segment, so "a/b/c/d" narrows to "…/c/d" rather than "…/b…/c/d".
function truncateDirectoryChain(name: string, maxWidth: number) {
  if (stringWidth(name) <= maxWidth) return name;
  const kept: string[] = [];
  let width = stringWidth("…/");
  for (const segment of name.split("/").slice().reverse()) {
    const next = stringWidth(segment) + (kept.length ? 1 : 0);
    if (width + next > maxWidth) break;
    kept.unshift(segment);
    width += next;
  }
  if (kept.length === 0) return truncateFilePath(name, maxWidth);
  return `…/${kept.join("/")}`;
}
