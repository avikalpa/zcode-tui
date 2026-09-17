# opencode v2 parity ledger

**Reference:** opencode **v2.0.6** (stable) — dev `~/gh/opencode` branch
`v2ref` (tag `v2.0.6`). The v2 TUI surface is **239 keybind definitions**
(`packages/tui/src/config/keybind.ts`) + the component set under
`packages/tui/src/component/`. Re-pull and re-inventory this file whenever
upstream releases; update the ledger AFTER EVERY WAVE — a line moves from
Remaining to Shipped only with the wave version that shipped it.

Non-parities BY OWNER LAW (never copy): model allowlist, provider_connect /
console_org.

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

## Remaining (v2.0.6 → us)

- **diff.* family (19 binds)** — the diff viewer route: open, tree,
  hunks (next/prev), files (next/prev), split/unified, file tree toggle,
  single patch, source switch (git/branch/last-turn), mark_reviewed, help.
  Largest single surface gap. Reference: `feature-plugins/system/
  diff-viewer.tsx` (~1077 lines) + file-tree utils. CLAIMED (parked twice —
  see door); data sources git/branch via local git in the workspace cwd,
  last-turn needs a host verb.
- **session.tab.* (16 binds) + session-tabs-rail** — session TABS:
  next/prev/close/reopen/unread/history/select-1-10. We have sessions
  dialog + quick slots only; tabs are the v2 navigation structure.
- **session.message.next/previous** (binds "none" — palette commands;
  user-message walking shipped 0.6.18, all-message walking still open).
- **messages.copy (extended)** — copy selected/all messages (we copy the
  last assistant message only).
- **stash family** — prompt_stash/pop/list + stash.delete dialog.
- **prompt.skills** — skills selector dialog.
- **mcp.list / dialog-mcp** — MCP server list dialog.
- **session.ops deep** — share/unshare, session.move (dialog-move-session),
  child/parent navigation (session.child.first/next/previous, session.parent).
- **display toggles (P2)** — thinking visibility toggle, timestamps,
  diffwrap, paste_summary, file_context, scrollbar, exploration_grouping.
- **theme mode** — light/dark switch + mode lock (we ship the dark arms).
- **panes + embedded terminal** — pane.focus.left/right, terminal.select/
  toggle/close, composer.terminal.*, dialog-shell-output. New v2 surface.
- **composer.subagent.* / composer.shell.*** — subagent & shell prompt
  switchers. New v2 surface.
- **prompt.images.view / dialog-image-preview** — image preview.
- **misc dialogs** — experiments, integration, pair, update, workspaces,
  worktree-name, open, config, debug, error-details; plugins.* family;
  server.pair; service.restart; session.cd; session.background;
  permission.prompt.fullscreen; opencode.status/debug (we have leader s
  status view — verify field parity).
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

## Maintenance law

Owner directive 2026-09-17: after EVERY UX iteration, re-write the Remaining
section to the truth (move lines to Shipped with the wave version, re-pull
upstream when it releases) — continue until this file's Remaining is empty
(modulo the non-parities and host-verb blocks).
