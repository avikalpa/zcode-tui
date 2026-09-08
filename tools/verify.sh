#!/usr/bin/env bash
# Per-verb verification: each verb gets an isolated PTY run (combined runs
# interleave frames and skew timing; see docs/verification.md). Markers are
# status/dialog text greped from the cumulative capture.
set -u
REPO="${REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
OUT="${OUT:-$HOME/.yggterm/scratchpad/zcode-tui/verify}"
BUN_BIN="${BUN_BIN:-$(command -v bun || true)}"
if [[ -z "$BUN_BIN" && -x "$HOME/.bun/bin/bun" ]]; then BUN_BIN="$HOME/.bun/bin/bun"; fi
if [[ -z "$BUN_BIN" ]]; then
  echo "bun is required (set BUN_BIN or install it under ~/.bun/bin)" >&2
  exit 2
fi
mkdir -p "$OUT"
PASS=0; FAIL=0
ONLY="${ONLY:-}"
declare -a RESULTS

drive() {
  local name="$1" script="$2" marker="$3"
  if [[ -n "$ONLY" && ",$ONLY," != *",$name,"* ]]; then return 0; fi
  local cap="$OUT/zcode-tui-verify-$name.$$.txt"
  ( eval "$script" ) | timeout 150 script -qec "$BUN_BIN run $REPO/src/tui/main.tsx" "$cap" >/dev/null 2>&1
  local rc=$?
  local S; S=$(sed -e 's/\x1b\[[0-9;?]*[a-zA-Z]/ /g; s/\x1b\][^\x07\x1b]*\x1b\\/ /g' "$cap")
  if echo "$S" | grep -Eq -a "$marker"; then
    RESULTS+=("PASS $name"); PASS=$((PASS+1))
  else
    RESULTS+=("FAIL $name (wanted '$marker')"); FAIL=$((FAIL+1))
  fi
}

drive boot       "(sleep 20; printf '\x1b'; sleep 0.5; printf 'q')"                                                          "zcodetui"
drive sessions   "(sleep 10; printf '/sessions\r'; sleep 4; printf '\x1b'; sleep 0.5; printf '\x1b'; sleep 0.5; printf 'q')"  "Sessions for zcode-tui"
drive create     "(sleep 10; printf '\x1b'; sleep 0.5; printf 'a'; sleep 4; printf '\x1b'; sleep 0.5; printf 'q')"             "ready"
drive model      "(sleep 10; printf '\x1b'; sleep 0.5; printf 'm'; sleep 3; printf '\x1b'; sleep 0.5; printf '\033'; sleep 0.5; printf 'q')"         "Model"
drive themes     "(sleep 10; printf '\x1b'; sleep 0.5; printf 't'; sleep 3; printf '\x1b'; sleep 0.5; printf '\033'; sleep 0.5; printf 'q')"         "Themes"
drive mode       "(sleep 10; printf '\x1b'; sleep 0.5; printf 'a'; sleep 4; printf '\x1b'; sleep 0.5; printf 'o'; sleep 3; printf '\x1b'; sleep 0.5; printf '\x11')" "mode → "
drive effort     "(sleep 10; printf '\x1b'; sleep 0.5; printf 'e'; sleep 3; printf '\033'; sleep 0.5; printf 'q')"                                   "effort → "
drive palette    "(sleep 10; printf '\x1b'; sleep 0.5; printf '\x0b'; sleep 3; printf 'fork'; sleep 2; printf '\x1b'; sleep 0.5; printf '\x11')"          "fork session"
drive forkdlg    "(sleep 10; printf '/sessions\r'; sleep 3; printf '\x1b[B'; sleep 0.5; printf '\r'; sleep 18; printf 'b'; sleep 4; printf '\x1b'; sleep 0.5; printf '\x11')" "Fork at message"
drive send       "(sleep 10; printf 'What is 17*24? Answer with just the number.\r'; sleep 75; printf '\x1b'; sleep 0.5; printf '\x11')"           "408|turn done"

echo "=== VERIFICATION RESULTS ==="
for r in "${RESULTS[@]}"; do echo "$r"; done
echo "=== $PASS pass, $FAIL fail ==="
exit $((FAIL > 0))
