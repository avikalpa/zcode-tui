# design/ux — zcode-tui ux-corpus (ux-falsify)

The runtime falsification corpus for the TUI lego. Skill: `ux-falsify`
(dev `~/git/yggsteer/skills/ux-falsify`). The TUI adapter implementing the
runner contract is `tools/ux/falsify.py` — PTY driver (pyte cell truth),
PNG render layer, cell-diff judge, planted-defect selftest.

## Layout

- `states/*.toml` — state manifests: identity/claim, per-app command+cwd,
  drive steps, readiness, sig_masks (animated regions excluded from settle),
  evaluate.masks (declared BEFORE inspection, each with a reason).
- `runs/` — generated evidence bundles (cells.json + png + bundle.json).
  **Gitignored** — regenerate any time; hashes recorded in findings.
- `findings/` — the durable findings ledger (append-only, one file per run
  wave), including triage against `docs/parity-v2.md`.

## Run recipes

```sh
sh tools/ux/fixtures.sh                     # deterministic fixture workspace
# candidate needs pinned deps (bun install) — see findings 2026-10-27 env note
bun install
python3 tools/ux/falsify.py capture design/ux/states/home.toml --both
RUN=$(ls -t design/ux/runs | head -1)
python3 tools/ux/falsify.py diff design/ux/states/home.toml \
  design/ux/runs/$RUN/opencode.idle.cells.json \
  design/ux/runs/$RUN/zcode-tui.idle.cells.json
python3 tools/ux/falsify.py selftest design/ux/runs/$RUN/opencode.idle.cells.json
```

## Conventions

- Reference pin: `opencode` binary v2.1.4 (recorded in every bundle meta).
  The ledger pins vendored v2.0.8 (`tools/opencode-reference/`) — findings
  triage must separate 2.1.4 upstream drift from real candidate deviations;
  re-pin by editing the manifest's reference revision (never silently).
- Animated regions (placeholder typewriter, cursor blink) are declared in
  `sig_masks` (settle) and `evaluate.masks` (diff) with reasons — never
  discovered masks.
- Verdicts: this tool returns comparison verdicts CLEAN / MISMATCH
  (UNVERIFIED when a capture didn't settle); the STATE verdict MATCH is
  granted only by the full loop contract (two clean passes from independent
  resets, transitions, visual acceptance) — never by one comparison.
- The selftest must pass 12/12 (plants on both-unmasked cells, resolved-style
  mutations) or every verdict is suspended.
- Evidence: every cells.json is hashed and retained under
  `~/.local/share/ux-falsify-evidence/` (override with UX_FALSIFY_EVIDENCE).
- Masks are per-subject (`both` / `reference` / `candidate`) and every mask
  revision bumps `contract_rev`; corrections carry their measurement date.
