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

## Composer boundaries and paste

The pinned `component/prompt/index.tsx` gives Up/Down to visual cursor
movement until offset 0/end, then calls `prompt/history.tsx.move`.
A nonempty draft differing from the selected history entry refuses history
replacement. Previous puts the cursor at the start; next at the end.
The React adapter now follows those rules for hard newlines and soft wraps,
keeps the 50 newest entries and deduplicates only consecutive submissions.
Shared-store history loading remains the backend adaptation.

OpenTUI decodes raw Ctrl+J as `linefeed`, not `ctrl+j`; accept both forms.
Paste flushes earlier typed bytes before insertion, normalizes CRLF/CR,
adds one undo snapshot, and yields input to dialogs, diff and permission
surfaces. Six production-App keystroke tests compare actual session/send
content; all six failed before this unit and pass after it. The Escape
fixture waits for the terminal parser's ambiguous Alt-prefix timeout.

Still open: folded long-paste placeholders/extmarks, attachment-rich history
and full persistence equivalence, and cancellation/order for asynchronous
attachment-path resolution. These require separate bounded units.

## Session and model picker input

The pinned `ui/dialog-select.tsx` uses a synchronous Solid store for filter,
selection and action dispatch. The React adapter previously let a single
`gamma` + Enter burst select alpha. Filter + Down + favorite similarly
acted on the original row. Immediate refs now drive keyboard selection,
filtering, paging and actions, while React state renders the result.
Mouse movement updates the same selection and notifies preview/disarm hooks.
Enter with no matches leaves the query/dialog intact, as the reference's
absent selection does. Disabled separate-runner models remain inert.

Tests cover the shared picker, actual ModelDialog provider/model selection
and refusal, and App's filtered session/resume target. These are stdin,
render and request proofs; not live visual equivalence. Search ranking and
short-terminal grouped-list geometry remain separate comparison items.

## Status details and unavailable data

Ported the pinned `component/dialog-status.tsx` MCP row structure: a colored
bullet, bold server name and subdued wrapped detail. Connected, disabled
and authentication states use the reference's grammar; failures show their
available detail, with Failed as an explicit missing-detail fallback.
Existing plan/account sections remain the previously requested extension.

A rejected `mcp/list` now yields unavailable in both Status and the MCP
picker instead of a successful empty result. Other plan sections still
render. Component and production-App fixtures cover that distinction.
Keyboard End/Home at 60×20 reaches a wrapped failure and returns to plan
content while the title/esc chrome remains visible. Existing wheel coverage
also remains. OpenCode's MIT attribution is included in third-party notices.

## Sitting 3 validation

Final full suite: `bun test` — 218 passed, 0 failed across 23 files.
`bun x tsc --noEmit` passes with the shared MCP state type. The final status
and App subset also passes after that type-only consolidation.
The lane launcher exits 0 without a TTY; `src/tui/live-smoke.tsx` exits 0
against the installed backend and renders the home composer. A real
100×30 xterm PTY boot renders that composer without an error and exits 124
at the deliberate ten-second timeout. No prompts were submitted during
boot smoke. Private raw captures/logs are retained outside the repository.
These checks do not establish live side-by-side pixel parity.

Four bounded units are committed/pushed on the review lane. This sitting
performs no merge, release or deploy. Remaining comparisons include folded
long paste, asynchronous attachment paste cancellation/order, rich history,
search ranking and small grouped pickers, plus the broader day-1/2 message,
spacing, toast and scroll comparison.
