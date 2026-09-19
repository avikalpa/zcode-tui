#!/usr/bin/env bash
# Re-pin the vendored opencode TUI reference (tools/opencode-reference/) to a
# tag or branch of the upstream checkout and print which ports it touches.
#
#   tools/sync-opencode.sh [ref]        # ref = upstream tag/branch (default v2ref)
#
# The reference tree is MIT code (Copyright (c) 2025 opencode), vendored
# VERBATIM as the porting surface — our own sources never import it; it
# exists so a parity wave is a diff job, not a rediscovery job.
#
# After pinning, run:
#   tools/gen-keybinds.py               # refresh the keybind registry + gap report
#   python3 tools/gen-themes.py         # refresh the theme arms (reads the pin)
#   tools/parity-report.py --stale      # which of our ports the bump touches
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REF="${1:-v2ref}"
SRC="${OPENCODE_REPO:-$HOME/gh/opencode}"
DEST="$ROOT/tools/opencode-reference"

COMMIT="$(git -C "$SRC" rev-parse "$REF")"
VERSION="$(git -C "$SRC" describe --tags "$REF" 2>/dev/null || echo "$REF")"

rm -rf "$DEST"
mkdir -p "$DEST"
git -C "$SRC" archive "$REF" packages/tui/src | tar -x -C "$DEST"
mv "$DEST/packages/tui/src" "$DEST/tui"
rmdir "$DEST/packages/tui" "$DEST/packages"

printf '%s\n' "$VERSION" > "$DEST/VERSION"
printf '%s\n' "$COMMIT" > "$DEST/COMMIT"
cat > "$DEST/README.md" <<EOF
Vendored opencode TUI reference — $VERSION ($COMMIT)

Source: github.com/sst/opencode (anomalyco mirror), packages/tui/src, pinned
by tools/sync-opencode.sh. MIT License, Copyright (c) 2025 opencode — see
the upstream LICENSE. This tree is the PORTING SURFACE for the parity
campaign: our code never imports or compiles it. Sync with
tools/sync-opencode.sh <tag>, then gen-keybinds.py + gen-themes.py +
parity-report.py --stale.
EOF

echo "pinned $VERSION ($COMMIT)"
echo
python3 "$ROOT/tools/parity-report.py" --stale
