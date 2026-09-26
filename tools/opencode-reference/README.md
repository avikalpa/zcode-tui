Vendored opencode TUI reference — v2.0.18 (cd9a14a6b688d4021bee381dfd39d2cef9c0f862)

Source: github.com/sst/opencode (anomalyco mirror), packages/tui/src, pinned
by tools/sync-opencode.sh. MIT License, Copyright (c) 2025 opencode — see
the upstream LICENSE. This tree is the PORTING SURFACE for the parity
campaign: our code never imports or compiles it. theme-pkg/ is the
@opencode/theme engine (packages/theme/src/tui) that the v2 default-theme
resolver (tools/resolve-theme-v2.ts) runs verbatim at build time. Sync with
tools/sync-opencode.sh <tag>, then resolve-theme-v2.ts + gen-keybinds.py +
gen-themes.py + parity-report.py --stale.
