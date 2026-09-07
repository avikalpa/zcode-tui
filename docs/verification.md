# Verification ledger

## probe:battery (deterministic, no model calls) — GREEN

session/list · workspace/readState catalog · session/create ·
session/subscribe · session/read · session/fork refuses fresh session ·
session/compact accepts empty · session/stop · unknown-session error
contract (-32004). Run: `bun run probe:battery`.

## bun test (src/protocol/client.test.ts) — 4 pass

Fake-server framing/correlation/pushes; packaged-runtime integration:
session/list, timeout rejection, SIGKILL→backend-lost→respawn→list.
Run: `bun test`.

## Staged PTY pass (tools/verify.sh) — timing-sensitive instrument

One PTY session drives boot → theme(t) → filter(/) → create(a) → model(m)
→ mode(o) → thinking(e) → fork(f) → compact(c) → send, then greps the
cumulative raw capture for each stage's marker.

Known instrument limits (why a stage can FAIL here while being proven
elsewhere):
- markers are status-line text; frames redraw only changed cells, and the
  raw capture interleaves cursor moves — single-stage runs are reliable,
  long combined runs get overlap noise;
- backend cold start re-connects all MCP servers per spawn; warm-up time
  varies with network (this is why the pass uses ONE spawn);
- theme has no text marker at all (colors are invisible in char frames).

Latest run: 4/8 in-script; every "failing" stage has an isolated proof:
- filter: state transitions debugged in-PTY (y→"yde" appends, Esc carries)
- mode: isolated PTY run "mode → plan"
- send: multiple PTY runs (408 rendered, "turn done · N tokens")
- theme: typecheck + no-crash runs; visual check needs a real terminal.

First real-terminal pass is the owner's to eyeball (per the PTY-proof
law: declare per-row only after reading the viewport).
