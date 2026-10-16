# CAMPAIGN — zcode-tui × AutoClaw integration (consolidated campaign memory)

**Last consolidation:** 2026-10-16 (autoclaw harness seat, jojo). **Board thread:**
`infra/meta` ACK-2dbf0f9e92, correction ACK-3b80ad9263. **Consults:**
`docs/consults/2026-10-16-autoclaw-model-switcher-sol.md` (round 1, sol HIGH),
`docs/consults/2026-10-16-autoclaw-integration-round2-sol.md` (round 2, sol HIGH),
`docs/evidence/2026-10-16-autoclaw-integration-measurements.md` (M1–M6, raw).

A later agent picking this campaign up should read THIS file first, then the
consults/evidence. Do not re-derive the measurements; they are staged.

---

## 1. Campaign goal (owner, verbatim intent)

`/models` in zcode-tui offers **ZCode Coding Plan, ZCode Starter Plan, AutoClaw** —
with AutoClaw rows genuinely usable. zcode-tui "takes the harness with auth" from the
proprietary desktop programs and uses them as surfaces; it never becomes an auth
authority and never ships the harness.

## 2. Owner rulings (chronological — later wins)

| Round | Ruling | Effect |
|---|---|---|
| R1 (2026-10-16 am) | Ship the grouped plans picker | Slice 1 DONE: 4fc6a18 — ZCode Coding Plan switchable, Starter honest not-entitled, AutoClaw 4 models READ-ONLY with disabled gate |
| R2 (2026-10-16 pm) | NO auth bridging (credentials.enc stays desktop-in-process); NO harness shipping; mirror the zcode pattern | Struck route A (provider registration) permanently; struck credential extraction permanently |
| **R3 (2026-10-16 evening)** | **The standalone pi track is a MISTAKE — struck.** zcode-tui takes the harness WITH AUTH from the proprietary program (ZCode desktop → zcode.cjs app-server). A separate pi login/profile would be a third auth to maintain — exactly the kind of dial the campaign exists to remove. **Also: the auth-sync config dial (`auth.source`) is dropped as a dial — derive dynamically from the yggterm connected fleet; the config file remains for manual override (user/agent-edited).** | Sol round-2 slices 2–3 (standalone probe, pi backend adapter) are DEAD — do not resurrect. The AutoClaw backend is ONE track: upstream-gated (W1). Auth-source discovery becomes W2 (buildable now). |

## 3. State of the world (measured — trust these, then re-verify cheaply)

- ZCode pattern: TUI spawns `ELECTRON_RUN_AS_NODE=1 /opt/ZCode/zcode
  resources/glm/zcode.cjs app-server` (NDJSON JSON-RPC; auth in-process to that
  runtime). Precondition of the pattern: the desktop ships an external protocol host.
- AutoClaw 2.0.3 does NOT ship one (measured: no app-server/headless entry in
  `main.cjs`; zwork-agent runs in-process — 1026 bundled modules; auth =
  `ProductAccountCredentialVault` → `account-credentials.enc`, decrypted in-process,
  injected via `resolveProviderAuth`). Provider of record: `zwork-managed`.
- The bundled `@earendil-works/pi-coding-agent` v0.83.0 exposes `rpc-entry.js` (JSONL;
  32 commands incl. `new_session/set_model/get_available_models/get_state`) — probed
  live. Its standalone auth store is EMPTY and is NOT the desktop's plan auth.
- Standalone pi 1.3.0 (ynpm) RPC surface is a strict superset (adds `clear_queue`);
  honors `PI_CODING_AGENT_DIR`; `~/.pi/agent/models.json` providers work with
  `$ENV`/`!cmd` key indirection (fleet skill §Pi) — IRRELEVANT to this campaign now
  (R3), but documented for the upstream ask: an AutoClaw external host could expose
  this same protocol shape with desktop auth in-process.
- AutoClaw DOES have a real automation system (scheduled-automation kernel:
  `scheduled_task.create/replace/delete/set_enabled`, `agent_prompt` ≤32k with
  watchdog, `registered_program`, occurrence history, misfire/overlap/retry policies)
  — in-process only, no external transport.
- Fleet auth scaffolding (zcode side, existing and working):
  `src/auth/sync.ts` — config file `~/.config/zcode-tui/config.json`
  (`auth.source`, default jojo per fleet law 2026-09-17) → ssh-fetch SSOT
  `~/.zcode/v2/provider_config.json` → store (0600) + sha256 fingerprint → surgical
  heal of local settings with dated backups → hand to backend via
  `ZCODE_PERSONAL_PROVIDER_CONFIG_FILE`. Hub-and-spoke `ygg-zcode-sync` rsyncs the
  `.zcode` config plane (md5-verified). `ygg-auth.py` HARNESSES registry = codex,
  claude (no pi — and none needed under R3).

## 4. Pending work (for the next agent)

### W1 — AutoClaw external protocol host (UPSTREAM ASK — blocks the headline goal)
**Ask:** AutoClaw ships an external protocol host — the exact analog of
`zcode.cjs app-server` — exposing session lifecycle, model catalog + selection,
streamed events, cancellation, persistence, auth-expiry handling, while product-account
credentials stay in-process. The internal runtime-publication-hub already names
headless consumers ("the headless CLI: stream-json, ACP `rawInput`"), so this is an
exposure/packaging ask, not a redesign.
**Acceptance:** from zcode-tui, with NO AutoClaw credential export: authenticated
catalog/state query succeeds; one inference attributed to AutoClaw credits; refresh/
reauth; restart/resume; backend+meter identity visible in the footer.
**Falsifier:** no such endpoint answers → stop; do not build a TUI adapter against
guessed protocols; do NOT extract credentials as a workaround (R2).
**Where to file:** upstream Zhipu AutoClaw channel + `infra/meta` pointer.

### W2 — dynamic auth source for the zcode sync (BUILDABLE NOW, no blockers)
Drop `auth.source` as an operating dial. New resolution order in `loadAuthConfig()`:
1. `ZCODE_TUI_AUTH_SOURCE` env (explicit escape hatch — kept);
2. config file `auth.source` (manual override; users/agents may still edit — the file
   STAYS, it just stops being a required dial);
3. **NEW default: derive from yggterm connected fleet** — read
   `~/.yggterm/auth/.fleet-hosts` (comma-separated, hub-first; measured
   `jojo,dev,oc,practice`); hub = first host; probe reachability once
   (`ssh -o BatchMode=yes -o ConnectTimeout=3 <hub> true`); absent/unreachable →
   previous behavior (default "jojo", then fail-soft boot).
Re-derived EVERY startup → yggterm fleet updates propagate automatically ("one less
dial"). Zero behavior change on hosts without yggterm.
**Acceptance:** delete the config file on a yggterm host → source = fleet hub; flip
roster order in a sandbox → next start follows; no yggterm → unchanged fail-soft boot.
**Falsifier:** a sandbox roster with a different first host must be followed (proves
dynamic), and a missing roster must NOT break boot (proves fail-soft).
**Note:** keep the existing ssh-fetch/store/heal/fingerprint machinery untouched —
this item changes only WHERE the source host comes from.

### W3 — picker enablement of AutoClaw rows (BLOCKED by W1)
When W1 lands: enable the four product rows behind the existing guardrails — route
identity (backend+profile+billing scope+plan+providerId+modelId), readback ≠ billing
attribution, no silent fallback, footer shows backend+meter. Reuse slice-1's disabled
gate machinery for any still-unavailable state. Standalone-pi rows: NONE (R3).

### STRUCK — do not resurrect
- Standalone pi track in ANY form (probe, adapter, scaffolding of `~/.pi/agent`,
  pi login dial) — R3: the pi agent is a vestige of a misunderstanding; zcode-tui
  users must never need a pi login.
- Bridging/extracting `credentials.enc` — R2.
- Registering AutoClaw model ids inside the `zai` provider — R1 (round-1 route A).

## 5. Pointers
- Prep doc (external, AutoClaw workspace):
  `autoclaw-zcode-tui-integration-prep.md` (v3 carries R3 banner; technical detail).
- Fleet context: `~/gh/yggterm/.agents/skills/yggterm-agent-fleet/SKILL.md`
  (ygg-auth §3f, ygg-zcode-sync, fleet roster), `~/data/msggraph/README.md`.
