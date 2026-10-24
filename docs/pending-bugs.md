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

## BUG-005 — AutoClaw managed chat rejects all held credentials (401 Invalid token) — OPEN, owner-gated
Discovered 2026-10-24 while chasing the owner's report: autoclaw credits
unused for 24h+ (dashboard). Chain: (1) route rotation bug — per-ns count
pinned every dream on zai (fixed, yggterm 286ea909+); (2) gateway dropped
legacy X-Authorization in a server deploy between 10/23-24 — signHeaders now
sends Authorization; **catalog (model-config) 200 with the desktop's live
token**; (3) the desktop rotated its token at 11:29 (owner re-auth) revoking
the mined plan copy — fleet sync left dev stale via the (local-newer) mtime
race (fix: validity-checked sync, not mtime); (4) STILL OPEN: chat
(POST /autoclaw-proxy/proxy/autoclaw/v1/messages) returns 401 Invalid token
for EVERY auth shape we hold — account access token via Authorization /
x-api-key / both, all model-id families, desktop's own decrypted live token
(iat 16:04, valid to 10/25) — while the desktop's own chat works. The chat
path carries an auth dimension not in the mined wire contract (renderer
session cookie, body signature, or a second token minted at chat time).
NEEDS: capture one real desktop chat request (owner-approved proxy
instrumentation) or the missing contract field from the 2.0.3 bundle.
Proof-task ztq-d46252ed parked; re-enqueue when (4) lands.
