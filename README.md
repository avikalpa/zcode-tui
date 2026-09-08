# zcode-tui

A functioning, **polished** TUI for ZCode — so the subsidized ZCode workflow
is not locked to the Electron desktop. Owner objective, 2026-09-07. Priority
above the bridge work.

## Architecture

```
┌──────────────┐  ZCode Protocol v4 (NDJSON/stdio)   ┌───────────────────┐
│ zcode-tui    │ ──────────────────────────────────► │ zcode … app-server │
│ (OpenTUI)    │ ◄────────────────────────────────── │ (Electron-as-node  │
└──────────────┘   v4/conversation/frame pushes      │  runtime, SAME     │
                                                     │  stores+identity)  │
                                                     └───────────────────┘
```

- Stack: **Bun + TypeScript + OpenTUI** (anomalyco/opentui — Zig core, TS
  bindings; the OpenCode production TUI stack).
- We do **not** reimplement the agent loop. The TUI is a frontend speaking
  the **ZCode Protocol v4** to `app-server` — the same wiring shape the
  Electron desktop uses (desktop → host → zcode-cli children).
- Same stores, same credentials, same subsidized identity as the desktop:
  `~/.zcode/cli/db/db.sqlite`, `~/.zcode/v2/*`, memories under
  `~/.zcode/cli/memories/`. Reflection TUI↔GUI falls out of shared stores.
- UX reference: the opencode2 TUI. Quality bar: beat ZCode's built-in
  default `tui` command (exists today; not polished).

## Install / run

- **Binary** (linux x64): grab `zcode-tui` from
  [releases](https://github.com/avikalpa/zcode-tui/releases), `chmod +x`,
  run. Requires the ZCode desktop install (`/opt/ZCode`) — the binary
  spawns its packaged runtime as the protocol server.
- **From source**: `bun install && bun run tui` (bun ≥ 1.1).

## Keys

Launch opens the centered `zcodetui` front page. Type a prompt and press Enter
to create a session, or type `/sessions` to open the session browser.

`a` new session · `i` focus composer · Enter open/send · `s` sessions · `m`
model dialog · `t` themes · `e` reasoning effort · **Ctrl+K** command palette
(all verbs, type-to-filter) · `f` fork · `b` fork at message… · `c` compact ·
`o` cycle mode (plan/build/edit/yolo/auto) · `[`/`]` page conversation · `r`
refresh/reconnect · `q` quit · permission asks: `y` allow · `a` always
(project) · `n` deny

Dialogs follow OpenCode's selection pattern: type-to-filter, date-grouped
sessions, arrows, Enter, Esc, and compact footer hints. Themes include the
OpenCode reference arm, Z.ai light/dark, and several popular terminal arms.

## Status

**v0.5.7 — OpenCode-shaped UX (2026-09-08).** The TUI lists/resumes/streams/sends
against the real backend with the same store and identity as the desktop, with
an OpenCode-shaped home surface, `/sessions` browser, grouped session picker,
state-controlled composer, and theme arms.

- `bun run tui` — the TUI (keys: `a` new · `i` type · Enter send/open ·
  `m` model · `r` refresh · `q` quit)
- `bun run probe:battery` — protocol acceptance battery (no model calls)
- `bun run probe:live` — scripted create→subscribe→send with stream capture
- `bun run src/tui/live-smoke.tsx` — headless OpenTUI acceptance frame

Phases landed: protocol captured (docs/protocol.md) · full loop proven ·
TUI v0 read-only · send path + streaming · scrollbox/markdown polish ·
model switcher · acceptance battery · fork + compact verbs · theme arms ·
release v0.1.0.

## Layout

- `src/protocol/` — client + types for the v4 protocol (zero-dep).
- `src/bin/` — probe, probe-script, live (stream capture), battery.
- `docs/screenshots/` — captured character frames (real app, real data).
- `docs/` — capture notes + evidence. `docs/evidence/strace-cli-50s.txt` is
  **local-only** (gitignored; contains owner conversation bytes).


## Licence

GPL-3.0-or-later — see [LICENSE](LICENSE) and [NOTICE](NOTICE).
Contributions welcome (see [CONTRIBUTING.md](CONTRIBUTING.md) and
[CLA.md](CLA.md)); third-party notices in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

**Trademark:** ZCode is a trademark of Z.ai. zcode-tui is an unofficial,
independent client for a locally installed ZCode runtime; it is not
affiliated with or endorsed by Z.ai. See [TRADEMARKS.md](TRADEMARKS.md).
