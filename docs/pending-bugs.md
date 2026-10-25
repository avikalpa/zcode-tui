# zcode-tui pending bugs (1.0.0 polish)

## BUG-001: mid-session stall — quiet-window, stale-reclaim, and transcript truncation all miss (2026-10-24)
Symptom: a 45-min-class big dream (ztq-d087cb67, GLM-5.3) froze mid-run: transcript last
event ms≈711s, then 24+ min silence with the run.ts process alive; the 600s tool-quiet
window never fired its cut; the route's 45-min stale-reclaim never fired; the transcript
file truncated 4.6MB → 4.6KB while frozen.
Kill-path defect: manual SIGTERM → the queue classified it "auth/config (terminal)"
(no retry) instead of stall/transient.
Fix requirements: (1) quiet-window must fire on writeTranscript silence (not only on
event-stream silence); (2) reclaimStale must consider started_at + heartbeat, not only
route timeout; (3) SIGTERM on a running task → outcome "stalled", retryable; (4) find
and fix the transcript truncation path (writeTranscript rewriting vs appending).
Owner law: ALWAYS root-cause zcode-tui defects — alpha polish until 1.0.0.

## BUG-002: thinking blocks render tiny (UX parity)
opencode renders thinking as collapsible, visually distinct blocks; zcode-tui renders
them flat/small. Owned by the 4-day UX-parity grind (lane/zcode-tui/ux-sol-parity-2).

## BUG-003 (fixed, verify in production): reasoning effort defaulted low
Executors injected output_config effort:"low" (bisect-era) and run.ts sessions never
set reasoningLevel. Landed: effort:"max" + reasoning:true in idle/autoclaw executors,
session/create options reasoningLevel:"enabled" in run.ts (owner law: MAX thinking on
all zai/start/autoclaw plans). VERIFY: next natural sessions show max-effort thinking.

## BUG-004 — provider turn-kill class `project_token_request_failed` (reason=unknown, retryable=false) — OPEN (2026-10-24)
Observed LIVE on the ZCode desktop (owner report 11:09 AM, GLM-5.3-Flash Max
session): mid-turn the provider killed the turn with
`Turn execution failed provider=account:zai-individual-coding-plan
model=GLM-5.3-Flash reason=unknown retryable=false` and the desktop stalled —
the owner had to steer it back by hand.
**zcode-tui contract:** this class is STEER-class, never STOP-class —
`run.ts` STOP_KINDS (auth/quota/permission/insufficient/cancelled/forbidden)
must never match it (verified: "project_token_request_failed" matches none;
the quiet-window continue-steer picks it up). Executed dream routes (idle.ts,
autoclaw.ts) surface it as providerError → rc=1 → the queue retry ladder
requeues honestly. VERIFY on the next live occurrence: the transcript must
show a steer, not a stop. Desktop-side tolerance is a ZCode-desktop defect,
not fixable here — noted for the campaign report.

### BUG-005 addendum (2026-10-24 late) — narrowed to ONE unknown
Bundle ground truth (zwork ManagedModelRequestRuntime): chat auth is
**X-Authorization** (the runtime nulls Authorization and sets X-Authorization
from the account credential), plus resolveHeaders adds X-Session-Id,
X-Request-Model, X-Client-Type, x_trace_id=autoclaw-desktop, and the chat
client sends x-api-key: "zwork-managed-model" (constant) + its own
user-agent. With that exact shape the direct probe moved 401 → **406
(empty body)** across all model ids and accept/version/stream/beta variants.
The desktop's token-usage log proves the plane works (provider=zwork-managed,
model=zai_glm-5.3-flash, 990 requests). Remaining unknown: one request
dimension a direct probe cannot see (likely renderer-session-scoped header
or cookie, or a body-affecting transform). Root cause requires one captured
real desktop chat request (owner approved). Interim: parity dreamer runs on
zai; autoclaw proof task parked (ztq-d46252ed).
## BUG-005 — AutoClaw managed chat rejects all held credentials (401 Invalid token) — CLOSED 2026-10-25

Closed by the owning agent session: the AutoClaw plan is stable on zcode-tui
and usable from any fleet machine (owner-confirmed 2026-10-25). The swarm
plane  was re-enabled through the swarm-config ledger
(revision 4, d08bfa669d48, owner-endorsed proposal from jojo).

## BUG-006 — TUI focus test fails on main: dialog-close leaves toast overlay, composer not re-focused — OPEN
`bun test src/tui/app.test.tsx` — "closing a text dialog releases editor focus
back to the App composer" fails on pristine origin/main (2026-10-24, verified
in a clean worktree): the rendered frame shows the toast ("rename pending host
support · Fixture renamed") occupying the viewport and no "Status" dialog.
Toast/dialog interplay — likely the toast render racing the dialog close in
the test harness, or a real focus regression from the sitting-4 paste-fold/toast
units. Pre-dates lane/model-default-resolution (verified). Needs: repro with
toast disabled, then root-cause in toast.tsx/dialog focus wiring.
