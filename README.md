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

`a` new session · `i` focus composer · Enter open/send · `m` model dialog ·
**Ctrl+K** command palette (all verbs, type-to-filter) · `f` fork ·
`c` compact · `o` cycle mode (plan/build/edit/yolo/auto) · `e` thinking
on/off · `[`/`]` page conversation · `/` filter sidebar · `t` theme
(zai-dark/zai-light) · `r` refresh (respawns the backend after a loss) ·
`q` quit · permission asks: `y` allow · `a` always (project) · `n` deny

Dialogs follow opencode2's dialog-select pattern: type-to-filter, arrows,
Enter, Esc — the same OpenTUI stack, so the feel matches.

## Status

**v0.1.0 — FUNCTIONING (2026-09-07).** The TUI lists/resumes/streams/sends against
the real backend with the same store and identity as the desktop.

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
