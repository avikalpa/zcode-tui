# zcode-tui 2.0.0 — the fleet harness architecture

Ratified by the owner 2026-10-25 after the AutoClaw transport study: the
**official apps are the plan SSOTs**; zcode-tui is the automator/broker layer
around them; **ygg-auth owns all auth movement between hosts**.

## The layers

1. **Official harnesses (SSOTs).** ZCode desktop/CLI and the AutoClaw
   desktop run on fleet hosts — with a display where one exists, headless
   under xvfb where not (`zcode-tui install autoclaw-headless` writes the
   systemd user unit, CDP on a loopback port). Login is a per-host,
   owner-performed step inside the official app; zcode-tui ships no logins
   (§12 boundary, unchanged).
2. **ygg-auth — the fleet auth plane.** `ygg-auth.py --harness zcode` and
   `--harness autoclaw` capture/store/switch/replicate the two auth sets with
   single-writer lineage and provenance, exactly like codex:
   - zcode: `~/.zcode/v2/credentials.json` (+ the paired
     `~/.zcode/v2/provider_config.json`),
   - autoclaw: `~/.config/zcode-tui/autoclaw-plan.json` (the mined plan).
   Standard wave: `capture` on the freshest host → `fetch <host> <slug>
   --activate` everywhere → `fleet` → `doctor`. `llmproxy-seed` pushes the
   stored keys into the llmproxy guest (`/etc/llmproxy/zcode.json`) — the
   zai-coding-plan api key and the autoclaw route.
3. **zcode-tui — the automator.** Scheduling (queue), off-peak tickets,
   usage/reset plane, and (architecture going forward) local **brokers** that
   drive the official apps over their debug ports: submit → task-id → status
   → result → cancel, durable job↔task mapping, idempotent resubmission,
   SUBMISSION_UNKNOWN holds, account-wide budget aggregation (more
   installations do not create more entitlement).

## What 2.0.0 removed

- `zcode-tui autoclaw sync` — the per-tool scp loop (prints the ygg-auth
  migration path if invoked).
- The startup auth plane (`src/auth/sync.ts`) is off by default; a passive
  pointer names the ygg-auth command when a host lacks auth. One-transition
  escape hatch: `ZCODE_TUI_AUTH_SYNC=1`.

## What 2.0.0 added

- `zcode-tui install <doctor|zcode|autoclaw|autoclaw-headless>` — installs/
  verifies the official harnesses the way the fleet wants them. Downloads
  only from an explicit `--file`/`--url` (or `ZCODE_INSTALL_URL` /
  `AUTOCLAW_INSTALL_URL`); the tool never guesses vendor URLs.
- `zcode-tui queue ls` — the daily queue view (`list` alias).
- `zcode-tui usage` wired into the launcher (live plan windows + reset
  tokens plane).

## Test discipline

`install doctor` is the fleet-readiness check (cli, auth, app, login, plan,
ygg-auth profiles, xvfb) — run it after any auth wave. Auth changes verify
with `ygg-auth fleet` + `doctor`, never by trusting a copy's existence.
