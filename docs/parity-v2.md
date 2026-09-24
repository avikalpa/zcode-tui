# opencode v2 parity ledger

## ★ PRIME DOCTRINE (owner, 2026-09-17 23:34 — supersedes all earlier UX invention)

**COPY opencode v2 (latest stable code) instead of inventing ANY UX. ONLY the
wiring — adapting v2's surfaces to the zcode protocol/backend — is our
intelligent work. This file is the doc spec.** Every surface must trace to a
v2 source file (component structure, labels, colors, key behavior); where we
shipped an invention in the past, it is a DEVIATION to be fixed, not a
feature to keep. Audit pass 2026-09-17 filed the known deviations below
(Deviation queue). The non-parities (model allowlist, provider_connect)
remain the only exceptions.

**Reference:** opencode **v2.0.10** (stable; repo renamed sst → anomalyco, 2026-09) — VENDORED in-repo at
`tools/opencode-reference/` (pinned by `tools/sync-opencode.sh <tag>`;
MIT, never compiled into our binary). The sync toolchain makes a parity
wave a diff job: `parity-report.py --map/--stale/--gaps`,
`gen-keybinds.py` (the 241-bind registry + machine-refreshed gap report in
`docs/parity-keybinds.md`), `gen-themes.py` (reads the pin). Ported files
carry a grep-able header (`Ported from opencode <version> <ref path>`) —
the port map IS the headers. Update the ledger AFTER EVERY WAVE — a line
moves from Remaining to Shipped only with the wave version that shipped it.

Non-parities BY OWNER LAW (never copy): model allowlist, provider_connect /
console_org, and the zcodetui wordmark on the home screen (owner 2026-09-18:
"Our home screen zcodetui logo stays btw" — a v2 session-destination home
ports AROUND the logo, never over it).

## Shipped (1:1 unless noted)

- **the models dialog onto the menu grammar** SHIPPED 0.6.54 — the first of
  the small-wave dialog migrations. Reference component/dialog-model.tsx:
  sections verbatim (Favorites; Recent minus favorites; the rest grouped by
  provider name), rows through the SelectDialog menu path, title "Select
  model". The rest-sort adopts the NEUTRAL parts of their sortModelOptions
  (provider-name locale-compare, then title); their house-provider boost
  (opencode/opencode-go first) and the release-date key have no honest
  analog or data here and are skipped, and the "Free" footer needs cost
  data the zcode catalog does not expose. SHARED BEHAVIOR ported with it:
  the reference flatten (dialog-select.tsx) — a non-empty query collapses
  every grouped dialog to one flat list, no headers, no spacers. The
  invented star/recent row metas are RETIRED (deviation-drain): favorites
  wear the upstream "(Favorite)" description (the one noted delta: their
  grouped Favorites rows omit the mark; ours keep it so the mark survives
  the collapsed filter view), recent membership is carried by the Recent
  header. ctrl+f favorite, enter select, and the setModel wiring are
  unchanged; the builder is src/tui/model-dialog.ts + 8 unit checks.
  SKIPPED and recorded: the "Connect an integration" action row (our
  provider_connect plane is the 0.6.34 integration dialog — a follow-on
  wave if the owner wants the link from this dialog), fuzzysort (its own
  Remaining line).

- **the transcript-render family, slice 1 (model layer)** SHIPPED
  0.6.53 — the framework-free core of upstream's #48489/#50930/#50936
  rework, ported verbatim from the v2.0.16 reference and UNWIRED by
  design: grouping/tree.ts (groupEntries/mergeGroups/splitGroups),
  grouping/session.ts (SessionEntry/SessionNode/SessionGroup,
  projectEntries/append/completePrevious/groupRefs/partitionPending/
  hasPart; one wiring seam — CacheUsage.model typed unknown until slice
  2's rows layer re-homes it), anchors.ts (AnchorTarget/anchorKey/
  entryRef/groupID/containsAnchor/createTimelineAnchors), mount-budget.ts
  (rowWeight/rowsBefore/rowsAfter — #50936), grouping/history.ts
  (completeGroupBoundary — #50930's pure async core, re-homed from
  rows.ts until the render rework gives it its rows home). Tests
  verbatim with re-homed imports: anchors + mount-budget + history,
  14 checks. Tool-name note: partPath's exploration class matches
  ["read","glob","grep"] via toLowerCase — our Read/Glob/Grep group
  correctly verbatim; Bash/Edit-class stay ungrouped, upstream
  semantics preserved. No runtime wiring, no render change; slice 2
  (the React translation of group-view/anchor-view + the app
  integration + the rows store) remains the open half in Remaining.
- **the subagent tab strip** SHIPPED 0.6.52 — the R39-audit line, landed
  as the UI half of the HOST's session/subagents verb (live-probed
  2026-09-25, tools/subagents-probe.ts: params { sessionId }; payload
  { revision, childSessionIds, running: [{ childSessionId, agentId,
  toolCallId, subagentType, title, startedAt, status }], ended:
  { total, items: [...the same + summary, endedAt] } }; status
  vocabulary measured running|success). THE PORT: src/tui/session/
  subagents.ts maps the payload (success->completed, cancelled kept,
  unmeasured->error conservatively; host title -> label, summary ->
  inspector body, subagentType -> the picker row's secondary slot; the
  upstream display formula description||title||label verbatim). The
  PICKER is RunSubagentSelectBody on the SelectDialog menu grammar — tab
  toggles running vs not-running through the new onExtraKey hook
  (reference onKey in their searchable-panel controller), footerHints
  carry the toggle + inspect, empty state "No subagents found". The
  INSPECTOR is RunFooterSubagentBody's header plane (statusColor/
  statusIcon verbatim including the mono fallbacks * - ! ., the i-of-n
  count cell, footerMenuText budget) rendered above the composer; esc
  back, tab cycles all tabs with wrap. OPENS via session.child.first —
  down on an EMPTY single-line draft when tabs exist (the only spot the
  history walk below is a no-op); the 0.6.24 blocked-host note is
  SUPERSEDED (the child tree has its own verb), coverage: first covered
  with member evidence, child.next/previous partial (the inspector tab
  cycle carries the semantic, the right/left keys are unbound). The
  footer hint row gains "down N subs" (the contextHintCandidates entry).
  MEASURED HOST GAPS (filed in Blocked-on-host, not invented around):
  session/messages + session/read on a child id fail "Session is not
  active" (tools/subagents-child-gap-probe.ts) — no child-transcript
  navigation, the body renders the host summary or the upstream empty
  state; per-child interrupt unverified, so the interrupt hint stays
  unrendered (upstream renders it only when the binding exists). No new
  PTY stage: the surface needs a live subagent turn in-proof (dream
  filed for a dedicated probe stage); 16 unit checks pin the mapping,
  the picker filter, the label strings, and the glyphs.

- **the theme-v2 default-theme plane** SHIPPED 0.6.51 — upstream's live
  default theme is the v2 document (theme/assets/v2/opencode.json),
  resolved at runtime by their @opencode/theme package; we baked the v1
  assets/opencode.json. The port: tools/sync-opencode.sh now also
  vendors the engine source verbatim (packages/theme/src/tui ->
  tools/opencode-reference/theme-pkg/), and tools/resolve-theme-v2.ts
  runs it VERBATIM under bun at build time (parseThemeDocument ->
  resolveThemeDocument per mode; effect 4.0.0-rc.112 devDependency,
  build-time only) to emit tools/theme-v2-opencode.json; gen-themes.py
  merges it as the "opencode" theme in both arms. Every token read
  cites upstream: map() in the reference mini/theme.ts (bg/fg/subtle/
  borders/feedback colors; accent = hue.interactive[200], the doc's own
  $selected action ref; user = categorical[0][200] — the live app tints
  agent identities from the categorical cycle, slot 0 is Build;
  selected = formfield.selected) and the v1->v2 correspondence
  (v1-migrate.ts) for panel/surface/borderActive/assistant; faint takes
  hue.neutral[500] — the doc's mid neutral — because the v1
  borderSubtle has no v2 successor (the one judgment row, recorded).
  MEASURED DELTA vs the v1 bake: exactly two tokens — faint dark
  #3c3c3c->#4c4c4c, light #d4d4d4->#bebebe; every other token
  (18+19+12 x 2 arms) the v1 asset already carries the v2 document's
  values (upstream keeps the v1 opencode.json in lockstep). The win is
  the ENGINE: from this pin on, every re-pin re-resolves the default
  through upstream's own code, so v2-doc drift flows into the bake
  automatically instead of riding a hand-synced v1 shadow. New pins in
  design.test.ts (accent/user/faint, both arms). No user-custom theme
  documents exist in this tree (the legacy flat theme-id file only), so
  v2 custom-document PARSING stays unported — recorded, not a gap.

- **the v2.0.16 re-pin (maintenance law, fourth live fire)** SHIPPED
  0.6.50 — upstream released v2.0.12..v2.0.16 in the three days after
  R39's recon (28 TUI commits, 34 files, +1146/-581). The vendored
  reference is re-pinned (tools/sync-opencode.sh v2.0.16, explicit
  tag); generators refreshed: the keybind surface is UNCHANGED (241
  binds, coverage 162/49/22/1/7, lint 0 lies) and the baked theme arms
  are unchanged (the generator consumes the v1 assets/*.json, which did
  not move — the v2 default-theme drift is its own Remaining wave).
  Ports landed:
  - **/clear split (session.clear, #50524)** — upstream split "new
    session" from a new "clear session" command: /clear closes the
    ACTIVE tab (recorded to the closed stack) and lands on the front
    page; /new keeps creating. Ours: the one command registry
    (design.ts SLASH_COMMANDS + union), the dispatcher arm, the palette
    row. The model/effort/mode survive (ours are app-level; upstream
    re-sets them across the route change).
  - **errorMessage family (#50778/#50783)** — upstream util/error.ts
    errorMessage/errorFormat ported (src/tui/error.ts; isRecord
    inlined, cliErrorMessage left upstream-side): Error.message ->
    Error.name -> record.message -> record.data.message -> String ->
    errorFormat — the fix for user-visible surfaces printing a bare
    "[object Object]" for structured API failures. All 21 ad-hoc
    `instanceof Error ? …` sites in app.tsx ride it now. 7 unit checks.
  Dispositions (no plane in this tree, truth-recorded): copy-session-ID
  from the tab context menu (#50181) — the FUNCTION is at parity (the
  session.copy.id palette row since 0.6.33), the tab CONTEXT MENU stays
  in the strip's ledgered mouse-affordance deviation; export complete
  transcript (#50733) — parity by construction (our resume loads the
  FULL message list; upstream's bug was formatting from their loaded
  window); turn-token latest-step summary (#50765), execute-details
  click (#50921), MCPFailed removal (#50958), Mini exit aliases
  (#50388), /btw resize (#50392), MCP sidebar persist (#50447), renderer
  listener budget (#50442), update-command description (#50687),
  canonical projects + worktrees-out (#50674/#50612), composer import
  cycle (#50637), verbosity levels (net-reverted upstream; survives
  only in their mini mode, which we do not port).

- ~~**settings dialog truncated hints**~~ FIXED 0.6.45 — SelectDialog's row
  budget gave the label column `cardWidth - 10` (78 of 88 cols in large
  dialogs), starving every description to `max(8, 2)` = 8 chars ("color
  s…", "dark mo…" — the owner's modal complaint, relay dogfood). The label
  column now fits the longest label+meta actually present, capped at
  cardWidth - 18; descriptions get the remainder (≈58 cols in large).
  Fixes every SelectDialog with descriptions, not just settings.

- ~~**permission.ask payload layout**~~ FIXED 0.6.44 — the ask card's payload
  (`ask.detail`, the Bash command) rendered INSIDE the height-1 title row with
  space-between justification, so long commands overran the "△ Permission
  required" header (surfaced by the relay dogfood: "more ugly not in opencode
  UX"). v2's header row is TITLE-ONLY; the payload now lives in a body box
  under the tool meta (wrapMode word, maxHeight 10 collapsed, lifting when
  expanded like the diff/patch arms).
- ~~**agent mode at startup**~~ SHIPPED 0.6.44 — `zcode-tui --mode
  <plan|build|edit|yolo|auto>` (the owner's "run it like opencode2 --auto"):
  the mode rides session/create (replacing the hardcoded build), applies to
  the launch-resumed session via session/setMode, and the footer badge shows
  it. Relay sessions can now spawn straight into yolo (no permission asks).
  Proven by the pty-proof YM family (own spawn, the PF Write-bait: no ask
  paints, the file lands, the badge reads Yolo through the turn).

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
  upstream). Tabs are in-memory for the TUI lifetime. v2.0.10 hue swap
  PORTED 0.6.43: unread/attention take hue.accent, running takes
  hue.interactive (upstream swapped the two roles in component/
  session-tabs.tsx + mini/theme.ts; ours rides the C.accent/C.warning
  adaptation — see the port header).
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

### 0.6.39 — the v2.0.9 re-pin (maintenance law, zero parity delta)

Upstream shipped v2.0.9 the morning after our pin (first release past it);
re-pinned via `tools/sync-opencode.sh v2.0.9` (dev checkout already tracks
anomalyco/opencode — the sst rename needs no in-repo URL surgery; the
vendored README already says "anomalyco mirror"). Recon of the 81-file
packages/tui diff: it is the THEME-SURFACE API refactor — tokens rename
(`.default` → `.base` everywhere, `text.subdued` → `muted`, status colors →
hue tokens), `useTheme()` loses the context overload, component themes go
mode-less (`createComponentTheme(tokens)`), dialog theming centralizes into
`ui/dialog.tsx` (`ThemeContextProvider context="dialog"`) with a cached
`theme.surface(name)` accessor, terminalPalette/context-local hardcode the
dark hues, and the upstream source of the "opencode" theme moves to a
NEW v2-schema `assets/v2/opencode.json` (the v1 asset is still shipped and
unchanged; palette anchors match — our v1-sourced generated arms stay
correct). The only behavioral deltas live in surfaces we never ported (btw
answers now render markdown via plugins.markdown; dialog-error-details
loses its FRAME-measure scroll machinery; form review-height rework) or
are internal re-expressions (StatusBadge raised? + theme.decrease,
BlockToolContent merged into BlockTool — the hover pre-existed). Keybinds:
241 binds, counts IDENTICAL to 0.6.38, lint clean (0 lies, 0 warnings).
Zero runtime delta beyond generated-file stamps — NO ynpm ride.

- Gates (2026-09-19, dev, dist at lane ee9714a+pin): typecheck clean;
  110+1known (the auth-sync red re-verified on the stashed clean tree);
  full proof 114+9F then 118+5F — F0 persistent + the documented X2/CX/S
  timing class, run 2 a strict subset of run 1 (the release-gate shape).
- REAL FIND (environment, not the wave): S1 (jump-to-latest affordance)
  failed ISOLATED `--stage STHEMES` runs on BOTH this binary AND the
  untouched v0.6.38 release binary (bisected via a throwaway-worktree
  build) — while `--stage CSPINE` went green 68/0 on a quiet re-run. The
  dev host session catalog reached 100 entries today; the class degrades
  with host load. NEXT SITTING: re-needle S1 per the poll law (its
  affordance check is the frailest in the battery) and consider catalog
  weight (the proof seeds real sessions on dev).

### 0.6.40 — the proof re-needle (0.6.39's environmental find, zero parity delta)

Three changes, all in `tools/pty-proof.py` (the battery, not the TUI):

- **LEAK GUARD** — `sweep_stale_instances()` at run start, stage teardown
  and the full-run epilogue: `/proc/<pid>/exe` exact-binary matching (never
  cmdline — the path rides argv there) kills leftover instances of the
  exact worktree-dist binary, plus orphaned `zcode-cli` backends (comm
  match, reparented to ppid 1) that spin at 100% CPU for hours after their
  TUI dies. An earlier sitting leaked five worktree-dist TUIs that burned
  the host for hours — the "degrades with host load" flake class was
  partly the proof's OWN orphans. Owner rows run from the ynpm generation
  path, never a worktree dist, so the sweep cannot touch them (veto law
  holds; measured live: the ynpm-generation row on dev survived every
  sweep this sitting).
- **S-series re-homed onto a transcript the PROOF OWNS** — the fossil
  "/themes" session the family rode aged out of the 100-capped host
  catalog (the 0.6.39 root cause: search hit "No matching items", enter
  fell through to a short session, nothing to scroll). The family now
  grows its own >1-page transcript in the throwaway: a 40-line
  bracketed-paste filler (one atomic insert, under the 4096-byte tty
  buf), send, poll the echo paint, esc-interrupt with re-arms at poll
  windows 6/20/40 (the first escape can land before running=true), poll
  quiescent. No new session seeded — the catalog-growth rate is
  unchanged, and the family no longer depends on catalog state at all.
- **S1 re-needled per the poll law** — the affordance paint LAGS the
  scroll render under a heavy catalog (microscope evidence: the scrolled
  frame runs 2-3 state-changes ahead of the affordance frame), so the
  single fixed sample at first-scroll becomes a polled window.
  Composer-empty verified before the filler turn (SE law) with ctrl+c and
  the /home palette as fallbacks; every enter is poll-gated (a blind
  enter on a leftover draft sends a real message).

Gates (2026-09-19, dev, dist at lane 7df0735+needle): typecheck clean;
110+1known (the documented auth-sync red); `--stage STHEMES` isolated
PASS x4 consecutive (11 checks) after one pre-needle FAIL; full proof
125+1F (F0 only — the cleanest full run on record) then 122+4F (F0 + the
documented X2/CX timing class, green in run 1); S-series green in both
full runs; the leak guard reaped one self-leaked instance per run at
teardown. Tools-only wave — NO ynpm ride, hosts stay on their rides.

### 0.6.41 — the sync-opencode default-ref trap fix (tools-only, zero parity delta)

The maintenance law's natural invocation is a bare `tools/sync-opencode.sh`,
but the script's default ref was the `v2ref` branch in the upstream checkout —
created from v2.0.6 and never advanced — so the natural invocation would have
SILENTLY DOWNGRADED the vendored reference two releases behind the v2.0.9 pin
(found in the 2026-09-19 maintenance sweep; dream ACK-93ca56afa0). Two layers
now:

- the default ref resolves to the NEWEST `v2.*` tag in the upstream checkout
  (`git tag --sort=-v:refname`) — the maintenance law's own target; with no
  `v2.*` tag the script refuses instead of guessing;
- a backwards guard refuses a default-path pin whose base version is OLDER
  than the current `tools/opencode-reference/VERSION` (base compare via
  `sort -V`, `git describe` suffixes stripped; same-tag re-pins stay legal) —
  the explicit-ref path still downgrades deliberately.

- Gates (2026-09-19, dev): guard predicate checked for the trap pair
  (v2.0.6 default vs v2.0.9 pin → refuse) and the pass cases (v2.0.10
  default vs v2.0.9 pin, equal bases → proceed); default path run live on
  the pinned tree — resolves v2.0.9, idempotent, the reference tree stays
  `git status`-clean. Tools-only wave — NO ynpm ride.

### 0.6.43 — the v2.0.10 re-pin (maintenance law, SECOND live fire — the strip hue swap)

Live ls-remote probe (2026-09-19) found v2.0.10 past our v2.0.9 pin; bare
`tools/sync-opencode.sh` run (the 0.6.41 guard path) resolved v2.0.10
(b8cedc1a) cleanly. The v2.0.9→v2.0.10 delta is ONE semantic change — the
HUE SWAP — repeated across three files: unread/attention move from
hue.interactive to hue.accent and running moves from hue.accent to
hue.interactive (component/session-tabs.tsx ×3 sites, feature-plugins/
prompt/btw.tsx spinner, mini/theme.ts running/question/permission map).
Ported onto the ONE of our files that tracks it: src/tui/session/
session-tabs.tsx (busy spinner → C.warning, unread dot + ! ? attention →
C.accent; unread-error stays C.error) — through the C.accent=hue.accent /
C.warning=hue.interactive token adaptation the 0.6.22 port established;
header re-stamped v2.0.10. No /btw port exists (registry row only);
storybook fixtures are dev-facing upstream; gen-themes map does not
consume mini/theme.ts. Generators re-run: 241 binds, coverage identical
(162/49/22/1/7), keybinds/themes deltas are version stamps only.
which-key.* re-verified v2.0.10 — still definitions-only. Runtime delta
is real (strip colours) → full gates; NO ynpm ride (post-release host
convention: rides are owner-directed; 0.6.43 offered from the lane tip).

### 0.6.46 — the plan-quota surface (fork (b) resolved live — TUI-owned)

The owner directive (2026-09-20: show the Z.AI Coding Plan quota, usage
and weekly quota left) had a design fork: (a) a host verb vs (b) the TUI
calling the Z.AI endpoints with the synced coding-plan key. RESOLVED by
probe: the synced key authenticates the desktop's own monitor plane —
api.z.ai/api/monitor/usage/quota/limit (envelope {code,msg,data};
data.limits[] rows {type, unit, number, usage=denominator,
currentValue=consumed, remaining, percentage, nextResetTime};
data.level; live: 5-hour 1063/12000 8% + weekly 47172/60000 78%, level
pro) and api.z.ai/api/biz/subscription/list (VALID rows carry
productName/valid/nextRenewTime/autoRenew — GLM Coding Pro, renews
2026-11-27). The desktop's quota plumbing (buildZaiQuotaUrl /
buildBigModelQuotaUrl, zcodejwttoken/oauth credentials, 15s timeouts)
was decoded from app.asar as the MAP, not the dependency: the TUI goes
straight to the endpoint with its own key. /api/v1/coding-plan/reset
404s on GET — not needed.

Shipped: src/tui/planQuota.ts (fetch/parse/format, fail-soft, key never
renders or logs); the Status dialog (leader s) gains the PLAN QUOTA
section — plan row, per-window bar rows (bar / percent / used / total /
resets-in), and the usage/stats 7d summary line; the fetch fires on
dialog open only (mirrors the mcp/list pattern) and every failure
branch paints an honest fallback line (no key synced, HTTP error,
network failure). StatusDialog stays STATELESS and props-only — state
lives in App beside mcpState (remount hazard law).

STALE-NOTE REPAIR (stale-doc law): the seat door's React-hazard note
claimed StatusDialog/HelpDialog/DiffHelpDialog are "still nested-in-App"
— FALSE since the thin-App split (App ends at its compose; all three
dialogs are module top-level, verified this sitting). The LAW stands
(state in App, dialogs props-only); the stale nesting claim is
corrected here and in the seat door.

Proof: ST2 (PLAN QUOTA paints) + ST3 (resolves to data or an honest
fallback line — every branch paints) added to the ST family;
planQuota.test.ts unit-covers the parsers and formatters against the
live fixtures.

### 0.6.47 — the v2.0.11 re-pin (maintenance law, third live fire)

Upstream released v2.0.11 past the v2.0.10 pin; the bare sync-opencode.sh
default path re-vendored cleanly (the 0.6.41 guard active). The delta is
mostly desktop/core churn; the TUI surface is four commits:

- PORTED — the autocomplete row rework (#50008 muted label text + #48551
  label mention options) onto our SlashPopup: the fixed padEnd(12) name
  column is gone; the display truncates MIDDLE to the popup budget
  (truncateMiddle, the v2 Locale helper shape) and never overflows the
  row; the description collapses whitespace, takes one leading space and
  flexes (flexShrink + wrapMode none). N/A on our surface: the
  right-aligned kind labels (skill/agent/reference) — our popup lists
  slash commands and @cwd files only, and v2 file options carry no kind
  either; the MCP-resources removal — we never listed MCP resources in
  the popup.
- N/A — #50037 question-form border token: no FormPrompt surface on our
  dialog-era TUI (and zero hue.interactive token uses in our tree).
- N/A — #49962 session-scoped plugin toasts (retitle + Open action for a
  non-focused session): our toast host is the single-slot
  message+variant overlay with no router and no session navigation; the
  capability folds into the sessions-view footer-menu port line below.

TH NEEDLE REPAIR (the 0.6.46 handoff): TH4 (theme first-cycle) failed
IDENTICALLY on a clean binary — root cause: the needle window read the
Color mode row HINT text ("dark mode / light mode / system theme"), so
the light-absence half failed on every binary while TH3/TH5/TH7 were
false-green on the same hint. All TH value asserts now read the VALUE
token (the meta between the double-space separators); TH4 also proves
the pin on disk (state.json theme.mode == dark — the TH6 consumption
shape) and the cycle polls instead of fixed-settling.

GATES, HONEST LEDGER: typecheck clean; bun 123 pass + the auth-sync red
reproduced on the stashed clean lane this sitting (documented
pre-existing); gen-keybinds regen stamp-only drift (v2.0.11 headers,
241 binds, coverage identical 162/49/22/1/7); gen-themes stamp-only;
lint 0 lies. Full runs on the 0.6.47 binary: 123/8, 121/11, 123/9 —
every fail F0 (documented) or in the documented load-escalated
X2/CX/S/PG/TG/TB rotating class, and every red family is green in
another run on the SAME binary (CX green run 3; PG/TG/scroll green
run 4; TB/stash green run 2); dev load 5.4-8.2 throughout (the
documented escalation condition). TH 8/8 green in ALL runs — the
needle repair is proven.

THE ZOMBIE-STORE FINDING (0.6.47, tools-only hardening shipped same
wave): the proof's own PF throwaway sessions are UNREMOVABLE (the
session/close host-verb gap — 14+ pf636 rows, session/close answers
"Session is not active"), and an interrupted turn's PENDING permission
ask survives in the store: resuming that session REPAINTS the ask card
and every later keystroke feeds the card, not the composer. Measured:
a pf636 card hijacked the C-spine into X2/CX fails on a HEALTHY binary
(control run: the clean 0.6.46 binary failed X2/CX5 on the same store
minutes later; direct probes showed the port rendering correctly).
This is the R34 burial debt biting the proof itself. Hardening shipped:
(1) a de-zombifier at C-1 — dismiss OUR OWN leftover cards only
(payload must carry the proof scope; a foreign ask is never touched,
named instead) using the PF3 esc grammar; (2) a PF teardown witness —
poll until no card paints for two consecutive windows before the kill,
so new runs stop minting zombies. New harness law: a fail cluster in
ASK-CARD-adjacent checks is store poisoning until the dumps prove
otherwise — never a regression signal on its own.

### 0.6.48 — the session-picker grammar (v2 select-controller + picker behaviors)

The sitting itself has a story worth keeping: the wave was started by a seat
(zcode sess_431a246e) that died mid-gate — sources frozen 02:23 IST, its last
proof run finishing 05:59, no OUTCOME. The next seat (sess_094dc2e5) found
the wave INTACT and coherent, posted a TAKEOVER claim (infra/meta
ACK-0073d0760c), and drove it home. The swarm lesson: a wave is in the
worktree, not in the transcript — a dead seat with a clean diff is a
handoff, not a loss.

PORTED — src/tui/select-controller.ts, the verbatim reference
ui/select-controller.ts (reconcileSelection, moveSelection with the
dialog.select.prev/next policy wrap, revealSelectionOffset, moveSelectionOffset
margin scroll, reconcileSelectionWindow) + unit checks. SelectDialog now rides
it: moves wrap at the ends; the row window scrolls with the reference reveal
margin (the center-slice heuristic is gone); display rows include the group
headers and their spacers (a window counts real rows, like the reference
scrollbox); the empty and no-match states split (v2 emptyView vs noMatchView —
the empty list speaks the reference "No items available",
dialog-select.tsx:690); an onMove hook fires on user-driven moves only
(reference moveTo path). SelectDialog gains emptyLabel/noMatchLabel.

SESSIONS PICKER BEHAVIORS — pinned sessions lead in their own Pinned
category, the rest group under date headings; the gutter digit is now the
session OPEN-TAB slot (leader N opens tab N — v2.0.7 session.tab.select), not
a positional index (the positional gutter was a deadlock invention — the
digit showed a key that did nothing for that row); the quick-switch footer
hint renders only while tabs exist (v2 quickSwitchFooterHints); moving the
selection clears the armed delete (onMove); the empty state reads "No
sessions available". This is the PICKER-GRAMMAR slice of the sessions-view
line; the footer-menu PRIMITIVE port (mini/footer.menu.tsx categorized
surface + tab strip) remains the top open line below.

DREAM SWEEP ACK-9e5105d7b0 (the 0.6.47 handoff, tools-only): _palette_run
now polls the open paint (the titled Commands dialog), the pick row VISIBLE
before enter (typed-command law), and the close — fixed settles missed picks
under dev load and collapsed S1-S3 while S4 passed vacuously. S0-S2 re-needled
as polls; S4s needle is POSITIVE and dialog-scoped (the titled Stash dialog
plus its own empty line) — "No matching items" alone is the shared empty text
of palette/SlashPopup/SelectDialog and passed vacuously when the pick missed
and no dialog was open at all. B2/B4 re-needled for the conditional hint
grammar (no tabs, no switch hint, no slot gutters); TB6 added (with a tab
open the dialog wears the tab-slot gutter and the switch hint). poll_paint
lifted above its first user (was duplicated mid-file).

CX-PRE NEEDLE REPAIR (found on the resumed gates): the /copy and /export
popup checks asserted typed-text-plus-no-placeholder — vacuous, because the
"Ask anything" placeholder disappears on ANY typed text regardless of popup;
every late-run popup miss passed CX-pre and surfaced only as an unexplained
CX5 red. The hardened needle FIRST guessed the palette label ("Copy session
transcript") and stayed red — until the fail-screen microscope (the PF3
pattern: print the screen tail on fail) showed the popup OPEN AND CORRECT,
rendering the design.ts SLASH-table summary row ("/copy copy the session
transcript to the clipboard"): the popup renders the summary, never the
palette label. Final needles read the summary rows (copy/export the session
transcript), /export with 14 rounds — the fat-session paint needs the margin
(41.7K of context by CX time). The /export fail screen also caught the
pf636 ask-card debt painting at the composer — the R37 zombie-store debt
biting the proof, unchanged, and now photographed.

I-SERIES TURN WITNESS (the PF-teardown law applied to the spine): after I0,
the proof now polls the busy footer gone (esc stop renders only while
running) and denies retries of our own proof-scoped ask, the PF way — the
interrupt PAINT can outrun the wind-down, and a still-busy spine gates the
slash popup and leader routes so CX fails in a bundle (observed: CX red,
SKM green minutes later). The witness NOTEs whatever held the spine.

GATES, HONEST LEDGER: typecheck clean; bun 138 pass + the auth-sync red
stash-verified pre-existing on the clean lane; generators stamp-only
(coverage unchanged 162/49/22/1/7, lint 0 lies). The BINARY is one build
of the final sources throughout; the HARNESS evolved during the sitting
(the CX needle repair below) and only post-correction full runs carry
weight: run 9 = 108 pass (S/TB/stash/K/M/PG/V/TG and the AT families
load-flaked together — every one green in run 10), run 10 = 130 pass /
3 fail, the best full run of the campaign week: CX-pre /export + CX5 red
on the pf636 zombie-debt card photographed at the composer (green in run
9), F0 documented-persistent. CX-pre /copy AND /export green in run 9,
/copy green again in run 10. CSPINE isolation green in 4 of 6 executions
today — the two red isolations are what caught the vacuous needle and the
wrong-shaped replacement. Every red family is green in >=1 full run on
this binary; the fails live in the documented rotating load class (dev
load 5.5-8.7, the escalation condition), F0, and the pf636 debt.


### 0.6.49 — the footer-menu primitive (the sessions surface rebuilt on it)

The top open line after 0.6.48 was the categorized paint. mini/footer.menu.tsx
is ported 1:1 as src/tui/footer-menu.tsx: footerMenuText over grapheme-true
takeWidth/truncateWidth (mono dots vs the ellipsis), buildMenuRows (a header
per category change, a spacer before every group but the first, compact drops
both — including the last-seen-category subtlety: an uncategorized row between
two same-category rows does NOT re-trigger the header), useFooterMenuState
(clamp moves — the footer-menu policy, dialogs wrap at their own layer —
reveal/margin windows, the reconcile effect), and the FooterMenu renderer:
grouped and flat windows, the description column aligned at the longest
display + 2, the footer cell with selection|running|error|success tones
(current+selection suppresses the cell; toned rows keep a short primary cell
over the icon), compact-width clamps at 40 columns, the ▌/| border gutter and
INVERSE mono highlight. Theme mapping (RunFooterTheme → ThemeTokens):
shade→surface, muted→subtle, actionFocusedBg→accent,
actionFocusedText→accentText, formfieldText→fg, running→accent (the
interactive hue), success/error as named. 14 new unit checks.

THE SESSIONS SURFACE REBUILT ON IT — SelectDialog grows a `menu` paint path;
the engine is untouched (filter, wrap moves, margin windows, onMove, actions,
hints row), and the legacy dialog-select rows stay for the surfaces not yet
migrated. Session rows become menu items: the gutter column is now the menu
icon cell (busy spinner, else the session's OPEN-TAB slot — the digit still
is what leader N does); the CURRENT session marks itself with the menu footer
cell ("current" in the selection tone, suppressed while the row is selected —
the reference agent-panel pattern replaces the old ● gutter donation); the
armed delete keeps its destructive background and confirm label — v2's own
dialog-session-list bg field, the ONE field the menu grammar gains (sourced
from the reference, not invented). Pinned/date headers ride the menu's
muted-bold header grammar.

CARRY-OVER AUDIT (the SSOT line): the count range row is DROPPED on the menu
path (the reference panels count in the frame as count/total, never a range;
the menu windows internally). meta appends to the display when a menu surface
needs it (mapping in SelectDialog). The legacy status cell (the MCP dialog's
Connected ✓) is the footer cell's predecessor — its migration rides the wave
that moves the remaining dialogs (models, agents, settings, stash, config,
MCP) onto the menu grammar; this wave deliberately touches ONLY the sessions
surface so the D/S/TB/CSPINE needles on the legacy paint stay honest.

TAB-STRIP AUDIT (PROBE LAW): the subagent tab strip has a PROTOCOL PLANE and
no TUI wiring — sessionSubagents ("session/subagents") sits in
SESSION_METHODS with zero call sites (grep-verified 2026-09-21). The
reference surface (RunSubagentSelectBody + RunFooterSubagentBody) is portable
once the payload is live-probed (plugins-probe pattern, idempotent reads
only). Filed as its own follow-up wave; nothing invented this sitting.

GATES, HONEST LEDGER: typecheck clean; bun 151 pass + the documented
auth-sync red (the same red R38 stash-verified pre-existing on this lane
tip; this diff touches no auth file); generators stamp-only — coverage
unchanged 162/49/22/1/7, lint 0 lies. PTY: full run 1 = 129 pass / 4 fail
(scroll S1, K0/K1, F0); full run 2 (load 11.6) = 127/6 (S1, stash S3/S4,
K0/K1, F0 — the red set ROTATES; run 1's stash was green); isolations on
the same binary: ST 4/4, SKM 9/9 (K green), CSPINE-2 green except
CX-pre/CX5 — and the CX dumps show the popup rendering CORRECTLY with the
pf636 zombie ask card painting over the composer stealing enter (the R38
photographed host-gap debt again, not a regression; CX is green in full
run 1). TB6/B0 green in both full runs — the menu-painted sessions dialog
carries the tab-slot gutter and the switch hint in the PTY. The reds are
keystroke/paint-latency checks under dev load far past the escalation line
(45-47 with a pegged foreign python3 core). WAVE-LAW LOOP: five full runs
rotated the red set while every family but S1-scroll landed its green
(run 1 129/4, run 2 127/6, attempts 1-3 125/8, 130/3, 129/4; isolations ST
4/4 and SKM 9/9). S1-scroll stayed red in ALL five — decisive, and a
HARNESS defect, not a code one: the 0.6.39 poll window (15×0.7s ≈ 10.5s)
is sized for a thin isolation session; the fat full-run transcript paints
the affordance late (the CX-pre fat-session lesson in scroll form; the
stage's own re-needle comment predicted it). The window doubled to 30
rounds (harness-only commit; no assertion weakened — the needle still
requires the affordance to APPEAR) and run 6 went 130 PASS / 3 FAIL
(S1-scroll GREEN; matching R38's best full run of the week) with only the
pf636 CX pair (green in runs 1/2/attempt-2 — the photographed host-gap
debt) and documented-persistent F0 red. EVERY red family is green in >=1
full run on this binary; the law is closed.


### 0.6.55 — the transcript-render refactor, slice 2 (the render half: rows, groups, anchors WIRED)

Slice 1 landed the grouping model unwired; slice 2 wires the transcript to
it. The app transcript now renders SessionRows from reduceSessionRows — the
rows layer ported from upstream rows.ts (the reducer plus the footer helpers
turnDuration/turnTokensPerSecond/cacheReuseDrop/messageBoundaryIDs/
sessionRowID/resolvePart) — fed by the RAW host records: the app keeps a raw
mirror (setRawMsgs) patched at EVERY event site right beside the flat
TurnMessage patch, same payload, adjacent lines. The flat list stays the
copy/export/stream voice byte-for-byte; the rows derive from the mirror.

The data boundary is the port's one adaptation surface (grammar upstream's,
wiring ours): normalizeRawMessage lifts our {info, parts} records onto the
shape the reducer walks (tool part ids ride the host callID; text/reasoning
parts take content-order ordinals like upstream); terminality reads
completed-or-error because our records carry no finish field — in our store
the record's completed time IS the turn boundary; inputs pass empty (no
queued-delivery plane) and permission partitioning runs on an empty set;
turn_tokens passes false (upstream's debug gate). Consequence, measured: the
assistant-footer row now emits for RESUMED history too (upstream parity —
the flat model only ever footed the just-finished live turn), computed by
upstream's turnDuration grammar from record times.

THE RENDER SURFACES — src/tui/session/group-view.tsx translates
group-view.tsx 1:1 where the stack allows: reasoning groups collapse to
"Thought: {title} · N steps · {duration}" (upstream's running-title memo via
ref; the +N-ms alpha drop renders as plain warning), exploration groups to
"Explored — N searches" (toolDisplay counts, grep/glob fold into "search");
children recurse through the same walker (thought mode = the muted
left-border body — our plain-text voice; tool mode = ToolPart rows); pending
entries render inside the group. src/tui/session/anchor-view.tsx translates
anchor-view: EntryAnchor/GroupAnchor register mounted renderables into a
timeline-anchors registry (module singleton — keys are session-unique,
destroyed nodes filter; upstream's ctx-per-session isolation to the same
effect). The InlineToolRow port and reasoningSummary port ride along. Slice
1's ONE declared wiring seam is filled: CacheUsage.model is typed (ModelRef).

EXPANSION (#48489): per-group state keyed by upstream's groupID formula
(JSON[first ref, kind, level]), in-memory for the TUI lifetime; the
keyboard adapter EVOLVES — ctrl+o now cycles collapsed → groups open →
groups + tool outputs open → collapsed (upstream expands by mouse only; our
ledgered deviation queue 1 adapter gains the group plane without a new
keybind — the keybind surface is UNCHANGED, 241 binds).

NAVIGATION: messageJump walks transcript ROWS through upstream's
messageBoundaryIDs dedupe (one jump target per message); jumpToMessage
prefers the timeline anchor's exact geometry (timelineAnchors.forMessage)
with the positional child math as fallback; the DialogTimeline onMove
preview resolves ids over boundaries. The scroll window counts ROWS.

MEASURED GRAMMAR DELTAS vs the flat voice: the static "+ Thought · Ns" faint
line is REPLACED by the live group header (spinner while running, title from
reasoningSummary, expandable body); read/glob/grep tool runs fold into one
exploration summary row instead of N sibling rows; assistant text FOLLOWING
tool rows within a turn is no longer dropped (the flat tail-append no-oped
on a tool tail — the row model keeps content order, upstream's grammar);
footers render their own row. Everything else keeps the v2.0.7-era pixel
voice (row spacing stays internal paddingTop, not upstream's marginTop).

GATES: typecheck clean; bun 203 pass + the documented auth-sync red (clean
tip verified 189+1 in a seat-private worktree; +7 this wave's rows.test.ts
reducer checks; +7 from an UNCLAIMED seat's models-dialog test file present
untracked on the shared floor — excluded from this commit, see the infra/meta
hail of this sitting); gen-keybinds stamp-only (241 binds, 163/3/49/19/7),
lint 0 lies; PTY on dist md5 7cf8bd72 — TWO gated full runs (mutex vs the R45 launcher,
load-window law): run 1 (load 10.88) 123/9 {S2-scroll, stash S1-S4, TG0,
TG1, F0}; run 2 (load 10.77) 130/3 {CX-pre/CX5, F0} — the accepted closing
state exactly; every run-1 red family green in run 2 on the same binary,
the CX pair green in run 1, F0 documented. Wave law MET.

PROVENANCE NOTE (the sitting's version collision, resolved): R45 (the
models dialog onto the menu grammar, sess-corrected numbering) shipped
0.6.54 mid-sitting (0ce8945 + b0eaf81 + b6dde42) while this wave was
uncommitted on the same floor; this wave's scp overwrote their dirty
app.tsx in the worktree AFTER their commit landed, so their delta is
re-merged here by hand and the wave re-versions to 0.6.55. The merged
transcript renders rows UNDER their menu-grammar model dialog; their L0
needle fix ("Select model") rides committed. Their proof runs before the
re-merge tested this wave's interim dist (md5 8a2caf7c) — their reds were
all known classes (the pf636 CX pair, documented F0, the rotating S1/TB
set); their S1 clean-window corroboration leg folds into this wave's runs.

## Remaining (v2.0.16 → us)

- ~~**theme-v2 default-theme plane** (opened 0.6.50, the re-pin audit)~~
  SHIPPED 0.6.51 — the default "opencode" theme resolves from the v2
  document through the vendored @opencode/theme engine run verbatim at
  build time (tools/resolve-theme-v2.ts -> tools/theme-v2-opencode.json
  -> the gen-themes.py merge); measured delta two faint tokens. See the
  0.6.51 shipped section.
- ~~**transcript-render refactor family (v2.0.12..v2.0.16)**~~ SLICE 1
  SHIPPED 0.6.53 (the framework-free model layer, unwired by design),
  SLICE 2 SHIPPED 0.6.55 (the render half WIRED: the rows layer over our
  raw records, the group-view/anchor-view React translations, persisted
  group expansion #48489, the timeline-anchors registry feeding
  jumpToMessage, jump-over-rows via messageBoundaryIDs, the ctrl+o
  3-state cycle). Family follow-ups recorded, none blocking: upstream's
  per-event append optimizations (createSessionRows' fine-grained
  subscription) are replaced by wholesale re-reduce over the raw mirror —
  same rows, their store split is theirs; the turn-usage verbose per-step
  table stays unported (upstream gates the whole surface behind
  config.debug.turn_tokens; ours renders the collapsed summary only);
  upstream's session/index.tsx routed split is not ported (our app keeps
  its monolith shape — a routing-level rework, no user-visible delta);
  per-session expansion persistence rides in-memory module state, not the
  session-tabs store; the hover/mouse plane and the tool-images slot have
  no arm here (ledgered deviations).
- **automatic tabs mode (#50456)** and **sidebar onboarding (#50475)** —
  new upstream surfaces, no plane here yet (the auto mode onto our strip
  model; onboarding — our sidebar keeps its own shape, deviation
  ledger).
- ~~**plan-quota surface** (owner directive 2026-09-20: show the Z.AI
  Coding Plan quota, usage and weekly quota left)~~ SHIPPED 0.6.46 —
  the design fork RESOLVED (b): the synced coding-plan api key
  authenticates the desktop's own monitor endpoints DIRECTLY (live probe
  2026-09-20: Bearer key -> api.z.ai/api/monitor/usage/quota/limit 200
  with the two CREDIT_LIMIT windows {5-hour, weekly} + level, and
  api.z.ai/api/biz/subscription/list 200 with GLM Coding Pro
  VALID/renew) — TUI-owned, no host verb. Usage section in the Status
  dialog (leader s): plan row (name / level / renews), per-window bars
  (used/total, percent, resets-in), and the usage/stats 7d summary
  line; the USAGE half rides the protocol verb, the LIMIT half the
  monitor endpoints, both fail-soft (no key or network -> honest
  unavailable lines). See the 0.6.46 wave section below.
- **agent permission asks die in ~10s (CRITICAL, host-side — the relay's
  maiden-run TLDR, owner-confirmed 2026-09-20)** — in a yggterm zcode-tui
  row, every agent permission ask errors "Permission request failed" after
  ~10s: the TUI card holds indefinitely by design (src/tui/app.tsx ask
  Promise resolves only on the card's keybindings), but the HOST
  (/opt/ZCode/resources/glm/zcode.cjs) deadline-limits the client answer
  and fails the tool call silently (the CLI's own log records zero
  permission events — the relay measured 155+ asks, zero answered,
  unattended rows are thereby read-only). MITIGATION SHIPPED 0.6.44:
  --mode yolo for unattended relays. FIX BELONGS WITH THE ZCODE HOST:
  raise/remove the client-answer deadline for TUI rows (a human at the
  card is the point), or expose a permission-mode arm in the yggterm
  launch contract. Filed with the host campaign this sitting.
- **sessions view on the v2.0.8 footer-menu grammar** (owner, 2026-09-19
  relay dogfood: "the sessions view has so many UX differences from
  opencode2") — PICKER SLICE SHIPPED 0.6.48 (the select-controller grammar,
  picker behaviors); FOOTER-MENU PRIMITIVE + REBUILD SHIPPED 0.6.49: the
  reference mini/footer.menu.tsx is ported 1:1 (src/tui/footer-menu.tsx —
  categorized header/item/spacer rows, icon column, aligned description
  column, footer tones selection|running|error|success, 8-row viewport,
  compact-width mode) and the sessions surface is REBUILT ON it
  (SelectDialog `menu` path: busy spinner / open-tab slot as the icon cell,
  the current session as the menu footer cell "current"/selection — the
  agent-panel pattern replacing the ● gutter — armed delete keeping v2's
  destructive bg, the one field the grammar gains). Carry-over audit
  settled: the count range row is dropped on the menu path; meta appends to
  the display; the legacy status cell is the footer cell's predecessor.
  REMAINS on this line: migrating the OTHER dialogs onto the menu grammar
  (agents, settings, stash, config, MCP — each a small wave; the legacy
  paint and its proof needles stay honest until each moves). SHIPPED: the
  sessions slice 0.6.48/0.6.49, the SUBAGENT TAB STRIP 0.6.52, the MODELS
  dialog 0.6.54.
- **quick_switch persistent slots** (split out of the sessions line,
  0.6.48 audit) — v2.0.11 keeps a SECOND slot plane beside the tab keys:
  session.quick_switch.1-9 bound to local.session.slots() (a persisted
  session-to-slot store), and the sessions dialog gutter renders THOSE
  slots. Our 1-9 are the v2.0.7 session.tab.select keys (owner re-point
  0.6.22) and the picker now renders tab slots to match (the digit is
  what the key does). The persistent slot plane itself is unported — a
  wave if the owner wants v2's full quick-switch grammar.
- **fuzzysort weighted filter** (0.6.48 audit) — v2.0.11 DialogSelect
  filters with fuzzysort (title weight 2x, category/searchText weight 1,
  threshold option); ours is substring over label/description/meta/group.
  Same shape, weaker recall. Port when a wave touches filtering (needs
  the fuzzysort dep in bun).

- **auto-update while running** (owner directive 2026-09-19: "like opencode2,
  an outstanding UX feature") — opencode2 checks for newer releases and
  updates itself without the user driving. For us the channels are npm
  (public, @avikalpa/zcode-tui) and the ynpm dev fleet rides (push-based).
  WAVE (needs design before code): a version check against the npm registry,
  an unobtrusive update-available surface (v2-style toast), and a
  self-upgrade path for npm-installed binaries (atomic swap + restart-to-
  apply); fleet hosts keep riding ynpm pushes.
- **MODES list audit** — our mode set carries an `auto` entry ("ride the
  default agent (Build)") alongside plan/build/edit/yolo; verify against the
  daemon's real mode vocabulary and the v2 semantics; drop or re-label if it
  is an early invention (deviation-queue rules apply).

- ~~opencode.settings~~ SHIPPED 0.6.27 (/settings): the DialogConfig surface
  — category groups, current value per row, ←/→ cycles + enter steps —
  mapped ONLY to our real setters (theme, animations, editor context,
  diff wrap, thinking, sidebar, mode, effort, tool output). The v2 rows
  without a plane here (scrollbar, markdown, TPS, permissions,
  notifications, sounds…) stay out rather than being invented.
- ~~dialog.select.page_up/page_down/home/end~~ SHIPPED 0.6.27 in
  SelectDialog (every dialog): pageup/pagedown move ±10 (v2's step), home/
  end jump; prev/next/submit were already wired.
- which-key.* (11 binds): STUB — definitions only, no implementation in
  the vendored tree (grep-verified at v2.0.7; re-verified at v2.0.9 and
  v2.0.10, 2026-09-19). Nothing to copy.

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

- **subagent child plane (0.6.52 measured)** — session/messages and
  session/read on a child session id fail "Session is not active"
  (tools/subagents-child-gap-probe.ts): the child transcript is not
  addressable from the TUI, so upstream's subagent detail view (their
  1141-line stream-v2.subagent transport feeding
  RunFooterSubagentBody's scrollbox) has no data source here — our
  inspector renders the host summary line instead. Per-child interrupt
  (v2 session.interrupt on the child id) is unverified in the same
  stroke. The strip itself SHIPPED 0.6.52 on the summary/empty-state
  body; the detail plane returns when the host exposes child reads.

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
- **session/delete (or close-of-persisted)** — the daemon's session store
  accumulates every session a client ever creates, and there is NO client
  verb to remove a persisted (inactive) session: `session/close` answers
  "Session is not active" for them (measured 2026-09-20 with a sweep probe,
  tools/cleanup-proof-sessions.ts, ~40 proof sessions unremovable). The
  desktop host has the machinery (gateway SessionsIndexPublisher
  removeSession; the daemon emits session.deleted/session.removed events) —
  the wire verb is the gap. Real consequence: the proof battery's throwaway
  sessions bury real work in /sessions (the owner hit this live in the
  relay dogfood, 2026-09-20). FILED with the zcode host.

## Harness law (proof isolation, 2026-09-20)

The battery runs against the SHARED daemon: every throwaway turn it creates
persists into the session store the owner's real sessions live in (the
relay-dogfood /sessions flood). Until a session/delete verb exists, this is
bounded but not solved: keep proof bait volume low, prefer re-running single
families (--stage) over full batteries when the question is one family, and
treat the session store as SHARED STATE — the proof never cleans what it
cannot delete. (persistence:"deferred" at create does NOT help: proof
sessions carry turns, and turned sessions persist regardless.)

Defect note: the sessions dialog's ctrl+d delete runs session/close, which
fails on inactive ("Session is not active") sessions — delete in the dialog
is dead for everything older than the current run. Rides on the
session/delete verb above.

## Maintenance law

Owner directive 2026-09-17: after EVERY UX iteration, re-write the Remaining
section to the truth (move lines to Shipped with the wave version, re-pull
upstream when it releases) — continue until this file's Remaining is empty
(modulo the non-parities and host-verb blocks).
