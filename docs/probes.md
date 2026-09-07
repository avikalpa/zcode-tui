# Dual-source probes — the integration contract

zcode-tui is the guinea pig for a two-ended integration-verification design:
every integration milestone is announced by **both ends**, so a missing half
is the bug, pinned to a side.

## The two sources

| end | channel | what fires |
|---|---|---|
| **STIMULUS** (zcode-tui) | the terminal-title sequence `ESC ]0;zcode-tui\|<milestone>\|<detail>BEL`, written straight to `/dev/tty` | every milestone below, only when `YGGTERM_SESSION_ID` is set (inside yggterm) |
| **WITNESS** (yggterm) | the daemon's own ytrace rows — the `cli/*` chain (title follow, identity poll, store scan, launch/attach) plus the PTY attach/detach events it already emits | what it observes the row doing |

Why the title: it rides the PTY byte stream natively — same channel, same
path, same degradation story (a plain terminal silently ignores it) — for
local AND remote rows, with zero host changes. The bytes bypass
`process.stdout` entirely (`/dev/tty` direct write): OpenTUI owns stdout and
the renderer swallows anything routed through it.

A second, full-fidelity record lands in
`~/.yggterm/cli-trace/zcode-tui.jsonl` (`{ts,pid,event,detail}`) when the
directory exists — the offline capture the title channel is the live
projection of.

## Milestones (both sides must fire)

| milestone (cli title) | pairs with (yggterm) | the bug class if the pair breaks |
|---|---|---|
| `boot` | the row's launch/`agent_cli` spawn event | launch fired, row never booted (dead row / wrong binary) |
| `backend-spawn` | PTY attach | attach raced the spawn |
| `renderer-live` | the first paint / mount probe | renderer died before first frame |
| `backend-live` + `list-ok|N sessions` | store-scan / harvest sees the session | daemon-attach OK but the store plane is blind |
| `resume\|<sessionId>` | the resume decision / metadata rail | resume bound the wrong session |
| `turn-start` / `turn-end\|tokens=N` | working-state detection (sidebar dot) | working-state false idle/working |
| `permission-ask` / `permission-answered` | question-picker detection | the picker eats input undetected |
| `quit` | PTY close / despawn | despawn fired while the CLI lives (or vice versa) |

## Verifying (the pairing query)

```sh
# yggterm side: what the daemon saw
yggterm server trace tail --json | jq 'select(.event | test("cli/|agent_cli"))'
# cli side: what zcode-tui announced
tail -f ~/.yggterm/cli-trace/zcode-tui.jsonl
```

A milestone with a stimulus and no witness is a yggterm integration bug.
A witness with no stimulus is a dead or lying row. One line each, and the
pair tells you which side broke — that is the whole architecture.

## Status

- STIMULUS: shipped v0.5.3, PTY-verified (five milestones observed on the
  title channel under `YGGTERM_SESSION_ID`; jsonl fires always).
- WITNESS: the daemon's existing cli/* chain is the reader; a dedicated
  pairing-verifier verb (assert the pairs above over a launch→quit window)
  is the follow-up in the cli-integration campaign.
