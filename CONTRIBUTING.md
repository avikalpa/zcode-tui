# Contributing

Short version: issues and pull requests welcome; contributions are licensed
GPL-3.0-or-later (inbound = outbound); sign CLA.md (a DCO-style
certification — you keep your copyright) before your first merged PR.

## Before you touch the protocol

Read `docs/protocol.md` — it is the measured contract with the app-server,
and `SKILL.md` carries the hard-won laws (envelope shape, the
subscribe-before-events rule, per-instance session ownership). Violating
those re-derives days of reverse engineering.

## Checks before every PR

```sh
bun run typecheck        # tsc --noEmit, must be clean
bun test                 # client suite, 4 pass
bun run probe:battery    # protocol acceptance, GREEN (needs /opt/ZCode)
```

`probe:battery` and `bun test`'s runtime group talk to a real app-server
spawned from the locally installed ZCode desktop; they create short-lived
test sessions in the shared store (they are visible in your desktop's
sidebar — that is the same-store premise, not a bug). UI changes should
also run `bun run src/tui/live-smoke.tsx` and attach the captured char
frame to the PR.

## Instruments

- Raw `script` PTY captures are frame-diffs; strip escapes with a space
  inserted, and prefer headless `captureCharFrame` for layout truth. See
  `docs/verification.md` for the flakiness analysis.
- The backend cold-start reconnects all MCP servers — budget 8–25 s for
  the first list. Repeated rapid spawns throttle; use single-spawn passes.

## Licence

By contributing you agree your work is licensed GPL-3.0-or-later, same as
the project (see CLA.md). Add `Signed-off-by: Your Name <email>` to your
commits (`git commit -s`).
