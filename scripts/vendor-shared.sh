#!/usr/bin/env bash
# Copy the canonical pure helpers in shared/ into each plugin that uses them.
#   scripts/vendor-shared.sh          write the vendored copies
#   scripts/vendor-shared.sh --check  exit 1 if any vendored copy differs from shared/
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHECK=0
[ "${1:-}" = "--check" ] && CHECK=1

# plugin -> shared files it vendors (space separated)
declare -a MAP=(
  "mize-coworker:statusline-bus.ts"
)

rc=0
for entry in "${MAP[@]}"; do
  plugin="${entry%%:*}"
  files="${entry#*:}"
  dir="$ROOT/plugins/$plugin/hooks/lib"
  for f in $files; do
    src="$ROOT/shared/$f"
    dst="$dir/$f"
    if [ "$CHECK" = 1 ]; then
      if ! cmp -s "$src" "$dst"; then
        echo "DRIFT: plugins/$plugin/hooks/lib/$f differs from shared/$f" >&2
        rc=1
      fi
    else
      mkdir -p "$dir"
      cp "$src" "$dst"
      echo "vendored shared/$f -> plugins/$plugin/hooks/lib/$f"
    fi
  done
done
exit $rc
