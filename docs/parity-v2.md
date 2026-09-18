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

**Reference:** opencode **v2.0.8** (stable) — VENDORED in-repo at
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

## Deviation queue (past inventions to re-port onto v2 code — audit 2026-09-17)

1. ~~Tool-call rendering~~ RE-PORTED 0.6.21 (see Shipped) — the row now
   traces to routes/session/index.tsx; residuals: upstream mouse expansion
   adapted to ctrl+o (no mouse plane), background-shell output polling
   needs the zcode shell verb (renders from the part instead).
2. **Permission card** — header/labels ported 0.6.19 (△ Permission
   required / Allow once / Always allow / Reject, esc=Reject); residual:
   hidden y/a/n accelerators (invisible; keep) + the v2 body variants
   (EditBody diff view, PatchDiff) not ported.
3. ~~Flash status line~~ CLOSED 0.6.21 — flashStatus is toast-only (the
   transient status-slot text was already invisible; lifecycle state still
   feeds the leader-s status summary).
4. **Home screen** — CORRECTED 0.6.26 (stale audit line): v2.0.7 home is
   logo + prompt + the home.footer status row (⊙ N MCP / plugins-failed /
   version) — there is NO session-destination recent-sessions front page
   upstream (grep-verified routes/home.tsx). The footer MCP half is ported
   (0.6.26); the plugins half has no plane here. ⚠ owner 2026-09-18: the
   zcodetui LOGO STAYS.
5. **Footer hint rows** — our "enter select esc close" bracket-less hints
   approximate v2's FooterAction pattern; diff the exact rendering.
6. **Queue manager / timeline / sessions dialogs** — modeled on v2 but with
   our own chrome; re-diff each against v2's dialog-* source file by file.
7. **Turn footers, context label, spinner** — verify token-for-token against
   v2 (formatTurnFooter was measured earlier; re-verify on v2.0.6).
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

## Remaining (v2.0.6 → us)

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
- **messages.copy (extended)** — copy selected/all messages (we copy the
  last assistant message only).
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
- **theme mode** — light/dark switch + mode lock (we ship the dark arms).
- **panes + embedded terminal** — pane.focus.left/right, terminal.select/
  toggle/close, composer.terminal.*, dialog-shell-output. New v2 surface.
- **composer.subagent.* / composer.shell.*** — subagent & shell prompt
  switchers. New v2 surface.
- **prompt.images.view / dialog-image-preview** — image preview.
- **misc dialogs** — experiments, integration, pair, update, workspaces,
  worktree-name, open, config, debug, error-details; plugins.* family;
  server.pair; service.restart; session.cd; session.background;
  permission.prompt.fullscreen; opencode.debug (a dev-facing view —
  nothing to port).
- **selection grammar** — input.select.* (shift selections), visual line
  ops, buffer home/end, select.all, delete.line (our cursor is char-mode;
  selection still partial — ledger note from 0.6.10).

## Blocked on a zcode HOST VERB (file with the zcode host, not the TUI)

- **session.undo / session.redo** — v2 = server-side session.revert
  stage/clear; zcode has fork-at-message only (timeline). Needs
  `session/revert` (stage/clear) in the app-server.
- **diff last-turn source** — needs a session-diff verb (v2: client.session.
  diff). Git/branch sources ship TUI-side.
- **session.rename** — needs session/title update verb (long-standing).
- **/btw side question (session.aside, v2.0.8)** — needs a one-shot
  session-scoped generate verb (v2: client.session.generate — runs no tool
  loop, answers from session context in a dialog; our protocol has
  workspace/generateText only, not session-context). The v2.0.8
  subagent-notice click-to-open-child rides the SAME parent-linkage gap
  already filed below (payload carries no childID), and upstream opens it
  by mouse regardless (no mouse plane here).

## Maintenance law

Owner directive 2026-09-17: after EVERY UX iteration, re-write the Remaining
section to the truth (move lines to Shipped with the wave version, re-pull
upstream when it releases) — continue until this file's Remaining is empty
(modulo the non-parities and host-verb blocks).
