#!/usr/bin/env bash
# R68 fixture test for tools/sync-opencode.sh (dream ACK-807bfb2681):
# live default-ref resolution, the stale-clone loud failure, the
# --print-default-ref dry mode, and a full sandboxed pin run.
# Usage: test-sync-refspec.sh /path/to/sync-opencode.sh
set -u
SCRIPT="$(readlink -f "$1")"
fails=0
expect() { # name expected actual
  if [ "$2" = "$3" ]; then echo "  PASS  $1"
  else echo "  FAIL  $1 (want [$2] got [$3])"; fails=$((fails+1)); fi
}
expect_rc() { # name expected_rc actual_rc
  if [ "$2" = "$3" ]; then echo "  PASS  $1 (rc=$3)"
  else echo "  FAIL  $1 (want rc=$2 got rc=$3)"; fails=$((fails+1)); fi
}

tmp="$(mktemp -d)"
bare="$tmp/origin.git"; clone="$tmp/clone"
git init --bare -q "$bare"
git init -q "$clone"
git -C "$clone" remote add origin "$bare"
git -C "$clone" config user.email f@example.invalid
git -C "$clone" config user.name f
git -C "$clone" config tag.gpgSign false
mkdir -p "$clone/packages/tui/src" "$clone/packages/theme/src/tui"
echo "export const a=1" > "$clone/packages/tui/src/foo.ts"
echo "export const b=2" > "$clone/packages/theme/src/tui/bar.ts"
git -C "$clone" add -A
git -C "$clone" commit -q -m fixture
for t in v2.0.9 v2.0.10 v2.0.18 vscode-v0.0.99 v3.0.0; do
  git -C "$clone" tag -a "$t" -m "t $t"
done
git -C "$clone" push -q origin --tags

echo "[1] adversarial election (clone fresh, vscode + v3 traps live)"
got="$(OPENCODE_REPO="$clone" bash "$SCRIPT" --print-default-ref 2>/dev/null)"
expect "election picks v2.0.18 (vscode-v0.0.99 + v3.0.0 excluded)" "v2.0.18" "$got"

echo "[2] stale clone: the ORIGIN gains v2.0.19, the clone never fetches it"
git -C "$clone" commit -q --allow-empty -m f2
git -C "$clone" push -q origin HEAD
git -C "$bare" tag -a v2.0.19 -m "t v2.0.19" HEAD
out="$(OPENCODE_REPO="$clone" bash "$SCRIPT" --print-default-ref 2>&1)"; rc=$?
expect_rc "print-default-ref fails LOUD on stale clone" 1 "$rc"
case "$out" in
  *"fetch --tags --prune"*) echo "  PASS  loud message names the fetch" ;;
  *) echo "  FAIL  message lacks the fetch command: $out"; fails=$((fails+1)) ;;
esac

echo "[3] --print-default-ref with an explicit ref"
got="$(OPENCODE_REPO="$clone" bash "$SCRIPT" --print-default-ref v2.0.9 2>/dev/null)"
expect "explicit ref echoed verbatim" "v2.0.9" "$got"

echo "[4] full sandboxed pin run (clone fetched fresh, DEST pre-seeded at v2.0.17)"
git -C "$clone" fetch -q origin --tags
mkdir -p "$tmp/repo/tools/opencode-reference"
cp "$SCRIPT" "$tmp/repo/tools/sync-opencode.sh"
printf '#!/bin/sh\n' > "$tmp/repo/tools/parity-report.py"
echo "v2.0.17" > "$tmp/repo/tools/opencode-reference/VERSION"
out="$(OPENCODE_REPO="$clone" bash "$tmp/repo/tools/sync-opencode.sh" 2>&1)"; rc=$?
expect_rc "sandboxed full run exit 0" 0 "$rc"
got="$(cat "$tmp/repo/tools/opencode-reference/VERSION")"
expect "DEST re-pinned to live newest v2.0.19" "v2.0.19" "$got"
[ -f "$tmp/repo/tools/opencode-reference/tui/foo.ts" ] \
  && echo "  PASS  tui/ archived" \
  || { echo "  FAIL  tui/foo.ts missing"; fails=$((fails+1)); }

echo "[5] backwards guard on the default path"
git -C "$clone" fetch -q origin --tags   # clone fresh again: guard, not presence, must fire
echo "v2.0.99" > "$tmp/repo/tools/opencode-reference/VERSION"
out="$(OPENCODE_REPO="$clone" bash "$tmp/repo/tools/sync-opencode.sh" 2>&1)"; rc=$?
expect_rc "refusing backwards pin exit 1" 1 "$rc"
case "$out" in
  *"refusing backwards pin"*) echo "  PASS  guard message present" ;;
  *) echo "  FAIL  guard message missing: $out"; fails=$((fails+1)) ;;
esac

rm -rf "$tmp"
echo "FIXTURE: $(( fails == 0 ? 1 : 0 )) (fails=$fails)"
exit $(( fails > 0 ? 1 : 0 ))
