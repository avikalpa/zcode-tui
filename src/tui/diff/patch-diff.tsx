// Ported from opencode v2.0.7 packages/tui/src/component/patch-diff.tsx;
// the virtualization half re-ported from v2.0.18 (#51122 render half).
// Port of the reference PatchDiff onto our React binding: each hunk of a
// unified patch renders under its own `@@` header row through the OpenTUI
// core DiffRenderable (the `diff` JSX intrinsic, typed in @opentui/react's
// jsx-namespace), and the line-number gutters of every hunk are width-synced
// so split view aligns. Added-file diffs large enough to stall the TUI
// (>= 3000 lines) render instead as 128-line virtual chunks: offscreen
// chunks become fixed-height placeholders, the chunks overlapping the
// viewport (+-1) follow the scroll offset observed on the renderer
// lifecycle pass, and the whole file is tree-sitter highlighted once with
// each chunk painting its slice.
// Binding deviations: requestAnimationFrame -> setTimeout (no rAF here);
// Solid signals -> React state with an equality bail-out (the lifecycle
// pass fires on every render pass and must not re-render while the window
// has not moved); props.read -> refs mirrored from the latest render (the
// lifecycle pass and PatchDiffRef closure must not read stale props).

import {
  BoxRenderable,
  CodeRenderable,
  DiffRenderable,
  LineNumberRenderable,
  getTreeSitterClient,
  type OnHighlightCallback,
  type Renderable,
  type ScrollBoxRenderable,
  type SimpleHighlight,
} from "@opentui/core";
import { useRenderer } from "@opentui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { splitAddedPatch, splitPatchHunks, type AddedPatchChunk } from "./split-patch-hunks";
import { stringWidth } from "./string-width";

// Smaller patches render fine as a single DiffRenderable; only split files large enough to stall the TUI.
const VIRTUAL_MIN_LINES = 3000;
const VIRTUAL_CHUNK_LINES = 128;

export interface PatchDiffRef {
  hunks: () => (DiffRenderable | BoxRenderable)[];
}

export interface PatchDiffProps {
  diff: string;
  hunkFg: string;
  lineNumberBg: string;
  view: "split" | "unified";
  filetype?: string;
  syntaxStyle?: unknown;
  showLineNumbers: boolean;
  wrapMode: "word" | "char" | "none";
  fg: string;
  addedBg: string;
  removedBg: string;
  contextBg: string;
  addedSignColor: string;
  removedSignColor: string;
  lineNumberFg: string;
  addedLineNumberBg: string;
  removedLineNumberBg: string;
  width?: number | "100%";
  scroll?: () => ScrollBoxRenderable | undefined;
  refCb?: (ref: PatchDiffRef) => void;
}

// The props handed straight through to the `diff` intrinsic on the virtual path.
interface DiffIntrinsicProps {
  view: "split" | "unified";
  filetype?: string;
  syntaxStyle?: never;
  showLineNumbers: boolean;
  fg: string;
  addedBg: string;
  removedBg: string;
  contextBg: string;
  addedSignColor: string;
  removedSignColor: string;
  lineNumberFg: string;
  addedLineNumberBg: string;
  removedLineNumberBg: string;
}

export function PatchDiff(props: PatchDiffProps) {
  const hunks = splitPatchHunks(props.diff);
  const nodes = useRef(new Map<number, DiffRenderable>());
  const virtualRoot = useRef<BoxRenderable | undefined>(undefined);
  const chunksRef = useRef<readonly AddedPatchChunk[] | undefined>(undefined);
  const minDigitsRef = useRef(0);
  const hasScroll = props.scroll !== undefined;
  const chunks = useMemo(() => {
    if (!hasScroll) return undefined;
    const result = splitAddedPatch(props.diff, VIRTUAL_CHUNK_LINES);
    return result && lineCount(result) > VIRTUAL_MIN_LINES ? result : undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.diff, hasScroll]);
  chunksRef.current = chunks;
  // Virtual chunks mount independently, so size the gutter for the whole file rather than the mounted chunks.
  minDigitsRef.current = chunks ? String(lineCount(chunks)).length : 0;
  const register = (index: number, node: DiffRenderable | null) => {
    if (!node) {
      nodes.current.delete(index);
      return;
    }
    nodes.current.set(index, node);
    syncGutters();
  };

  useEffect(() => {
    props.refCb?.({
      hunks: () => {
        if (chunksRef.current) {
          const root = virtualRoot.current;
          return root && !root.isDestroyed ? [root] : [];
        }
        return [...nodes.current.entries()]
          .sort(([left], [right]) => left - right)
          .map(([, node]) => node)
          .filter((node) => !node.isDestroyed);
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const syncGutters = (attempt = 0) => {
    setTimeout(() => {
      const sides = [...nodes.current.values()]
        .filter((item) => !item.isDestroyed)
        .flatMap((item) =>
          item.getChildren().filter((side): side is LineNumberRenderable => side instanceof LineNumberRenderable),
        );
      const lineNumbers = sides.map((side) => new Map([...side.getLineNumbers()].filter(([line]) => line >= 0)));
      const digits = lineNumbers.map((numbers) => Math.max(0, ...numbers.values()).toString().length);
      const after = sides.map((side) =>
        Math.max(
          0,
          ...[...side.getLineSigns()].filter(([line]) => line >= 0).map(([, sign]) => stringWidth(sign.after ?? "")),
        ),
      );
      const maxDigits = Math.max(...digits);
      const maxAfter = Math.max(...after);
      if ((!Number.isFinite(maxDigits) || !maxDigits) && attempt < 2) return syncGutters(attempt + 1);
      if (!Number.isFinite(maxDigits) || !maxDigits) return;
      const width = Math.max(maxDigits, minDigitsRef.current);
      sides.forEach((side) => {
        const index = sides.indexOf(side);
        const signs = new Map([...side.getLineSigns()].filter(([line]) => line >= 0));
        signs.set(-1, { after: " ".repeat(maxAfter + width - digits[index]) });
        side.setLineNumbers(lineNumbers[index]);
        side.setLineSigns(signs);
      });
    }, 0);
  };

  const diffProps: DiffIntrinsicProps = {
    view: props.view,
    filetype: props.filetype,
    syntaxStyle: props.syntaxStyle as never,
    showLineNumbers: props.showLineNumbers,
    fg: props.fg,
    addedBg: props.addedBg,
    removedBg: props.removedBg,
    contextBg: props.contextBg,
    addedSignColor: props.addedSignColor,
    removedSignColor: props.removedSignColor,
    lineNumberFg: props.lineNumberFg,
    addedLineNumberBg: props.addedLineNumberBg,
    removedLineNumberBg: props.removedLineNumberBg,
  };

  if (chunks) {
    return (
      <VirtualAddedPatch
        chunks={chunks}
        scroll={props.scroll!}
        diffProps={diffProps}
        lineNumberBg={props.lineNumberBg}
        register={register}
        registerRoot={(root) => (virtualRoot.current = root)}
      />
    );
  }

  return (
    <>
      {hunks.map((hunk, index) => (
        <box key={index} style={{ width: "100%", flexDirection: "column", flexShrink: 0 }}>
          {index > 0 ? (
            <box style={{ width: "100%", height: 1, flexShrink: 0, backgroundColor: props.lineNumberBg }}>
              <text content={` ${hunk.header ?? ""}`} fg={props.hunkFg} bg={props.lineNumberBg} />
            </box>
          ) : null}
          <diff
            ref={(node: DiffRenderable | null) => register(index, node)}
            diff={hunk.patch}
            view={props.view}
            filetype={props.filetype}
            syntaxStyle={props.syntaxStyle as never}
            showLineNumbers={props.showLineNumbers}
            wrapMode={props.wrapMode}
            fg={props.fg}
            addedBg={props.addedBg}
            removedBg={props.removedBg}
            contextBg={props.contextBg}
            addedSignColor={props.addedSignColor}
            removedSignColor={props.removedSignColor}
            lineNumberFg={props.lineNumberFg}
            lineNumberBg={props.lineNumberBg}
            addedLineNumberBg={props.addedLineNumberBg}
            removedLineNumberBg={props.removedLineNumberBg}
            style={{ width: props.width ?? "100%", minHeight: hunk.rows ?? 0, flexShrink: 0 }}
          />
        </box>
      ))}
    </>
  );
}

// Chunks render without wrapping so each one is exactly `rows` tall. Offscreen chunks become fixed-height
// placeholders, and the chunks overlapping the viewport (plus one on each side) follow from the scroll offset.
function VirtualAddedPatch(props: {
  chunks: readonly AddedPatchChunk[];
  scroll: () => ScrollBoxRenderable | undefined;
  diffProps: DiffIntrinsicProps;
  lineNumberBg: string;
  register: (index: number, node: DiffRenderable | null) => void;
  registerRoot: (root: BoxRenderable) => void;
}) {
  const renderer = useRenderer();
  const rootRef = useRef<BoxRenderable | null>(null);
  const scrollRef = useRef(props.scroll);
  const [windowState, setWindowState] = useState({ first: 0, last: 0 });
  scrollRef.current = props.scroll;
  // A chunk is not valid source on its own (a slice of a JSON object parses as an error), so highlight
  // the whole file once and give each chunk its slice of the result.
  const contents = useMemo(
    () => props.chunks.map((chunk) => chunk.lines.map((line) => line.slice(1)).join("\n")),
    [props.chunks],
  );
  const offsets = useMemo(
    () =>
      contents.map((_, index, all) => all.slice(0, index).reduce((sum, content) => sum + content.length + 1, 0)),
    [contents],
  );
  const filetype = props.diffProps.filetype;
  const fileHighlights = useMemo<Promise<SimpleHighlight[] | undefined> | undefined>(() => {
    if (!filetype) return undefined;
    return (
      getTreeSitterClient()
        .highlightOnce(contents.join("\n"), filetype)
        .then((result) => result.highlights)
        // Rejects when the renderer tears down the client mid-parse; chunks then keep their own highlights.
        .catch(() => undefined)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filetype, contents]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.onLifecyclePass = () => {
      const scroll = scrollRef.current();
      if (!scroll) return;
      // ScrollBox's scroll position is not a reactive signal; observe it during the render pass.
      const top = scroll.scrollTop - (root.y - scroll.content.y);
      setWindowState((prev) => {
        const first = Math.floor(top / VIRTUAL_CHUNK_LINES);
        const last = Math.floor((top + scroll.viewport.height) / VIRTUAL_CHUNK_LINES);
        return prev.first === first && prev.last === last ? prev : { first, last };
      });
    };
    renderer.registerLifecyclePass(root);
    return () => {
      renderer.unregisterLifecyclePass(root);
      root.onLifecyclePass = null;
    };
  }, [renderer]);

  const chunkHighlights =
    (index: number): OnHighlightCallback =>
    async () => {
      const all = await fileHighlights;
      if (!all) return;
      const start = offsets[index];
      const end = start + contents[index].length;
      return all.flatMap((highlight): SimpleHighlight[] =>
        highlight[0] < end && highlight[1] > start
          ? [[Math.max(highlight[0], start) - start, Math.min(highlight[1], end) - start, highlight[2], highlight[3]]]
          : [],
      );
    };

  return (
    <box
      style={{ width: "100%", flexDirection: "column", flexShrink: 0 }}
      ref={(root: BoxRenderable | null) => {
        if (root) {
          rootRef.current = root;
          props.registerRoot(root);
        }
      }}
    >
      {props.chunks.map((chunk, index) =>
        index >= windowState.first - 1 && index <= windowState.last + 1 ? (
          <diff
            key={index}
            {...props.diffProps}
            ref={(node: DiffRenderable | null) => {
              props.register(index, node);
              // DiffRenderable creates its CodeRenderable after ref runs; setting onHighlight re-highlights.
              queueMicrotask(() => {
                const code = node && !node.isDestroyed ? findCode(node) : undefined;
                if (code) code.onHighlight = chunkHighlights(index);
              });
            }}
            diff={chunk.patch}
            wrapMode="none"
            lineNumberBg={props.lineNumberBg}
            style={{ width: "100%", height: chunk.rows, flexShrink: 0 }}
          />
        ) : (
          <box key={index} style={{ height: chunk.rows, flexShrink: 0 }} />
        ),
      )}
    </box>
  );
}

function findCode(node: Renderable): CodeRenderable | undefined {
  if (node instanceof CodeRenderable) return node;
  return node.getChildren().reduce<CodeRenderable | undefined>((found, child) => found ?? findCode(child), undefined);
}

function lineCount(chunks: readonly AddedPatchChunk[]) {
  return chunks.reduce((count, chunk) => count + chunk.rows, 0);
}
