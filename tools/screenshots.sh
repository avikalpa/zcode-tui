#!/usr/bin/env bash
# Regenerate the char-frame screenshot gallery (headless, real backend).
set -eu
cd "$(dirname "$0")/.."
mkdir -p docs/screenshots
bun run src/tui/live-smoke.tsx > docs/screenshots/sessions.charframe.txt 2>/dev/null
echo "gallery refreshed"
