#!/usr/bin/env bash
# Validate and test the plugin, the frame contract and the status line, and check the vendored helper for drift.
# Usage: scripts/check-all.sh [plugin-name ...]
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLAUDE_BIN="${CLAUDE_BIN:-$HOME/.local/bin/claude}"
rc=0

"$ROOT/scripts/vendor-shared.sh" --check || rc=1

if [ "$#" -gt 0 ]; then
  plugins=("$@")
else
  plugins=()
  for d in "$ROOT"/plugins/*/; do plugins+=("$(basename "$d")"); done
  # the status line and its two suites (bash 3.2 and 5 where both exist)
  echo "== statusline"
  for t in test-statusline.sh test-statusline-usage-cache.sh; do
    if ! out=$(STATUSLINE_SCRIPT="$ROOT/statusline/statusline.sh" bash "$ROOT/statusline/tests/$t" 2>&1); then
      echo "$out" | tail -15
      echo "FAIL $t"
      rc=1
    else
      echo "$out" | tail -1
    fi
  done
fi

for p in "${plugins[@]}"; do
  dir="$ROOT/plugins/$p"
  echo "== $p"
  if ! out=$("$CLAUDE_BIN" plugin validate --strict "$dir" 2>&1); then
    echo "$out" | tail -15
    echo "FAIL validate $p"
    rc=1
  else
    echo "validate ok"
  fi
  # A tool.call hook that can match Bash (no matcher, a regex, or Bash itself) breaks Bash in
  # every worktree-isolated subagent on 2.1.287 (docs/BUILD-SPEC.md rule 7a). Exact names only.
  if ! echo "$out" | "$ROOT/scripts/worktree-safety.py"; then
    echo "FAIL worktree-safety $p"
    rc=1
  fi
  if [ -f "$dir/tests/test_frames.py" ] && ! out=$(cd "$dir" && python3 -m unittest tests/test_frames.py 2>&1); then
    echo "$out" | tail -15
    echo "FAIL frames $p"
    rc=1
  fi
  if ! out=$(cd "$dir" && "$CLAUDE_BIN" plugin test 2>&1); then
    echo "$out" | tail -25
    echo "FAIL test $p"
    rc=1
  else
    echo "$out" | grep -E '^ *[0-9]+ (pass|fail)' | tr '\n' ' '
    echo
  fi
done
exit $rc
