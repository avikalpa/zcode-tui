#!/usr/bin/env bash
# Re-pin the vendored opencode TUI reference (tools/opencode-reference/) to a
# tag or branch of the upstream checkout and print which ports it touches.
#
#   tools/sync-opencode.sh [ref]          # ref = upstream tag/branch
#                                         # (default: newest v2.* tag, LIVE)
#   tools/sync-opencode.sh --print-default-ref [ref]
#                                         # resolve + print the ref, touch
#                                         # nothing — the dry preview
#
# The reference tree is MIT code (Copyright (c) 2025 opencode), vendored
# VERBATIM as the porting surface — our own sources never import it; it
# exists so a parity wave is a diff job, not a rediscovery job.
#
# The default ref is the newest v2.* tag resolved LIVE from the origin
# remote (ls-remote), never from this clone's possibly-stale local tag set —
# dream ACK-807bfb2681: with a stale clone the executor could "re-pin" to
# the version it already had, the backwards guard saw an equal pin and
# passed, while tools/upstream-check.py (live) correctly said re-pin owed.
# The archive still reads THIS clone's object store, so a live newest that
# is missing locally is a LOUD failure naming the fetch to run. A
# default-path resolution that would move the pin BACKWARDS vs the current
# tools/opencode-reference/VERSION is refused; pass the ref explicitly to
# force a downgrade.
#
# After pinning, run:
#   tools/gen-keybinds.py               # refresh the keybind registry + gap report
#   bun tools/resolve-theme-v2.ts       # resolve the v2 default theme (opencode doc)
#   python3 tools/gen-themes.py         # refresh the theme arms (pin + v2 json)
#   tools/parity-report.py --stale      # which of our ports the bump touches
#   Check whether a re-pin is owed BEFORE pinning: python3 tools/upstream-check.py
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${OPENCODE_REPO:-$HOME/gh/opencode}"
DEST="$ROOT/tools/opencode-reference"

PRINT_ONLY=0
if [ "${1:-}" = "--print-default-ref" ]; then
  PRINT_ONLY=1
  shift
fi

EXPLICIT_REF="${1:-}"

# Same traps as tools/upstream-check.py, in bash: the ls-remote hash is
# stripped before any sort (sorting whole lines elects by hash), release
# tags are anchored ^v<digits>. (foreign namespaces like vscode-v0.0.x
# elect newest under raw sort -V), filtered to the pin family (v2.*), and
# the annotated-tag ^{} peel is deduplicated.
resolve_default_ref() {
  local url tags
  url="$(git -C "$SRC" remote get-url origin 2>/dev/null)" || {
    echo "no origin remote on $SRC — pass an explicit ref: $0 <tag|branch>" >&2
    exit 1
  }
  if ! tags="$(git ls-remote --tags "$url")"; then
    echo "live tag listing failed for $url — pass an explicit ref: $0 <tag|branch>" >&2
    exit 1
  fi
  printf '%s\n' "$tags" \
    | sed -e 's/^[^\t]*\t//' -e 's/\^{}$//' -e 's|^refs/tags/||' \
    | grep -E '^v[0-9]+\.' \
    | grep -E '^v2\.' \
    | sort -u -V \
    | tail -n1
}

if [ -n "$EXPLICIT_REF" ]; then
  REF="$EXPLICIT_REF"
else
  REF="$(resolve_default_ref || true)"
  if [ -z "$REF" ]; then
    echo "no v2.* release tag at the origin of $SRC — pass an explicit ref: $0 <tag|branch>" >&2
    exit 1
  fi
  # Live resolution is not local presence: git archive reads $SRC's store.
  if ! git -C "$SRC" rev-parse -q --verify "refs/tags/$REF" >/dev/null 2>&1; then
    echo "live newest $REF is NOT in local clone $SRC — run: git -C $SRC fetch --tags --prune" >&2
    exit 1
  fi
  if [ "$PRINT_ONLY" = 0 ]; then
    echo "default ref: $REF (newest v2.* tag, live at origin)"
  fi
fi

if [ "$PRINT_ONLY" = 1 ]; then
  printf '%s\n' "$REF"
  exit 0
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
