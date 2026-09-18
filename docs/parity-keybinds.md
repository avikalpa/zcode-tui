# Parity keybind coverage (GENERATED — do not edit by hand)

Upstream reference: **v2.0.7** — 240 keybind definitions
(packages/tui/src/config/keybind.ts). Classes from
tools/keybind-coverage.json; regenerate with tools/gen-keybinds.py.

| class | binds |
|---|---|
| blocked-host | 3 |
| covered | 122 |
| law | 7 |
| none | 89 |
| partial | 19 |

Open surfaces (partial / none / blocked-host):

- `app.debug` (none) [none] — dev-facing
- `app.console` (none) [none] — dev-facing
- `app.scrap` (none) [none] — dev-facing
- `app.toggle.animations` (none) [none] — display toggles (P2)
- `app.toggle.file_context` (none) [none] — display toggles (P2)
- `app.toggle.diffwrap` (none) [none] — display toggles (P2)
- `app.toggle.paste_summary` (none) [none] — display toggles (P2)
- `docs.open` (none) [none]
- `opencode.settings` (none) [none]
- `server.pair` (none) [none]
- `service.restart` (none) [none]
- `location.reload` (none) [none]
- `prompt.editor` (<leader>e) [none]
- `pane.focus.left` (<leader>left) [none] — panes surface
- `pane.focus.right` (<leader>right) [none] — panes surface
- `terminal.select` (<leader>down) [none] — embedded terminal surface
- `terminal.toggle` (<leader>t) [none] — embedded terminal surface
- `terminal.close` (<leader>up) [none] — embedded terminal surface
- `opencode.status` (<leader>s) [partial] — leader s status view — field parity unverified
- `opencode.debug` (none) [none] — dev-facing
- `session.move` (none) [none] — dialog-move-session
- `open.menu` (ctrl+o) [none]
- `session.share` (none) [none] — share/unshare
- `queued_prompt.delete` (ctrl+d) [none]
- `session.child.first` (down) [none] — child/parent navigation
- `session.child.next` (right) [none] — child/parent navigation
- `session.child.previous` (left) [none] — child/parent navigation
- `session.parent` (up) [none] — child/parent navigation
- `mcp.list` (none) [partial] — 0.6.23 /mcps list + status grammar; toggle and error-detail are host gaps (no mcp connect/disconnect verbs, no error payload)
- `provider.connect` (none) [none]
- `variant.cycle` (ctrl+t) [none]
- `variant.list` (none) [none]
- `session.message.next` (none) [partial] — user walking 0.6.18; all-message walking open
- `session.message.previous` (none) [partial] — user walking 0.6.18; all-message walking open
- `session.message.user.next` (none) [partial] — user walking 0.6.18; all-message walking open
- `session.message.user.previous` (none) [partial] — user walking 0.6.18; all-message walking open
- `session.undo` (<leader>u) [blocked-host] — needs session/revert in the app-server
- `session.redo` (<leader>r) [blocked-host] — needs session/revert in the app-server
- `prompt.submit` (none) [none]
- `prompt.queue` (<leader>return) [none]
- `prompt.editor_context.clear` (none) [none]
- `prompt.images.view` (<leader>i) [none] — image preview
- `prompt.clear` (ctrl+c) [none]
- `input.select.left` (shift+left) [partial] — cursor is char-mode; shift selections still partial
- `input.select.right` (shift+right) [partial] — cursor is char-mode; shift selections still partial
- `input.select.up` (shift+up) [partial] — cursor is char-mode; shift selections still partial
- `input.select.down` (shift+down) [partial] — cursor is char-mode; shift selections still partial
- `input.select.line.home` (ctrl+shift+a) [partial] — cursor is char-mode; shift selections still partial
- `input.select.line.end` (ctrl+shift+e) [partial] — cursor is char-mode; shift selections still partial
- `input.select.visual.line.home` (alt+shift+a) [partial] — cursor is char-mode; shift selections still partial
- `input.select.visual.line.end` (alt+shift+e) [partial] — cursor is char-mode; shift selections still partial
- `input.select.buffer.home` (shift+home) [partial] — cursor is char-mode; shift selections still partial
- `input.select.buffer.end` (shift+end) [partial] — cursor is char-mode; shift selections still partial
- `input.select.word.forward` (alt+shift+f,alt+shift+right) [partial] — cursor is char-mode; shift selections still partial
- `input.select.word.backward` (alt+shift+b,alt+shift+left) [partial] — cursor is char-mode; shift selections still partial
- `input.select.all` (super+a) [partial] — cursor is char-mode; shift selections still partial
- `prompt.history.previous` (up) [none]
- `prompt.history.next` (down) [none]
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
- `dialog.select.prev` (up,ctrl+p) [none]
- `dialog.select.next` (down,ctrl+n) [none]
- `dialog.select.page_up` (pageup) [none]
- `dialog.select.page_down` (pagedown) [none]
- `dialog.select.home` (home) [none]
- `dialog.select.end` (end) [none]
- `dialog.select.submit` (return) [none]
- `dialog.prompt.submit` (return) [none]
- `dialog.integration.rename` (ctrl+r) [none]
- `dialog.integration.delete` (ctrl+d) [none]
- `dialog.worktree.generate` (tab) [none]
- `dialog.move_session.new` (ctrl+a) [none]
- `dialog.move_session.move` (ctrl+m) [none]
- `dialog.move_session.delete` (ctrl+d) [none]
- `dialog.move_session.refresh` (ctrl+r) [none]
- `prompt.autocomplete.prev` (up,ctrl+p) [none]
- `prompt.autocomplete.next` (down,ctrl+n) [none]
- `prompt.autocomplete.hide` (escape) [none]
- `prompt.autocomplete.select` (return) [none]
- `prompt.autocomplete.complete` (tab) [none]
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
