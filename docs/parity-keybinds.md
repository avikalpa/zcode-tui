# Parity keybind coverage (GENERATED — do not edit by hand)

Upstream reference: **v2.0.8** — 241 keybind definitions
(packages/tui/src/config/keybind.ts). Classes from
tools/keybind-coverage.json; regenerate with tools/gen-keybinds.py.

| class | binds |
|---|---|
| blocked-host | 14 |
| covered | 165 |
| law | 7 |
| none | 54 |
| partial | 1 |

Open surfaces (partial / none / blocked-host):

- `app.debug` (none) [none] — dev-facing
- `app.console` (none) [none] — dev-facing
- `app.scrap` (none) [none] — dev-facing
- `app.toggle.paste_summary` (none) [none] — deviation: v2 compact-paste rendering needs composer paste spans; our draft is plain text
- `docs.open` (none) [blocked-host] — opens an external browser
- `server.pair` (none) [blocked-host] — desktop-shell verb
- `service.restart` (none) [blocked-host] — desktop-shell verb
- `location.reload` (none) [blocked-host] — desktop-shell verb
- `pane.focus.left` (<leader>left) [none] — panes surface
- `pane.focus.right` (<leader>right) [none] — panes surface
- `terminal.select` (<leader>down) [none] — embedded terminal surface
- `terminal.toggle` (<leader>t) [none] — embedded terminal surface
- `terminal.close` (<leader>up) [none] — embedded terminal surface
- `opencode.debug` (none) [none] — dev-facing
- `session.move` (none) [blocked-host] — no workspace-move verb; dialog.move_session.* with it (0.6.24)
- `open.menu` (ctrl+o) [none]
- `session.share` (none) [blocked-host] — no share verb in the zcode protocol (0.6.24)
- `session.aside` (none) [blocked-host] — v2.0.8 /btw side question — rides a one-shot session.generate (no tool loop); zcode has workspace/generateText only. Filed with the host 0.6.29.
- `session.child.first` (down) [blocked-host] — 0.6.24 measured: session/list carries no parentSessionId — no child tree to walk
- `session.child.next` (right) [blocked-host] — 0.6.24 measured: session/list carries no parentSessionId — no child tree to walk
- `session.child.previous` (left) [blocked-host] — 0.6.24 measured: session/list carries no parentSessionId — no child tree to walk
- `session.parent` (up) [blocked-host] — same: no parent linkage in the protocol
- `mcp.list` (none) [partial] — 0.6.23 /mcps list + status grammar; toggle and error-detail are host gaps (no mcp connect/disconnect verbs, no error payload)
- `provider.connect` (none) [none]
- `session.undo` (<leader>u) [blocked-host] — needs session/revert in the app-server
- `session.redo` (<leader>r) [blocked-host] — needs session/revert in the app-server
- `prompt.editor_context.clear` (none) [none] — n/a to the plain-text draft
- `prompt.images.view` (<leader>i) [none] — no attachments plane in this TUI
- `composer.subagent.up` (up) [none] — subagent prompt switcher
- `composer.subagent.down` (down) [none] — subagent prompt switcher
- `composer.subagent.select` (return) [none] — subagent prompt switcher
- `composer.subagent.interrupt` (ctrl+d) [none] — subagent prompt switcher
- `composer.shell.up` (up) [none] — shell prompt switcher
- `composer.shell.down` (down) [none] — shell prompt switcher
- `composer.shell.select` (return) [none] — shell prompt switcher
- `composer.shell.kill` (ctrl+d) [none] — shell prompt switcher
- `composer.terminal.up` (up,k) [none] — embedded terminal
- `composer.terminal.down` (down,j) [none] — embedded terminal
- `composer.terminal.select` (return) [none] — embedded terminal
- `dialog.prompt.submit` (return) [none]
- `dialog.integration.rename` (ctrl+r) [none]
- `dialog.integration.delete` (ctrl+d) [none]
- `dialog.worktree.generate` (tab) [none]
- `dialog.move_session.new` (ctrl+a) [none]
- `dialog.move_session.move` (ctrl+m) [none]
- `dialog.move_session.delete` (ctrl+d) [none]
- `dialog.move_session.refresh` (ctrl+r) [none]
- `permission.prompt.fullscreen` (ctrl+f) [none] — fullscreen permission prompt
- `plugins.toggle` (return) [none]
- `dialog.mcp.toggle` (space) [blocked-host] — zcode protocol has no mcp connect/disconnect verbs (0.6.23 finding)
- `dialog.plugins.error` (space) [none]
- `dialog.plugins.install` (shift+i) [none]
- `dialog.plugins.update` (ctrl+u) [none]
- `dialog.plugins.check` (ctrl+r) [none]
- `terminal.suspend` (ctrl+z) [none] — embedded terminal surface
- `terminal.title.toggle` (none) [none] — embedded terminal surface
- `plugins.list` (none) [none]
- `plugins.install` (none) [none]
- `key.toggle` (ctrl+alt+k) [none]
- `key.layout.toggle` (ctrl+alt+shift+k) [none]
- `key.pending.toggle` (ctrl+alt+shift+p) [none]
- `key.group.previous` (ctrl+alt+left,ctrl+alt+[) [none]
- `key.group.next` (ctrl+alt+right,ctrl+alt+]) [none]
- `key.scroll.up` (ctrl+alt+up,ctrl+alt+p) [none]
- `key.scroll.down` (ctrl+alt+down,ctrl+alt+n) [none]
- `key.page.up` (ctrl+alt+pageup) [none]
- `key.page.down` (ctrl+alt+pagedown) [none]
- `key.home` (ctrl+alt+home) [none]
- `key.end` (ctrl+alt+end) [none]
