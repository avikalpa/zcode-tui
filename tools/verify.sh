#!/usr/bin/env bash
# Per-verb verification: each verb gets an isolated PTY run (combined runs
# interleave frames and skew timing; see docs/verification.md). Markers are
# status/dialog text greped from the cumulative capture.
set -u
REPO="${REPO:-$HOME/gh/zcode-tui}"
OUT="${OUT:-/tmp}"
PASS=0; FAIL=0
declare -a RESULTS

drive() {
  local name="$1" script="$2" marker="$3"
  local cap="$OUT/zcode-tui-verify-$name.$$.txt"
  ( eval "$script" ) | timeout 150 script -qec "bun run $REPO/src/tui/main.tsx" "$cap" >/dev/null 2>&1
  local rc=$?
  local S; S=$(sed -e 's/\x1b\[[0-9;?]*[a-zA-Z]/ /g; s/\x1b\][^\x07\x1b]*\x1b\\/ /g' "$cap")
  if echo "$S" | grep -Eq -a "$marker"; then
    RESULTS+=("PASS $name"); PASS=$((PASS+1))
  else
    RESULTS+=("FAIL $name (wanted '$marker')"); FAIL=$((FAIL+1))
  fi
}

drive boot       "(sleep 20; printf 'q')"                                                                                       "[0-9]+ sessions"
drive filter     "(sleep 10; printf '/'; sleep 0.5; printf 'z'; sleep 1; printf '\x1b'; sleep 1; printf '\x1bq')"               "filter: z"
drive create     "(sleep 10; printf 'a'; sleep 4; printf '\x1bq')"                                                              "new sess_"
drive model      "(sleep 10; printf 'm'; sleep 3; printf '\x1bq')"                                                              "type to filter"
drive mode       "(sleep 10; printf 'a'; sleep 4; printf 'o'; sleep 3; printf '\x1bq')"                                         "mode → "
drive think      "(sleep 10; printf 'a'; sleep 4; printf 'e'; sleep 3; printf '\x1bq')"                                         "thinking → "
drive palette    "(sleep 10; printf '\x0b'; sleep 3; printf 'fork'; sleep 2; printf '\x1bq')"                                   "fork session"
drive forkdlg    "(sleep 10; printf '\r'; sleep 18; printf 'b'; sleep 4; printf '\x1bq')"                                       "fork at message"
drive send       "(sleep 10; printf 'a'; sleep 4; printf 'i'; sleep 1; printf 'What is 17*24? Answer with just the number.'; sleep 0.5; printf '\r'; sleep 75; printf '\x1bq')" "408|turn done"

echo "=== VERIFICATION RESULTS ==="
for r in "${RESULTS[@]}"; do echo "$r"; done
echo "=== $PASS pass, $FAIL fail ==="
exit $((FAIL > 0))
