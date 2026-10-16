# Fresh measurements (2026-10-16, jojo, AutoClaw 2.0.3 AppImage runtime copy)

## M1 — AutoClaw automation system (answer to owner Q1)
- The desktop bundles `zwork-agent` IN-PROCESS into main.cjs (1026 module refs,
  `packages/zwork-agent/src/...`). No out-of-process agent.
- Scheduled automation kernel exists, ledger-backed (SQLite `scheduled_tasks_v38`,
  `scheduled_automation_workspaces`, occurrences, attempts):
  - Protocol verbs: `scheduled_task.create | replace | delete | set_enabled |
    mark_history_read | mark_all_history_read` (+ connected_source.*,
    domestic_connector.* verbs in the same protocol contract).
  - Action kinds: `agent_prompt` (prompt <=32k chars, `timeoutSeconds` watchdog,
    default 1800) and `registered_program` (taskRef `program:<id>`, version,
    artifactSha256).
  - Scopes: session or workspace. Policies: misfire (skip/run_once + grace),
    overlap (skip/queue_one), retry (maxAttempts/backoff). Delivery targets,
    history-read states, preview/migrate schemas.
  - The runtime-publication-hub comment names its intended stream consumers:
    "the headless CLI: stream-json, ACP `rawInput`" — i.e. the internal
    architecture anticipates headless hosts, but NO headless CLI host ships
    in 2.0.3 (zero `app-server`/`--server`/stream-json entry points in the binary).

## M2 — the bundled pi harness (AutoClaw's agent runtime)
- `resources/app/node_modules/@earendil-works/pi-coding-agent` v0.83.0.
- `dist/rpc-entry.js` = JSONL-over-stdio RPC. PROBED LIVE from jojo:
  - `new_session` → `{"type":"response","command":"new_session","success":true,...}`
  - `get_state` → full session state (model/thinkingLevel/sessionFile/sessionId...)
  - `get_available_models` → `{"models":[]}` (EMPTY — see M3)
- Full command set (from rpc-mode.js): abort, abort_bash, abort_retry, bash,
  clone, compact, cycle_model, cycle_thinking_level, export_html, follow_up,
  fork, get_available_models, get_available_thinking_levels, get_commands,
  get_entries, get_fork_messages, get_last_assistant_text, get_messages,
  get_session_stats, get_state, get_tree, new_session, prompt, set_auto_compaction,
  set_auto_retry, set_follow_up_mode, set_model, set_session_name,
  set_steering_mode, set_thinking_level, steer, switch_session.
- Config resolution (config.js): `ENV_AGENT_DIR = APP_NAME + "_CODING_AGENT_DIR"`;
  `APP_NAME = pkg.piConfig?.name || "pi"`; piConfig.name is UNSET in this build
  ⇒ env var is `PI_CODING_AGENT_DIR`, default dir `~/.pi/agent`.
- Auth storage: `~/.pi/agent/auth.json` (FileAuthStorageBackend, lockfile, 0600),
  plus `models-store.json`, `settings.json`, `sessions/`. Measured ON JOJO: both
  auth.json and models-store.json are EMPTY `{}`.

## M3 — where AutoClaw's real auth lives (the asymmetry vs ZCode)
- Desktop credential vault: `ProductAccountCredentialVault` writing
  `account-credentials.enc` per account partition; a second `credentials.enc`
  at the data directory. Product provider is `zwork-managed` (measured in logs:
  `"provider":"zwork-managed","model":"zai_glm-5.3-flash"`).
- Injection path (main.cjs): `resolveProviderAuth(provider, credentials,
  authContext, overrides)` → `readCredential(credentials, provider.id)` →
  oauth/api-key resolution. All IN-PROCESS. The pi rpc process gets nothing.
- ⛔ There is NO external protocol server in AutoClaw 2.0.3: createServer=1
  (unrelated), ipcMain=96 (Electron-internal), no app-server mode, no
  headless CLI binary. The zcode pattern's PRECONDITION (a desktop runtime
  that speaks an external protocol and owns auth) does not exist for AutoClaw
  today.

## M4 — the zcode pattern (what we must mirror)
- zcode-tui spawns `ELECTRON_RUN_AS_NODE=1 /opt/ZCode/zcode
  resources/glm/zcode.cjs app-server` and speaks NDJSON JSON-RPC
  (session/*, workspace/*, plugins/*, automation/*, interaction/*).
- Auth is in-process to that runtime: the TUI holds NO credentials. Same-store
  reflection: sessions created in the TUI appear in the desktop and vice versa.
- Prior slice 1 shipped (zcode-tui 4fc6a18): grouped /models picker — ZCode
  Coding Plan (2 approved routes, switchable), ZCode Starter Plan (honest
  not-entitled), AutoClaw (4 catalog models READ-ONLY, "not switchable from
  this TUI", SelectDialog disabled gate).

## M5 — the AutoClaw model catalog (measured desktop-side)
- AutoClaw plan group: Auto, Auto-Fast, GLM-5.3 (credit High), GLM-5.3-Flash
  (credit Low); all 1M context; provider zwork-managed; meter = AutoClaw credits.
- These require the desktop's product-account auth. A standalone pi process
  CANNOT reach them without either (a) a desktop-exposed bridge, or (b)
  credential extraction (⛔ owner-rejected).

## M6 — what a standalone pi process COULD serve (honest inventory)
- With `PI_CODING_AGENT_DIR=<dir>` pointed at a user-prepared pi config, the
  rpc-entry process serves whatever providers the USER configured for pi
  standalone (auth.json entries / models.json providers / env keys). That is
  pi's own upstream auth story — the user logs in once via pi itself, no
  TUI-held secrets, no desktop credential extraction, no harness shipping
  (the runtime is loaded from the installed AutoClaw's node_modules, versioned
  with the app).
- Caveat: ~/.pi/agent on jojo is currently EMPTY — nobody has ever configured
  standalone pi auth here. The picker's AutoClaw group would honestly show
  "no providers configured in standalone pi" until the user does.
