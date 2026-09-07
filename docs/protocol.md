# ZCode Protocol (v4) — phase-1 capture

Measured 2026-09-07 on jojo, ZCode desktop 3.11.2 (`/opt/ZCode`, build
89817f5b). Sources: live `strace` of a running `zcode-cli` child (50 s of an
actively streaming turn) + static reads of
`/opt/ZCode/resources/glm/zcode.cjs` (12.6 MB, `apps/zcode-cli` dist bundle)
and the desktop's `app.asar` (`out/main/*`). Raw capture:
`docs/evidence/strace-cli-50s.txt` (owner-content present — do not publish).

## Process topology (measured via /proc + ss -xp)

```
ZCode (Electron main, /opt/ZCode/zcode)
  ├─ utilityProcess.fork(glm/zcode.cjs, serviceName="zcode-host-local-1")
  │    ├─ cli child  "zcode-cli"          ← per-session agent runtime
  │    │    └─ "zcode-node-repl-mcp"      ← tool children
  │    └─ bash rows (live terminals)
  ├─ renderers/utility (network, audio, node.mojom.NodeService)
  └─ crashpad
```

- Every one of these is the **same Electron ELF** with
  `ELECTRON_RUN_AS_NODE=1`; the entry is `resources/glm/zcode.cjs`. Process
  identity is cosmetic (argv0/serviceName + setproctitle — the original argv
  buffer is overwritten with zero padding, so `/proc/PID/cmdline` lies).
- Channels (all AF_UNIX socketpairs, not pipes):
  - desktop main fd 43 ↔ host fd 14
  - host fd 44/47/50 ↔ cli fd 0/1/2 (stdio = the protocol channel)
  - host fd 18 ↔ renderer fd 30
  - ⚠ host/cli stdout+stderr *also* have fds to **journald** — those are
    logging, NOT the protocol. (Earlier session-notes guessed the
    desktop↔runtime channel was the journal socketpair; measured wrong.)
- Desktop forks the host with Electron `utilityProcess.fork`
  (`serviceName`, `execArgv:["--no-warnings"]`,
  `env.ZCODE_PROCESS_LABEL="local-1"`, `hostProcessLocalEnv`).

## Wire format

**NDJSON** — one JSON document per `\n`-terminated line. Live-captured
outbound frames from the cli:

```json
{"method":"v4/telemetry/event","params":{"version":1,"eventId":"<uuid>","eventSeq":137434,"occurredAt":1788793073526,"sessionId":"sess_…","sourceCommandId":"…","turnId":"turn_…","kind":"stream.chunk","channel":"thought","chunkLength":9,"firstChunk":false,"assistantMessageId":"msg_…"}}
```

```json
{"method":"v4/conversation/frame","params":{"wireVersion":3,"kind":"complete","deliveryKind":"online","logicalFrameId":"sub-…-lf-41","logicalFrameOrdinal":41,"topic":"conversation/sess_…","subscriptionId":"sub-…","frame":{"topic":"…","subscriptionId":"…","sentAt":…,"fromSeq":4266,"toSeq":4279,"payload":{"kind":"deltas","deltas":[…]}}}}
```

- Requests carry `requestId` (zod `.strict()` schemas, 189 `requestId`
  refs); server→client pushes (frames, telemetry) are notifications.
- `wireVersion: 3`.
- The feed is **logical-replication-style**: per-topic sequences,
  subscriptions, resync, rowsRange backfill.

### Topics observed live

- `conversation/sess_<uuid>` — the conversation of one session.
- `sessions-index/<workspacePath>` — e.g. `sessions-index//home/pi/.zcode/workspace/default` (double slash: topic = literal `"sessions-index/" + path`).

### Delta ops observed

- `row.upserted` — conversation row: `rowId`, `turnId`, `entityId`,
  `productTurnId`, `visibility`, `createdAt`, `createdAtSeq`,
  `kind:"reasoning"` (others exist), `assistantResponseId`, `text`, …
- `session.upserted` — index row: `sessionId`, `workspaceId`, `title`,
  `titleSource:"generated"`, `phase:"running"`, `sessionEnded`,
  `hasBackgroundWork`, `lastActivityAt`, `lastAssistantPreview`,
  `lastTerminalQuery{queryId,historyRoundCount}`, …

## Method registry (exact strings from zcode.cjs)

```js
{
  connectionFlow:              "v4/connection/flow",
  controllerSubscribe:         "v4/controller/subscribe",
  controllerResync:            "v4/controller/resync",
  controllerUnsubscribe:       "v4/controller/unsubscribe",
  conversationSubscribe:       "v4/conversation/subscribe",
  conversationResync:          "v4/conversation/resync",
  conversationUnsubscribe:     "v4/conversation/unsubscribe",
  conversationRowsRange:       "v4/conversation/rowsRange",
  conversationPlans:           "v4/conversation/plans",
  conversationFileChanges:     "v4/conversation/fileChanges",
  conversationFileRewindPreview:"v4/conversation/fileRewindPreview",
  usageStats:                  "v4/usage/stats",
  conversationUsage:           "v4/conversation/usage",
  attachmentBegin:             "v4/attachment/begin",
  attachmentChunk:             "v4/attachment/chunk",
  attachmentCommit:            "v4/attachment/commit",
  attachmentAbort:             "v4/attachment/abort",
  attachmentRead:              "v4/attachment/read",
  attachmentPreviewSource:     "v4/attachment/previewSource",
  commandsQuery:               "v4/commands/query",
  command:                     "v4/command",
}
```

Server→client notifications: `v4/conversation/frame`, `v4/telemetry/event`
(plus `v4/command_fact`, `v4/fork_start_failure`, `v4/cua/permission-observation`).

Schema fragments seen: requests use `requestId`, `workspaceKey`,
`sessionId`, `clientMode` (enum), `sessionContext` enum `"live"|"cached"`;
ask/permission payloads carry `prompt`, `inputType:"text"|"choice"|"confirm"`,
`choices[]`, `options[{optionId,label}]`, `sensitive`. Error codes seen:
`backend_unavailable`, `capability_unsupported`, `duplicate_request_id`,
`ref_not_found`, `navigation_blocked`, `timeout`, `renderer_unreachable`,
`cancelled`, `execution_error`, `quota_exceeded`, `coding_plan_required`.

## Launching the backend (what our TUI spawns)

The desktop spawns: `ELECTRON_RUN_AS_NODE=1 /opt/ZCode/zcode
resources/glm/zcode.cjs …`. The runtime decides presentation by argv:

```js
process.argv.includes("app-server") || process.argv.includes("agent-server")
  ? "electron" /* protocol server */ : "cli"
```

- **`app-server` / `agent-server`** — headless protocol server on stdio.
  This is our backend. (Confirmed: `isProtocolServerInvocation`,
  `--surface can only be used with --prompt, --target, app-server, or agent-server`.)
- `--surface` flag exists (`type:"string"`); `tui` is the DEFAULT positional
  command of the plain CLI (`commandName = positionals[0] ?? "tui"`).
- **The CLI already ships a built-in TUI** (default `tui` command →
  lazy-imported `runTui`, resolves models/effort/git branch first). Not
  OpenTUI (no @opentui/react/solid markers in the bundle). It is our quality
  baseline — and possibly a reference for protocol usage.
- ⛔ `zcode --help` lies about some flags (`--settings`, `--max-turns` are
  refused by its own parser). Measure, never trust.

## The request API (phase 1b — extracted from `dispatchRequest` + `ZCodeProtocolNdjsonConnection`)

Envelope is JSON-RPC-flavored NDJSON:

- client→server request: `{"method":"session/list","params":{…},"id":1}`
- response: `{"id":1,"result":{…}}` or `{"id":1,"error":{"code":…,"message":…,"data":…}}`
- server→client requests use string ids `"server-<n>"` (interaction/
  permission asks arrive this way; answer with `{"id":"server-…","result":…}`)
- server→client pushes (no id): `v4/conversation/frame`, `v4/telemetry/event`
- error codes in the server's client-request machinery: `-32020` no client
  attached, `-32021` cancelled, `-32022` timed out (class `qa`)

⚠ The earlier guess that requests carry `requestId` at the top level was
wrong — `requestId` appears only INSIDE some params schemas (strict zod).

### Full method registry #2 — the app-server's primary API (exact strings)

`session/create, session/resume, session/list, session/subagents,
session/requestRuntimePreferences, session/read, session/messages,
session/events, session/subscribe, session/send, session/stop,
session/cancelBackgroundTask, session/fork, session/compact, session/goal,
session/close, session/setModel, session/setThoughtLevel,
session/updateRuntimeModelConfig, session/setMode, session/usage,
workspace/readState, workspace/hooks/trustGrant,
workspace/updateProviderRegistry, workspace/updateInteractionPreferences,
workspace/updateModelIoPreferences, workspace/upsertModelProvider,
workspace/removeModelProvider, workspace/setDefaultModel,
workspace/setDefaultThoughtLevel, workspace/setDefaultMode,
workspace/generateText, workspace/cancelGenerateText, mcp/list,
plugins/* (list, referenceCatalog, setEnabled, overview,
marketplace/{add,remove,update}, install, cancelOperation, uninstall,
update, restoreBuiltin, configure, resetConfig, validate, describe,
resolveSuggestedReference), skills/referenceCatalog, automation/{create,
update,checkTaskBinding,list,delete}, usage/stats,
interaction/{requestPermission, requestUserInput,
requestProviderRuntimeHeaders, requestOfficialMcpAuthHeaders,
browserList, browserExecute}, computer-use/operation-event`

The v4/* family and this session/* family go through the SAME dispatch
switch; v4/* calls into a "v4 gateway" (the sync plane the host uses).
For a standalone TUI, session/* + workspace/* + interaction/* are the API.

### Live proof (2026-09-07, this repo's probe)

`bun run src/bin/probe.ts --method session/list --params '{}'` against a
freshly spawned `ELECTRON_RUN_AS_NODE=1 /opt/ZCode/zcode
/opt/ZCode/resources/glm/zcode.cjs app-server` returned the real session
list from `~/.zcode/cli/db/db.sqlite` — the desktop's live sessions, this
session included (fields: `sessionId, title, titleSource, sessionKind,
status, mode, traceId, createdAt, updatedAt,
workspace{workspaceKey,workspacePath}`). Same store, same identity: proven.

## Phase 2 — param schemas + live loop (2026-09-07, same sitting)

All pinned statically (zod in zcode.cjs) AND confirmed live via
`bun run probe:script` / `bun run probe:live`. Zod is `.strict()` — unknown
keys are rejected with `-32602` and a field-accurate message (use that to
iterate).

- `session/list` `{workspace?, includeArchived?=false, limit?}` →
  `{sessions:[{sessionId,title,titleSource,sessionKind,status,mode,traceId,createdAt,updatedAt,workspace{…}}]}`
- `session/create` `{workspace:{workspacePath,workspaceKey} (REQUIRED),
  mode?:"plan|build|edit|yolo|auto", model?{providerId,modelId,variant?},
  persistence?:"immediate|deferred", thoughtLevel?, titleGenerationEnabled?,
  mcpServers?, toolAllowlist?, toolDenylist?, parentSessionId?,
  importedHistory?, sessionId? (only for imported history), runtimeModel?}`
  → `{session:{sessionId,model,title,…}, messages:[], projection:{status,
  mode, contextUsed, contextWindow, turnCount,…}, runtime:{eventSeq,…},
  settings:{mode,model{available:[…]}}, protocol:{name,version}}`
- `session/resume` `{sessionId, workspace?, runtimeModel?, thoughtLevel?,
  mcpServers?, toolAllowlist?, toolDenylist?}` → same shape WITH history
  (`messages:[{info:{role,model,tokens,time,semantics,…},
  parts:[{partId,…}]}]`). Activates the store session in THIS instance.
- `session/read` `{sessionId, deliveryKind?, messageLimit?, afterSeq?}`
- `session/messages` `{sessionId, afterMessageId?, limit?}` → `{messages}`
- `session/events` `{sessionId, afterSeq?, limit?}` → `{events}`
- `session/subscribe` `{sessionId, deliveryKind:"desktop-continuous"|
  "web-remote-replayable" (REQUIRED), afterSeq?, includeSnapshot?=false}` →
  `{eventSeq, events, sessionId, snapshot?}`
- `session/send` `{sessionId, content:string (REQUIRED plain string),
  inputId?, queryId?, attachments?, expectedRevision?,
  expectedProviderRevision?, runtimeModel?, …}` →
  `{accepted:true, sessionId, stateRevision}`; `-32010` if a prompt is
  already running
- `session/stop` `{sessionId}` → `{}`
- `session/fork` `{sessionId, target?:{kind:"turn",turnIndex}|{kind:"message",messageId}|{kind:"checkpoint",checkpointId}|{kind:"latestCheckpoint"} (default), expectedRevision?}`
  → `{forkedSessionId, parentSessionId?, …}`; refuses a session with no
  checkpoint yet ("No workspace checkpoint is available yet")
- `session/compact` `{sessionId, inputId?, instructions?, expectedRevision?}`
  → `{response, snapshot, compact:{state,…}}`; accepted on empty sessions
- workspace-scoped methods (`workspace/readState`, `mcp/list`,
  `plugins/list`, …) ALL take
  `{workspace:{workspacePath,workspaceKey}}`
- `workspace/readState` → model catalog: GLM-5.1 (200k ctx, 64k out),
  GLM-4.7 (204.8k ctx, 131k out) on "Z.AI Coding Plan", reasoning
  levels enabled/disabled — this is the TUI's model-picker source.

### Session ownership (architectural)

Sessions are **per-app-server-instance**: `session/list` reads the shared
store, but read/messages/events/subscribe on a session owned by ANOTHER
instance (e.g. the desktop's cli child) fail `-32004 "Session is not
active"`. The TUI drives sessions it `create`s or `resume`s in its own
app-server.

### Server→client asks (answer or the flow stalls)

- `session/requestRuntimePreferences` (scopes `runtime-materialization` and
  `user-execution`, fires on create/resume AND on send) → reply
  `{nativeSearchEnhancementsEnabled:boolean}` (zod MEt; defaults cover the
  rest — `memoryEnabled=false`, `askUserQuestionAutoResolutionEnabled=true`,
  `modelContextBudgetStrategy="preflight-v1"`)
- `interaction/requestOfficialMcpAuthHeaders` (un-authed official plugin
  MCP, e.g. image_search) — failing it is harmless
- `interaction/requestPermission` / `interaction/requestUserInput` — the
  ask flows (reply shapes still to pin under load)

### Live stream taxonomy (from probe:live, tiny prompt, turn done in ~8.5 s)

Pushes during a turn: `state.updated` (`{patch:{status},reason,revision,
scope,sessionId}`), `session/event` (the main feed: title change, turn
lifecycle, text content deltas, final `response`), `v4/telemetry/event`
mirror (`turn.started`, `model.request.status`, `usage.delta`,
`turn.terminal`), `computer-use/operation-event`, `process/mcpTelemetry`.
`send ack {accepted, stateRevision}` arrives immediately; first content at
~10.9 s wall (model latency included).

### Live stream contract (phase-5 precision; probe:live classifies payloads)

After `session/subscribe {sessionId, deliveryKind:"desktop-continuous"}`:

- `session/event` with **typed** payloads: `type:"text_delta"`,
  `type:"reasoning_delta"` (streaming deltas), plus untyped lifecycle
  payloads discriminated by key shape:
  - `{previousTitle,source,title}` — title generated/changed
  - `{turnNumber,input,messageId,foregroundExecutionId,queryId}` — turn
    started (echoes the user input)
  - `{content,contextWindow,querySource,stopReason,usage,cacheHit,
    contextUsageBreakdown,toolCallCount}` — **authoritative final turn
    content** (replace the streamed tail with `content`)
  - `{response,tokenCount,usage,toolCallCount,historyRoundCount,duration,
    resultType,cacheStats}` — turn summary (backfills an empty tail)
- `state.updated` `{patch:{status},reason,revision,scope,sessionId}` —
  running/idle machine
- `v4/telemetry/event` mirror: `turn.started`, `model.request.status`,
  `usage.delta`, `turn.terminal`; also `process/mcpTelemetry`,
  `process/resourceSample`, `computer-use/operation-event`
- `session/event model_request_completed` (typed) carries provider
  telemetry: `timeToFirstContentMs`, `timeToFirstTextMs`, `finishReason`,
  `usage`, `maxAttempts`, `streamStallCount`, … (stats-line fodder)

⚠ **A session MUST be subscribed or the UI sees no events** — send is
accepted and runs server-side silently otherwise. (This exact bug bit the
first TUI send path; symptom: "streaming…" forever, answer only in store.)

Baseline system-prompt cost observed: a trivial turn reports ~38.5k input
tokens on glm-5.1 (system + memories + tools).

## Not-our-layer notes

- `out/main/chunk-WR3FEWGO.js` implements "web-remote-control" RPC framing
  (crc32-checksummed base64 fragments, bridge sessions,
  `remote.rpcFrame.*` errors) — that is the BROWSER remote-control bridge,
  a separate hop; TUI v0 ignores it.
- Tool dispatch inside the runtime uses `ARGV0=` style dispatch
  (`ARGV0=bfs/rg/ugrep …`) for bundled ripgrep/bfs/ugrep binaries under
  `resources/tools/`.

## Open (phase 2)

- `session/create` + `session/send` exact params (strict zod; iterate with
  the probe — validation errors name the expected fields).
- Streaming: `session/subscribe` vs `v4/conversation/subscribe` semantics
  for a single session's deltas.
- `interaction/requestPermission` / `requestUserInput` reply shapes
  (server→client `"server-<n>"` requests).
- Whether `app-server` needs any of the desktop's env in restrained
  environments (it ran clean from our spawn on jojo).
