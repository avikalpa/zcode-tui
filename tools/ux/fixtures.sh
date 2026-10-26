#!/usr/bin/env sh
# Deterministic fixture workspace for ux-falsify TUI captures.
set -e
rm -rf /tmp/ux-falsify/proj
mkdir -p /tmp/ux-falsify/proj
cd /tmp/ux-falsify/proj
printf 'fixture project for ux-falsify captures\n' > README.md
git init -q .
git add README.md
GIT_AUTHOR_DATE="2026-10-27T00:00:00Z" GIT_COMMITTER_DATE="2026-10-27T00:00:00Z" \
  git -c user.name=falsify -c user.email=falsify@local commit -qm fixture
echo "fixture ready: /tmp/ux-falsify/proj"
