**Verdict: accept C as the first slice; defer B behind an auth proof; reject A as a provider-config-only solution.** C delivers plan visibility, but it must be described as the first increment toward the requested switcher.

I treat the jojo measurements dated **2026-10-16** in [BRIEF.md](/tmp/sol-tui-consult/BRIEF.md:11) as supplied evidence, not independently repeated measurements.

**Q1 — Route and feasibility**

| Route | Decision | Reason |
|---|---|---|
| **A: AutoClaw provider inside ZCode** | Reject as presently specified | `workspace/upsertModelProvider` registers configuration; it does not acquire AutoClaw credentials, refresh them, implement its request protocol, or establish its billing meter. |
| **B: AutoClaw/pi backend** | Preferred conditional end-state | It preserves the separate runtime/account boundary, but requires AutoClaw’s auth and provider integration—not merely its bundled executable. |
| **C: unified selector with read-only AutoClaw entries** | Ship first | Supported by the measured catalog, with explicit unavailable/unknown states and no inference requests from AutoClaw rows. |

The current TUI launches ZCode’s own `zcode.cjs app-server`, uses JSON-RPC, and changes models through `session/setModel`. Its hard allowlist contains exactly `zai/GLM-5.3-Flash` and `zai/GLM-5.3`; `loadModels()` deliberately ignores additional runtime catalog entries. Those are the existing execution boundary and regression guard. [Supplied measurements](/tmp/sol-tui-consult/BRIEF.md:14)

For **A**, adding AutoClaw IDs to the existing `zai` models map is insufficient. That provider currently targets `https://api.z.ai/api/anthropic`; an AutoClaw model name does not make that endpoint consume AutoClaw credits. A separate provider identity would be necessary if this route eventually works. [Supplied configuration](/tmp/sol-tui-consult/BRIEF.md:29)

For **B**, upstream pi **v0.83.0** documents the required control primitives:

| TUI operation | Pi RPC command |
|---|---|
| Create a fresh session | `new_session` |
| Select a model | `set_model` |
| Obtain configured models | `get_available_models` |
| Read selected model/session | `get_state` |

This is JSONL over stdin/stdout, requiring an adapter rather than forwarding ZCode JSON-RPC messages unchanged. The exact bundled build still needs a local compatibility probe. [Version-pinned pi RPC documentation](https://raw.githubusercontent.com/earendil-works/pi/v0.83.0/packages/coding-agent/docs/rpc.md)

**The missing piece is an AutoClaw provider/auth bridge:** something must answer pi’s provider-header requests using the correct account, perform credential refresh, and supply the provider configuration needed for AutoClaw inference. The measured desktop obtains this through its in-process model-connections service and encrypted `credentials.enc`. Launching `rpc-entry.js` alone does not recreate that service. [Supplied AutoClaw measurements](/tmp/sol-tui-consult/BRIEF.md:40)

Distinguish these conclusions carefully:

- **Impossible with the proposed configuration alone:** deriving authenticated AutoClaw plan access from model IDs, a catalog snapshot, or a ZCode provider-registry entry.
- **Not established as impossible without upstream:** implementing a local desktop-backed bridge or a compatible standalone auth/provider adapter. These are unwritten and unproven.
- **Upstream-dependent if no usable external interface exists:** a supported standalone AutoClaw login/token-refresh interface or desktop inference bridge. The supplied evidence establishes “no documented interface,” not “no possible interface.”

The honest end-state is a unified selector dispatching to independently authenticated backends. Crossing from ZCode to AutoClaw should initially **create/open an AutoClaw-backed session**, with an explicit action label. Existing ZCode conversation history must not silently become a pi session.

**Q2 — Selector shape**

Use **one searchable picker with grouped sections**, preserving the current keyboard selection path. Three groups do not justify a mandatory plan-then-model step.

Proposed content:

```text
ZCode Coding Plan · ZCode account · plan quota
  GLM-5.3-Flash
  GLM-5.3

ZCode Starter Plan · unavailable: not entitled

AutoClaw · separate account · AutoClaw credits · desktop only
  Auto           · 1M · credit level unknown
  Auto-Fast      · 1M · credit level unknown
  GLM-5.3        · 1M · credit level High
  GLM-5.3-Flash  · 1M · credit level Low
  Not switchable from this TUI
```

The ZCode plan labels above are **conditional on proving the route-to-plan mapping**. The current provider name `zai`, known builtin plan strings, and an available entitlement cache entry do not by themselves prove which meter serves the current custom provider.

Carry these fields in the selection record:

`backend + accountRef + planId + providerId + exact modelId`

Keep the backend, plan, and meter visible in the selected-model footer too. Flattened search results must repeat the group identity so two GLM-5.3 entries remain distinguishable.

`creditConsumptionLevel` is a qualitative catalog attribute. Display **“Credit level: High/Low”**, not invented prices or multipliers. Do not infer Auto/Auto-Fast consumption from their names. The measured catalog contains those four models, all with 1M context. [Supplied catalog](/tmp/sol-tui-consult/BRIEF.md:43)

**Q3 — Guardrail**

Replace the global model-name allowlist with an **explicit allowlist of execution routes per backend and plan**, intersected with current runtime capability and entitlement evidence.

```text
selectable =
  approved exact route
  AND backend supports route
  AND relevant account/auth is ready
  AND relevant plan entitlement permits it
```

Use the backend’s existing auth authority for working legacy routes; do not invent a new credential reader.

Additional rules:

- Catalog discovery may add **informational rows**, never automatically executable routes.
- ZCode’s `coding-plan-cache.json` describes ZCode entitlements. **It says nothing about AutoClaw entitlement or remaining credits.**
- Cached entitlement is timestamped evidence, not final authorization. Refresh through the runtime where supported; missing or stale evidence becomes “unknown.”
- Preserve exact model IDs and casing; aliases require an explicit mapping.
- Apply the same gate to picker clicks, shortcuts, restored defaults, and programmatic changes.
- Commit the displayed selection only after backend acceptance/readback. On rejection, retain the previous selection and expose the reason.
- Never fall back automatically to another provider or spending meter.

“Never send something the resolver would reject” is an aspiration, not an implementable guarantee: auth and entitlements can change between checks. Validate locally, then handle authoritative runtime rejection without fallback.

**Q4 — Suggested board post**

> **zcode-tui plans decision — sol consult, 2026-10-16:** First slice: grouped, searchable plan/model picker; preserve approved ZCode routes, show Starter’s measured not-entitled state, and show AutoClaw’s four catalog models read-only with separate-account/credits labels. ZCode entitlement cache must not imply AutoClaw entitlement. Provider registration and pi RPC alone do not supply AutoClaw auth. Next: bounded proof of a provider-header/refresh bridge before building a second backend. A supported external auth/desktop bridge may require upstream; technical impossibility without upstream is not established. Cross-backend selection initially opens a separate session; no silent billing fallback.

This is proposed board text; I have not posted it.

**Q5 — Three ordered slices**

| Slice | Effect-level proof | Cheapest falsifier |
|---|---|---|
| **1. Route model and picker** | Render all three groups; switch both existing approved ZCode models; read back the selected model; exercise keyboard/click/restore paths against disabled AutoClaw entries and verify zero mutation requests. Inject an unexpected paid catalog entry and verify it cannot become selectable. | Both plans collapse to the same unqualified route identity, or a disabled/unknown route reaches the mutation boundary. |
| **2. Disposable AutoClaw capability/auth probe** | Against the bundled build, create a session, enumerate/select models, complete one bounded inference, and verify AutoClaw usage attribution. Exercise refresh or reauthentication rather than proving only a borrowed token works once. | Pi reaches a provider-header request that cannot be answered through the available desktop/standalone integration. Stop backend implementation there and record the precise missing contract. |
| **3. Conditional backend integration** | From the real picker, open an AutoClaw-backed session, receive streamed output, cancel a turn, resume it, and return to the intact ZCode session. Confirm backend/model/account/meter identity remains visible throughout. | A backend change reuses the wrong session store, silently changes meters, or reports selection success before authenticated inference works. |

Start implementation with slice 1. Build the second backend only after slice 2 proves the account-backed inference path.


