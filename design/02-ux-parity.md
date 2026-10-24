# UX parity sittings 3–4

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
short-terminal grouped-list geometry were closed by sitting 4 below.

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

## Sitting 4 — grouped picker viewport

The pinned `ui/dialog-select.tsx` keeps category headings inside a bounded
scrollbox, caps list height at half the terminal minus six rows, spaces the
filter/body/footer, and stacks left footer actions below 60 columns. The
adapter now uses that structure instead of subtracting every category from
an option-count window. Keyboard reveal follows the actual rendered row;
Home/End and wheel scrolling share the scrollbox. Arrow and page navigation
wrap with the reference's `ui/select-controller.ts` rules.

At 40×18 the inherited footer clipped; the regression now keeps all three
session actions and the current last row visible. The 60×20 grouped-list
fixture reaches the last model and returns to the first without losing
chrome. New boundary navigation checks fail before and pass after.
Validation: 221 tests pass; TypeScript passes. These are rendered character
and input proofs, with live terminal pixel comparison still open.

## Sitting 4 — ranked search and stable selection

The shared picker uses the reference's fuzzysort 3.1.0, title weight 2,
category and supplemental search weight 1, then first-seen category grouping.
Abbreviations match; title matches precede provider-only matches. Rendering,
keyboard selection and actions use that same order within a key burst.
When favorite/pin actions move a row between sections, selection follows
its provider-qualified identity rather than its previous numerical index.
Tests exercise abbreviations plus Enter and actual ModelDialog favorite /
unfavorite transitions. Disabled separate-runner rows remain informational
and inert, an intentional existing plan-catalog adaptation.

Validation: 225 tests and typecheck pass. The dependency/lock change adds
only fuzzysort; existing resolved packages are unchanged. The local Bun
cannot read the inherited v2 lockfile and attempted a broad dependency
refresh; that refresh was discarded. Tests retain the inherited renderer
versions, with the new package held in lane-only dependencies.

## Sitting 4 — prompt status sizing

The prompt footer follows `component/prompt/index.tsx`'s shrinking location
cell and `feature-plugins/prompt/footer.tsx`'s cell-width budget for usage
and shortcuts. It reuses the already-ported `ui/file-path.tsx` truncator,
including Unicode grapheme handling. The home MCP extension now occupies a
compact cell instead of a second full-width box nested in the footer.
The inherited shortcut and home version extensions remain; no extra host
state is invented. Running status uses the reference `esc interrupt` label
while retaining the adapter's existing single-Escape interrupt semantics.

A production-App MCP/footer test fails on the previous commit and passes
now. Three rendered fixtures cover one-row home metadata, narrow Unicode
location plus usage, and running interrupt plus usage. Typecheck passes.

## Sitting 4 — toast lifecycle and affordance

Ported `ui/toast.tsx`'s hover pause/resume, remaining-time accounting,
hover-time arrival queue, pending count, click dismissal/action dispatch,
five-second default and unmount timer cleanup. The surface follows top=1,
max-width sizing, split heavy vertical borders, title/message spacing and
hovered affordance from the pinned reference. Existing App notifications
now use that controller; there is no independent status-flash timer.

The actual App's notification-close regression fails on the previous
commit and passes now. Clock-controlled lifecycle checks prove remaining
time, ordered queued delivery, replacement, action dispatch and cleanup;
a rendered mouse fixture proves activation. Typecheck and full suite pass
(234 tests). Live side-by-side terminal pixels remain open.

## Sitting 4 — text prompt input and final checks

The reference `ui/dialog-prompt.tsx` uses a focused native textarea and reads
its current buffer on confirm. The adapter now does the same, with explicit
blur on teardown, bold title and a blank row before the editor. This fixes
same-burst typing/Enter submitting stale React text, missing selection /
cursor editing and ignored bracketed paste. Three editor regressions fail
before and pass after. A production App rename-dialog interaction then
opens Status from the restored composer, proving editor focus was released.
The existing host-rename limitation remains explicitly reported to the user.

Final sitting 4 validation: 238 tests pass, zero failures; TypeScript passes.
Real installed-backend home smoke exits 0. The actual lane launcher, with
no compiled dist binary, renders the home composer in a 100×30 xterm PTY
and exits 124 at the intentional ten-second timeout; no runtime error is
reported. The no-TTY launcher exits 0. No model prompts were submitted by
live smoke. Logs and private runtime captures stay outside this repository.

Five units are committed and pushed to the review lane; no merge, release
or deploy is performed here. Remaining work includes long-paste folding,
asynchronous attachment paste, attachment-rich prompt history, specialized
upstream model sorting/server session search, broader message/code/diff and
streaming comparisons, and live side-by-side terminal pixels.
