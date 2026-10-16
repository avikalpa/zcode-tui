# Consult brief — sol HIGH — zcode-tui × AutoClaw integration (round 2)

DECISION SOUGHT: architecture verdict + slice plan for integrating AutoClaw as a
USABLE backend in zcode-tui's /models, under the owner's NEW constraints.

## Owner constraints (2026-10-16, supersede prior framing)
1. NO auth bridging: zcode-tui must never hold/extract/bridge AutoClaw desktop
   credentials (credentials.enc stays desktop-in-process).
2. NO harness shipping: zcode-tui must not bundle/ship the AutoClaw (pi) harness.
3. MIRROR the zcode pattern: the TUI spawns/talks to a runtime that OWNS its own
   auth; the TUI is just a surface. Same relationship as zcode.cjs app-server.
4. End state: /models groups = ZCode Coding Plan, ZCode Starter Plan, AutoClaw —
   with AutoClaw rows genuinely usable, not the shipped READ-ONLY slice-1 state.

## Questions (fixed verdict shape: accept|rebut|defer — correction per item)
- Q1 ROUTE: Given M3 (AutoClaw desktop has NO external protocol server — the zcode
  pattern's precondition is absent upstream) and M2 (pi rpc-entry IS an external
  protocol, but its standalone auth is a SEPARATE credential store, not the
  desktop's plan auth): what is the honest architecture?
  (a) standalone pi backend via rpc-entry, PI_CODING_AGENT_DIR-scoped, user's own
      pi auth (auto paid via user's AutoClaw-account? no — via whatever provider the
      user configured in pi standalone);
  (b) wait/push upstream for an AutoClaw app-server/headless host (the internal
      stream-json/ACP hooks suggest it's anticipated);
  (c) some hybrid (e.g. pi rpc backend NOW for user-configured providers, AutoClaw
      plan rows stay desktop-only-honest until upstream ships a host).
- Q2 SEMANTICS: what should the AutoClaw group in /models honestly contain under
  your verdict? (plan models with which meter labels? standalone-pi providers?
  both? "requires desktop" markers?)
- Q3 GUARDRAILS: what must the route allowlist + session-boundary rules be so the
  TUI never silently bills the wrong meter (esp. pi standalone providers vs the
  AutoClaw plan)?
- Q4 SLICES: ordered slice plan with effect-level proofs + cheapest falsifiers,
  consistent with slice 1 already shipped (4fc6a18).

Evidence staged raw beside this brief: 01 prior verdict, 02 prior brief,
03 fresh measurements (M1..M6), 04 zcode-tui architecture.
Judge ONLY from staged evidence; flag where a measurement is missing.
