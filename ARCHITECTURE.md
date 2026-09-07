# Architecture

```
┌────────────────────────────────────────────────────────────┐
│ zcode-tui (this repo, Bun)                                 │
│                                                            │
│  src/tui/main.tsx    entry: spawns backend, renders App    │
│  src/tui/app.tsx     React surface (OpenTUI): sidebar,     │
│                      conversation, composer, banners       │
│  src/protocol/client.ts   AppServer: spawn + NDJSON +      │
│                      id-correlated requests, push/ask      │
│                      listeners, respawn                    │
│  src/bin/probe.ts        single request  → response        │
│  src/bin/probe-script.ts batched probes from JSON          │
│  src/bin/live.ts         create→subscribe→send capture     │
│  src/bin/battery.ts      acceptance battery (no model)     │
└──────────────┬─────────────────────────────────────────────┘
               │ NDJSON {method,params,id} over stdio socketpairs
               ▼
┌────────────────────────────────────────────────────────────┐
│ ELECTRON_RUN_AS_NODE=1 /opt/ZCode/zcode                    │
│   /opt/ZCode/resources/glm/zcode.cjs app-server            │
│                                                            │
│  ZCodeProtocolNdjsonConnection → dispatchRequest           │
│  ├─ session/*    create/resume/send/subscribe/stop/…       │
│  ├─ workspace/*  readState (model catalog), providers…     │
│  ├─ plugins/* automation/* skills mcp/list usage/*         │
│  ├─ interaction/* server→client asks (permissions)         │
│  └─ v4 gateway   sessions-index topics (snapshot standalone)│
│                                                            │
│  SAME ~/.zcode stores + credentials as the desktop GUI     │
│  (db.sqlite sessions/messages/parts, WAL — short txns)     │
└────────────────────────────────────────────────────────────┘
```

## Why this shape

- **We never reimplement the agent loop.** The packaged runtime is the
  exact code the desktop drives; spawning it in protocol mode is the same
  relationship the desktop's host has with its cli children (measured:
  utilityProcess forks `glm/zcode.cjs`, stdio socketpairs, argv0/serviceName
  cosmetics via setproctitle).
- **Same-store reflection is free.** Sessions created here appear in the
  desktop GUI and vice versa; memories and credentials are shared. The TUI
  is just another surface on one store.
- **Desktop-only capabilities are honest gaps, not bugs.** Live
  sessions-index push and attachment upload hang off host bindings
  (`getSessionWorkspaceId`, `putSessionAttachment`, …) the desktop wires in.
  Standalone: snapshot-on-subscribe + 20s poll; no attachments. See
  docs/protocol.md for the evidence chain.

## State machines

- **Session**: list (store) → resume/create (activates in OUR instance;
  foreign sessions answer -32004) → subscribe (REQUIRED for events) →
  send → pushes reshape the tail → turn.terminal/stop.
- **Server asks**: answered via `client.onAsk` handlers; a reply must
  satisfy the ask's strict zod schema or the flow records a denial.
- **Backend loss**: proc exit (unexpected) → backend-lost listeners →
  `r` respawns → refresh; `session/resume` is the reattach path (store has
  everything).

## Testing doctrine

- `probe:battery` — protocol contract, deterministic, no model calls.
- `bun test` — client machinery; fake server for framing, real runtime for
  integration (skips when /opt/ZCode absent).
- `tools/verify.sh` — staged PTY drive of every verb; timing-sensitive,
  see docs/verification.md for the flakiness analysis and isolated proofs.
- `live-smoke`/`headless-drive` — OpenTUI test-renderer acceptance frames.
