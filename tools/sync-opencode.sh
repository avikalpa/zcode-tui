#!/usr/bin/env bash
# Re-pin the vendored opencode TUI reference (tools/opencode-reference/) to a
# tag or branch of the upstream checkout and print which ports it touches.
#
#   tools/sync-opencode.sh [ref]        # ref = upstream tag/branch
#                                       # (default: newest v2.* tag)
#
# The reference tree is MIT code (Copyright (c) 2025 opencode), vendored
# VERBATIM as the porting surface — our own sources never import it; it
# exists so a parity wave is a diff job, not a rediscovery job.
#
# The default ref is the newest v2.* tag in the upstream checkout — the
# maintenance law's natural invocation. A default-path resolution that
# would move the pin BACKWARDS vs the current tools/opencode-reference/VERSION
# is refused; pass the ref explicitly to force a downgrade.
#
# After pinning, run:
#   tools/gen-keybinds.py               # refresh the keybind registry + gap report
#   bun tools/resolve-theme-v2.ts       # resolve the v2 default theme (opencode doc)
#   python3 tools/gen-themes.py         # refresh the theme arms (pin + v2 json)
#   tools/parity-report.py --stale      # which of our ports the bump touches
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${OPENCODE_REPO:-$HOME/gh/opencode}"
DEST="$ROOT/tools/opencode-reference"

EXPLICIT_REF="${1:-}"
if [ -n "$EXPLICIT_REF" ]; then
  REF="$EXPLICIT_REF"
else
  REF="$(git -C "$SRC" tag -l 'v2.*' --sort=-v:refname | head -n1)"
  if [ -z "$REF" ]; then
    echo "no v2.* tag found in $SRC — pass an explicit ref: $0 <tag|branch>" >&2
    exit 1
  fi
  echo "default ref: $REF (newest v2.* tag)"
fi

COMMIT="$(git -C "$SRC" rev-parse "$REF")"
VERSION="$(git -C "$SRC" describe --tags "$REF" 2>/dev/null || echo "$REF")"

# Backwards guard (default path only): refuse to move the pin behind the
# current one. The stale-default downgrade trap this guards was real — the
# v2ref branch sat at v2.0.6 while the tree was pinned at v2.0.9.
CUR_VERSION=""
if [ -f "$DEST/VERSION" ]; then
  CUR_VERSION="$(cat "$DEST/VERSION")"
fi
if [ -z "$EXPLICIT_REF" ] && [ -n "$CUR_VERSION" ]; then
  NEW_BASE="${VERSION%%-*}"
  CUR_BASE="${CUR_VERSION%%-*}"
  OLDEST="$(printf '%s\n%s\n' "$NEW_BASE" "$CUR_BASE" | sort -V | head -n1)"
  if [ "$OLDEST" = "$NEW_BASE" ] && [ "$NEW_BASE" != "$CUR_BASE" ]; then
    echo "refusing backwards pin: default resolved to $VERSION but the tree is pinned at $CUR_VERSION" >&2
    echo "to force a downgrade, pass the ref explicitly: $0 $REF" >&2
    exit 1
  fi
fi

rm -rf "$DEST"
mkdir -p "$DEST"
git -C "$SRC" archive "$REF" packages/tui/src | tar -x -C "$DEST"
git -C "$SRC" archive "$REF" packages/theme/src/tui | tar -x -C "$DEST"
mv "$DEST/packages/tui/src" "$DEST/tui"
mv "$DEST/packages/theme/src/tui" "$DEST/theme-pkg"
rm -rf "$DEST/packages"

printf '%s\n' "$VERSION" > "$DEST/VERSION"
printf '%s\n' "$COMMIT" > "$DEST/COMMIT"
cat > "$DEST/README.md" <<EOF
Vendored opencode TUI reference — $VERSION ($COMMIT)

Source: github.com/sst/opencode (anomalyco mirror), packages/tui/src, pinned
by tools/sync-opencode.sh. MIT License, Copyright (c) 2025 opencode — see
the upstream LICENSE. This tree is the PORTING SURFACE for the parity
campaign: our code never imports or compiles it. theme-pkg/ is the
@opencode/theme engine (packages/theme/src/tui) that the v2 default-theme
resolver (tools/resolve-theme-v2.ts) runs verbatim at build time. Sync with
tools/sync-opencode.sh <tag>, then resolve-theme-v2.ts + gen-keybinds.py +
gen-themes.py + parity-report.py --stale.
EOF

echo "pinned $VERSION ($COMMIT)"
echo
python3 "$ROOT/tools/parity-report.py" --stale
