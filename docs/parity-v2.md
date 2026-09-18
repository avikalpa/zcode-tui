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

## Deviation queue (past inventions to re-port onto v2 code — audit 2026-09-17)

1. **Tool-call rendering** — ours: one invented "● Tool summary ✓ms" line
   with truncated inline output (the TodoWrite raw-JSON row in the owner's
   screenshot). v2: per-tool title formatters + collapsible details rows
   (`routes/session/index.tsx` message parts + `component/patch-diff.tsx`).
2. **Permission card** — header/labels ported 0.6.19 (△ Permission
   required / Allow once / Always allow / Reject, esc=Reject); residual:
   hidden y/a/n accelerators (invisible; keep) + the v2 body variants
   (EditBody diff view, PatchDiff) not ported.
3. **Flash status line** — ours invented (transient hint-slot text). v2 uses
   toasts only. Re-point confirmations to toast variants.
4. **Home screen** — ours is logo+composer; v2 home = session-destination
   (recent sessions, frecency) + tips. Ledger P2 line upgraded to deviation.
5. **Footer hint rows** — our "enter select esc close" bracket-less hints
   approximate v2's FooterAction pattern; diff the exact rendering.
6. **Queue manager / timeline / sessions dialogs** — modeled on v2 but with
   our own chrome; re-diff each against v2's dialog-* source file by file.
7. **Turn footers, context label, spinner** — verify token-for-token against
   v2 (formatTurnFooter was measured earlier; re-verify on v2.0.6).
8. **Diff viewer binding gaps (0.6.20)** — opentui 0.5.11 has no mouse plane
   (the right-click file menu and hover states are omitted; upstream's tree
   is partly mouse-driven) and no renderer lifecycle passes (the
   dynamically-tinted top edge renders static context colour; file headers
   do not float while scrolling). Reviewed cards tint to the panel step (no
   surface.overlay token in the 33-theme port); image files show the
   no-patch notice (v2 previews image bytes); syntax highlighting rides the
   markdown SyntaxStyle (the tree-sitter filetype→language map was not
   ported, so per-language highlight fidelity may differ).

## Remaining (v2.0.6 → us)

- ~~diff.* family (19 binds)~~ SHIPPED 0.6.20 (the last-turn SOURCE stays
  blocked below).
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
