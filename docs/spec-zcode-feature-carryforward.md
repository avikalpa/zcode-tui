# SPEC: ZCode exclusive-feature carry-forward into zcode-tui

Status: DRAFT v1 (2026-10-22) · Owner vision, captured verbatim-in-intent:
"zcode-tui should create these [idle-time tasks] and show us the registered
[state] like ZCode. This gives us the flexibility to access exclusive ZCode
features outside ZCode on any ssh system using an installed and
authenticated ZCode harness on a desktop machine (like jojo). This opens up
flexibility for our ygg harness system, automation and dreaming
scaffolding."

## 1. Vision

ZCode desktop ships exclusive capabilities (Automations → Idle-time tasks,
scheduled tasks, plugins, skills). The fleet's seats live on ssh hosts —
they cannot click the desktop UI. zcode-tui already speaks the desktop's
own app-server protocol with the desktop's own identity and stores; every
ZCode feature that rides that protocol should therefore be reachable from
any fleet host — without reimplementing, impersonating, or destabilizing
first-party ZCode.

## 2. The discovery law (how we find features)

ZCode's runtime bundle is the protocol truth. Feature surfaces are found by
mining `/opt/ZCode/resources/glm/zcode.cjs` for dispatch-table method
strings, then probing them against a servable app-server:

- 2026-10-22: `automation/list|create|update|delete|checkTaskBinding`
  found as dispatch-table keys (`automationCreate: "automation/create"`,
  …). Trigger/schedule vocabulary co-located (`trigger`, `schedule`,
  `triggerbindings`, `triggertemplates`).
- MEASURED (2026-10-22, both hosts): dev's app-server AND jojo's
  app-server (same packaged build as the desktop showing the panel, after
  fixing its provider-config servability) both answer `automation/list`
  with **Method not found** → the Automations panel is served by the
  desktop MAIN process (Electron main side — likely backed by the Z.AI
  cloud account; the creation cooldown "Free tier limit reached … in
  4 hr 38 min" is server-enforced state). The dispatch-table keys in the
  runtime bundle belong to the desktop main ↔ cloud/renderer channel,
  not the app-server protocol. CONFIRMED: app-server mode never routes
  automations on any host tested.
- Per-host capability must therefore be DISCOVERED (probe + version),
  never assumed. `zcode-tui automations list` on an unservable host
  reports the gap honestly instead of failing.
- BREAKTHROUGH (2026-10-22 late, bundle-mined + measured): idle-task
  CREATION is session-tool-reachable. The packaged runtime exposes an
  `OffPeakCreate` agent tool (`offPeakCreateHandler`: schema
  `{title, prompt, permissionMode?, model?}` → result `{offPeakTaskId,
  queuePosition?, sessionId?}`) opted into a session via
  `session/create {offPeakToolEnabled:true}`. The handler calls
  `offPeakPort.create` → server ticket → `off_peak_tasks` row (with
  `server_ticket_id`). This is the desktop's own path — no HID, no
  desktop-main trace needed. `zcode-tui idle create` (0.7.2) drives it;
  execution still requires a polling runtime on the creating host, so
  create runs against the desktop host (queue route `zai-offpeak` rides
  ssh dev→jojo).

## 3. Observed first-party behavior to replicate (ZCode desktop, screenshot 2026-10-22)

- Automations panel: tabs `Scheduled tasks` / `Idle-time task`; filters
  All / In progress / Completed / Failed.
- Idle-time task fields (observed): untitled-by-default prompt text,
  status (Succeeded / Failed), "Runs in: <task name>" continuation link.
- Creation cooldown: "Free tier limit reached. You can create another
  task in 4 hr 38 min." — server-enforced; free tier ≈ spaced creation.
- Idle tasks are assigned queue numbers (`#{Queue numbers}` per owner).
- Toggle: "Keep your computer awake while ZCode is running a chat."
- Templates gallery: e.g. "Standup Git Summary", "CI Failures & Flaky
  Test Report" ("Soonest available").
- Idle-plan model ids (owner): `zai-offpeak-idle-plan/{model}` — distinct
  from Coding Plan models; allocation is server-side black box; NOT
  exposed via app-server `modelCatalog` on dev's build (measured:
  only `zai/*` Coding Plan entries).

## 4. Carry-forward rules (the "no infringement, no damage" law)

1. **Client, never reimplementation.** zcode-tui drives the packaged
   runtime / cloud endpoints exactly as the desktop does. We never
   reverse the agent loop, never forge identity, never bypass entitlement
   checks. A feature the host cannot serve is reported, not emulated.
2. **Entitlement honesty.** Plan/privilege state (coding-plan-cache.json,
   server cooldowns) is surfaced as-is. No plan-label leakage into
   third-party tools; no silent billing fallback; disabled routes never
   reach the mutation boundary.
3. **Naming law.** "ZCode" is Z.ai's trademark (AGENTS.md): keep fork
   naming purely descriptive ("zcode-tui automations (unofficial
   client)"). No ZCode UI assets, no impersonation of the first-party
   product.
4. **Graceful degradation.** Every carried feature is a probe + capability
   report first (`--json` capability block), so fleet schedulers (dream
   scaffolding, peak-window policy) can route around missing surfaces.
5. **Fleet policy layers on top, never inside.** Consumption-window law
   (zai/autoclaw peak 11:30–15:30 IST), dream-class allocation, and
   spend caps live in fleet tooling (zai_peak_window.py,
   dream-classes.json), not in the client protocol layer.
6. **First-party safety.** Nothing here may destabilize the desktop:
   no writes to stores the desktop owns (db.sqlite schema, credentials.enc),
   no concurrent-session abuse; respect server cooldowns and usage policy
   (docs.z.ai/devpack/usage-policy).

## 5. Slices

- **S0 (measured 2026-10-22): automations are NOT app-server-reachable.**
  Interim path for the dream batch: desktop-interface automation (HID
  class, on the host whose desktop owns the tasks) OR the upstream ask.
  zcode-tui still ships the S1 capability probe so fleet schedulers can
  verify per host/build.
- **S1: the capability probe verb.** `zcode-tui automations list`
  probes the method family on the host's runtime and prints the
  capability verdict + any returned tasks; `--json` for machines.
  Discovery of the serving channel (desktop main vs app-server vs cloud)
  is part of the output (`servedBy`).
- **S2: create/list parity.** LANDED for idle-time tasks (0.7.2):
  `zcode-tui idle list` (read-only off_peak_tasks with queue positions)
  and `zcode-tui idle create` (drives the OffPeakCreate tool in a
  session with offPeakToolEnabled:true; cooldown-aware refusal surfaces
  verbatim with parsed wait). Scheduled/cron automations parity (the
  desktop-main `automation/create` channel) remains open — the
  owner-UI-creation protocol trace is still the recovery path there.
- **S3: dream scaffold integration.** The dream batch executor registers
  its 3 daily jobs (1 BIG + 2 MODERATE) as idle-time tasks via S2, and
  reconciles their Succeeded/Failed states into dream-log telemetry.
- **S4: scheduled tasks + templates** parity (lower priority).

## 6. Open questions (blocking S2)

- RESOLVED 2026-10-22: the channel is the desktop main process (measured
  on jojo: app-server answers Method-not-found even with the desktop's
  own build and a servable spawn). Remaining: recover the main-process
  params schema via a desktop protocol trace while creating an idle-time
  task, or an upstream ask to expose automations in app-server mode.
- RESOLVED (0.7.2): run.ts --model maps string ids to {modelId,
  providerId:"zai"} refs and passes JSON refs verbatim — live-falsified
  (glm-5.3-flash session settled, MODEL-REF-OK). Idle-plan models stay
  catalog-invisible upstream (the OffPeakCreate `model` param takes the
  idle-plan id string; default omits it).
- The exact create-params schema (prompt, kind=idle, queue binding,
  schedule) — recover from the desktop main bundle or a traced session.
- Whether idle-task execution requires the desktop awake on the machine
  that owns the task (the "keep computer awake" toggle suggests yes) —
  this decides which fleet host should own dream idle-tasks (dev/oc are
  always-on; jojo sleeps).

## 7. Replication map for Idle-time tasks (owner question 2026-10-22: "jojo + other hosts?")

The automation splits into three tiers with different answers per host:

| Tier | jojo (desktop host) | dev / oc (headless) |
|---|---|---|
| **Create** (register 3/day idle tasks) | Interim: HID drive of the ZCode window (works today). Proper: recover the desktop-main create channel via protocol trace. | NOT POSSIBLE — no desktop; task registration is desktop-main + server-account scoped. |
| **Execute** (idle compute runs the task) | Native — ZCode desktop runs tasks when the machine is idle (this is Z.AI's design: the owner's idle local compute). | NOT POSSIBLE — the idle compute privilege is tied to the desktop identity/machine. |
| **Consume results** | Native (same store). | FULLY POSSIBLE — task runs create sessions in the shared store; zcode-tui `session/resume`, sessions-index, and ygg-memory ingest all work. |

Bottom line: jojo replicates creation (interim HID, proper via trace); the
other hosts consume results. No host other than the desktop owner-machine
can host execution — that is Z.AI's design, not a gap we can close.
Fleet integration therefore = HID-created tasks on jojo + fleet-wide
result consumption + the existing protocol-composable dream routes
(zt-run/codex/opencode) everywhere else.

## 8. Session-store findings (2026-10-22 late)

- Idle-task runs ARE app-server-addressable: the dream-campaign idle-task
  sessions live in jojo's session store and `session/resume` works on them
  (with the standard server-ask handlers). Summary exposes `sessionKind`,
  `status`, `target`, `workspace`, `traceId` — sessionKind/target are the
  discriminating fields for listing idle-task sessions (next probe: print
  them for an idle session vs an ordinary one).
- The model ref is NOT in the summary; it lives deeper (messages/parts or
  run records) — next drill: resume + inspect parts, or read the store db
  read-only.
- Fleet tools landed from this sitting: `src/bin/session-dump.ts`
  (session list with full ids), `src/bin/session-model-probe.ts`
  (resume + field extractor — needs the onServerRequest handlers when
  copied). These are the microscope's eyes for the create-channel trace.
- PERMISSION PROTOCOL (owner): the next idle-time task creation happens
  only after the owner says go — and ideally DURING the armed
  desktop-channel trace, so the create-schema is recovered in the same
  act (his 3/24h allowance is not spent on a bare repeat).

## 9. v4 gateway breakthrough + probe.ts restored (2026-10-22 late)

- The app-server's **v4 gateway IS routed** (unlike automation/*):
  `v4/conversation/workflowRuns` validates params (wants `sessionId`) —
  workflow runs are per-session and queryable from zcode-tui. This is the
  register-view path for idle-task runs.
- `v4/usage/stats` (range: all|7d|30d) works: rich usage telemetry
  (tokens, cache hit rate, tool error rate, heatmap, favorite model).
- `v4/offPeak/lifecycle` = Method not found on this build.
- probe.ts upgraded with the standard server-ask handlers (needed by any
  probe that resumes sessions) — fold into the next release commit.
- Pending: workflowRuns{sessionId} first read (interrupted), then the
  model-ref extraction from an idle-task run, then the fast-catch create
  design (timer from v4/usage/stats or the create-refusal message;
  FCFS 3-task burst with per-task fault tolerance).

## 10. 0.7.2 landing record (2026-10-23 night sitting)

- The worker queue SHIPPED native: `zcode-tui queue enqueue|list|status|
  serve` (src/bin/queue.ts + src/queue/core.ts), state in
  ~/.local/state/zcode-tui/queue (SQLite WAL, crash-safe reclaim),
  fault tolerance per the owner spec (attempt cap 3, "in X hr Y min"
  refusal parsing → route+task park, 30/60/120s+jitter backoff, one
  in-flight per route, terminal never retried), routes
  zai-coding-plan (peak-gated) / zai-offpeak (ssh→desktop host) /
  opencode-free / codex / autoclaw (honestly unavailable).
- Live-falsified: systemd serve on dev (user unit, linger); codex
  dispatch end-to-end (8KB protocol report); untimed "Free usage limit
  reached" parks the route 3h (measured: opencode free tier exhausted
  account-wide on dev AND oc tonight); run.ts --model object-ref.
- Metrics: metrics.jsonl tick/dispatch events carry queue positions
  (drain series).
- Remaining for the falsification chain: the off_peak_tasks row from a
  queue-dispatched idle create (in flight at writing), one idle-task
  session completing end-to-end (owner's two live tasks running), and
  the 40/day pressure actuals (opencode parked → tonight's volume ran on
  codex; zai-offpeak gated by the 3/24h allowance).
