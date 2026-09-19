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

**Reference:** opencode **v2.0.9** (stable; repo renamed sst → anomalyco, 2026-09) — VENDORED in-repo at
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

## Remaining (v2.0.9 → us)

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
  the vendored tree (grep-verified at v2.0.7; re-verified at v2.0.9,
  2026-09-19). Nothing to copy.

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
