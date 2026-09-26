// Ported from opencode v2.0.7 packages/tui/src/feature-plugins/system/diff-viewer.tsx
// Port of the reference diff viewer route (opencode v2.0.6
// feature-plugins/system/diff-viewer.tsx) onto our React binding.
//
// Faithful: full-screen route over the app (the route renders INSTEAD of
// home/session, like v2's plugin route), the source header grammar
// (`All · vs main` + n/m reviewed count), the card-per-file patch pane with
// ▄ separators and +n/-m headers, the file tree rail (width clamp 30..40,
// shown at >= 90 cols), split/unified with the 100-col split floor,
// single-patch mode, hunk/file jump arithmetic, review marks, and the exact
// loading/error/empty strings.
//
// zcode wiring (the only non-port part): files come from local git in the
// session cwd (src/tui/diff/git.ts reproducing the reference server's
// adapter), and the keyboard grammar is driven by the App's central
// dispatcher through the imperative api this component registers.
//
// Binding deviations (opentui 0.5.11, recorded in the ledger): no mouse
// plane (right-click file menu + hover states omitted), no renderer
// lifecycle passes (the dynamically-tinted top edge renders static context
// colour and the file header does not float while scrolling), rAF becomes
// setTimeout, reviewed cards tint to the panel step (no surface.overlay —
// raised.high since the v2.0.8 rename — token in the 33-theme port).

import { TextAttributes, type BoxRenderable, type ScrollBoxRenderable } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DiffTokens, ThemeTokens } from "../design";
import { FilePath } from "./file-path";
import { DiffViewerFileTree } from "./file-tree";
import {
  allExpandedFileTreeDirectories,
  buildFileTree,
  fileTreeFileSelection,
  flattenFileTree,
  movePatchFileIndex,
  orderedPatchFileIndexes,
  showDiffViewerFileTree,
  singlePatchFileIndex,
} from "./file-tree-utils";
import { gitDiff, type DiffBase, type DiffFile, type DiffMode } from "./git";
import { PatchDiff, type PatchDiffRef } from "./patch-diff";

const MIN_SPLIT_WIDTH = 100;
const FILE_TREE_MIN_WIDTH = 30;
const FILE_TREE_MAX_WIDTH = 40;
const FILE_HEADER_HEIGHT = 2;
export type DiffView = "split" | "unified";

export type DiffPreferences = {
  tree?: boolean;
  single?: boolean;
  view?: "auto" | DiffView;
  /** app.toggle.diffwrap: word-ish wrapping vs hard truncate (v2 config.diffs.wrap). */
  wrap?: "char" | "none";
};

// The imperative surface the App's keyboard dispatcher drives — the command
// ids mirror the reference keymap layer (diff.*).
export type DiffViewerApi = {
  scrollLine: (direction: -1 | 1) => void;
  scrollPage: (direction: -1 | 1) => void;
  scrollHalfPage: (direction: -1 | 1) => void;
  scrollToStart: () => void;
  scrollToEnd: () => void;
  jumpHunk: (offset: -1 | 1) => void;
  jumpFile: (offset: -1 | 1) => void;
  markReviewed: () => void;
  toggleFileTree: () => void;
  toggleSinglePatch: () => void;
  toggleView: () => void;
  toggleWrap: () => void;
};

export function diffSourceLabel(mode: DiffMode) {
  if (mode === "branch") return "All";
  if (mode === "committed") return "Committed";
  return "Uncommitted";
}

export function DiffViewer(props: {
  C: ThemeTokens;
  D: DiffTokens;
  syntaxStyle?: unknown;
  cwd: string;
  mode: DiffMode;
  base?: string | null;
  preferences?: DiffPreferences;
  onPreferencesChange?: (value: DiffPreferences) => void;
  onSwitchSourceDialog: () => void;
  onHelpDialog: () => void;
  apiRef?: (api: DiffViewerApi | null) => void;
}) {
  const C = props.C;
  const D = props.D;
  const [files, setFiles] = useState<readonly DiffFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [reportedBase, setReportedBase] = useState<DiffBase | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  const [fileTreeEnabled, setFileTreeEnabled] = useState(props.preferences?.tree ?? true);
  const [singlePatch, setSinglePatch] = useState(props.preferences?.single ?? false);
  const [wrapMode, setWrapMode] = useState<"char" | "none">(
    props.preferences?.wrap === "none" ? "none" : "char",
  );
  const [viewOverride, setViewOverride] = useState<DiffView | undefined>(
    props.preferences?.view && props.preferences.view !== "auto" ? props.preferences.view : undefined,
  );

  const dimensions = useTerminalDimensions();
  const showFileTree = dimensions.width >= 90 && showDiffViewerFileTree(fileTreeEnabled, files.length);
  const fileTreeWidth = Math.max(FILE_TREE_MIN_WIDTH, Math.min(FILE_TREE_MAX_WIDTH, Math.floor(dimensions.width / 4)));
  const patchPaneWidth = dimensions.width - (showFileTree ? fileTreeWidth : 0) - 4;
  const splitAvailable = patchPaneWidth >= MIN_SPLIT_WIDTH;
  const view: DiffView = splitAvailable ? (viewOverride ?? "split") : "unified";

  const fileTree = useMemo(() => buildFileTree(files), [files]);
  const [expandedFileNodes, setExpandedFileNodes] = useState<ReadonlySet<number>>(new Set());
  const [selectedFileIndex, setSelectedFileIndex] = useState<number | undefined>();
  const [reviewedFileNames, setReviewedFileNames] = useState<ReadonlySet<string>>(new Set());
  const [selectedHunk, setSelectedHunk] = useState<{ fileIndex: number; hunkIndex: number; scrollTop: number } | undefined>();
  const [pendingPatchScrollFileIndex, setPendingPatchScrollFileIndex] = useState<number | undefined>();

  const scrollRef = useRef<ScrollBoxRenderable | null>(null);
  const patchNodeByFileIndex = useRef(new Map<number, BoxRenderable>());
  const patchDiffByFileIndex = useRef(new Map<number, PatchDiffRef>());
  const pendingPatchScrollRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    pendingPatchScrollRef.current = pendingPatchScrollFileIndex;
  }, [pendingPatchScrollFileIndex]);

  // Live truth mirrors (the draftRef discipline — keyboard bursts settle
  // before React commits, so dispatcher-time reads never trust state).
  const stateRef = useRef({ selectedFileIndex, selectedHunk, singlePatch, splitAvailable, view, fileTreeEnabled });
  stateRef.current = { selectedFileIndex, selectedHunk, singlePatch, splitAvailable, view, fileTreeEnabled };

  // Reset the per-open surface state whenever the file set changes (the
  // reference's createEffect on the tree).
  useEffect(() => {
    setExpandedFileNodes(allExpandedFileTreeDirectories(fileTree));
    setSelectedFileIndex(undefined);
    setSelectedHunk(undefined);
    setReviewedFileNames(new Set());
    patchNodeByFileIndex.current.clear();
    patchDiffByFileIndex.current.clear();
  }, [fileTree]);

  // The data plane: local git in the session cwd, reloaded per mode/base.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setUnavailable(false);
    gitDiff(props.cwd, props.mode, props.base ?? undefined)
      .then((result) => {
        if (cancelled) return;
        setFiles(result.files);
        setReportedBase(result.base);
        setUnavailable(Boolean(result.unavailable));
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [props.cwd, props.mode, props.base]);

  const sourceDetail = (() => {
    if (props.mode === "working") return "vs HEAD";
    if (error) return "Base or diff unavailable";
    if (loading) return "Resolving diff…";
    if (!reportedBase) return "Base not reported";
    return `vs ${reportedBase.name}`;
  })();

  const clearPatchSelection = () => {
    setPendingPatchScrollFileIndex(undefined);
    setSelectedHunk(undefined);
    if (!stateRef.current.singlePatch) setSelectedFileIndex(undefined);
  };

  const scrollPageBy = (direction: -1 | 1, divisor: 1 | 2) => {
    clearPatchSelection();
    const scroll = scrollRef.current;
    if (scroll) scroll.scrollBy(direction * Math.max(1, Math.floor((scroll.viewport?.height ?? 24) / divisor)));
  };

  const scrollPatchNodeToTop = (patchNode: BoxRenderable, offset?: number) => {
    const scroll = scrollRef.current;
    if (!scroll || patchNode.isDestroyed) return;
    const contentY = patchNode.y - scroll.content.y;
    scroll.scrollTo(contentY + (offset ?? (contentY > 0 ? 1 : 0)));
  };

  const revealFileTreeFile = (fileIndex: number) => {
    const selection = fileTreeFileSelection(fileTree, fileIndex);
    if (!selection) return;
    setExpandedFileNodes((expanded) => {
      if ([...selection.expandedNodes].every((node) => expanded.has(node))) return expanded;
      const next = new Set(expanded);
      selection.expandedNodes.forEach((node) => next.add(node));
      return next;
    });
  };

  const selectPatchFile = (fileIndex: number) => {
    setPendingPatchScrollFileIndex(undefined);
    revealFileTreeFile(fileIndex);
    setSelectedFileIndex(fileIndex);
  };

  const scrollSinglePatchToTop = () => {
    setTimeout(() => {
      scrollRef.current?.scrollTo(0);
      setTimeout(() => scrollRef.current?.scrollTo(0), 0);
    }, 0);
  };

  const scrollToFileIndex = (fileIndex: number | undefined) => {
    if (fileIndex === undefined) return;
    selectPatchFile(fileIndex);
    const patchNode = patchNodeByFileIndex.current.get(fileIndex);
    if (patchNode) scrollPatchNodeToTop(patchNode);
  };

  const patchFileIndexes = useMemo(
    () => orderedPatchFileIndexes(flattenFileTree(fileTree)),
    [fileTree],
  );

  const currentPatchFileIndex = (): number | undefined => {
    const scroll = scrollRef.current;
    if (!scroll) return undefined;
    const viewportContentY = scroll.scrollTop + 1;
    const entries = patchFileIndexes
      .map((fileIndex) => ({ fileIndex, node: patchNodeByFileIndex.current.get(fileIndex) }))
      .filter((entry): entry is { fileIndex: number; node: BoxRenderable } => Boolean(entry.node))
      .map((entry) => ({
        ...entry,
        contentY: scroll.scrollTop + entry.node.y - scroll.viewport.y,
      }))
      .sort((left, right) => left.contentY - right.contentY);
    const last = [...entries].reverse().find((entry) => entry.contentY <= viewportContentY);
    return last?.fileIndex ?? entries[0]?.fileIndex;
  };

  const jumpRelativePatchFile = (offset: number) => {
    setSelectedHunk(undefined);
    const next = movePatchFileIndex(patchFileIndexes, stateRef.current.selectedFileIndex ?? currentPatchFileIndex(), offset);
    if (stateRef.current.singlePatch) {
      if (next === undefined) return;
      selectPatchFile(next);
      scrollSinglePatchToTop();
      return;
    }
    scrollToFileIndex(next);
  };

  const singlePatchIndex = singlePatchFileIndex(selectedFileIndex, currentPatchFileIndex(), patchFileIndexes[0]);
  const visiblePatchFiles: { file: DiffFile; fileIndex: number }[] = (() => {
    if (!singlePatch) {
      return patchFileIndexes.flatMap((fileIndex) => {
        const file = files[fileIndex];
        return file ? [{ file, fileIndex }] : [];
      });
    }
    const file = singlePatchIndex === undefined ? undefined : files[singlePatchIndex];
    return file && singlePatchIndex !== undefined ? [{ file, fileIndex: singlePatchIndex }] : [];
  })();

  const ensureHighlightedPatchFile = () => {
    const fileIndex = currentPatchFileIndex() ?? stateRef.current.selectedFileIndex ?? patchFileIndexes[0];
    if (fileIndex === undefined) return;
    selectPatchFile(fileIndex);
  };

  const scrollToPatchFileIndexAfterRender = (fileIndex: number, offset?: number) => {
    setPendingPatchScrollFileIndex(fileIndex);
    setTimeout(() => {
      if (pendingPatchScrollRef.current !== fileIndex) return;
      const patchNode = patchNodeByFileIndex.current.get(fileIndex);
      if (patchNode) scrollPatchNodeToTop(patchNode, offset);
      setTimeout(() => {
        if (pendingPatchScrollRef.current !== fileIndex) return;
        const patchNode = patchNodeByFileIndex.current.get(fileIndex);
        if (patchNode) scrollPatchNodeToTop(patchNode, offset);
        setPendingPatchScrollFileIndex(undefined);
      }, 0);
    }, 0);
  };

  const jumpRelativeHunk = (offset: -1 | 1) => {
    const patchScroll = scrollRef.current;
    if (!patchScroll) return;
    const hunks = visiblePatchFiles
      .flatMap((entry) => {
        return (
          patchDiffByFileIndex.current
            .get(entry.fileIndex)
            ?.hunks()
            .map((node, hunkIndex) => ({
              fileIndex: entry.fileIndex,
              hunkIndex,
              contentY: patchScroll.scrollTop + node.y - patchScroll.viewport.y - (hunkIndex > 0 ? 1 : 0),
            })) ?? []
        );
      })
      .sort((left, right) => left.contentY - right.contentY);
    const selected = stateRef.current.selectedHunk;
    const selectedIndex =
      selected?.scrollTop === patchScroll.scrollTop
        ? hunks.findIndex((hunk) => hunk.fileIndex === selected.fileIndex && hunk.hunkIndex === selected.hunkIndex)
        : -1;
    const contentTop = patchScroll.scrollTop + FILE_HEADER_HEIGHT;
    const next =
      selectedIndex !== -1
        ? hunks[selectedIndex + offset]
        : offset === 1
          ? hunks.find((hunk) => hunk.contentY > contentTop)
          : [...hunks].reverse().find((hunk) => hunk.contentY < contentTop);
    if (!next) return;
    selectPatchFile(next.fileIndex);
    patchScroll.scrollTo(Math.max(0, next.contentY - FILE_HEADER_HEIGHT));
    setSelectedHunk({ fileIndex: next.fileIndex, hunkIndex: next.hunkIndex, scrollTop: patchScroll.scrollTop });
  };

  const toggleFileReviewed = (fileIndex: number | undefined) => {
    if (fileIndex === undefined) return;
    const file = files[fileIndex]?.file;
    if (!file) return;
    const reviewed = reviewedFileNames.has(file);
    setReviewedFileNames((previous) => {
      const next = new Set(previous);
      if (next.has(file)) next.delete(file);
      else next.add(file);
      return next;
    });
    const nextFileIndex =
      stateRef.current.singlePatch && !reviewed
        ? (movePatchFileIndex(patchFileIndexes, fileIndex, 1) ?? fileIndex)
        : fileIndex;
    selectPatchFile(nextFileIndex);
    setSelectedHunk(undefined);
    scrollToPatchFileIndexAfterRender(nextFileIndex);
  };

  // The imperative api — the App dispatcher's diff.* command targets. Fresh
  // closures every render, so the dispatcher always calls live code.
  useEffect(() => {
    props.apiRef?.({
      scrollLine: (direction) => {
        clearPatchSelection();
        scrollRef.current?.scrollBy(direction);
      },
      scrollPage: (direction) => scrollPageBy(direction, 1),
      scrollHalfPage: (direction) => scrollPageBy(direction, 2),
      scrollToStart: () => {
        clearPatchSelection();
        scrollRef.current?.scrollTo(0);
      },
      scrollToEnd: () => {
        clearPatchSelection();
        const scroll = scrollRef.current;
        if (scroll) scroll.scrollTo(scroll.scrollHeight);
      },
      jumpHunk: (offset) => jumpRelativeHunk(offset),
      jumpFile: (offset) => jumpRelativePatchFile(offset),
      markReviewed: () => toggleFileReviewed(stateRef.current.selectedFileIndex ?? currentPatchFileIndex()),
      toggleFileTree: () => {
        const next = !stateRef.current.fileTreeEnabled;
        setFileTreeEnabled(next);
        props.onPreferencesChange?.({ tree: next });
      },
      toggleSinglePatch: () => {
        setSelectedHunk(undefined);
        if (!stateRef.current.singlePatch) {
          ensureHighlightedPatchFile();
          setSinglePatch(true);
          props.onPreferencesChange?.({ single: true });
          scrollSinglePatchToTop();
          return;
        }
        const fileIndex = visiblePatchFiles[0]?.fileIndex ?? singlePatchIndex;
        if (fileIndex !== undefined) selectPatchFile(fileIndex);
        setSinglePatch(false);
        props.onPreferencesChange?.({ single: false });
        if (fileIndex !== undefined) scrollToPatchFileIndexAfterRender(fileIndex);
      },
      toggleView: () => {
        if (!stateRef.current.splitAvailable) return;
        setSelectedHunk(undefined);
        const next: DiffView = stateRef.current.view === "split" ? "unified" : "split";
        setViewOverride(next);
        props.onPreferencesChange?.({ view: next });
      },
      toggleWrap: () => {
        const next: "char" | "none" = wrapMode === "char" ? "none" : "char";
        setWrapMode(next);
        props.onPreferencesChange?.({ wrap: next });
      },
    });
    return () => props.apiRef?.(null);
  });

  const countsWidth = (entry: { file: DiffFile }) =>
    String(entry.file.additions).length + String(entry.file.deletions).length + 5 +
    (reviewedFileNames.has(entry.file.file) ? 2 : 0);

  return (
    <box style={{ width: "100%", height: "100%", backgroundColor: C.bg, flexDirection: "column" }}>
      {!showFileTree ? (
        <box style={{ paddingLeft: 2, paddingRight: 2, height: 1, flexShrink: 0, flexDirection: "row", gap: 1 }}>
          <text content={diffSourceLabel(props.mode)} fg={C.user} attributes={TextAttributes.BOLD} wrapMode="none" />
          <text content={` · ${sourceDetail}`} fg={C.subtle} wrapMode="none" />
          <text content={`${files.filter((file) => reviewedFileNames.has(file.file)).length}/${files.length}`} fg={C.subtle} wrapMode="none" />
        </box>
      ) : null}
      <box style={{ flexGrow: 1, minHeight: 0, flexDirection: "column" }}>
        {loading ? (
          <box style={{ flexGrow: 1, paddingLeft: 2, paddingRight: 2, paddingTop: 2, flexDirection: "column" }}>
            <text content="Loading diff…" fg={C.subtle} />
          </box>
        ) : error ? (
          <box style={{ flexGrow: 1, paddingLeft: 2, paddingRight: 2, paddingTop: 2, flexDirection: "column" }}>
            <text
              content={
                !reportedBase && props.mode !== "working"
                  ? "Could not load diff. Choose a base branch from Diff source, or select Uncommitted."
                  : "Could not load diff. Reopen the diff viewer to try again."
              }
              fg={C.error}
            />
          </box>
        ) : unavailable ? (
          <box style={{ flexGrow: 1, paddingLeft: 2, paddingRight: 2, paddingTop: 2, flexDirection: "column" }}>
            <text content="Committed comparison unavailable without base metadata. Choose a base branch from Diff source." fg={C.subtle} />
          </box>
        ) : files.length === 0 ? (
          <box style={{ flexGrow: 1, paddingLeft: 2, paddingRight: 2, paddingTop: 2, flexDirection: "column" }}>
            <text content="No changes to show" fg={C.subtle} />
          </box>
        ) : (
          <box style={{ flexDirection: "row", flexGrow: 1, minHeight: 0 }}>
            {showFileTree ? (
              <DiffViewerFileTree
                C={C}
                width={fileTreeWidth}
                files={files}
                loading={loading}
                error={error}
                selectedFileIndex={selectedFileIndex ?? (singlePatch ? visiblePatchFiles[0]?.fileIndex : undefined)}
                reviewedFileNames={reviewedFileNames}
                expandedNodes={expandedFileNodes}
                source={diffSourceLabel(props.mode)}
                sourceDetail={sourceDetail}
                diffText={{ added: D.diffAdded, removed: D.diffRemoved }}
                footer={<text content="? help" fg={C.fg} wrapMode="none" />}
              />
            ) : null}
            <box style={{ flexGrow: 1, minWidth: 0, minHeight: 0, paddingLeft: 2, paddingRight: 2, flexDirection: "column" }}>
              <box style={{ height: 1, flexShrink: 0, backgroundColor: D.diffContextBg }} />
              <scrollbox
                ref={(element: ScrollBoxRenderable) => { scrollRef.current = element; }}
                style={{ flexGrow: 1, minHeight: 0 }}
                scrollbarOptions={{ visible: false }}
              >
                {visiblePatchFiles.map((entry, index) => {
                  const reviewed = reviewedFileNames.has(entry.file.file);
                  const background = reviewed ? C.panel : D.diffContextBg;
                  return (
                    <box
                      key={entry.fileIndex}
                      ref={(element: BoxRenderable | null) => {
                        if (!element) return;
                        patchNodeByFileIndex.current.set(entry.fileIndex, element);
                        if (pendingPatchScrollRef.current === entry.fileIndex) {
                          scrollToPatchFileIndexAfterRender(entry.fileIndex);
                        }
                      }}
                      style={{ width: "100%", flexDirection: "column", flexShrink: 0 }}
                    >
                      {index > 0 ? (
                        <box style={{ height: 1, flexShrink: 0 }}>
                          <text content={"▄".repeat(Math.max(1, patchPaneWidth))} fg={D.diffContextBg} />
                        </box>
                      ) : null}
                      <box style={{ width: "100%", backgroundColor: background, flexDirection: "column" }}>
                        <box
                          style={{
                            flexDirection: "row",
                            gap: 1,
                            flexShrink: 0,
                            height: FILE_HEADER_HEIGHT,
                            backgroundColor: background,
                            paddingLeft: 1,
                            paddingRight: 1,
                            paddingBottom: 1,
                          }}
                        >
                          <box style={{ flexGrow: 1, minWidth: 0, flexDirection: "row" }}>
                            <FilePath
                              value={entry.file.file}
                              maxWidth={Math.max(1, patchPaneWidth - countsWidth(entry) - 2)}
                              fg={C.subtle}
                              basenameFg={reviewed ? C.subtle : C.fg}
                            />
                          </box>
                          {reviewed ? <text content="✓" fg={C.subtle} /> : null}
                          <text content={`+${entry.file.additions}`} fg={reviewed ? C.subtle : D.diffAdded} />
                          <text content={`-${entry.file.deletions}`} fg={reviewed ? C.subtle : D.diffRemoved} />
                        </box>
                        {reviewed ? null : entry.file.patch ? (
                          <PatchDiff
                            refCb={(ref) => patchDiffByFileIndex.current.set(entry.fileIndex, ref)}
                            scroll={() => scrollRef.current ?? undefined}
                            diff={entry.file.patch}
                            hunkFg={D.diffHunkHeader}
                            view={entry.file.status === "modified" ? view : "unified"}
                            filetype={filetypeOf(entry.file.file)}
                            syntaxStyle={props.syntaxStyle}
                            showLineNumbers
                            wrapMode={wrapMode}
                            fg={C.fg}
                            addedBg={D.diffAddedBg}
                            removedBg={D.diffRemovedBg}
                            contextBg={D.diffContextBg}
                            addedSignColor={D.diffHighlightAdded}
                            removedSignColor={D.diffHighlightRemoved}
                            lineNumberFg={D.diffLineNumber}
                            lineNumberBg={D.diffContextBg}
                            addedLineNumberBg={D.diffAddedLineNumberBg}
                            removedLineNumberBg={D.diffRemovedLineNumberBg}
                          />
                        ) : (
                          <box style={{ width: "100%", flexShrink: 0, paddingLeft: 1, paddingRight: 1, paddingBottom: 1 }}>
                            <text content="No patch available for this file." fg={C.subtle} />
                          </box>
                        )}
                      </box>
                    </box>
                  );
                })}
              </scrollbox>
            </box>
          </box>
        )}
      </box>
      {!showFileTree ? (
        <box style={{ position: "absolute", top: 0, right: 0, width: 1, height: 1 }}>
          <text content="?" fg={C.fg} />
        </box>
      ) : null}
    </box>
  );
}

export function filetypeOf(path: string): string | undefined {
  const dot = path.lastIndexOf(".");
  if (dot <= 0) return undefined;
  return path.slice(dot + 1).toLowerCase();
}
