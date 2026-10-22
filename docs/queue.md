# zcode-tui queue — the fleet worker queue

Unofficial client-side dispatcher for fleet dream/batch work (owner directive
2026-10-22). Native TypeScript in this repo — no seat scripts.

## Verbs

```
zcode-tui queue enqueue --prompt-file F --workspace W --route R \
    [--title T] [--model M] [--priority N] [--max-attempts N]
zcode-tui queue list [--json]
zcode-tui queue status [--json]
zcode-tui queue serve [--routes A,B] [--poll-ms N] [--dry-run] [--state-dir D]
```

State lives in a zcode-tui-owned dir (default
`~/.local/state/zcode-tui/queue/`): `queue.sqlite3` (WAL, crash-safe),
`runs/` (per-attempt transcripts), `metrics.jsonl` (queue-position-over-time
drain metric). A serve crash is recovered on boot: stale `running` rows are
requeued (or failed at the attempt cap).

## Routes

| route | executor | peak gate |
|---|---|---|
| `zai-coding-plan` | `zcode-tui run` session on the Z.AI Coding Plan (credit-metered) | **blocked Mon–Fri 11:30–15:30 IST**; also defers when <20 min remain to the boundary (5-min shutdown margin) |
| `zai-offpeak` | `zcode-tui idle create` over ssh to the desktop host (jojo) — takes a server idle-time ticket; jojo's runtime executes it | exempt (zero plan-quota cost; the server owns the schedule) |
| `opencode-free` | `opencode run` free tier (`opencode/glm-5.3-flash-free` default) | exempt |
| `codex` | `codex exec` spillover | exempt |
| `autoclaw` | config-ready, **not dispatchable**: provider absent from the app-server model registry (measured 2026-10-22; upstream ask open) | would be gated |

The peak gate mirrors `tools/zai_peak_window.py` (docs.z.ai devpack: peak
usage burns 1x vs 0.5x off-peak). During peak, serve logs one line per route
and holds tasks; `run.ts` still carries `--max-run-min` as the in-run guard.

## Fault tolerance

- per-task attempt cap (default 3); terminal states (`completed`, `failed`)
  are never retried
- refusal cooldown parsing: output like `Free tier limit reached … in 4 hr
  38 min` parks BOTH the task and the whole route until the parsed time (+60s
  buffer), and does not consume an attempt
- 30/60/120s + ≤15s jitter backoff between attempts
- one in-flight dispatch per route (routes parallelize with each other)
- deterministic auth/config failures fail terminally without retries
- `run.ts` exit 4 (peak budget stop) defers the task to after the boundary
  without consuming an attempt

## systemd (always-on serve)

```
mkdir -p ~/.config/systemd/user
cp systemd/zcode-tui-queue.service ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now zcode-tui-queue
loginctl enable-linger $USER
journalctl --user -u zcode-tui-queue -f
```

Deployed on `dev` (linger already enabled).

## Drain metric

`metrics.jsonl` gets a `tick` snapshot every 30s (pending depth per route,
route cooldowns) plus `dispatch`/`done` events carrying the queue position at
dispatch — the queue_position-over-time series for drain analysis:

```
grep '"ev":"dispatch"' ~/.local/state/zcode-tui/queue/metrics.jsonl | tail
```

## idle verbs (companion)

```
zcode-tui idle list [--json]    # read-only view of off_peak_tasks (the
                                # ZCode Automations panel's table)
zcode-tui idle create --prompt-file F [--workspace W] [--title T] [--model M]
```

`idle create` drives the runtime's own `OffPeakCreate` agent tool in a
session created with `offPeakToolEnabled: true` (measured in the packaged
bundle 2026-10-22; schema `{title, prompt, permissionMode?, model?}`, result
`{offPeakTaskId, queuePosition, sessionId}`). This is the same protocol path
the desktop uses — client, never reimplementation. Server refusals surface
as-is (exit 3, cooldown parsed) for the queue to schedule around.
