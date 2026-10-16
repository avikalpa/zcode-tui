**accept — Q1(c), as two explicitly separate tracks.** Standalone pi can become a usable backend for user-configured providers. It cannot make AutoClaw plan models usable. Completing the owner’s requested AutoClaw integration requires a desktop-owned external protocol host that retains product-account auth in-process.

This verdict uses only the staged evidence; I have not repeated its measurements.

1. **Q1 ROUTE — accept the hybrid; rebut standalone pi as AutoClaw plan access.**

   The honest architecture is:

   ```text
   zcode-tui surface
     ├─ ZCode adapter → installed zcode.cjs app-server → ZCode auth/store
     ├─ Pi adapter    → installed pi rpc-entry         → standalone pi auth/store
     └─ AutoClaw adapter → desktop-owned protocol host → AutoClaw auth/store
                          [missing in measured 2.0.3]
   ```

   M2 proves that pi RPC starts, creates a session, and reports state. Its empty model inventory demonstrates the separation from desktop auth. M6 describes the standalone configuration route; it does **not** provide an authenticated inference proof. [M2 and M6](03-fresh-measurements.md)

   Therefore:

   - **(a) accept conditionally:** launch the locally installed runtime, use an explicit `PI_CODING_AGENT_DIR`, and let pi own authentication. Package adapter code only—no harness copy, extraction, or automatic download.
   - **(b) accept as the dependency for AutoClaw plan completion:** request an external host that exposes inference while keeping credentials inside the desktop-owned runtime.
   - **(c) accept as the practical development plan:** optional standalone pi support now; AutoClaw plan execution remains gated on that host.

   Under the measured 2.0.3 interfaces and owner constraints, there is no demonstrated route to AutoClaw credits. This establishes a **missing interface**, not impossibility of future upstream implementation. Internal stream-json/ACP references establish architectural anticipation, not a callable endpoint. [M1 and M3](03-fresh-measurements.md)

   AutoClaw **does have scheduled automation**: agent prompts and registered programs, with scheduling, retries, overlap policies, and history. Those internal verbs do not supply the missing external transport.

2. **Q2 SEMANTICS — accept three top-level groups; rebut mixing their spending authorities.**

   Keep the shipped grouping. Within AutoClaw, distinguish product-plan inventory from optional standalone execution:

   ```text
   AutoClaw
     Desktop plan · AutoClaw credits · unavailable from this TUI
       Auto             · 1M · credit level unknown
       Auto-Fast        · 1M · credit level unknown
       GLM-5.3          · 1M · credit level High
       GLM-5.3-Flash    · 1M · credit level Low
       Requires AutoClaw external runtime support

     Standalone pi · separately configured provider billing
       No providers configured
       [Once configured: provider / model · profile label]
   ```

   “Requires desktop” alone is misleading: running the current desktop does not enable these rows. Name the missing external runtime support.

   If standalone pi is offered inside this group to preserve the requested three-group layout, label it **“Standalone pi — uses installed AutoClaw runtime; separate provider billing.”** Repeat that distinction in search results and the active-session footer. It must never inherit an “AutoClaw credits” label.

   Standalone pi is an optional additional capability, **not fulfillment of the AutoClaw plan requirement**. All four product-plan rows stay disabled until their genuine backend works. High/Low are qualitative catalog labels, not prices or multipliers. [M4–M6](03-fresh-measurements.md)

3. **Q3 GUARDRAILS — accept an exact execution-route allowlist plus immutable session ownership.**

   Model names are insufficient. Use a route identity containing:

   ```text
   backend + runtime/profile reference + account/billing scope
           + plan + exact providerId + exact modelId
   ```

   References are non-secret identifiers; the TUI must not read credential files to construct them.

   Enforce these rules at the execution boundary:

   - **Discovery is not authorization.** Intersect approved routes with the runtime’s current inventory and capabilities. A newly discovered provider or model remains informational until explicitly enabled with its billing identity.
   - **Preserve the existing ZCode approvals.** Neither AutoClaw catalog entries nor pi discovery may expand those routes.
   - **Keep product routes separate.** A `zwork-managed` name in standalone configuration is not proof of AutoClaw plan authority. Require the desktop-owned host contract for product-plan routes.
   - **Make provider spend explicit.** Standalone selection says it uses that provider’s billing. Unknown tariffs can be labelled unknown; they cannot be presented as plan coverage.
   - **Prevent ambient changes.** Fix the selected profile and launch configuration. Do not accidentally inherit unrelated provider keys. Provider/account configuration changes invalidate the previous route approval; credential refresh within the same authority remains the runtime’s responsibility.
   - **Bind each session to its backend, profile, and billing scope.** Crossing any of those boundaries creates or opens a separate session. Never migrate history implicitly.
   - **Serialize selection and sending.** Finish or explicitly abort the current turn before changing models. Read back the accepted model before enabling the next send; reject stale events from previous backend instances.
   - **No silent fallback or replay.** Auth failure, quota failure, process loss, or unavailable models must not switch providers, accounts, plans, or replay an uncertain prompt after restart.
   - **Apply every gate everywhere:** picker, shortcuts, defaults, restored sessions, and programmatic requests.

   A successful `set_model` readback proves selection, **not billing attribution or successful inference**. Likewise, pi resume must use its own session mechanism; ZCode’s store/reflection behavior cannot be assumed for pi. [Existing session architecture](04-zcode-tui-architecture.md)

4. **Q4 SLICES — accept capability-first development after shipped slice 1.**

   Treat **4fc6a18 as completed inventory/UI groundwork**, not backend completion.

   | Next slice | Scope and effect-level proof | Cheapest falsifier |
   |---|---|---|
   | **2. Bounded standalone capability probe** | Use a user-prepared, explicit pi profile with the installed runtime. Enumerate, select/read back, complete one bounded inference, observe streaming, abort, restart, and resume. Record the provider’s billing authority; verify attribution through provider usage where available. Exercise reauthentication/refresh if claiming durable auth support. | The present empty profile immediately falsifies “usable now.” An authenticated prompt or resume failure blocks integration claims. |
   | **3. Optional standalone pi integration** | Introduce a small backend interface around model discovery/selection, session lifecycle, normalized events, send, abort, and loss handling. Keep the existing ZCode client behind its adapter; implement pi separately. From the actual picker: start a clearly labelled pi session, stream/cancel/resume, return to the intact ZCode session. Verify disabled product rows issue no execution requests and unsupported capabilities remain unavailable. | A late event changes the wrong conversation; a discovered route bypasses approval; reconnect replays a prompt; or the displayed meter differs from the route executed. |
   | **4. Genuine AutoClaw plan integration—host-gated** | Obtain a desktop-owned external host exposing catalog, account/billing identity, inference/events, cancellation, persistence, and auth-expiry handling. Then enable exact product routes. Prove actual AutoClaw-credit attribution, refresh/reauthentication, restart/resume, and visible backend identity from the real TUI. | First require authenticated catalog/state through the proposed external endpoint **without credential export**. If that fails, stop before building the adapter. |

   For slice 3, do not forward ZCode JSON-RPC unchanged to pi JSONL. Normalize their differences, and advertise capabilities explicitly. ZCode plugins, automation, permission asks, attachments, and session indexing are not established pi equivalents.

   **defer — these measurements are still missing:** authenticated standalone inference and meter attribution; pi event/correlation/error behavior; refresh, cancellation, and persistence behavior; tool/permission semantics; installed-runtime discovery and upgrade compatibility; and the entire external AutoClaw host contract. The staged command inventory alone proves none of those effects.

**Implementation recommendation:** proceed with the bounded probe and backend separation. Offer standalone pi only with its separate billing semantics. Keep genuine AutoClaw plan integration explicitly open until a desktop-owned host passes the capability gate; do not relabel standalone-provider success as completion.
