# UX parity sitting 3

Reference: the owner-selected OpenCode v2ref at
`b084acc55ea2cdb50e9c2ec49a8d9ab3608d43ad`. Source comparison is local;
no upstream version change or whole-app parity claim is implied.

## Thinking command proof

Task: toggle visible reasoning from the resumed session composer while
leaving model generation and effort unchanged. The existing session resume
restores typing in `open()`'s finally block: an `i` activation types actual
text. Removing it uncovered a second fault: slash autocomplete matched the
older variants aliases before the canonical thinking/effort commands.
Those colliding aliases are removed; `/variants` retains its own command.

The production `App` fixture types `/thinking` plus Enter as one burst,
checks both rendered expanded/collapsed reasoning and persisted preference,
and rejects backend send/model/thought-level requests. This extends sitting
2's thinking component proof with the actual session composer path.

## Next source comparisons

- Composer: `packages/tui/src/prompt/history.tsx` and
  `packages/tui/src/component/prompt/index.tsx` (history boundaries,
  multiline cursor motion, normalized bracketed paste).
- Pickers: `packages/tui/src/ui/dialog-select.tsx` and
  `packages/tui/src/component/dialog-{session-list,model}.tsx`.
- Status: `packages/tui/src/component/dialog-status.tsx`.

Live terminal pixels, paste folding/extmark behavior and remaining message,
spacing, toast and scroll comparisons remain open until separately proven.
