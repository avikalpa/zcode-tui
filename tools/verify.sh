#!/usr/bin/env bash
# Systematic verification pass — ONE staged PTY session (single backend
# spawn; repeated spawns throttle MCP warm-up and skew timing). Every key
# verb is driven in sequence; each stage's marker must appear in the
# cumulative capture.
set -u
REPO="${REPO:-$HOME/gh/zcode-tui}"
OUT="${OUT:-/tmp}"
CAP="$OUT/zcode-tui-verify.$$.txt"

# stage: boot → theme → filter → create → model → mode → think → fork →
# compact → send
( sleep 14
  printf 't'; sleep 1; printf 't'; sleep 1
  printf '/'; sleep 0.5; printf 'z'; sleep 1; printf '\x1b'; sleep 0.5
  printf 'a'; sleep 4
  printf 'm'; sleep 2
  printf 'o'; sleep 2
  printf 'e'; sleep 2
  printf 'f'; sleep 3
  printf 'c'; sleep 6
  printf 'i'; sleep 1
  printf 'What is 17*24? Answer with just the number.'
  sleep 0.5; printf '\r'
  sleep 55
  printf '\x1b'; sleep 1; printf 'q'
) | timeout 150 script -qec "bun run $REPO/src/tui/main.tsx" "$CAP" >/dev/null 2>&1

S=$(sed -e 's/\x1b\[[0-9;?]*[a-zA-Z]//g; s/\x1b\][^\x07\x1b]*\x1b\\//g' "$CAP")
PASS=0; FAIL=0
check() {
  if echo "$S" | grep -Eq -a "$1"; then
    echo "PASS $1"; PASS=$((PASS+1))
  else
    echo "FAIL $1"; FAIL=$((FAIL+1))
  fi
}
check "[0-9]+ sessions"
check "theme"
check "filter: z"
check "new sess_"
check "model → "
check "mode → "
check "thinking → "
check "turn done|408"
echo "=== $PASS pass, $FAIL fail (capture: $CAP) ==="
exit $((FAIL > 0))
