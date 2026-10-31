# opencode v2 parity ledger

## ★ PRIME DOCTRINE (owner, 2026-09-17 23:34 — supersedes all earlier UX invention)

**COPY opencode v2 (latest stable code) instead of inventing ANY UX. ONLY the
wiring — adapting v2's surfaces to the zcode protocol/backend — is our
intelligent work. This file is the doc spec.** Every surface must trace to a
v2 source file (component structure, labels, colors, key behavior); where we
shipped an invention in the past, it is a DEVIATION to be fixed, not a
feature to keep. Audit pass 2026-09-17 filed the known deviations below
(Deviation queue). The historical exceptions were the model allowlist and provider connection.
The 2026-10-23 plan-catalog pass below expands model discovery
without routing AutoClaw models through the ZCode backend.

**Reference:** opencode **v2.0.8** (stable) — VENDORED in-repo at
`tools/opencode-reference/` (pinned by `tools/sync-opencode.sh <tag>`;
MIT, never compiled into our binary). The sync toolchain makes a parity
wave a diff job: `parity-report.py --map/--stale/--gaps`,
`gen-keybinds.py` (the 241-bind registry + machine-refreshed gap report in
`docs/parity-keybinds.md`), `gen-themes.py` (reads the pin). Ported files
carry a grep-able header (`Ported from opencode <version> <ref path>`) —
the port map IS the headers. Update the ledger AFTER EVERY WAVE — a line
moves from Remaining to Shipped only with the wave version that shipped it.

Historical non-parities (model discovery updated 2026-10-23 below): model execution allowlist, provider_connect /
console_org, and the zcodetui wordmark on the home screen (owner 2026-09-18:
"Our home screen zcodetui logo stays btw" — a v2 session-destination home
ports AROUND the logo, never over it).

## 2026-10-23 plan and interaction pass (lane, not released)

A substantial UX gap remains under review; historical shipped entries do
not establish current whole-app parity. Reference for this targeted pass:
local opencode `v2ref` at `b084acc55ea2cdb50e9c2ec49a8d9ab3608d43ad`.
See [design decisions and evidence](../design/01-plan-dialogs.md).

Implemented on the review lane:

- Model dialog: provider-qualified row IDs, Favorites/Recent categories,
  provider labels, all models from the managed AutoClaw catalog, live fetch
  with cached fallback, an explicitly offline four-model baseline for configured
  plans, and a setup state for unconfigured hosts. AutoClaw rows are
  explicitly separate-runner entries; execution still uses `autoclaw run`.
- Status: cached Coding Plan entitlements, used/limit meters when present,
  seven-day runtime telemetry, AutoClaw plan presence/credential age/catalog
  source and count, plus existing MCP state. Missing quota remains unknown.
- Shared picker: mouse selection, clickable esc, readable secondary labels,
  multiword/provider search and stable disabled-row behavior. Session delete
  confirmation disarms when selection moves. Model preferences update after
  the backend accepts an active-session switch.

Remaining for this pass: AutoClaw execution inside this TUI needs a separate
backend-routing contract; unavailable quota windows need upstream data;
full live-pixel parity and the rest of the reported gap remain open.
The deterministic component checks do not close those items. No release or
main merge is part of this lane.

## 2026-10-24 UX parity sitting 3 (lane; never merged here)

Reference remains the owner-selected OpenCode `v2ref`
`b084acc55ea2cdb50e9c2ec49a8d9ab3608d43ad`; this does not re-pin the vendor tree.

- Unit 1: restored the production-session `/thinking` keystroke regression.
  Resume already restores typing, so the test no longer types an extra `i`.
  The test then exposed conflicting `/variants` aliases in autocomplete:
  `/thinking` opened effort despite canonical command parsing being correct.
  Removed the conflicting aliases. The real composer now toggles persisted
  show/hide twice without `session/send`, `setModel` or `setThoughtLevel`.
  Deterministic render/input proof only; no live pixel-parity claim.

- Unit 2: composer history follows the pinned reference's visual-row and
  start/end boundary rules, refuses replacement of edited drafts, positions
  recalled cursors correctly, and keeps 50 entries with adjacent-only
  deduplication. Raw Ctrl+J (`linefeed`) inserts a newline. Paste flushes
  prior typing, normalizes newlines, undoes atomically, and cannot reach
  the hidden composer under a dialog/permission/diff. Six production-App
  input/send tests failed before and pass after the change. Long-paste
  folding and asynchronous attachment-path races remain open.

- Unit 3: shared session/model pickers dispatch search + navigation +
  Enter/actions from immediate state, fixing stale-row selection in fast
  bursts. Empty-result Enter retains the query/dialog. Actual ModelDialog
  tests preserve disabled separate-runner refusal, and App's session search
  asserts the resumed session ID. Search ranking and grouped-list geometry
  remain open comparisons.

- Unit 4: Status copies the reference's colored MCP bullet, bold name and
  subdued wrapped status/error detail. Failed `mcp/list` is unavailable in
  Status and the MCP picker, distinct from a successful empty list.
  Component/App fixtures prove that distinction; short-terminal keyboard
  scrolling reaches wrapped details without losing title/esc chrome.
  MIT attribution is retained in third-party notices.

Validation: 218 tests passed, 0 failed; TypeScript clean; no-TTY launcher
and real-backend home smoke exit 0. A real 100×30 PTY renders the home
composer before the deliberate 10-second timeout (124). No model prompt
was sent in boot smoke. Four bounded lane commits; no merge/release/deploy
performed by this sitting. Broader day-1/2 and live-pixel parity remain open.

See [sitting 3 decisions](../design/02-ux-parity.md) for references and gaps.

## 2026-10-24 UX parity sitting 4 (lane; never merged here)

Reference remains OpenCode `v2ref` at `b084acc55ea2cdb50e9c2ec49a8d9ab3608d43ad`.

- Unit 1: ported the shared picker's bounded category scrollbox, spacing,
  narrow stacked footer and wrap navigation from `ui/dialog-select.tsx`
  and `ui/select-controller.ts`. A short terminal can reach the last group
  with its footer visible; all options remain wheel-scrollable. Two new
  regression checks fail before and pass after; 221 tests and typecheck
  pass. Ranking and full live-pixel comparison remain open.

- Unit 2: shared picker search now uses the reference's pinned fuzzysort
  engine and weighted name/category/supplemental ranking, followed by stable
  grouping. Favorite/pin changes preserve the highlighted identity across
  section moves. Real ModelDialog favorite/unfavorite and fuzzy burst
  selection tests pass; full suite 225/225 and typecheck pass. Specialized
  upstream model sorting and server-backed session search remain adaptations.

- Unit 3: prompt status uses the reference's location truncation and
  usage/shortcut width budget. Home MCP status no longer allocates a nested
  full-width row that clips shortcuts. Running label is `esc interrupt`.
  Production App regression fails before/pass after; three component render
  fixtures also pass. Typecheck and full suite pass (229 tests).

- Unit 4: toast interaction ports the pinned reference's hover pause,
  pending queue, click affordance, split border, sizing and five-second
  default; timer cleanup follows unmount. Actual App click-dismissal
  regression fails before/pass after. Lifecycle and rendered mouse tests
  pass; full suite 234/234 and typecheck pass.

- Unit 5: text prompts port the reference native textarea, current-buffer
  submit, selection/edit/paste behavior, focus cleanup and title/editor
  spacing. Three input regressions fail before/pass after; production App
  proves the composer works after closing the dialog. Host rename remains
  unavailable and is explicitly reported, without fake persistence.

Final sitting 4 validation: 238 passed, zero failed; TypeScript clean;
no-TTY and real-backend home smoke exit 0. A 100×30 xterm PTY boots the lane
source and renders home without runtime error before the intentional
10-second timeout (124). No prompts sent by live smoke. Five unit commits
are pushed; no merge/release/deploy. Remaining: long-paste folding, async
attachment paste, rich history, specialized model sorting/server session
search, broader message/code/diff/streaming and live terminal pixels.
See [sittings 3–4 decisions](../design/02-ux-parity.md).

## 2026-10-24 UX parity sitting 5 (lane; never merged here)

Reference remains OpenCode `v2ref` at `b084acc55ea2cdb50e9c2ec49a8d9ab3608d43ad`.

- Unit 1: the transcript scrollbox carries the reference session-column pad
  (2, or 1 below 44 columns), and the user turn renders the reference left
  `┃` rule in the agent color spanning padTop/text/padBottom — rule at
  column 2, text at column 5 (`routes/session/index.tsx` 1276–1278, 2259+).
  Assistant and tool rows dropped private right paddings. The drafted tests
  exposed a real production bug: the live `tool_call` handler dropped
  `toolInput`, so shell blocks showed "Writing command…" forever; it now
  stores it. Two App interaction tests fail before/pass after; 254 tests
  and typecheck pass.

- Unit 2: transcript vertical rhythm follows the reference row grammar —
  the single blank line between rows comes from the row wrapper
  (`SessionRowView` marginTop 1), never from content boxes. Block tools
  keep only their border paddings (paddingTop/Bottom 1, paddingLeft 2,
  gap 1), inline tool rows only paddingLeft 3, and the turn footer is its
  own row one blank below the reply. The drafted geometry tests exposed a
  second production bug: the submit-time empty assistant turn painted its
  row gap as a stray blank line ahead of the tool row below it. The
  reference builds rows from message parts, so an assistant message with
  no parts contributes no row; MessageView now renders nothing for an
  assistant turn with no text, thinking or footer. Three App interaction
  tests (block tool one blank above/below, pending inline row one blank
  above, footer one blank below the reply) pin the geometry; full suite
  257/257 and typecheck pass; no-TTY boot renders home before the
  intentional timeout.

- Unit 3: exploration grouping — consecutive read/glob/grep tool rows
  collapse into one `→ Explored — N reads, M searches` header (spinner +
  `Exploring — …` while any part runs), ctrl+o expands the individual rows
  back beneath the header (`routes/session/index.tsx` SessionGroupView,
  `grouping/{session,tree}.ts`). Adjacent-only merge: any non-tool row
  breaks the run; failed parts settle the group like completed ones
  (the reference reads part.time.completed, set for errors too). Colour is
  text.subdued in both states — the reference brightens on hover only, and
  this no-mouse binding keeps subdued. Two production defects fixed during
  the port: the group JSX compared a row index against the message count,
  so isTail (the streaming tell) never landed on the row after a
  multi-tool group (red-green pinned by a reasoning_delta test — `▪
  Thinking` vs `+ Thought`); and the running label first used text.default
  against the reference's subdued. The thinking-integration burst test now
  asserts ordering against the `Explored` header, which is the reference
  grammar for a lone settled read. Deviations recorded: expansion is
  keyboard-driven (ctrl+o; the reference toggles by mouse), and the
  config.session?.grouping === "none" opt-out is not wired (the binding
  has no session config surface yet; the reference default is grouping on).
  13 exploration tests (6 App interaction + 7 unit) — the isTail and
  running-colour defects failed before and pass after; full suite 270/270
  across 30 files (twice; one cross-file dialog-focus flake passed in
  isolation and on re-run), typecheck exit 0, no-TTY boot renders home
  before the intentional timeout.

## Shipped (1:1 unless noted)

- ~~**permission.prompt.fullscreen**~~ SHIPPED 0.6.36 — the v2
  SessionQuestion fullscreen arm (routes/session/permission.tsx) onto our
  ask card: ctrl+f toggles the ask between the inline card and the
  full-viewport overlay (top 0, 2-col insets, status row reserved —
  bottom: 1 upstream; explicit width/height per our ModalBackdrop idiom,
  zIndex under the toast), the diff/patch maxHeight caps lift when
  expanded, a flexGrow spacer parks the footer at the card foot, and the
  footer hint grammar is verbatim (ctrl+f fullscreen|minimize flipping
  with the arm, ⇆ select, enter confirm). Escape follows the v2 dismiss
  law MINIMIZE-FIRST; a collapsed escape keeps our deny+stopTurn interrupt
  law (owner, 2026-09-17) and the hidden y/a/n accelerators stay.
  Collapsed card geometry unchanged.
- ~~**prompt.images.view / dialog-image-preview**~~ SHIPPED 0.6.35 — the
  attachments family, ported off the vendored local-attachment.ts +
  prompt/attachment.ts + dialog-image-preview.tsx with the host wire
  MEASURED LIVE (begin/chunk/commit schemas extracted from the host bundle
  and round-tripped: begin {connectionId, uploadId, sessionId, fileName,
  mime, totalBytes<=20MB, totalChunks<=64, checksum sha256:…} -> chunk
  {chunkIndex, dataBase64<=512KB} -> commit -> {ref zcode-artifact://…};
  session/send takes attachments [{ref, fileName, mime, bytes}]).
  Landed: pasted-path resolution (image/* + pdf <=20MB, svg-as-text, single
  or multi filepath pastes, file:// decode — verbatim), pasteAttachment
  ([Image N]/[PDF N] label grammar + the label leaves the text at submit),
  the draft attachment strip (first 3 thumbs, height clamp 4..8 rows,
  width 2x, +N more), prompt.images.view (leader i + palette) opening the
  DialogImagePreview port (Image N of M, left/right cycle, esc, label
  footer), and the upload funnel + session/send attachments array.
  The <image> render is the v2 element VERBATIM (opentui was already our
  stack): kitty/sixel when the terminal speaks them, the blocks fallback
  otherwise, the v2 failed arm (No preview) on error.
  MAPPING TRUTH: labels are virtual text in v2 (extmarks); our plain draft
  syncs parts by label-presence (the submit/prune race — capture parts
  BEFORE the draft clear — was found by the AT proof and fixed).
  BLOCKED/RESIDUE: clipboard-IMAGE paste has no PTY read plane (text
  paste + path resolution are the portable arms); v4/attachment/read +
  previewSource are message-scoped preview channels (previewRef
  authorization) — unused by the send path; the host does not echo
  attachments back in conversation rows, so the label/name echo is ours
  (resumed sessions show the text only); prompt-stash rides text-only
  (upstream stash carries files); thumb/dialog mouse arms are mouse-only
  upstream.
- Surfaces: home, session transcript, composer, sidebar, leader grammar,
  ctrl+p palette, slash popup + @files autocomplete, permission card, toasts,
  help overlay (`?`/`/help`), sessions dialog (reference chrome, 0.6.8),
  model dialog with favorites/recent + f2/shift+f2 global cycle (0.6.11),
  themes dialog with LIVE preview + Search + gutter ● (0.6.16).
- 33 official themes verbatim + zai arms; theme switch persists; effort
  variants ride setModel; state.json persistence (recent/favorite/variant/
  theme/pinned).
- Transcript: sticky-bottom scrollbox, hidden scrollbar, Jump-to-latest,
  scroll grammar (pageup/pagedown, half-page, line, first ctrl+g, last
  ctrl+alt+g), sliding window with prepend+anchor; typed-part rendering
  (reasoning → collapsed Thought, tool rows with ✓/✗/ms, 0.6.17);
  unbreakable-token wrapping (0.6.17); user-message navigation alt+up /
  alt+down / alt+end (0.6.18).
- Composer: input editing grammar (word motions/deletes, line ops, undo/
  redo, ctrl+c clear), newline keys, atomic paste, history previous/next,
  external editor (leader e), queued prompts + manager (leader q), queue
  auto-pump with full-stop interrupt (0.6.17).
- Session ops: new, list, resume, fork (leader f + timeline fork-at-message
  leader g, 0.6.14), interrupt (esc = FULL stop: denies pending permission,
  drops queue, 0.6.17), compact (leader c), export (leader x), copy message
  (leader y, OSC 52), delete/rename/pin in the sessions dialog, quick slots
  1-9, running-status adoption on open (0.6.17).
- Agents: list (leader a), cycle (tab), modes (shift+tab), status view
  (leader s).
- **Status view** — opencode.status SHIPPED 0.6.28: the v2 DialogStatus
  port — title row "Status" + the subdued esc hint (esc only, v2
  verbatim), the "No MCP servers" empty state, the "{n} MCP server(s)"
  header, rows "• <name> <status>" with v2's status→colour map
  (connected success · failed error · needs_auth warning · else subdued)
  and v2's status grammar (Connected / error / Disabled in configuration
  / Needs authentication). leader s, /status and a palette row open it —
  the invented statusSummary toast is retired (deviation queue). Host gap
  carried: the mcp/list payload has no error text (0.6.23), so
  failed/needs_auth render without v2's error suffix; the code takes the
  error field when a payload ever carries one.
- **Session tabs** — the session.tab.* family (0.6.22): the open-session
  strip above the transcript (adaptive widths 8/22/32 with ‹N / N› overflow
  markers, number gutter, running spinner / • unread / ! ? attention,
  elevated active tab), the tabs model verbatim (open/close, the 10-deep
  closed stack with position-restoring reopen, move, cycle, the 100-entry
  bounded switch history), leader 1-9/0 = tab select, leader w = close,
  ctrl+shift+t = reopen, ctrl+i = history forward, ctrl+tab / alt+up+down =
  cycle (shift = unread walk). v2.0.7 RE-POINT: alt+up/down now walk tabs —
  the user-message walk keeps alt+end (its prev/next are palette commands
  upstream). Tabs are in-memory for the TUI lifetime.
- **Tool-call rows** — the v2 per-tool grammar (0.6.21): ToolPart
  dispatches on the display class (shell/glob/read/grep/webfetch/websearch/
  write/edit/subagent/patch/question/skill/generic) with the reference
  icons + titles + pending lines ("Reading file…", "Finding files…"…),
  block shells (command + tail-collapsed output, 10-line budget) and block
  edits ("← Edit path" with the inline PatchDiff when the part carries a
  patch), Read's "↳ Loaded" lines, match counts from metadata, the generic
  row as `tool [key=value, …]` with expandable input/output. The invented
  "● Tool summary ✓ms" row is DEAD. Adapter: upstream expands rows by
  MOUSE — this binding has no mouse plane, so ctrl+o toggles the expanded
  set (registered in the help overlay + coverage notes).
- **diff.* family (19 binds)** — the diff viewer route (`/diff` + ctrl+p
  palette): full-screen route over the app, source header grammar
  (All/Committed/Uncommitted `· vs <base>` + n/m reviewed count), file-tree
  rail (width clamp 30..40, shown at >= 90 cols, collapsed single-dir
  chains, rails + status letters + reviewed ✓), per-file cards (▄
  separators, FilePath headers, +n/-m counts), split/unified with the
  100-col split floor, single-patch view, hunk jumps (] / [), file jumps
  (n / p + alt+arrows), mark_reviewed (m) with single-mode advance, Diff
  source dialog (All/Committed/Uncommitted/Base) + Base branch picker
  (local+remote, remembered until exit), Diff shortcuts overlay (?),
  scroll grammar (j/k, pagedown/pageup, ctrl+d/u, gg/G, home/end), escape/q
  close, preferences persisted (tree/single/view) (0.6.20). Wiring: local
  git in the session cwd reproducing the reference server adapter —
  working = `git diff HEAD` + untracked via `--no-index /dev/null`;
  branch/committed = merge-base against the default branch (origin HEAD
  symref, else main/master); `--unified=12 --no-renames --no-ext-diff`.
- **Preference repository** — the v2.0.8 client-sync rework (0.6.29):
  state.json writes merge from the DISK current under a lock
  (addRecent/setFavorite/update own every write), and subscribe() watches
  the file so a change made by one zcode-tui process surfaces live in the
  others (fs.watch on state.json siblings, 50ms debounce, reference-counted
  watcher — upstream #49611). The lock is the adapted Flock port
  (src/tui/session/flock.ts): mkdir critical section with the reference's
  breaker pattern + 60s mtime staleness; the effect/hash deps and heartbeat
  writer are adapted out, and the wait is bounded (500ms) because our
  callers are UI handlers — on budget exhaustion it falls back unlocked.
  The turn footer's tok/s numerator counts reasoning tokens when a payload
  carries them (v2.0.8 rows.ts); BlockToolContent's flexShrink={0} spacing
  fix was already our 0.6.21 shape. The theme token rename
  (surface.overlay→raised.high, surface.offset→raised.base) touches no
  code here — our ports carry no upstream token layer; ledger wording
  updated. /btw (session.aside) and the v2.0.8 subagent-notice click are
  BLOCKED-ON-HOST (below).
- **Deviation-drain wave** — the audit residuals #2/#5/#7 re-ported onto
  v2.0.8 code (0.6.30): the v2 AssistantFooter + Locale.duration/number
  grammars (turn footers, width gates, interrupted suffix, 29.2K context
  labels), the FooterAction hint grammar (bold word first, subdued key,
  left/right space-between), the static ▪ running marker + "esc stop" busy
  status, and the conditional EditBody diff/patch branches on the
  permission card. See the deviation queue for the per-item truth.
  MAINTENANCE DEFECT FIXED in the 0.6.29 port: withLockSync assumed the
  locks/ parent dir exists — a cleaned config dir made every locked
  preference write throw ENOENT, which killed the model dialog's
  enter-select before closeDialog() (the 2026-09-19 harness B0 cascade on
  BOTH the wave and clean builds; the dir's existence had masked it since
  0.6.29). The parent is now ensured recursively once per lock call, the
  lock dir itself still non-recursive so EEXIST keeps signalling
  contention.

- **theme mode (0.6.32)** — the v2 context/theme.tsx machine ported:
  dual-arm themes-generated.ts (33 themes × dark+light, arm-cascade when
  upstream omits a light token — measured: zero cascades),
  themeModes/tokensFor/mdFor/diffFor resolution (a mode outside the
  document keeps the document's first mode, v2 loadTheme), mode+lock
  state with setMode=pin+persist / lock-unlock=pin-free, settings
  "Color mode" row (values system/dark/light, default system), theme
  persistence moved onto the 0.6.29 preference repository as
  state.json theme:{name,mode} with live cross-client sync. PTY TH-series:
  isolated-home settings drive + state.json pin proof + restart-restore.
  BLOCKED residuals recorded below (terminal-follow half).

- **session copy/export family (0.6.33)** — the "messages.copy residual"
  decoded against the pin: leader y already WAS the v2 semantic (Copy last
  assistant message — the residual was mislabeled). Shipped instead:
  session.copy (/copy + palette: the v2 formatSessionTranscript markdown —
  ## User / ## Shell / ## Assistant bodies, _Thinking:_ block behind the
  toggle, **Tool:** blocks with fenced json input, # title header with
  **Session ID:**/**Created:**/**Updated:** and --- separators — into the
  clipboard via OSC 52; the ported formatter + withTimestampedFallback live
  in src/tui/session/transcript.ts), session.copy.id (palette, keys none
  upstream), and session.export upgraded from the v1 editor-export to the
  v2 DialogExportOptions flow (leader x kept + /export: markdown radio,
  thinking/tools [x]/[ ] toggles, tab walk, Copy or tmp-file export and
  the DialogExportResult path dialog). json/sanitize arms BLOCKED-ON-HOST
  (no session/export verb; rows omitted, 0.6.31 Revert-row precedent).
  The keybind ledger carried a batch covered-lie on copy/copy.id — retired
  with per-row truth.

- **plugins dialog (0.6.34)** — the v2 feature-plugins/system/plugins.tsx
  select ported: /plugins + palette plugins.list, rows off plugins/list
  (live-measured payload: {id, name, version, enabled, components, …}),
  sorted by name; footer grammar verbatim (status word when not active,
  then the version — v2 displayVersion shortens a 40/64-hex pin to 7);
  enter toggles via plugins/setEnabled {pluginId, enabled} with the
  pending gutter mark, the success/error toast, and the row updated from
  the response. MAPPING NOTE: v2's toggle lives on its TUI-runtime arm
  (activate/deactivate of plugins embedded in the TUI process); our rows
  are server plugins with a server-side enabled flag — the only toggle
  plane the host offers, so v2's toggle semantic rides it. OMITTED per the
  Revert-row precedent: dialog.plugins.error/-check/-update (plugins/list
  carries no error or outdated fields — measured 0.6.34) and the ctrl+a
  internal-plugins toggle (no TUI-runtime arm in our architecture).
  REAL FIND: the coverage ledger's host-gap assumption on the whole
  plugins.* family was WRONG — the zcode protocol carries a full plugins
  verb family (SESSION_METHODS measured); only the error/outdated fields
  are missing.

## Deviation queue (past inventions to re-port onto v2 code — audit 2026-09-17)

1. ~~Tool-call rendering~~ RE-PORTED 0.6.21 (see Shipped) — the row now
   traces to routes/session/index.tsx; residuals: upstream mouse expansion
   adapted to ctrl+o (no mouse plane), background-shell output polling
   needs the zcode shell verb (renders from the part instead).
2. **Permission card** — header/labels ported 0.6.19 (△ Permission
   required / Allow once / Always allow / Reject, esc=Reject); the v2
   EditBody branches (routes/session/permission.tsx) ported 0.6.30 as
   CONDITIONAL renders: a `diff` payload → inline PatchDiff, a `patch`
   payload → subdued patch text. HOST GAP carried (the mcp error-field
   pattern): interaction/requestPermission inputs carry
   command/file_path/path/url only — no diff/patch body — so both branches
   are dead until the host grows the fields. Hidden y/a/n accelerators stay
   (invisible).
3. ~~Flash status line~~ CLOSED 0.6.21 — flashStatus is toast-only (the
   transient status-slot text was already invisible; lifecycle state still
   feeds the leader-s status summary).
4. **Home screen** — CORRECTED 0.6.26 (stale audit line): v2.0.7 home is
   logo + prompt + the home.footer status row (⊙ N MCP / plugins-failed /
   version) — there is NO session-destination recent-sessions front page
   upstream (grep-verified routes/home.tsx). The footer MCP half is ported
   (0.6.26); the plugins half has no plane here. ⚠ owner 2026-09-18: the
   zcodetui LOGO STAYS.
5. ~~Footer hint rows~~ RE-PORTED 0.6.30 — the diff found the rendering
   INVERTED: v2's FooterAction puts the WORD first in bold and the KEY
   after, subdued ("open enter"); ours had key-first with the word faint.
   SelectDialog now renders the v2 order with the space-between left/right
   groups (side: "right" plumbed; container keeps the card's established
   chrome padding — the v2 4/2 numbers are dialog-edge-relative and our
   cards predate them).
6. **Queue manager / timeline / sessions dialogs** — measured 0.6.30: v2.0.8
   has NO dialog-queue component (queued prompts surface only as the
   statusline work group "N pending"); our leader-q manager dialog is our
   own chrome around the queue model — recorded invention, pending owner's
   call. dialog-timeline.tsx EXISTS upstream and is still un-diffed (open).
   Sessions dialog: the hint row rides deviation 5's fix.
7. ~~Turn footers, context label, spinner~~ RE-PORTED 0.6.30 (v2.0.8
   verified): Locale.duration grammar (900ms / one-decimal seconds /
   Xm Ys / Xh Ym — the round-to-12s and bare-seconds forms retired), the
   AssistantFooter width gates (model hidden <28 cols, duration hidden in
   28-35), the subdued `· interrupted` suffix (stamped at session/stop),
   Locale.number context labels (29.2K — capital K, plain integers <1000),
   and the STATIC ▪ running marker (the braille animation was an
   invention; the busy status text is `{interruptLabel()} stop` → "esc
   stop", the invented "Working…" retired). Known adaptation kept: our
   tok/s denominator is the wall-clock turn duration (v2 sums per-step
   stream times; our protocol carries one final content payload — no step
   streams).
9. **OpenTUI reconciler remount (0.6.23 finding)** — a wrapper function
   component around SelectDialog is REMOUNTED by the reconciler on every App
   re-render (the 530ms cursor blink), resetting the wrapper's useState each
   tick; a DIRECT `<SelectDialog>` branch with App-level state (the sessions
   dialog shape) is stable. All three 0.6.23 dialogs render direct branches
   with App-level state (stashArm / skillsState / mcpState + one fetch
   effect keyed on `dialog`). Any future dialog MUST follow this shape.
10. **Stash dialog binding gaps (0.6.23)** — the destructive-arm colours use
    our C.error row bg (sessions-dialog precedent) rather than v2's
    background/text.action.destructive.focused pair (no such tokens in the
    33-theme port); disarm-on-move is approximated by arming at open and
    disarming after a delete or dialog close (SelectDialog's onHighlight
    re-fires per render, so it cannot carry move-edge semantics).
8. **Diff viewer binding gaps (0.6.20)** — opentui 0.5.11 has no mouse plane
   (the right-click file menu and hover states are omitted; upstream's tree
   is partly mouse-driven) and no renderer lifecycle passes (the
   dynamically-tinted top edge renders static context colour; file headers
   do not float while scrolling). Reviewed cards tint to the panel step (no
   surface.overlay — raised.high since the v2.0.8 rename — token in the
   33-theme port); image files show the
   no-patch notice (v2 previews image bytes); syntax highlighting rides the
   markdown SyntaxStyle (the tree-sitter filetype→language map was not
   ported, so per-language highlight fidelity may differ).

## Harness law (0.6.24 correction)

pty-proof stages that open dialogs (palette/slash flows) must NOT run
between the D-series' sessions-dialog reopen and the C-series'
enter-to-open — a staged dialog closes that dialog, the C-series enter then
hits the composer, and every downstream session stage fails. The 0.6.23
sitting mis-read exactly this as "environmental" (its control run shared
the same broken harness — circular evidence). The S/K/M + V/TG block now
lives after the session flow, just before kill(pid), where the whole
battery ran green (0.6.24). LAW: a control run only controls the BINARY
when both runs share the harness VERSION.

(0.6.30 correction) EVERY dialog-open needs a POLLED ready paint — never a
fixed settle. The B0 sessions-dialog open carried a fixed 1.5s and lost the
race on a cold/slowed daemon (2026-09-19): B + C + G + I + S cascade-failed
on BOTH the wave and clean builds, one day after the same harness ran green
twice. The B0/reopen/S-series opens now poll for the dialog chrome (the
ST0 pattern), and a poll timeout dumps the screen. The same sitting's
flock ENOENT defect (above) shows the flip side: an environment ACCIDENT
(the locks/ dir existing) can mask a real defect, and an environment
CHANGE (the dir cleaned) can manufacture fake failures — the control run
on the clean lane is what separates them.

- **Timeline / Fork / Message Actions** — SHIPPED 0.6.31: the v2.0.8
  routes/session/dialog-{timeline,message,fork}.tsx port. The timeline
  (leader g, `/timeline` — v2 "Jump to message") is the DialogSelect titled
  "Timeline": user prompts newest-first, full text with newlines flattened,
  Locale.time footer when the payload carries a created time; cursor moves
  live-jump the transcript (v2 onMove → jumpToMessage); enter opens
  DialogMessage ("Message Actions": Jump to / Copy / Fork — v2's Revert row
  omitted, it needs the session/revert host verb filed below). Copy is
  per-message OSC 52 (user text | assistant text parts joined with 
) —
  the partial drain of messages.copy (extended). `/fork` now opens v2's
  DialogFork ("Fork session": Full session row + user prompts, same live
  preview; fork-before then the forked-at prompt restores into the
  composer, upstream projectedPromptInput ≈ our plain-text draft); leader f
  keeps the immediate fork-at-tail (our chrome, pending owner like
  leader-q). Locale.time ported (toLocaleTimeString timeStyle short — Bun
  ICU renders `8:23 AM` verbatim).

## Stage microscope (0.6.38 — dream ACK-c4026a1ec6)

`tools/pty-proof.py BINARY --stage FAM [--dumps DIR]` runs boot-closure +
ONE family and exits with the FAMILY verdict — one harness spawn,
per-state-change pyte screen dumps (`sNNNN.txt` + `raw.bin` in DIR), and a
pid-scoped `~/.yggterm/cli-trace/zcode-tui.jsonl` tail on fail. The stage
bodies stay the SSOT: the runner only slices and execs the sections between
the `# ==== FAM:NAME [requires A, B] ====` marker comments; the no-arg full
run is untouched (the instrumentation is inert without the flags).

- Requires carry the VERIFIED state couplings and the runner execs them in
  file (full-run) order, so a family starts in exactly its full-run state.
  CSPINE is one unit for now (C/W/G/X/TL/I/Q/CX share the nested
  `if b0 and alive(pid):` block); split it into per-family sections the
  next time a family inside it needs the microscope — that is a data-only
  change (a marker + a dedent).
- STHEMES requires B + CSPINE even though it reads only `b0`: B alone
  leaves the sessions dialog OPEN, and STHEMES' first leader l would close
  it. The microscope must reproduce full-run STATE, not just variables —
  annotate requires from the exit state, not the globals read.
- Dumps fire on screen CHANGE (hash of the pyte display), capped at 999;
  RAW bytes land in `raw.bin` at teardown, and the teardown also kills any
  leftover harness even when a slice raises.
- Proof (2026-09-19, dev, dist at lane e0d3e70): `--stage H` (requires
  path + teardown + dumps), `--stage DF` (own-spawn path) 13/13, and
  `--stage PF` (the motivating case, one real turn) 5/5 with 69 dumps —
  verdicts agreeing with the full proof's series; full-run stability x2
  unchanged after the tooling change.

## Remaining (v2.0.8 → us)

- ~~opencode.settings~~ SHIPPED 0.6.27 (/settings): the DialogConfig surface
  — category groups, current value per row, ←/→ cycles + enter steps —
  mapped ONLY to our real setters (theme, animations, editor context,
  diff wrap, thinking, sidebar, mode, effort, tool output). The v2 rows
  without a plane here (scrollbar, markdown, TPS, permissions,
  notifications, sounds…) stay out rather than being invented.
- ~~dialog.select.page_up/page_down/home/end~~ SHIPPED 0.6.27 in
  SelectDialog (every dialog): pageup/pagedown move ±10 (v2's step), home/
  end jump; prev/next/submit were already wired.
- which-key.* (11 binds): v2.0.7 STUB — definitions only, no
  implementation in the vendored tree (grep-verified). Nothing to copy.

- ~~input.select.* (13 partials)~~ SHIPPED 0.6.25 — anchor-based selection
  on the hand-rolled composer: shift+left/right chars, shift+up/down VISUAL
  rows and alt+shift+a/e visual home/end over a new offset-carrying
  wrapRows() (byte-identical to wrapText), ctrl+shift+a/e logical line,
  shift+home/end buffer, alt+shift+b/f/left/right words, super+a all (v2's
  own default; PTY cannot send super — soft). Typed text/bursts/pastes
  REPLACE the selection (single funnel = insertAtCursor), backspace deletes
  it, pushUndo wired, any plain motion collapses. The Composer now renders
  cursor and highlight from the same mapped rows (fixing the old
  before/after-rewrap drift). PTY-proven by consumption (SL-series):
  highlight colours are invisible to the pyte text dump.

- ~~diff.* family (19 binds)~~ SHIPPED 0.6.20 (the last-turn SOURCE stays
  blocked below).
- ~~session.tab.* (16 binds)~~ SHIPPED 0.6.22. Residuals: the horizontal
  strip only (the vertical sidebar rail and the animation framework —
  springs/marquee/shimmer — are opentui-stack-bound), mouse drag reorder
  and the " + " add button are mouse-only upstream (no mouse plane here);
  ctrl+shift+t delivery is terminal-dependent.
- ~~**session.message.next/previous**~~ SHIPPED 0.6.24 — the walk
  generalized to all messages (`messageJump`), shipped as the four palette
  commands the reference uses (they are palette-only upstream too);
  alt+end last-user kept from 0.6.18.
- ~~**messages.copy (residual)**~~ RETIRED 0.6.33 — the bullet was a
  mislabel: v2 leader y copies the LAST ASSISTANT message (measured at
  routes/session/index.tsx:1043), which ours has done all along; the
  per-message Copy row shipped 0.6.31; what actually remained was the
  session copy/export family — SHIPPED 0.6.33 (see Shipped).
- ~~**stash family** — prompt_stash/pop/list + stash.delete dialog~~ SHIPPED
  0.6.23 (jsonl store `~/.config/zcode-tui/prompt-stash.jsonl`, MAX 50 with
  oldest-drop and sanitize-on-load; palette commands prompt.stash/.pop/.list
  verbatim; dialog-stash port with first-line preview, relative age, ~N
  lines footer and the ctrl+d two-stroke delete; restore = take-on-select).
- ~~**prompt.skills** — skills selector dialog~~ SHIPPED 0.6.23 (/skills +
  palette; name-padded rows, collapsed descriptions, loading/error/empty
  views verbatim; selecting inserts a plain `@name ` mention — the v2
  extmark decoration is composer-internal and not portable). Disabled
  catalog skills stay hidden (the runtime would not run them).
- ~~**mcp.list / dialog-mcp** — MCP server list dialog~~ SHIPPED 0.6.23
  (/mcps + palette; sorted by name, status grammar verbatim: Connecting … ·
  Connected ✓ · Failed ! · Sign in required → · Disabled ○, reference
  colours). HOST GAPS recorded: the zcode protocol exposes mcp/list
  ({statuses:{name:{status,transport,toolCount,updatedAt,protocolEra}}},
  measured live 0.6.23) but NO mcp connect/disconnect verbs (the v2 space
  toggle → dialog.mcp.toggle is blocked-on-host) and the status payload
  carries no error text (the enter-to-error detail view has no data
  source). skills/referenceCatalog measured live same sitting:
  {authority, skills:[{id,name,description,path,scope,enabled}]}.
- **session.ops deep** — BLOCKED-ON-HOST (measured 0.6.24): session/list
  carries no parentSessionId (child/parent navigation has no data source),
  and the protocol has no share or workspace-move verbs
  (dialog.move_session.* with it). queued_prompt.delete SHIPPED 0.6.24
  (ctrl+d in the queue dialog; v2's enter=steer needs a mid-turn injection
  verb the protocol lacks — `-32010` on send-while-running — so our
  enter=remove stays).
- ~~**display toggles** (the v2.0.7 app.toggle.* surface)~~ SHIPPED 0.6.24:
  animations (ours = the cursor blink, the TUI's one animation),
  file_context (gates the @files popup), diffwrap (PatchDiff wrapMode
  char|none via DiffPreferences.wrap) — all persisted in state.json.
  paste_summary is a DEVIATION, not a port: v2 renders compact paste
  summaries through composer paste spans; our draft is plain text.
- ~~**theme mode**~~ SHIPPED 0.6.32 — both arms (the upstream
  theme:{token:{dark,light}} documents, dual-arm generator regen; the
  0.6.26 "assets carry no light/dark variants" note was true for v2.0.7
  and false for this pin), the v2 mode machine (lock = config theme.mode
  dark|light; mode = lock ?? dark — no terminal plane here), setMode
  pins+persists, the settings "Color mode" row (system/dark/light,
  v2 dialog-config verbatim), theme rides state.json theme:{name,mode}
  (the config.theme voice; legacy flat file = read-only fallback).
  theme.switch_mode / theme.mode.lock stay palette-hidden + keybind-none
  exactly as upstream stocks them.
- **panes + embedded terminal** — pane.focus.left/right, terminal.select/
  toggle/close, composer.terminal.*, dialog-shell-output. New v2 surface.
- **composer.subagent.* / composer.shell.*** — subagent & shell prompt
  switchers. New v2 surface.
- ~~**permission.prompt.fullscreen**~~ SHIPPED 0.6.36 (see Shipped) — the
  expanded ask arm is ours: ctrl+f toggle, full-viewport overlay,
  minimize-first escape, footer hint grammar.
- ~~**misc dialogs**~~ TRIAGED 0.6.34, the line dissolved into truth:
  - **plugins.*** SHIPPED 0.6.34 (see Shipped).
  - **experiments** — DEVTOOLS-ONLY upstream (opened from the v2 devtools
    bar, devtools-bar.tsx:433 — no palette/slash command) and the
    experiments[] array is EMPTY at v2.0.8; dev-facing, nothing to port.
  - **integration** — the dialog IS provider.connect (app.tsx "Connect an
    integration", /connect): OWNER NON-PARITY by the 2026-09-17 law.
  - **config** — dialog-config = opencode.settings, SHIPPED 0.6.27.
  - **debug (opencode.debug, app.debug, app.console, dialog-debug)** —
    v2 devtools surfaces; dev-facing, nothing to port.
  - **pair / server.pair** — already ledger-blocked (desktop-shell verb).
  - **workspaces + dialog.move_session.*** — already blocked-host (0.6.24).
  - **service.restart** — already ledger-blocked (desktop-shell verb).
  - **session.cd / session.background** — moved to Blocked-on-host below
    (their coverage rows were batch covered-lies; retired 0.6.34).
  - **update / worktree-name / open (projects+worktrees arms)** — moved
    to Blocked-on-host below.
  - **error-details** — the v2 DialogErrorDetails component rides dialogs
    whose payloads carry error text (plugins failures, mcp errors); both
    zcode payloads (plugins/list, mcp/list) carry no error field, so the
    surface has no data source — filed with the plugins row, returns when
    a host payload grows error text.
- ~~selection grammar~~ — STALE BULLET RETIRED 0.6.31: the input.select.*
  scope (shift selections, visual line ops, buffer home/end, select.all)
  SHIPPED 0.6.25 (see its entry above); this 0.6.10 note survived its own
  supersession and pointed backwards.

- **theme terminal-follow (v2 renderer plane)** — unlocked modes in v2
  follow the terminal: renderer.themeMode, the THEME_MODE render event,
  the OSC palette probe (getPalette + the 997;1n/2n notification) and the
  generated "system" pseudo-theme (generateSystem/tint math over
  TerminalColors). Our PTY stack has no TerminalColors source, so an
  unlocked mode holds its current value (their own renderer-less
  fallback is dark). Needs a terminal-colors plane on the host or an
  OSC 10/11 query+parse in our input loop.
## Blocked on a zcode HOST VERB (file with the zcode host, not the TUI)

- **session.undo / session.redo** — v2 = server-side session.revert
  stage/clear; zcode has fork-at-message only (timeline). Needs
  `session/revert` (stage/clear) in the app-server. The 0.6.31 Message
  Actions dialog omits v2's Revert row for this same gap.
- **diff last-turn source** — needs a session-diff verb (v2: client.session.
  diff). Git/branch sources ship TUI-side.
- **session.rename** — needs session/title update verb (long-standing).
- **session.export JSON arm** — v2 json/sanitize export rides
  client.api.session.export({sessionID, sanitize}); the zcode protocol has
  no session/export verb (measured against the types.ts verb table,
  0.6.33). The export dialog omits the json radio and its sanitize toggle
  until the verb exists; the markdown arm is local and shipped.
- **/btw side question (session.aside, v2.0.8)** — needs a one-shot
  session-scoped generate verb (v2: client.session.generate — runs no tool
  loop, answers from session context in a dialog; our protocol has
  workspace/generateText only, not session-context). The v2.0.8
  subagent-notice click-to-open-child rides the SAME parent-linkage gap
  already filed below (payload carries no childID), and upstream opens it
  by mouse regardless (no mouse plane here).
- **session.background** — v2 "Background blocking tools" rides
  client.api.session.background({sessionID}); SESSION_METHODS has no
  session/background verb (measured 0.6.34 — the coverage row had been a
  batch covered-lie under the core-ops note).
- **session.cd** — v2 "Change working directory" (/cd) rides
  client.api.session.move({sessionID, directory}) + location.get;
  SESSION_METHODS has neither (measured 0.6.34 — same covered-lie).
- **opencode.update / dialog-update** — v2 stocks the command ONLY when an
  updater exists (app.tsx gates it on updater.open) and rides its own
  UpdateSource/install/restart machine; the zcode stack has no updater or
  self-update plane (the TUI is npm-distributed, the backend is the host
  daemon). No dialog to port while no updater exists — upstream itself
  omits the surface.
- **worktree-name / dialog.worktree.generate** — v2's worktree-session
  creation flow (name-a-worktree prompt) needs host worktree verbs
  (server-side git worktree + session move into it); SESSION_METHODS has
  none (0.6.34).
- **open.menu projects/worktrees arms** — v2's Open menu (ctrl+o) lists
  projects (location/file listing) and worktrees per project from the
  server; the zcode protocol has no location/project/worktree listing
  verbs (0.6.34). The recent-sessions arm is already ours (session.list).

## Maintenance law

Owner directive 2026-09-17: after EVERY UX iteration, re-write the Remaining
section to the truth (move lines to Shipped with the wave version, re-pull
upstream when it releases) — continue until this file's Remaining is empty
(modulo the non-parities and host-verb blocks).

- Unit 4: the paste pipeline follows the reference enqueuePaste/pasteInputText
  contract (`prompt/index.tsx` 373–390, 1428–1475): every paste serializes on
  one queue, and changed() — captured at dequeue — drops a paste whose
  composer moved underneath it across the async resolution boundary. The
  predicate reads unmount, dialog/permission/diff input ownership, session
  switch, typing flip, draft edits, and unflushed burst bytes (this
  binding's keystroke coalescer stands in for the reference's synchronous
  key insertion, so pending burst bytes count as movement). Two defects the
  drafted tests exposed: typed-while-resolving appended the paste text
  AFTER the typed bytes (the old `!resolved` branch inserted
  unconditionally — the common non-attachment case inverted user order),
  and two pastes could resolve out of event order (no serialization). A
  gated pasteResolver prop (mirroring the existing preferences injection)
  makes the race deterministic in tests. Three App interaction tests in
  paste-queue.test.tsx pin drop-on-change, queue serialization, and the
  unedited landing path — all failed before and pass after; full suite
  273/273 across 31 files, typecheck exit 0, no-TTY boot renders home
  composer + `⊙ 5 MCP` before the intentional timeout.

- Unit 5: attachment-rich prompt history follows the reference
  prompt/history.tsx PromptInfo store — a submission with parts records its
  folded composer form (paste labels in the text, full sources riding in
  the parts; attachment labels backed by tray parts carrying uri/mime/name,
  bytes never persisted outside the data: uri), so Up/Down recall restores
  the folds and the tray (`restoreExtmarksFromPrompt`'s contract; the
  store swap is wholesale, and index 0 is the fresh empty composer).
  Adjacent-only dedupe is full-entry JSON equality, not text alone. Rich
  entries persist to `prompt-history.jsonl` under the TUI state dir
  (50-entry bound, self-healing rewrite, the reference's exact parse law:
  text:string + pasted:array) and lead the boot seed over the shared
  store's plain texts (mergeSeed; a plain text a rich entry already covers
  by exact text does not list twice). Three App interaction tests — folded
  recall + full-expansion resubmit round-trip, attachment recall
  re-uploading the same bytes through the stubbed begin/chunk/commit
  family, and restart persistence through the sidecar — all three failed
  against the parent wiring and pass after; eight module tests. Full suite
  284/284 across 33 files, typecheck exit 0, no-TTY boot renders home
  before the intentional timeout. Deviation recorded: entries submitted
  from other surfaces (the CLI) recall as flat text — their expansion into
  folds cannot be recovered from the shared store.

- Unit 6 (sitting 6): submit failure rollback follows the reference
  fail/restoreEntry contract (`prompt/index.tsx` submitInner): a failed
  attachment upload or a rejected session/send rolls the optimistic
  transcript rows back (the user echo and the placeholder assistant row are
  held by identity, so the rollback removes exactly those two rows even if
  unrelated rows land in between), reports the error as an error-variant
  toast (the reference's toast.show, not a sticky status line), and
  submitPrompt restores the composer entry — draft text, paste folds and
  attachment tray refs — with the cursor back at the end, unless the user
  already typed something new (the reference's `input.plainText !== ""`
  guard reads our draftRef). The typing re-arm respects dialog/diff
  ownership: a surface that opened over the composer mid-upload keeps its
  input grab. The history entry stays on failure, matching the reference
  (history.append precedes the send gates there too). Three App interaction
  tests in submit-rollback.test.tsx pin upload-failure rollback + restore,
  send-failure rollback + restore, and the typed-during-failure guard —
  all three failed against the parent wiring (red2 log; the first red log
  caught a stub-ordering artifact and was superseded) and pass after. Full
  suite 287/287 across 34 files, typecheck exit 0, boot renders home
  composer + `⊙ 5 MCP` before the intentional timeout.

- Unit 7 (sitting 6): queued prompts follow the reference queue delivery —
  submitInner expands the tracked pastes BEFORE the delivery split, so the
  queue entry now carries the folded composer form (queue-time draft plus
  its alive paste/file parts) and the pump expands before send and records
  the folded rich history entry exactly like a direct submit. Before, a
  prompt queued mid-turn sent the literal fold label to the host (the
  pasted content never reached the session) and recorded a flat plain
  entry. Second defect the drafted test exposed: the enqueue path cleared
  the draft without submitPrompt's cursor reset, so the next Up read a
  stale offset and moved the caret instead of reaching prompt history.
  send() now consumes exactly the parts it carries (a pump send no longer
  wipes attachments attached to the composer after queueing; a direct
  submit's set is unchanged — all alive parts). The queued-row preview and
  the /queue dialog read the entry's text. One App interaction test in
  queue-expansion.test.tsx pins expansion-at-send + folded recall — red
  against the parent (the host received the literal `[Pasted ~N lines]`
  label, red2 log; the first red log caught the test's own expected-order
  mistake and was superseded) and green after. Full suite 288/288 across
  35 files, typecheck exit 0, boot renders home composer + `⊙ 5 MCP`
  before the intentional timeout.

- Unit 8 (sitting 7): picker rows follow the reference Option law
  (`ui/dialog-select.tsx`), verified against GROUND-TRUTH frames rendered
  from the reference's own Solid test harness (`captureCharFrame` at
  100x30/80x24/60x20 — the reference checkout got a frozen `bun install`,
  HEAD unchanged, node_modules gitignored). The title caps at a FIXED 61
  CHARACTERS (`Locale.truncate`, "…" on the cap) regardless of row width —
  the invented 65%-ratio split is gone; the description joins with a
  SINGLE space and the pair hard-clips at the row's usable width
  (dialogWidth - 12 - status cell, the reference `contentWidth` grammar)
  WITHOUT an ellipsis marker, split back into title/description text nodes
  at the clip boundary so the description keeps its subdued colour;
  selected rows render bold like the reference Option. Group headers now
  share the title column (card + 4 — the old `paddingLeft` on `<text>` was
  silently dropped by the renderer, headers sat at card + 1), and empty
  lists use the reference default views ("No results found" when a filter
  is set, "No items available" otherwise) at the title column instead of
  the invented "No matching items". Four frame-based regression tests in
  select-dialog.test.tsx (61-cap on a wide row, single-space join +
  silent clip, header/title column equality, both default views) failed
  before and pass after; one inherited test's literal updated to the
  ported default. Full suite 292/292 across 35 files, typecheck exit 0,
  live smoke renders home composer + `⊙ 5 MCP`, no-TTY boot exit 124 at
  the intentional timeout. Reference frames kept outside the repo under
  /tmp/zq-ux-parity/ref-dialog-*.txt.

- Unit 9 (sitting 8): the composer autocomplete popup follows the reference
  Autocomplete treatment (`component/prompt/autocomplete.tsx` 873-951 +
  `ui/select-controller.ts` + the `prompt.autocomplete.*` keybind law).
  Geometry: the popup is now the reference overlay — absolutely positioned,
  bottom-anchored to the top edge of the whole [attachment strip + composer]
  block (the reference's prompt-body anchor; yoga `bottom: "100%"` gives the
  reference's `anchor.y - height` with no height arithmetic), SplitBorder
  `┃` walls in `border.default`, `background.default` inside, zIndex 100 —
  flow rows no longer shift while it is open (the old in-flow block pushed
  the composer down / squeezed the transcript). Row grammar: pad 1 both
  sides; name `text.default`, selected row on `background.action.primary.
  focused` + `text.action.primary.focused` (the C.accent/C.accentText
  mapping sitting 7 pinned for the pickers); descriptions join with a
  LEADING SPACE, subdued, `wrapMode="none"`, no invented cap. Command names
  align to (longest "/display" + 2) across the FULL command+alias set
  (`SLASH_PAD`, the reference pads in its commands memo), replacing the
  fixed 12-column pad. Empty states per trigger — "No matching commands" /
  "No matching files, agents, or references" — replace the invented generic
  "No matching items" line and render while the trigger is active; per the
  reference keybind layer the popup owns return/tab/arrows at zero matches,
  so return no longer submits a draft whose unmatched slash token is
  showing and tab no longer indexes into empty match lists. Trigger law
  ported from `prompt/display.ts` (`triggerToken`): prefix at draft start or
  after whitespace, whitespace-free query, a slash query may not carry a
  second slash — mid-path text ("bin/ls") and addresses ("a@b.c") no longer
  open the popup, fixing a live incoherence where the render side popped
  mid-text ("abc/ses") while the keyboard handler ignored it. Navigation
  wraps (moveSelection "wrap") and the window reveals at the edges
  (revealSelectionOffset, App-held sugWin state — wrapper state does not
  survive the reconciler remount), replacing the recentering window; @file
  rows truncate with the reference `truncateMiddle` at width − 4. The
  dismissal law was audited and left as-is: the printable/backspace resets
  already implement the reference dismissedValue reopen-on-text-change.
  Deviations (ledger): no space-above-anchor clamp (the reference caps the
  popup at the anchor's absolute y — joins the short-terminal leftover);
  our startsWith matcher retained (the reference's fuzzysort keys + prefix
  doubling + frecency ranking is a separate leftover); no mouse
  select/hover on rows yet (keyboard-driven, like the sitting-5
  exploration deviation). Four App interaction tests in
  autocomplete.test.tsx (empty-message popup + return swallow + escape
  release, mid-text no-popup + raw submit, edge reveal, wrap-to-last) and
  three component frame tests in autocomplete-popup.test.tsx (walls + pad +
  full-set alignment + leading-space description, both empty messages at
  the row pad) — all four interaction tests fail against the parent
  (red log /tmp/zq-ux-parity/sitting-8-red.log; the module also fails to
  load on the missing SlashPopup export) and pass after. Full suite
  298/298 across 37 files, typecheck exit 0, live smoke exit 0 (home
  composer + `⊙ 5 MCP`), and a scratch frame probe of the live home view
  shows the popup in situ (10 windowed rows, aligned columns, composer
  block unmoved). Board: infra/meta ACK-09d199007d (plan).

- Unit 10 (sitting 8): partial assistant text streams THROUGH the markdown
  component, like the reference TextPart
  (`streaming={time.completed === undefined}`, message-parts.tsx 147-174).
  The inherited streaming branch predated the parity campaign and painted
  a plain `text` row — raw ATX heading markers and unclosed code fences
  showed verbatim while the answer typed, and the completion swap from
  plain text to markdown re-flowed the tail. The streaming branch now uses
  the same markdown block as the completed branch (breakLongTokens +
  mdStyle + internalBlockMode "top-level" + grid tables + conceal), so the
  streaming view IS the final view modulo growing content; the "…"
  placeholder survives for a tail turn with no text and no thinking. The
  completed branch keeps its inherited `streaming={true}` (proven on
  opentui 0.5.11; the reference's time-based flag is the same visual
  result on full content — noted, not copied). Two App interaction tests
  in stream-markdown.test.tsx (placeholder → concealed heading; partial
  fence renders as a block without raw backticks) fail against the parent
  (red log /tmp/zq-ux-parity/sitting-8-unit2-red.log) and pass after.
  Full suite 300/300 across 38 files, typecheck exit 0, live smoke exit 0.

- Unit 11 (sitting 8): inline tool rows follow the reference
  InlineToolRow spinner + children law (message-parts.tsx 176-253 + the
  per-tool call sites). A call site that passes `spinner` runs with its
  CHILDREN under the spinner glyph — "⠋ Read /path", "⠋ <Subagent
  title>", "⠋ <generic summary>" — while one that does not (Write, Glob,
  Grep, WebFetch) keeps the pending label; our inlineRow always showed
  the pending label, so a running Read read "Reading file…" where the
  reference reads "⠋ Read /path". Read's "↳ Loaded <path>" rows render
  unconditionally (the reference has no expansion gate; our ctrl+o gate
  is dropped, column 6 kept). A running subagent shows its title under
  the spinner with the reference model suffix — subagentModelLabel ported
  (provider/model#variant → "provider/model (variant)"; the registry
  display-name resolution stays an adapter note, ToolPart has no model
  registry; the ↳ continuation icon is also an adapter note — the zcode
  protocol has no subagent-continuation input). Skill quotes its
  resolved name (metadata.name ?? input.id). Question's answered-block
  and WebSearch's "via <provider>" affordance stay adaptations (our
  protocol carries neither answers arrays nor the retry animation).
  Six ToolPart frame tests in tool-rows.test.tsx; red against the parent
  at module level (missing subagentModelLabel export — the row law had no
  exported unit; log /tmp/zq-ux-parity/sitting-8-unit3-red.log), green
  after. Full suite 306/306 across 39 files, typecheck exit 0, live
  smoke exit 0.

- Unit 12 (sitting 8): edit blocks take the reference Edit display laws
  (routes/session/index.tsx Edit): SPLIT diff view above 120 columns
  (editDiffView ports the auto default; the diffs.view config override
  stays a viewer-side adaptation), filetype(path) passed to the PatchDiff
  for syntax-tinted diff lines, and the diff sits in the reference's
  paddingLeft 1 inset inside the block. Ours hardcoded unified at every
  width with no filetype and no inset. Two law tests + a frame test
  distinguishing a side-by-side one-line replacement at 130 columns from
  the stacked unified rows at 80 (tool-rows.test.tsx); red against the
  parent at module level (missing editDiffView export; log
  /tmp/zq-ux-parity/sitting-8-unit4-red.log), green after. Full suite
  308/308 across 39 files, typecheck exit 0, live smoke exit 0.

- Unit 13 (sitting 9): write blocks take the reference Write body law
  (routes/session/index.tsx Write completed branch): the FULL content —
  no truncation — through the reference treatment, a line-number gutter
  (text.subdued, minWidth 3, paddingRight 1) wrapping the syntax code
  element (conceal off, text.default, filetype of the path), then the
  metadata diagnostics error rows. parseDiagnostics ported verbatim
  (index.tsx 3669): the diagnostics record keyed by file path, severity 1
  only, line+character+message required, capped at 3, rendered as
  "Error [line:column] message" in the error colour (the per-platform
  path normalization stays an adaptation — identity on this linux-only
  binding). The inherited body was a plain-text 12-line slice with no
  gutter and no diagnostics. filetypeOf now reads the reference
  util/filetype.ts grammar table verbatim — javascript/javascriptreact/
  typescriptreact collapse to "typescript", unmatched files read "none"
  — so the code element's tree-sitter lookup sees the grammar names the
  reference registers (the naive lowercase extension fed it "ts", which
  selects no grammar). ToolPart's syntaxStyle prop is typed SyntaxStyle
  (was unknown). One inherited diff.test literal moved to the ported
  contract. Two frame tests + two helper tests in write-block.test.tsx;
  red against the parent BEHAVIORALLY (both frame tests timed out — no
  "line 30" through the 12-line slice, no diagnostics rows — plus the
  filetypeOf literal; parseDiagnostics passed in isolation; log
  /tmp/zq-ux-parity/sitting-9-red.log), green after (sitting-9-after.log).
  Full suite 312/312 across 40 files, typecheck exit 0, live smoke
  exit 0.

- Unit 14 (sitting 9): shell blocks take the reference ShellDisplay
  running law (routes/session/index.tsx ShellDisplay): while RUNNING
  the command rides a bare spinner-glyph row (glyph + command, gap 1)
  with the "$ " prefix withheld; any settled state carries "$ " again
  (the inherited gate was `completed`, which also swallowed the
  reference's streaming/pending "$ " marker); the collapse budget loses
  2 columns only while running (was any loading status); expansion
  wraps word (was char). The reference shells put the marker in
  columns 5-6 of the block and the command text at 7 in EVERY state.
  Fixed on the way: blockTool's title/path spinner wiring was a ternary
  that DROPPED the glyph (spinnerPrefix ? stripped : plain) — it now
  prepends the glyph to the "# "-stripped label like the reference
  Spinner wrapping (index.tsx BlockToolContent), so a commandless
  running shell reads "⠋ Writing command…" and a pending edit spins
  its title. transcript-columns' live tool-row assertion moves to the
  ported geometry (border 2, marker columns 5-6, command text 7): the
  App's spinner is turn-scoped, so the synthetic frame after end_turn
  carries an empty glyph slot — documented in the test. Three frame
  tests in shell-block.test.tsx; red against the parent BEHAVIORALLY
  (running-spinner row + commandless-title assertions; log
  /tmp/zq-ux-parity/sitting-9-shell-red.log), green after. Full suite
  315/315 across 41 files on re-run (one known cross-file
  dialog-focus flake in the first pass — isolation + re-run clean,
  sitting-5 unit 3 precedent), typecheck exit 0, live smoke exit 0.

- Unit 15 (sitting 10): assistant turns take the reference error/retry
  footer law (routes/session/index.tsx AssistantFooter 1934-1985 +
  AssistantRetry 2418-2444 + routes/session/rows.ts 325-329). A
  terminal-by-error turn renders the `Error: <message>` row in the error
  colour; a retrying turn renders the countdown warning row (`⚠ Retrying
  in Ns · attempt N · <message>` while the retry timestamp is ahead,
  `⚠ Retry due` at zero, once-per-second tick ported); the footer head
  turns subdued under an error; and the footer row itself renders on
  terminal-by-error turns even without metrics (rows.ts: terminal =
  finish || message.error; the footer row is pushed when terminal ||
  retry — the metrics-less errored turn reads the head alone). A "Step
  interrupted" error suppresses the error row and rides the footer
  suffix. The error/retry rows each carry the SessionRowView row gap
  (paddingTop 1, sitting-5 rhythm law) and the reference's conditional
  footer marginTop 1 IS the flattened footer's own gap, so the metrics
  row keeps paddingTop 1. partsToTurns extracts info.error/info.retry
  (util/error.ts message law: error.message -> error.data.message ->
  String). The inherited transcript dropped message-level errors
  entirely — a failed turn was invisible. Presentation only: the rows
  render when the backend info carries the fields, never otherwise. Five
  frame tests + three extraction tests in turn-error.test.tsx; 7 red
  against parent 9f280a4 (behavioral — the rows/fields do not exist;
  log /tmp/zq-ux-parity/sitting-10-red.log), green after
  (sitting-10-after.log). Full suite 323/323 across 42 files, typecheck
  exit 0, live smoke exit 0.

- Unit 16 (sitting 10): resumed sessions take the reference footer
  projection law (routes/session/rows.ts 325-351 + turnDuration 353). The
  projection pushes an assistant-footer row for EVERY terminal assistant
  message — finish set and not tool-calls/unknown — and the footer
  duration is TURN-SCOPED: time.completed minus the turn input's
  time.created (the message's own created time when no input precedes).
  The live backend payload carries finish and time.completed on resumed
  messages (verified against a real session/resume dump 2026-10-26:
  per-step assistant messages with finish tool-calls on middle steps,
  end_turn on the last, tokens {input,output,reasoning,cache}), so
  partsToTurns extracts finish/completedAt and the new attachTurnMetrics
  stamps the turn-scoped duration on terminal steps at resume time.
  Throughput needs every step's time.streamed, which the payload does
  not carry — turnTokensPerSecond returns undefined without it, so
  resumed footers read `Build · model · <duration>` with no tok/s,
  matching the reference. The inherited resume path derived no metrics,
  so reopened sessions rendered no footers at all. Live turns untouched
  (finish is never set on the live path). Four extraction/metrics tests
  + one App frame test in resume-footer.test.tsx; module-level red
  against parent 351e001 (missing attachTurnMetrics export; log
  /tmp/zq-ux-parity/sitting-10-unit2-red.log), green after. Full suite
  328/328 across 43 files, typecheck exit 0, live smoke exit 0.

- Unit 17 (sitting 10): inline tool rows take the reference status
  details (routes/session/index.tsx, pinned v2ref). Glob/Grep gate the
  count segment on Solid <Show> — truthy on finiteNumber — so a zero
  count hides it entirely (the inherited row rendered "(0 matches)");
  Read's "↳ Loaded" rows settle on the completed status only (the
  reference returns [] until state.status === "completed"; the inherited
  row rendered them whenever metadata carried the list, even mid-run);
  GenericTool pretty-prints non-string input values with
  JSON.stringify(value, null, 2) in the expanded detail (the inherited
  detail emitted compact JSON). Three frame tests + two positive
  controls in inline-details.test.tsx; 4 red BEHAVIORALLY against
  parent 6c51392 via a targeted stash of tool-parts.tsx (the first red
  pass had two test-side defects — a wrong settle needle that ignored
  the sitting-8 spinner law, and an m literal missing the tool field —
  superseded by sitting-10-unit3-red2.log), green after. Full suite
  334/334 across 44 files, typecheck exit 0, live smoke exit 0.

- Unit 18 (sitting 11): completed turns take the reference turn-usage row
  law (routes/session/rows.ts turn-usage flush + cacheReuseDrop +
  hasTokenUsage/tokenTotal, routes/session/index.tsx TurnTokenUsage
  1484-1628, pinned v2ref). partsToTurns extracts info.tokens and the
  usage model identity (the payload carries {input,output,reasoning,
  cache:{read,write}} and model {providerId,modelId} — dump-verified
  2026-10-26 and re-verified this sitting); the new src/tui/turn-usage.tsx
  ports the legacy flush (steps accumulate until a terminal step — finish
  terminal or errored; the flush filters to token-bearing steps; a turn
  with none produces no row and leaves the cross-turn cache baseline
  untouched) and renders the reference row: subdued
  `+ Tokens: N steps · X new · Y cached · Z total` with a warning
  ` · ! N likely cache bust(s)` suffix, hover brightens to text.default,
  click (selection-guarded) expands the per-step table — Step padded past
  the widest label, bold right-aligned New, two-space gutters, the
  verbose-mode tool rows (primary key first, scalars in entry order) and
  the per-step `! Likely cache bust: N fewer cached tokens than the
  previous step` line. The row anchors on the terminal message id, or the
  last trailing tool row's call id when the terminal step's own tool rows
  trail it in the flat stream — the drafted walk dropped those tools
  (flush cleared pending before the trailing rows arrived) and anchored
  the usage row ahead of them; the reference order is part rows → footer
  → usage. The gate is debug.turn_tokens (false | true | "verbose") in
  state.json; the reference toggles it in its DevTools bar, which we do
  not port — ours is one settings-dialog row cycling off → on → verbose
  (ledgered adaptation). Rows compute over the whole history (the
  reference reduces every message, so the cache baseline spans
  scrolled-out turns) and the LIVE event path stays without rows: our
  session/event voice carries usage {inputTokens,outputTokens,...} on the
  stopReason event, not info.tokens — when the protocol surfaces the
  info shape live, the same extraction lights the rows up. Fifteen law
  tests in turn-usage.test.ts + three extraction tests and four
  gate/frame tests in turn-usage-frame.test.tsx; 5 red against parent
  e57d354 via a targeted stash of app.tsx + model-preference.ts
  (behavioral: missing extraction + no gated row; the negative control
  passes; log /tmp/zq-ux-parity/sitting-11-red.log), green after. Full
  suite 361/361 across 46 files, typecheck exit 0, live smoke exit 0.
