# Plan dialogs and picker parity

## Reference and task

Inspected opencode's local `v2ref` source at
`b084acc55ea2cdb50e9c2ec49a8d9ab3608d43ad`:

- `packages/tui/src/component/dialog-model.tsx`
- `packages/tui/src/component/dialog-status.tsx`
- `packages/tui/src/component/dialog-session-list.tsx`
- `packages/tui/src/ui/dialog-select.tsx`
- `packages/tui/src/component/prompt/index.tsx`
- `packages/tui/src/routes/session/index.tsx`
- `packages/tui/src/feature-plugins/system/diff-viewer.tsx`

This is a targeted pattern comparison, not an upstream re-pin. The vendored
v2.0.8 source remains unchanged. New components are React implementations;
no ZCode or AutoClaw application sources or app identity values are copied.

## Model selection

Task: find a model by name or provider, recognize its plan, and switch a
supported route. Preserve Favorites and Recent sections, provider labels,
and provider-qualified row identity. The remaining configured catalog stays
under its provider heading. Search matches words across title and provider.

AutoClaw metadata comes from the existing managed catalog API, with a
four-second request deadline and the user-owned catalog file as fallback.
The cache is read before a network request. When a plan file exists but
both discovery and the cache are unavailable, show the four model names
in the baseline catalog, explicitly labeled offline fallback. This is
public model metadata, not app identity. With no plan or catalog, show a
setup row. Live or cached discovery takes precedence over that baseline.

The ZCode conversation backend cannot execute AutoClaw models. Those rows
are visible and marked `separate runner`; keyboard and mouse selection both
stop before mutation. Use the existing `zcode-tui autoclaw run --model ID`
runner for execution. A future backend-routing change must supply that
contract before these rows become selectable. No ZCode model is substituted.
A ZCode switch is committed to local model preferences after backend acceptance.

## Status

Task: see account readiness, consumption and connected tools in one place.
Use the reference's flat titled sections, status bullets, subdued details,
and esc dismissal. The inspected reference itself is MCP-only; plan sections
are the requested extension, not a claim about its current contents.

Show Coding Plan entitlements and explicit finite `used`/`limit` pairs from
the local cache, including the entitlement cache age. Show seven-day token/session telemetry from the same
`usage/stats` endpoint used by `zcode-tui usage`. Missing limits are labeled
unavailable; tokens do not imply remaining quota. AutoClaw shows plan-file
presence, credential age and live/cached catalog count. Its projection
contains no tokens, app identity, endpoints or raw plan record.

The body scrolls on short terminals (wheel, arrows, Page Up/Down, Home/End).
MCP failure details remain visible. A failed request degrades its own section.

## General interaction pass and evidence

Shared picker: mouse hover/down/up follows the reference, esc is clickable,
secondary descriptions use available row width, and disabled Enter keeps
the search intact. Moving session selection disarms the previous delete.
The existing transcript/tool rendering, composer selection and responsive
diff layout were reviewed; no additional redesign was introduced.

Component tests render both provider groups with all four synthetic cached
models at 100×30, status with meters/telemetry/MCP at 100×40, missing-data
states, and click-to-select with disabled-row refusal. Data tests cover live
refresh, offline fallback, credential redaction and invalid meter values.
These are deterministic character-frame and input checks, not a live GUI
pixel-parity claim. Full visual parity remains subject to a live terminal
comparison; the reported gap is not replaced by a percentage guess.

Validation for this lane: `bun test` — 173 passed, 0 failed;
`bun x tsc --noEmit` — passed; `timeout 10 zcode-tui` with the lane's
`bin/` first on PATH — exited 0 with the expected no-TTY message.
The existing dependency installation was reused; the available Bun cannot
parse the repository's newer frozen lockfile format. No lockfile changed.
