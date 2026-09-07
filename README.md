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

## Status

- **Phase 1 (2026-09-07): protocol captured.** Topology, wire format, full
  `v4/*` method registry, topics/delta-feed shape, launch story — see
  [docs/protocol.md](docs/protocol.md).
- `bun run probe -- --method v4/connection/flow --params '{}'` — boots the
  real `app-server` and speaks to it; iterate the handshake from here.

## Layout

- `src/protocol/` — client + types for the v4 protocol (zero-dep).
- `src/bin/probe.ts` — protocol probe/trace tool.
- `docs/` — capture notes + evidence. `docs/evidence/strace-cli-50s.txt` is
  **local-only** (gitignored; contains owner conversation bytes).
