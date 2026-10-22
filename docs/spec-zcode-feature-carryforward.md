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
- MEASURED: dev's app-server build answers `automation/list` with
  **Method not found** → the Automations panel is NOT served by this
  app-server build. Working hypothesis: the desktop main process serves
  it (possibly backed by the Z.AI cloud account — the creation cooldown
  "Free tier limit reached … in 4 hr 38 min" is server-enforced state).
- Per-host capability must therefore be DISCOVERED (probe + version),
  never assumed. `zcode-tui automations list` on an unservable host
  reports the gap honestly instead of failing.

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

- **S1 (this commit): the discovery verb.** `zcode-tui automations list`
  probes the method family on the host's runtime and prints the
  capability verdict + any returned tasks; `--json` for machines.
  Discovery of the serving channel (desktop main vs app-server vs cloud)
  is part of the output (`servedBy`).
- **S2: create/list parity.** `zcode-tui automations create --kind idle
  --prompt-file F` mapping to `automation/create` once the params schema
  is recovered (from the desktop main bundle or protocol trace); includes
  queue-number display and cooldown-aware refusal.
- **S3: dream scaffold integration.** The dream batch executor registers
  its 3 daily jobs (1 BIG + 2 MODERATE) as idle-time tasks via S2, and
  reconciles their Succeeded/Failed states into dream-log telemetry.
- **S4: scheduled tasks + templates** parity (lower priority).

## 6. Open questions (blocking S2)

- Which channel serves `automation/*` (desktop main process? cloud REST?
  a newer app-server build?) — candidates to test: jojo's desktop runtime
  (provider-config quirk must be solved first), a protocol trace of the
  desktop while clicking "Create idle-time task" (the microscope pattern
  from 0.6.38), and newer ZCode builds.
- The exact create-params schema (prompt, kind=idle, queue binding,
  schedule) — recover from the desktop main bundle or a traced session.
- Whether idle-task execution requires the desktop awake on the machine
  that owns the task (the "keep computer awake" toggle suggests yes) —
  this decides which fleet host should own dream idle-tasks (dev/oc are
  always-on; jojo sleeps).
