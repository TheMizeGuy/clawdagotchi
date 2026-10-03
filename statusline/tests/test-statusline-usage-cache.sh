#!/usr/bin/env bash
# Regression suite for the status line's shared usage cache (statusline/statusline.sh).
# By default it tests statusline/statusline.sh; STATUSLINE_SCRIPT points it at another copy.
# Exit non-zero on any failure.
# The cache keeps one row per account, keyed by the seven-day window's reset time, so a tab
# still on the previous account cannot overwrite the current account's numbers (2026-10-02;
# before that one shared row accepted any changed resets_at as a rollover). The script is
# driven with fake payloads, a temp cache (STATUSLINE_USAGE_CACHE) and a fixed clock
# (STATUSLINE_NOW), under both the Homebrew bash and the system bash 3.2. The script's other
# state (git cache, bus, prune marker) goes to a temp STATUSLINE_STATE_DIR, so the fixed clock
# never reaches the live ~/.claude/state/statusline. Rendering has its own suite
# (test-statusline.sh).
SCRIPT="${STATUSLINE_SCRIPT:-$(cd "$(dirname "$0")/.." && pwd)/statusline.sh}"   # STATUSLINE_SCRIPT: a candidate before it is installed
pass=0; fail=0
ok()  { pass=$((pass+1)); }
bad() { fail=$((fail+1)); echo "FAIL [$1]${2:+ — $2}"; }
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
CACHE="$TMP/usage-cache.tsv"

pay() { # f5pct f5reset f7pct f7reset
  printf '{"model":{"display_name":"M"},"workspace":{"current_dir":"/tmp"},"context_window":{"used_percentage":3,"total_input_tokens":33000,"context_window_size":1000000},"rate_limits":{"five_hour":{"used_percentage":%s,"resets_at":%s},"seven_day":{"used_percentage":%s,"resets_at":%s}}}' "$1" "$2" "$3" "$4"
}
bare() { printf '{"model":{"display_name":"M"},"workspace":{"current_dir":"/tmp"}}'; }
shown() { # now ; payload on stdin -> "5h N% 7d N%"
  STATUSLINE_USAGE_CACHE="$CACHE" STATUSLINE_STATE_DIR="$TMP/state" STATUSLINE_NOW="$1" "$SH" "$SCRIPT" | sed $'s/\033\\[[0-9;]*m//g' | grep -oE '(5h|7d) [0-9]+%' | tr '\n' ' ' | sed 's/ $//'
}
expect() { # label want got
  if [ "$2" = "$3" ]; then ok; else bad "$1" "want '$2', got '$3'"; fi
}

A=900000; B=950000   # two accounts' seven-day resets
for SH in "$(command -v bash)" /bin/bash; do
  tag="$("$SH" -c 'echo ${BASH_VERSINFO[0]}')"
  rm -f "$CACHE"
  expect "bash$tag: first sample of account A"            "5h 40% 7d 10%" "$(pay 40 2000 10 $A | shown 1000)"
  expect "bash$tag: account B gets its own row"           "5h 5% 7d 2%"   "$(pay 5 2500 2 $B | shown 1010)"
  expect "bash$tag: A still shows A after B wrote"        "5h 40% 7d 10%" "$(pay 40 2000 10 $A | shown 1020)"
  expect "bash$tag: an idle A tab shows the fresher row"  "5h 40% 7d 10%" "$(pay 30 2000 9 $A | shown 1030)"
  expect "bash$tag: an older 5h window never overwrites"  "5h 40% 7d 10%" "$(pay 90 1500 9 $A | shown 1040)"
  expect "bash$tag: a later 5h reset is a rollover"       "5h 3% 7d 11%"  "$(pay 3 20000 11 $A | shown 1050)"
  expect "bash$tag: no rate_limits shows the newest row"  "5h 3% 7d 11%"  "$(bare | shown 1060)"
  expect "bash$tag: one row per account"                  "2"             "$(wc -l < "$CACHE" | tr -d ' ')"
  expect "bash$tag: a stale row takes a same-window sample" "5h 20% 7d 11%" "$(pay 20 20000 11 $A | shown 1400)"
  # the pre-2026-10-02 one-row file is ignored and replaced
  printf '66\t1790935800\t16\t1791511200\t1790931675\n' > "$CACHE"
  expect "bash$tag: the old one-row format is replaced"   "5h 12% 7d 4%"  "$(pay 12 2000 4 $A | shown 1000)"
  expect "bash$tag: and leaves one keyed row"             "$A"            "$(cut -f1 "$CACHE" | tr '\n' ' ' | sed 's/ $//')"
  # nine days on, the other account's untouched row is dropped
  printf '%s\t5\t2500\t2\t%s\t1010\n' "$B" "$B" >> "$CACHE"
  pay 12 2000 4 990000 | shown $((1000 + 9 * 86400)) >/dev/null
  expect "bash$tag: rows untouched for 8 days are dropped" "990000"       "$(cut -f1 "$CACHE" | tr '\n' ' ' | sed 's/ $//')"
done

echo "statusline-usage-cache: $pass passed, $fail failed"
exit $((fail > 0))
