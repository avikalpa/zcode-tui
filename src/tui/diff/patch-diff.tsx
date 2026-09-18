// Port of the reference PatchDiff (opencode v2.0.6
// packages/tui/src/component/patch-diff.tsx) onto our React binding: each
// hunk of a unified patch renders under its own `@@` header row through the
// OpenTUI core DiffRenderable (the `diff` JSX intrinsic, typed in
// @opentui/react's jsx-namespace), and the line-number gutters of every
// hunk are width-synced so split view aligns.
// Binding deviation: requestAnimationFrame -> setTimeout (no rAF here).

import { DiffRenderable, LineNumberRenderable } from "@opentui/core";
import { useEffect, useRef } from "react";
import { splitPatchHunks } from "./split-patch-hunks";
import { stringWidth } from "./string-width";

export interface PatchDiffRef {
  hunks: () => DiffRenderable[];
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
  refCb?: (ref: PatchDiffRef) => void;
}

export function PatchDiff(props: PatchDiffProps) {
  const hunks = splitPatchHunks(props.diff);
  const nodes = useRef(new Map<number, DiffRenderable>());
  const register = (index: number, node: DiffRenderable | null) => {
    if (!node) return;
    nodes.current.set(index, node);
    syncGutters();
  };

  useEffect(() => {
    props.refCb?.({
      hunks: () =>
        [...nodes.current.entries()]
          .sort(([left], [right]) => left - right)
          .map(([, node]) => node)
          .filter((node) => !node.isDestroyed),
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
      sides.forEach((side) => {
        const index = sides.indexOf(side);
        const signs = new Map([...side.getLineSigns()].filter(([line]) => line >= 0));
        signs.set(-1, { after: " ".repeat(maxAfter + maxDigits - digits[index]) });
        side.setLineNumbers(lineNumbers[index]);
        side.setLineSigns(signs);
      });
    }, 0);
  };

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
