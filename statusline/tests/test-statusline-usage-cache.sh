#!/usr/bin/env bash
# Regression suite for the status line's shared usage cache (statusline/statusline.sh).
# By default it tests statusline/statusline.sh; STATUSLINE_SCRIPT points it at another copy.
# Exit non-zero on any failure.
# The cache keeps one row per account, keyed by the seven-day window's reset time, so a tab
# still on the previous account cannot overwrite the current account's numbers (2026-10-02;
# before that one shared row accepted any changed resets_at as a rollover). A payload with only
# a seven-day window (no 5h window open) writes its row too, its 5h fields "-". The script is
# driven with fake payloads, a temp cache (STATUSLINE_USAGE_CACHE) and a fixed clock
# (STATUSLINE_NOW), under both the Homebrew bash and the system bash 3.2. The script's other
# state (git cache, bus, prune marker) goes to a temp STATUSLINE_STATE_DIR, so the fixed clock
# never reaches the live ~/.claude/state/statusline, and no fleet helper runs
# (STATUSLINE_FLEET_CMD empty), so an installed helper never changes what is shown. Rendering has its own suite
# (test-statusline.sh).
SCRIPT="${STATUSLINE_SCRIPT:-$(cd "$(dirname "$0")/.." && pwd)/statusline.sh}"
pass=0; fail=0
ok()  { pass=$((pass+1)); }
bad() { fail=$((fail+1)); echo "FAIL [$1]${2:+ — $2}"; }
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
CACHE="$TMP/usage-cache.tsv"

pay() { # f5pct f5reset f7pct f7reset
  printf '{"model":{"display_name":"M"},"workspace":{"current_dir":"/tmp"},"context_window":{"used_percentage":3,"total_input_tokens":33000,"context_window_size":1000000},"rate_limits":{"five_hour":{"used_percentage":%s,"resets_at":%s},"seven_day":{"used_percentage":%s,"resets_at":%s}}}' "$1" "$2" "$3" "$4"
}
pay7() { # f7pct f7reset: a payload with only the seven-day window (no 5h window open)
  printf '{"model":{"display_name":"M"},"workspace":{"current_dir":"/tmp"},"context_window":{"used_percentage":3,"total_input_tokens":33000,"context_window_size":1000000},"rate_limits":{"seven_day":{"used_percentage":%s,"resets_at":%s}}}' "$1" "$2"
}
bare() { printf '{"model":{"display_name":"M"},"workspace":{"current_dir":"/tmp"}}'; }
run() { # now ; payload on stdin -> the visible line
  STATUSLINE_USAGE_CACHE="$CACHE" STATUSLINE_STATE_DIR="$TMP/state" STATUSLINE_NOW="$1" STATUSLINE_FLEET_CMD="" "$SH" "$SCRIPT" | sed $'s/\033\\[[0-9;]*m//g'
}
shown() { # now ; payload on stdin -> "5h N% 7d N%"
  run "$1" | grep -oE '(5h|7d) [0-9]+%' | tr '\n' ' ' | sed 's/ $//'
}
row() { { tr '\t' ' ' < "$CACHE"; } 2>/dev/null; }
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
  # a payload with only a seven-day window (no 5h window open on the account) still writes
  # its account's row, its 5h fields "-"; a "-" never renders as a percent
  rm -f "$CACHE"
  expect "bash$tag: 7d only: the week is shown"              "7d 12%"        "$(pay7 12 $A | shown 2000)"
  expect "bash$tag: 7d only: its account's row is written"   "$A - - 12 $A 2000" "$(row)"
  expect "bash$tag: 7d only: an idle tab shows the fresher week" "7d 12%"    "$(pay7 10 $A | shown 2010)"
  expect "bash$tag: 7d only: and does not lower the row"     "$A - - 12 $A 2000" "$(row)"
  expect "bash$tag: 7d only: more use updates the row"       "7d 14%"        "$(pay7 14 $A | shown 2020)"
  expect "bash$tag: 7d only: the updated row"                "$A - - 14 $A 2020" "$(row)"
  out="$(pay7 14 $A | run 2030)"
  case "$out" in *5h*) bad "bash$tag: 7d only: no 5h piece" "$out" ;; *) ok ;; esac
  case "$out" in *-%*) bad "bash$tag: 7d only: a \"-\" is never a percent" "$out" ;; *) ok ;; esac
  out="$(bare | run 2040)"
  case "$out" in *5h*|*-%*) bad "bash$tag: 7d only: a tab with no rate_limits shows the row without a 5h" "$out" ;; *) ok ;; esac
  expect "bash$tag: 7d only: a tab with no rate_limits shows its week" "7d 14%" "$(bare | shown 2040)"
  expect "bash$tag: 7d only: B's 7d-only row beside A's"     "7d 3%"         "$(pay7 3 $B | shown 2050)"
  expect "bash$tag: 7d only: two rows"                       "2"             "$(row | wc -l | tr -d ' ')"
  # a later payload with a 5h window upgrades the row; a 7d-only one never clobbers that window
  expect "bash$tag: 7d only: a 5h window upgrades the row"   "5h 30% 7d 15%" "$(pay 30 5000 15 $A | shown 2060)"
  expect "bash$tag: 7d only: the upgraded row"               "$A 30 5000 15 $A 2060" "$(grep "^$A" "$CACHE" | tr '\t' ' ')"
  expect "bash$tag: 7d only: an idle 7d-only tab then shows the 5h too" "5h 30% 7d 15%" "$(pay7 14 $A | shown 2070)"
  expect "bash$tag: 7d only: and leaves the row alone"       "$A 30 5000 15 $A 2060" "$(grep "^$A" "$CACHE" | tr '\t' ' ')"
  # once that 5h window has reset, a 7d-only sample is the account's newest word on its week
  expect "bash$tag: 7d only: after the 5h reset a 7d-only sample is shown" "7d 16%" "$(pay7 16 $A | shown 5400)"
  expect "bash$tag: 7d only: and updates the row's week"     "16"            "$(grep "^$A" "$CACHE" | cut -f4)"
  # an idle tab still holding a 5h window that has since reset is older news than a 7d-only row
  rm -f "$CACHE"; pay7 14 $A | shown 2000 >/dev/null
  pay 30 1500 10 $A | shown 2010 >/dev/null
  expect "bash$tag: 7d only: an idle tab with an ended 5h window does not clobber the row" "$A - - 14 $A 2000" "$(row)"
  expect "bash$tag: 7d only: so the next idle tab still shows the fresher week, and no 5h" "7d 14%" "$(pay7 12 $A | shown 2020)"
done

echo "statusline-usage-cache: $pass passed, $fail failed"
exit $((fail > 0))
