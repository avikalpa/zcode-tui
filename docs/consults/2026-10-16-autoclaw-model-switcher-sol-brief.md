# CONSULT — zcode-tui: add an AutoClaw model switcher / plans (sol HIGH)

You are sol HIGH (reasoning/instruct seat; owner ruling: implementation architecture
decisions go to sol/GLM, never gemini).

## Owner ask (verbatim intent)
"zcode-tui should have an AutoClaw model switcher too. In other words, ZCode
Coding Plan, ZCode Starter Plan and AutoClaw Plans in the model selector.
Discuss the implementation, note on the message board, and start working on it."

## What EXISTS (all measured 2026-10-16 on jojo; cite these exact facts)

### zcode-tui (repo ~/gh/zcode-tui, TS + @opentui react; GPL-3.0)
- It is an UNOFFICIAL ZCode client. It spawns the ZCode desktop's own app-server:
  `ELECTRON_RUN_AS_NODE=1 /opt/ZCode/zcode /opt/ZCode/resources/glm/zcode.cjs
  app-server` (client.ts ELECTRON_BIN="/opt/ZCode/zcode", RUNTIME_CJS=
  "/opt/ZCode/resources/glm/zcode.cjs"), speaks JSON-RPC.
- Method families: `v4/*` (sync plane), `session/*` + `workspace/*` +
  `interaction/*` (the API a standalone TUI uses). Key ones:
  `session/create|setModel|setThoughtLevel|updateRuntimeModelConfig|usage`,
  `workspace/readState` (model catalog → the TUI's model-picker source),
  `workspace/updateProviderRegistry|upsertModelProvider|setDefaultModel`.
- Model picker today: `src/tui/app.tsx` has a hard `ALLOWED_MODELS` allowlist
  (2 entries) — GLM-5.3-Flash (zai/GLM-5.3-Flash, default) and GLM-5.3
  (zai/GLM-5.3, "1M ctx") — and loadModels() reads `workspace/readState`'s
  modelCatalog but deliberately IGNORES the runtime catalog and uses only the
  allowlist ("the runtime catalog must never re-introduce paid models here").
  setModel sends `session/setModel {sessionId, model:{providerId, modelId}}`.
- The owner has ALREADY wired two "plans" concepts into the ZCode runtime:
  `~/.zcode/v2/coding-plan-cache.json` carries entitlement states
  (builtin:zai-coding-plan available; builtin:zai-start-plan unavailable
  "coding_plan_not_entitled"; builtin:bigmodel-coding-plan/start-plan
  unavailable), and `/opt/ZCode/resources/glm/zcode.cjs` knows the strings
  `zai-coding-plan`, `zai-start-plan`, `bigmodel-coding-plan`,
  `bigmodel-start-plan`. `~/.zcode/cli/config.json` has provider "zai"
  (kind anthropic, baseURL https://api.z.ai/api/anthropic) with a models map
  (glm-5.1, glm-4.7, glm-5.3-flash, glm-5.3, GLM-5.3-Flash, GLM-5.3) and
  model.main zai/GLM-5.3-Flash, model.lite zai/glm-4.7.

### AutoClaw (z.ai desktop, "zwork", v2.0.3 AppImage on KDE Wayland)
- Separate product, separate account/auth (~/.config/AutoClaw-oversea-official/,
  credentials.enc), separate agent runtime.
- Model catalog (runtime/model-catalog/remote-snapshot.json) — 4 models:
  `zai_auto` (Auto), `zai_auto-fast` (Auto-Fast), `zaicoding_glm-5.3` (GLM-5.3,
  credit High), `zai_glm-5.3-flash` (GLM-5.3-Flash, credit Low). All 1M context.
- AutoClaw BUNDLES the same agent core: node_modules/@earendil-works/
  pi-coding-agent v0.83.0, whose package.json declares bin {pi: dist/cli.js}
  AND an export "./rpc-entry" (dist/rpc-entry.js → runs `main(["--mode","rpc"])`).
  AutoClaw's own main.cjs drives pi IN-PROCESS (`await import("@earendil-works/
  pi-coding-agent")`, zwork-agent ledger/migrations), and zwork has a
  built-in-model-catalog-service with BUILT_IN_AUTO_MODEL_ID="zai_auto" plus
  HTTP origins (autoglm-api.zhipuai.cn etc.). Provider auth flows through
  AutoClaw's in-process model-connections service reading encrypted
  credentials.enc — there is NO documented standalone RPC for a third party to
  obtain AutoClaw plan tokens; the pi-rpc entry assumes a parent that answers
  provider header requests.

## THE QUESTION
Give a decision + implementation plan for "AutoClaw Plans in the zcode-tui model
selector". Address:

Q1 FEASIBILITY / ROUTE. Three candidate shapes:
  (A) zcode.cjs provider-registry route: add an AutoClaw provider to the ZCode
      resolver (`workspace/upsertModelProvider` + the zai models map) so
      `session/setModel` selects AutoClaw plan models through ZCode's runtime.
      Needs AutoClaw plan auth usable from ZCode's process — is that even
      obtainable (credentials.enc, in-process only), or does this require an
      upstream Z.ai change?
  (B) Second daemon backend in zcode-tui: spawn AutoClaw's bundled pi-coding-agent
      `dist/rpc-entry.js` as an alternative backend with the model catalog from
      AutoClaw's remote-snapshot.json. Does the pi-rpc mode expose an equivalent
      of session/setModel + session/create + a model catalog, and can it run
      WITHOUT the AutoClaw desktop parent (auth!)? If not, name the exact missing
      piece.
  (C) UI-only first: show the AutoClaw plans/models in the selector READ-ONLY
      (from remote-snapshot.json + coding-plan-cache.json entitlements), labelled
      "AutoClaw (desktop) — not switchable from this TUI", so the owner sees the
      unified plan picture without a false promise.
  Which ships first, and what is the honest end-state? Be explicit about what is
  IMPOSSIBLE without upstream vs what is merely unwritten.

Q2 SHAPE OF THE SELECTOR. If models from multiple plans coexist: flat list with
  plan-prefixed labels ("ZCode Coding Plan / GLM-5.3", "AutoClaw / GLM-5.3-Flash")
  vs grouped sections vs a plan-then-model two-step? What must the label carry so
  the owner can tell which account/plan meters the spend (AutoClaw credits vs
  ZCode coding plan are DIFFERENT meters)? Consider the creditConsumptionLevel
  field AutoClaw exposes.

Q3 GUARDRAILS. The existing allowlist exists because the runtime catalog once
  re-introduced paid models. What is the correct guardrail now that MORE models
  (across two plans) are intentional — allowlist per plan? entitlement-driven
  (read coding-plan-cache.json)? Never-send-a-model-the-resolver-would-reject?
  Give the rule.

Q4 WHAT TO NOTE ON THE MESSAGE BOARD. One short post (the owner asked for a board
  note). Give its gist: decision, what ships now, what is blocked on upstream.

Q5 PLAN + FALSIFIERS. A minimal ordered slice list (max 3) with effect-level
  proof for each and the cheapest falsifier that would kill it.
