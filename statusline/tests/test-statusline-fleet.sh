#!/usr/bin/env bash
# Regression suite for the status line's account fleet (statusline/statusline.sh): the fleet file
# (<state>/fleet.tsv) and how it is read and aged, which account a session's next request runs
# on (me, moved, pinned, a fresh session), what the windows' chip shows in a fleet (slug, 5h,
# 7d, the model bucket, the accounts left and when one comes back), its colors and grounds, its
# place in the width ladder, the vitals' week field, the cache after a switch, and the
# background refresh of the file by a helper (stub helpers here: the helper is yours to write).
# By default it tests statusline/statusline.sh; STATUSLINE_SCRIPT points the suite at another
# copy. The script is driven with fake payloads, a fixed clock (STATUSLINE_NOW), a fresh temp
# state dir per case and no helper (STATUSLINE_FLEET_CMD empty) unless a check says otherwise,
# under both the Homebrew bash and the system bash 3.2. Exit non-zero on any failure.
SCRIPT="${STATUSLINE_SCRIPT:-$(cd "$(dirname "$0")/.." && pwd)/statusline.sh}"
export LC_ALL=en_US.UTF-8
pass=0; fail=0
ok()  { pass=$((pass+1)); }
bad() { fail=$((fail+1)); echo "FAIL [$1]${2:+ — $2}"; }
expect()   { if [ "$2" = "$3" ]; then ok; else bad "$1" "want '$2', got '$3'"; fi; }
has()      { case "$3" in *"$2"*) ok ;; *) bad "$1" "want '$2' in '$3'" ;; esac; }
hasnt()    { case "$3" in *"$2"*) bad "$1" "did not want '$2' in '$3'" ;; *) ok ;; esac; }
TMP="$(cd "$(mktemp -d)" && pwd -P)"; trap 'rm -rf "$TMP"' EXIT
NOW=2000000000
ESC=$'\033'; TAB=$'\t'
CL=$'\xee\x82\xb6'; CR=$'\xee\x82\xb4'; BRG=$'\xee\x82\xa0'

plain() { sed "s/${ESC}\\[[0-9;]*m//g; s/${ESC}\\]8;;[^${ESC}]*${ESC}\\\\//g"; }
pp() { plain | sed "s/${CL}/[/g; s/${CR}/]/g; s/${BRG}/⎇/g"; }
# win: the windows' chip of a readable line (the third chip, or the one holding a window)
win() { pp | grep -oE '\[[^][]*(7d|5h|left|acct)[^][]*\]' | head -1; }
chips() { python3 -c '
import re, sys
s = sys.stdin.read(); E = "\x1b"
chip = re.compile(E + r"\[38;2;(\d+;\d+;\d+)m\ue0b6" + E + r"\[48;2;\1m((?:(?!" + E + r"\[0m|" + E + r"\[49m|" + E + r"\[48;||).)*)"
                  + E + r"\[0m" + E + r"\[38;2;\1m" + E + r"\[0m", re.S)
pos, grounds = 0, []
while True:
    m = chip.match(s, pos)
    if not m: print("malformed at %d: %r" % (pos, s[pos:pos + 40])); sys.exit()
    grounds.append(m.group(1)); pos = m.end()
    if pos == len(s): break
    if s[pos] != " ": print("malformed at %d: %r" % (pos, s[pos:pos + 40])); sys.exit()
    pos += 1
print(" ".join(grounds))'; }
K="38;39;55"; KF="61;37;48"; KO="62;45;36"   # chip grounds: any group, spent, over
LAB="127;132;156"; LAB2="147;153;178"         # labels, and labels on a tinted ground
VAL="186;194;222"; YEL="249;226;175"; PEA="250;179;135"; RED="243;139;168"   # calm, watch, over, crit

# the accounts' seven-day resets; acct1 is the session's own account
R1=$(( NOW + 532800 )); R2=$(( NOW + 400000 )); R3=$(( NOW + 300000 )); R4=$(( NOW + 200000 )); R5=$(( NOW + 100000 ))
OLD=$(( NOW - 86400 ))      # a switch a day ago
EXP=$(( NOW + 2520 ))       # the prefix's expiry: a 1h prefix, so this session last answered at NOW-1080
BASE="$(printf '{"session_id":"f1","model":{"id":"m","display_name":"Fable 5.2"},"effort":{"level":"xhigh"},"thinking":{"enabled":true},"fast_mode":false,"output_style":{"name":"default"},"workspace":{"current_dir":"/nowhere/project","project_dir":"/nowhere/project"},"cost":{"total_cost_usd":44.4},"context_window":{"total_input_tokens":523000,"context_window_size":1000000,"used_percentage":52.3},"prompt_cache":{"warm":true,"ttl":"1h","expires_at":%s,"recache_tokens_if_cold":523000},"rate_limits":{"seven_day":{"used_percentage":57,"resets_at":%s}}}' "$EXP" "$R1")"
pay() { printf '%s' "$BASE" | jq -c "${1:-.}"; }
# lr <seconds after the switch> <switch epoch>: a 1h prefix whose request was answered then
lr() { printf '.prompt_cache.expires_at=%s' $(( $2 + $1 + 3600 )); }
# a fresh state dir per case (ST), the fleet file in it; unique even from inside $( )
newst() { ST="$(mktemp -d "$TMP/st/XXXXXX")"; }
hdr() { printf '#fleet\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$@"; }      # epoch active 5h-cap 7d-cap bucket-cap label switched mode
rw()  { printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$@"; }               # slug state 5h 5h-reset 7d 7d-reset bucket sample
# five calm accounts, all under every cap: <active> <switched at> [header epoch]
calm5() {
  { hdr "${3-$NOW}" "$1" 95 98 98 fable "$2" full
    rw acct1 ok - - 57 "$R1" 62 $(( NOW - 10 ))
    rw acct2 ok - - 12 "$R2" 11 $(( NOW - 10 ))
    rw acct3 ok - - 40 "$R3" 30 $(( NOW - 10 ))
    rw acct4 ok - - 50 "$R4" 20 $(( NOW - 10 ))
    rw acct5 ok - - 60 "$R5" 10 $(( NOW - 10 )); } > "$ST/fleet.tsv"
}
# line <cols> ; payload on stdin -> raw output (FCMD: the helper, none by default)
line() { COLUMNS="$1" STATUSLINE_STYLE="${STYLE:-chips}" STATUSLINE_NOW="$NOW" STATUSLINE_USAGE_CACHE="$ST/usage.tsv" STATUSLINE_STATE_DIR="$ST" STATUSLINE_FLEET_CMD="${FCMD-}" HOME="$FAKEHOME" "$SH" "$SCRIPT"; }
vitals() { cat "$ST/bus/f1/.vitals" 2>/dev/null; }

for SH in "$(command -v bash)" /bin/bash; do
  t="bash$("$SH" -c 'echo ${BASH_VERSINFO[0]}')"
  rm -rf "$TMP"/*; FAKEHOME="$TMP/home"; mkdir -p "$FAKEHOME" "$TMP/st"

  # --- no fleet: the single-account row, untouched ---
  newst
  expect "$t: no fleet file: the single-account row" "[✻ Fable 5.2] [ctx ▬▬▬▬▬▬▬▬▬▬ 52% · cache 42m] [7d 57%↗ ↻6d4h] [/nowhere/project] [\$44]" "$(pay | line 220 | pp)"

  # --- the fleet file: header first, rows after it, "-" for unknown ---
  newst; calm5 acct1 "$OLD"
  o="$(pay | line 220)"
  expect "$t: a fleet: slug, week, bucket and the accounts left" "[✻ Fable 5.2] [ctx ▬▬▬▬▬▬▬▬▬▬ 52% · cache 42m] [acct1 · 7d 57% fable 62% · 4 left] [/nowhere/project] [\$44]" "$(printf '%s' "$o" | pp)"
  expect "$t: every group is a well-formed chip on the chip ground" "$K $K $K $K $K" "$(printf '%s' "$o" | chips)"
  has "$t: the slug in the label color" "${ESC}[38;2;${LAB}macct1" "$o"
  has "$t: the bucket's label" "${ESC}[38;2;${LAB}mfable${ESC}[39m ${ESC}[38;2;${VAL}m62%" "$o"
  has "$t: a calm count of the accounts left" "${ESC}[38;2;${VAL}m4${ESC}[39m ${ESC}[38;2;${LAB}mleft" "$o"
  hasnt "$t: no pace marks in a fleet" "↗" "$(printf '%s' "$o" | plain)"
  hasnt "$t: no week countdown in a fleet" "↻" "$(printf '%s' "$o" | plain)"
  expect "$t: flat: the same pieces, joined by dots" "✻ Fable 5.2 │ ctx ▬▬▬▬▬▬▬▬▬▬ 52% · cache 42m │ acct1 · 7d 57% · fable 62% · 4 left │ /nowhere/project │ \$44" "$(pay | STYLE=flat line 220 | pp)"
  # a local helper knows the active account only: the session is labeled with it
  newst; { hdr "$NOW" acct1 95 98 - - "$OLD" local; rw acct1 ok - - 30 - - "$NOW"; } > "$ST/fleet.tsv"
  expect "$t: local: the slug and the session's own week, nothing else" "[acct1 · 7d 57%]" "$(pay | line 220 | win)"
  # "-" fields: a row without a week is not an account to count; "-" caps take the defaults
  newst; { hdr "$NOW" acct1 - - - - "$OLD" full; rw acct1 ok - - 57 "$R1" - "$NOW"; rw acct2 ok - - - "$R2" - "$NOW"
           rw acct3 ok - - 10 "$R3" - "$NOW"; rw acct4 ok - - 10 "$R4" - "$NOW"; } > "$ST/fleet.tsv"
  expect "$t: \"-\" fields: no bucket, a row without a week not counted" "[acct1 · 7d 57% · 2 left]" "$(pay | line 220 | win)"
  # (the usage cache keeps the highest sample of a window: each check goes up from the last)
  has "$t: \"-\" caps: 92 is calm" "${ESC}[38;2;${VAL}m92%" "$(pay '.rate_limits.seven_day.used_percentage=92' | line 220)"
  has "$t: \"-\" caps: the week's default cap is 98 (93 is within five)" "${ESC}[38;2;${YEL}m93%" "$(pay '.rate_limits.seven_day.used_percentage=93' | line 220)"
  # rows that are not plain slugs are skipped; so is any row before the header
  newst; { hdr "$NOW" acct1 95 98 98 fable "$OLD" full; rw acct1 ok - - 57 "$R1" 62 "$NOW"; rw 'x;y' ok - - 10 "$R2" 10 "$NOW"
           rw 'a b' ok - - 10 "$R3" 10 "$NOW"; rw 'ü1' ok - - 10 "$R4" 10 "$NOW"; rw acct5 ok - - 10 "$R5" 10 "$NOW"; } > "$ST/fleet.tsv"
  expect "$t: rows that are not plain slugs are skipped" "[acct1 · 7d 57% fable 62% · 1 left]" "$(pay | line 220 | win)"
  newst; { rw zz ok - - 5 "$R1" 5 "$NOW"; hdr "$NOW" acct1 95 98 98 fable "$OLD" full; rw acct1 ok - - 57 "$R1" 62 "$NOW"; } > "$ST/fleet.tsv"
  hasnt "$t: a row before the header is not read" "zz" "$(pay | line 220 | pp)"
  newst; calm5 acct1 "$OLD"; { printf '\n# a comment\n'; cat "$ST/fleet.tsv"; } > "$ST/x"; mv "$ST/x" "$ST/fleet.tsv"
  has "$t: blank and comment lines before the header are skipped" "[acct1 · 7d 57% fable 62% · 4 left]" "$(pay | line 220 | pp)"
  newst; { hdr "$NOW" acct1 95 98 98 FaBle-5 "$OLD" full; rw acct1 ok - - 57 "$R1" 62 "$NOW"; rw acct2 ok - - 10 "$R2" 10 "$NOW"; } > "$ST/fleet.tsv"
  hasnt "$t: the bucket label keeps lowercase letters and digits only" "FaBle" "$(pay | line 220 | pp)"
  newst; { hdr "$NOW" acct1 95 98 98 'fa'$'\033''[31mble' "$OLD" full; rw acct1 ok - - 57 "$R1" 62 "$NOW"; rw acct2 ok - - 10 "$R2" 10 "$NOW"; } > "$ST/fleet.tsv"
  o="$(pay | line 220)"
  hasnt "$t: no escape from the bucket label reaches the terminal" "${ESC}[31m" "$o"
  has "$t: and what is left of it reads" "fa31mble 62%" "$(printf '%s' "$o" | plain)"
  newst; { hdr "$NOW" acct2 095 098 098 fable 0"$OLD" full; rw acct1 ok - - 57 "$R1" 62 "$NOW"; rw acct2 ok 08 0$(( NOW + 900 )) 09 "$R2" 07 "$NOW"; } > "$ST/fleet.tsv"
  expect "$t: numbers with leading zeros are no error" "" "$(pay 'del(.rate_limits)' | line 220 2>&1 >/dev/null)"
  has "$t: and read as decimal" "[acct2 · 5h 8% ↻15m · 7d 9% fable 7% · 1 left]" "$(pay 'del(.rate_limits)' | line 220 | pp)"
  has "$t: caps with leading zeros too (93 is within five of 098)" "${ESC}[38;2;${YEL}m93%" "$(pay '.rate_limits.seven_day={"used_percentage":93,"resets_at":'"$R2"'}' | line 220)"
  # two slugs alike in their first characters are two accounts
  newst; { hdr "$NOW" account-numb2 95 98 98 fable $(( NOW - 300 )) full; rw account-numb1 ok - - 57 "$R1" 62 "$NOW"; rw account-numb2 ok - - 12 "$R2" 11 "$NOW"; } > "$ST/fleet.tsv"
  has "$t: slugs alike in their first 12 characters are still told apart (moved)" "7d 12% fable 11%" "$(pay | line 220 | pp)"

  # --- the file's age: shown under 900 s, redirects under 300 s, a header up to 60 s ahead ---
  newst; calm5 acct1 "$OLD" $(( NOW - 899 ))
  has "$t: a file 899 s old is shown" "acct1 · 7d 57%" "$(pay | line 220 | pp)"
  newst; calm5 acct1 "$OLD" $(( NOW - 900 ))
  expect "$t: a file 900 s old is not" "[7d 57%↗ ↻6d4h]" "$(pay | line 220 | win)"
  newst; calm5 acct1 "$OLD" $(( NOW + 60 ))
  has "$t: a header 60 s ahead is shown" "acct1 · 7d 57%" "$(pay | line 220 | pp)"
  newst; calm5 acct1 "$OLD" $(( NOW + 61 ))
  hasnt "$t: one 61 s ahead is not" "acct1" "$(pay | line 220 | pp)"
  for e in 0 - x12 ''; do
    newst; calm5 acct1 "$OLD" "$e"
    hasnt "$t: a header epoch '$e' is not a fleet" "acct1" "$(pay | line 220 | pp)"
  done
  SW=$(( NOW - 600 ))
  newst; calm5 acct2 "$SW" $(( NOW - 299 ))
  has "$t: a 299 s old file still redirects a session the switch left behind" "acct2 · 7d 12%" "$(pay | line 220 | pp)"
  newst; calm5 acct2 "$SW" $(( NOW - 300 ))
  has "$t: a 300 s old one shows the session's own account" "acct1 · 7d 57%" "$(pay | line 220 | pp)"
  has "$t: and its cache as it is" "cache 42m" "$(pay | line 220 | pp)"
  newst; calm5 acct2 "$SW" $(( NOW - 300 ))
  expect "$t: a fresh session is not sent to the active account by a 300 s old file" "" "$(pay 'del(.rate_limits)' | line 220 | win)"

  # --- which account: me / moved / pinned / a fresh session ---
  # me: the row whose week resets within 90 s of the payload's
  newst; calm5 acct1 "$OLD"
  has "$t: me: a week reset 90 s off is still me" "acct1 · 7d 57%" "$(pay '.rate_limits.seven_day.resets_at='"$(( R1 + 90 ))" | line 220 | pp)"
  has "$t: me: 90 s early too" "acct1 · 7d 57%" "$(pay '.rate_limits.seven_day.resets_at='"$(( R1 - 90 ))" | line 220 | pp)"
  hasnt "$t: me: 91 s off is no account of the fleet" "acct1" "$(pay '.rate_limits.seven_day.resets_at='"$(( R1 + 91 ))" | line 220 | pp)"
  newst; calm5 acct1 "$OLD"; sed "s/^acct1${TAB}ok${TAB}-${TAB}-${TAB}57/acct1${TAB}ok${TAB}-${TAB}-${TAB}60/" "$ST/fleet.tsv" > "$ST/x"; mv "$ST/x" "$ST/fleet.tsv"
  has "$t: me: the fleet's newer sample of the same week wins" "acct1 · 7d 60%" "$(pay | line 220 | pp)"
  newst; calm5 acct1 "$OLD"; sed "s/^acct1${TAB}ok${TAB}-${TAB}-${TAB}57/acct1${TAB}ok${TAB}-${TAB}-${TAB}50/" "$ST/fleet.tsv" > "$ST/x"; mv "$ST/x" "$ST/fleet.tsv"
  has "$t: me: an older fleet sample does not lower the payload's" "acct1 · 7d 57%" "$(pay | line 220 | pp)"
  # moved: the machine switched after this session's last response (90 s of grace)
  SW=$(( NOW - 300 ))
  newst; calm5 acct2 "$SW"
  o="$(pay "$(lr 89 "$SW")" | line 220)"
  expect "$t: moved: the active account's numbers and slug, the cache cold" "[✻ Fable 5.2] [ctx ▬▬▬▬▬▬▬▬▬▬ 52% · cache cold 523k] [⇄ acct2 · 7d 12% fable 11% · 4 left] [/nowhere/project] [\$44]" "$(printf '%s' "$o" | pp)"
  has "$t: moved: a big re-cache is peach" "${ESC}[38;2;${PEA}mcold 523k" "$o"
  has "$t: moved: the slug yellow with ⇄ after a switch" "${ESC}[38;2;${YEL}m⇄ acct2" "$o"
  has "$t: moved: with no re-cache count, the tokens in use are re-cached" "cache cold 523k" "$(pay "$(lr 89 "$SW") | del(.prompt_cache.recache_tokens_if_cold)" | line 220 | pp)"
  has "$t: moved: a small context re-caches quietly" "[ctx ▬▬▬▬▬▬▬▬▬▬ 5% · cache cold]" "$(pay "$(lr 89 "$SW") | .context_window.used_percentage=5 | .context_window.total_input_tokens=50000 | .prompt_cache.recache_tokens_if_cold=50000" | line 220 | pp)"
  newst; calm5 acct2 "$SW"
  o="$(pay "$(lr 90 "$SW")" | line 220 | pp)"
  has "$t: an answer 90 s after the switch is the session's own account" "[⇄ acct1 · 7d 57% fable 62% · 4 left]" "$o"
  has "$t: and its cache is warm" "cache 56m" "$o"
  newst; calm5 acct2 "$SW"
  has "$t: a 5m prefix dates the last answer too (moved)" "acct2 · 7d 12%" "$(pay '.prompt_cache.ttl="5m" | .prompt_cache.expires_at='"$(( SW + 89 + 300 ))" | line 220 | pp)"
  newst; calm5 acct2 "$SW"
  has "$t: a 5m prefix answered after the switch (not moved)" "acct1 · 7d 57%" "$(pay '.prompt_cache.ttl="5m" | .prompt_cache.expires_at='"$(( SW + 90 + 300 ))" | line 220 | pp)"
  newst; calm5 acct2 "$SW"
  has "$t: an unknown prefix lifetime dates nothing: not moved" "acct1 · 7d 57%" "$(pay '.prompt_cache.ttl="2h"' | line 220 | pp)"
  newst; calm5 acct2 "$SW"
  has "$t: no prefix at all dates nothing: not moved" "acct1 · 7d 57%" "$(pay 'del(.prompt_cache)' | line 220 | pp)"
  # the payload's limits are the whole process's (a subagent's answer updates them), the prefix is the main
  # conversation's: a main request from before the switch is cold whatever account answered last
  newst; calm5 acct1 "$SW"
  o="$(pay | line 220 | pp)"
  has "$t: the main conversation last asked before the switch: cold, though the process already answered on the active account" "cache cold 523k" "$o"
  has "$t: and the payload's own sample of that account is kept" "[⇄ acct1 · 7d 57% fable 62% · 4 left]" "$o"
  newst; calm5 acct1 "$SW"
  has "$t: a session that asked after the switch, on the active account, is not moved" "cache 57m" "$(pay "$(lr 120 "$SW")" | line 220 | pp)"
  newst; calm5 acct2 "$SW"
  has "$t: a request from before the switch is moved without any grace" "[⇄ acct2 · 7d 12% fable 11% · 4 left]" "$(pay "$(lr -1 "$SW")" | line 220 | pp)"
  newst; { hdr "$NOW" acct2 95 98 98 fable "$SW" full; rw acct2 ok - - 12 "$R2" 11 "$NOW"; rw acct3 ok - - 12 "$R3" 11 "$NOW"; } > "$ST/fleet.tsv"
  o="$(pay | line 220 | pp)"
  has "$t: full: a session on another login is not moved by the fleet's switch" "cache 42m" "$o"
  hasnt "$t: nor labeled" "acct" "$o"
  # two accounts whose weeks reset in the same hour
  newst; { hdr "$NOW" acct1 95 98 98 fable "$OLD" full; rw acct1 ok - - 57 "$R1" 62 "$NOW"; rw acct3 ok - - 40 "$R3" 30 "$NOW"; rw acct12 ok - - 96 $(( R1 - 1 )) 97 "$NOW"; } > "$ST/fleet.tsv"
  o="$(pay | line 220 | pp)"
  has "$t: two rows share the reset: the active one is me" "[acct1 · 7d 57% fable 62% · 2 left]" "$o"
  expect "$t: and no pin comes of it" "" "$(ls "$ST/pin" 2>/dev/null)"
  newst; { hdr "$NOW" acct3 95 98 98 fable $(( NOW - 3000 )) full; rw acct1 ok - - 57 "$R1" 62 "$NOW"; rw acct3 ok - - 40 "$R3" 30 "$NOW"; rw acct12 ok - - 96 $(( R1 - 1 )) 97 "$NOW"; } > "$ST/fleet.tsv"
  pay "$(lr 700 $(( NOW - 3000 )))" | line 220 >/dev/null
  expect "$t: two rows share the reset and neither is active: which one is open, so no pin" "" "$(ls "$ST/pin" 2>/dev/null)"
  # pinned: seen answering on another fleet account 600 s or more after the switch
  SW=$(( NOW - 3000 ))
  newst; calm5 acct2 "$SW"
  o="$(pay "$(lr 599 "$SW")" | line 220 | pp)"
  has "$t: 599 s after the switch is not yet pinned" "[acct1 · 7d 57% fable 62% · 4 left]" "$o"
  [ -e "$ST/pin/f1" ] && bad "$t: and leaves no pin" || ok
  o="$(pay "$(lr 600 "$SW")" | line 220 | pp)"
  expect "$t: pinned: its own account by the single-account rules, slug and bucket" "[✻ Fable 5.2] [ctx ▬▬▬▬▬▬▬▬▬▬ 52% · cache 20m] [acct1 · 7d 57%↗ ↻6d4h · fable 62%↗] [/nowhere/project] [\$44]" "$o"
  [ -e "$ST/pin/f1" ] && ok || bad "$t: pinned: the pin is kept in <state>/pin/<session>"
  hasnt "$t: pinned: no count of the accounts left" "left" "$o"
  o="$(pay "$(lr 0 "$SW")" | line 220 | pp)"
  has "$t: pinned: an answer from before the switch is still pinned (not moved)" "[acct1 · 7d 57%↗ ↻6d4h · fable 62%↗]" "$o"
  hasnt "$t: pinned: never sent to the active account" "acct2" "$o"
  hasnt "$t: pinned: its cache never forced cold" "cold" "$o"
  o="$(pay 'del(.rate_limits)' | line 220 | pp)"
  hasnt "$t: pinned: a fresh payload does not follow the active account" "acct2" "$o"
  [ -e "$ST/pin/f1" ] && ok || bad "$t: pinned: and keeps the pin"
  o="$(pay '.rate_limits.seven_day={"used_percentage":12,"resets_at":'"$R2"'}' | line 220 | pp)"
  has "$t: seen on another account than the pinned one, the pin goes" "[acct2 · 7d 12% fable 11% · 4 left]" "$o"
  [ -e "$ST/pin/f1" ] && bad "$t: and its file with it" "$(ls "$ST/pin")" || ok
  has "$t: and the session follows the fleet again (moved)" "acct2 · 7d 12%" "$(pay "$(lr 0 "$SW")" | line 220 | pp)"
  newst; calm5 acct2 "$SW"
  o="$(pay "$(lr 600 "$SW") | del(.session_id)" | line 220 | pp)"
  has "$t: no session id: never pinned" "[acct1 · 7d 57% fable 62% · 4 left]" "$o"
  expect "$t: and no pin file" "" "$(ls "$ST/pin" 2>/dev/null)"
  newst; calm5 acct2 "$SW"
  pay "$(lr 600 "$SW") | .session_id=\"../pin/x\"" | line 220 >/dev/null
  expect "$t: a session id that is not a plain name writes no pin" "" "$(find "$ST" -path '*pin*' 2>/dev/null)"
  newst; calm5 acct1 "$SW"
  pay "$(lr 600 "$SW")" | line 220 >/dev/null
  expect "$t: a session on the active account is never pinned" "" "$(ls "$ST/pin" 2>/dev/null)"
  # a fresh session (no rate_limits yet) runs on the active account
  newst; calm5 acct2 "$OLD"
  o="$(pay 'del(.rate_limits)' | line 220 | pp)"
  has "$t: a fresh session shows the active account" "[acct2 · 7d 12% fable 11% · 4 left]" "$o"
  has "$t: and its cache as it is" "cache 42m" "$o"
  newst; { hdr "$NOW" acct2 95 98 98 fable "$OLD" full; rw acct1 ok - - 57 "$R1" 62 "$NOW"; rw acct2 ok 30 $(( NOW + 9000 )) 12 "$R2" 11 "$NOW"; rw acct3 ok 0 $(( NOW + 18000 )) 40 "$R3" 30 "$NOW"; } > "$ST/fleet.tsv"
  has "$t: the active account's live 5h window, with its countdown" "[acct2 · 5h 30% ↻2h30m · 7d 12% fable 11% · 2 left]" "$(pay 'del(.rate_limits)' | line 220 | pp)"
  newst; { hdr "$NOW" acct3 95 98 98 fable "$OLD" full; rw acct1 ok - - 57 "$R1" 62 "$NOW"; rw acct3 ok 0 $(( NOW + 18000 )) 40 "$R3" 30 "$NOW"; } > "$ST/fleet.tsv"
  o="$(pay 'del(.rate_limits)' | line 220 | pp)"
  has "$t: a 0% 5h is no live window: no 5h piece" "[acct3 · 7d 40% fable 30% · 1 left]" "$o"
  newst; { hdr "$NOW" acct3 95 98 98 fable "$OLD" full; rw acct1 ok - - 57 "$R1" 62 "$NOW"; rw acct3 ok 40 $(( NOW - 10 )) 40 "$R3" 30 "$NOW"; } > "$ST/fleet.tsv"
  has "$t: a 5h window whose reset has passed is no live window either" "[acct3 · 7d 40% fable 30% · 1 left]" "$(pay 'del(.rate_limits)' | line 220 | pp)"
  # a local helper: a session the switch left behind shows the active account's numbers
  newst; { hdr "$NOW" acct2 95 98 - - $(( NOW - 300 )) local; rw acct2 ok 31 - 12 - - "$NOW"; } > "$ST/fleet.tsv"
  o="$(pay "$(lr -1 $(( NOW - 300 )))" | line 220 | pp)"
  has "$t: local: moved: the active account's numbers" "[⇄ acct2 · 5h 31% 7d 12%]" "$o"
  has "$t: local: moved: the cache cold" "cache cold 523k" "$o"
  has "$t: local: in the 90 s after the switch nothing says which account answered: left as it is" "cache 55m" "$(pay "$(lr 0 $(( NOW - 300 )))" | line 220 | pp)"
  has "$t: local: a session answered since: labeled with the active slug, its own numbers" "[⇄ acct2 · 7d 57%]" "$(pay "$(lr 120 $(( NOW - 300 )))" | line 220 | pp)"
  has "$t: local: a fresh session: the active account" "[⇄ acct2 · 5h 31% 7d 12%]" "$(pay 'del(.rate_limits)' | line 220 | pp)"
  newst; { hdr "$NOW" acct2 95 98 - - "$OLD" local; rw acct2 ok - - - - - "$NOW"; } > "$ST/fleet.tsv"
  has "$t: local with nothing but the slug: the session's own week" "[acct2 · 7d 57%]" "$(pay | line 220 | pp)"
  newst; { hdr "$NOW" acct2 95 98 98 fable "$OLD" full; rw acct2 ok - - 12 "$R2" 11 "$NOW"; rw acct3 ok - - 12 "$R3" 11 "$NOW"; } > "$ST/fleet.tsv"
  expect "$t: full: a session on an account the fleet does not know is not labeled" "[7d 57%↗ ↻6d4h]" "$(pay | line 220 | win)"
  # the active account's row is missing: no fleet
  newst; { hdr "$NOW" acct9 95 98 98 fable "$OLD" full; rw acct1 ok - - 57 "$R1" 62 "$NOW"; rw acct2 ok - - 12 "$R2" 11 "$NOW"; } > "$ST/fleet.tsv"
  expect "$t: an active slug without a row is no fleet" "[7d 57%↗ ↻6d4h]" "$(pay | line 220 | win)"

  # --- ⇄ for ten minutes after a switch ---
  newst; calm5 acct1 $(( NOW - 599 ))
  has "$t: 599 s after a switch the slug reads ⇄, in yellow" "${ESC}[38;2;${YEL}m⇄ acct1" "$(pay | line 220)"
  newst; calm5 acct1 $(( NOW - 600 ))
  o="$(pay | line 220)"
  hasnt "$t: at 600 s it is quiet again" "⇄" "$o"
  has "$t: in the label color" "${ESC}[38;2;${LAB}macct1" "$o"
  newst; calm5 acct1 $(( NOW + 30 ))
  hasnt "$t: a switch logged in the future is no switch yet" "⇄" "$(pay | line 220)"
  newst; calm5 acct1 -
  hasnt "$t: an unknown switch time is none" "⇄" "$(pay | line 220)"

  # --- windows near their caps: watch within 5 points, over at the cap (crit with none left) ---
  # caps: 5h 95, 7d 98, bucket 98
  # each sample in a fresh state dir holding the same fleet (the usage cache would keep the highest)
  again() { local f="$ST/fleet.tsv"; newst; cp "$f" "$ST/fleet.tsv"; }
  st7() { again; pay ".rate_limits.seven_day.used_percentage=$1" | line 220; }
  newst; calm5 acct1 "$OLD"
  has "$t: 7d 92 is calm" "${ESC}[38;2;${VAL}m92%" "$(st7 92)"
  has "$t: 7d 93 is watch" "${ESC}[38;2;${YEL}m93%" "$(st7 93)"
  has "$t: 7d 97 is watch" "${ESC}[38;2;${YEL}m97%" "$(st7 97)"
  o="$(st7 98)"
  has "$t: 7d 98, another account left: over" "${ESC}[38;2;${PEA}m98%" "$o"
  expect "$t: and the windows' chip tinted peach" "$K $K $KO $K $K" "$(printf '%s' "$o" | chips)"
  has "$t: its labels a tone up" "${ESC}[38;2;${LAB2}m7d" "$o"
  has "$t: the slug's too" "${ESC}[38;2;${LAB2}macct1" "$o"
  expect "$t: a watch window does not tint" "$K $K $K $K $K" "$(st7 97 | chips)"
  st5() { again; pay ".rate_limits.five_hour={\"used_percentage\":$1,\"resets_at\":$(( NOW + 9000 ))}" | line 220; }
  has "$t: 5h 89 is calm" "${ESC}[38;2;${VAL}m89%" "$(st5 89)"
  has "$t: 5h 90 is watch" "${ESC}[38;2;${YEL}m90%" "$(st5 90)"
  has "$t: 5h 94 is watch" "${ESC}[38;2;${YEL}m94%" "$(st5 94)"
  has "$t: 5h 95 is over" "${ESC}[38;2;${PEA}m95%" "$(st5 95)"
  has "$t: the session's own live 5h window, with its countdown" "[acct1 · 5h 89% ↻2h30m · 7d 57% fable 62% · 4 left]" "$(st5 89 | pp)"
  stb() { newst; { hdr "$NOW" acct1 95 98 "${2:-98}" fable "$OLD" full; rw acct1 ok - - 57 "$R1" "$1" "$NOW"; rw acct2 ok - - 12 "$R2" 11 "$NOW"; rw acct3 ok - - 12 "$R3" 11 "$NOW"; } > "$ST/fleet.tsv"; pay | line 220; }
  has "$t: bucket 92 is calm" "${ESC}[38;2;${VAL}m92%" "$(stb 92)"
  has "$t: bucket 93 is watch" "${ESC}[38;2;${YEL}m93%" "$(stb 93)"
  has "$t: bucket 98 is over" "${ESC}[38;2;${PEA}m98%" "$(stb 98)"
  expect "$t: a bucket over its cap tints the chip peach" "$K $K $KO $K $K" "$(stb 98 | chips)"
  expect "$t: a bucket on watch does not" "$K $K $K $K $K" "$(stb 93 | chips)"
  has "$t: no bucket cap: its cap is 100 (95 is watch)" "${ESC}[38;2;${YEL}m95%" "$(stb 95 -)"
  has "$t: no bucket cap: 94 is calm" "${ESC}[38;2;${VAL}m94%" "$(stb 94 -)"
  has "$t: no bucket cap: 100 is spent, whatever is left" "${ESC}[38;2;${RED}m100%" "$(stb 100 -)"
  # a helper that knows the active account only cannot say none is left
  newst; { hdr "$NOW" acct1 95 98 - - "$OLD" local; rw acct1 ok - - 98 - - "$NOW"; } > "$ST/fleet.tsv"
  o="$(pay '.rate_limits.seven_day.used_percentage=98' | line 220)"
  has "$t: local: the week at its cap is over, not spent" "${ESC}[38;2;${PEA}m98%" "$o"
  expect "$t: local: on the over ground" "$K $K $KO $K $K" "$(printf '%s' "$o" | chips)"
  hasnt "$t: local: no count of accounts left" "left" "$(printf '%s' "$o" | pp)"
  # nothing left to switch to: a window at its cap is spent
  newst; { hdr "$NOW" acct1 95 98 98 fable "$OLD" full; rw acct1 ok - - 98 "$R1" 62 "$NOW"; rw acct2 ok - - 99 "$R2" 11 "$NOW"; rw acct3 ok - - 98 "$R3" 20 "$NOW"; } > "$ST/fleet.tsv"
  o="$(st7 98)"
  has "$t: none left: the week at its cap is red" "${ESC}[38;2;${RED}m98%" "$o"
  has "$t: none left: red, with the first comeback" "${ESC}[38;2;${RED}mnone${ESC}[39m ${ESC}[38;2;${LAB2}mleft" "$o"
  expect "$t: none left: the chip on the failure ground" "$K $K $KF $K $K" "$(printf '%s' "$o" | chips)"
  has "$t: none left: the row" "[acct1 · 7d 98% fable 62% · none left ↻3d11h]" "$(printf '%s' "$o" | pp)"

  # --- the count of the accounts left ---
  # fl <active> <rows...> (each row "slug state 5h 5hreset 7d 7dreset bucket")
  fl() { local a="$1" r; shift; newst; { hdr "$NOW" "$a" 95 98 98 fable "$OLD" full; for r in "$@"; do set -- $r; rw "$1" "$2" "$3" "$4" "$5" "$6" "$7" "$NOW"; done; } > "$ST/fleet.tsv"; }
  left() { pay | line 220 | pp | grep -oE '(none|[0-9]+) left( ↻[^]]*)?'; }
  M="acct1 ok - - 57 $R1 62"
  fl acct1 "$M" "acct2 ok - - 10 $R2 10" "acct3 ok - - 10 $R3 10" "acct4 ok - - 10 $R4 10"
  expect "$t: three left" "3 left" "$(left)"
  has "$t: three left is a quiet number" "${ESC}[38;2;${VAL}m3${ESC}[39m" "$(pay | line 220)"
  fl acct1 "$M" "acct2 ok - - 10 $R2 10" "acct3 ok - - 10 $R3 10" "acct4 ok - - 99 $R4 10"
  has "$t: two left is a quiet number too" "${ESC}[38;2;${VAL}m2${ESC}[39m" "$(pay | line 220)"
  expect "$t: two left has no countdown, though one account is spent" "2 left" "$(left)"
  expect "$t: and does not tint the chip" "$K $K $K $K $K" "$(pay | line 220 | chips)"
  fl acct1 "$M" "acct2 ok - - 10 $R2 10" "acct3 ok - - 99 $R3 10" "acct4 ok - - 98 $R4 10"
  expect "$t: one left, with the first spent account's comeback" "1 left ↻2d7h" "$(left)"
  o="$(pay | line 220)"
  has "$t: one left while this account's windows are calm is watch" "${ESC}[38;2;${YEL}m1${ESC}[39m" "$o"
  expect "$t: and does not tint the chip" "$K $K $K $K $K" "$(printf '%s' "$o" | chips)"
  o="$(again; pay '.rate_limits.seven_day.used_percentage=94' | line 220)"
  has "$t: one left and the week within five points of its cap is over" "${ESC}[38;2;${PEA}m1${ESC}[39m" "$o"
  expect "$t: and tints the windows' chip peach" "$K $K $KO $K $K" "$(printf '%s' "$o" | chips)"
  fl acct1 "$M" "acct2 ok - - 99 $R2 10" "acct3 ok - - 98 $R3 10"
  o="$(pay | line 220)"
  has "$t: none left while this account has room is watch: nothing stops yet" "${ESC}[38;2;${YEL}mnone${ESC}[39m" "$o"
  expect "$t: and no tint" "$K $K $K $K $K" "$(printf '%s' "$o" | chips)"
  fl acct1 "$M" "acct2 out - - 10 $R2 10" "acct3 reserve - - 10 $R3 10" "acct4 down - - 10 $R4 10" "acct5 ok - - 10 $R5 10"
  expect "$t: out, reserve and down accounts are not counted" "1 left" "$(left)"
  fl acct1 "acct1 ok - - 98 $R1 62" "acct2 ok - - 10 $R2 10" "acct3 ok - - 10 $R3 10"
  expect "$t: the displayed account at its cap is not taken off the count" "2 left" "$(left)"
  fl acct1 "$M" "acct2 ok - - 99 $(( NOW - 10 )) 99" "acct3 ok - - 10 $R3 10"
  expect "$t: a week that rolled since its sample is empty again" "2 left" "$(left)"
  fl acct1 "$M" "acct2 ok 96 $(( NOW + 3600 )) 10 $R2 10" "acct3 ok - - 10 $R3 10" "acct4 ok - - 99 $R4 10"
  expect "$t: an account at its 5h cap is not ready; it comes back at its 5h reset" "1 left ↻1h00m" "$(left)"
  fl acct1 "$M" "acct2 ok 96 $(( NOW - 10 )) 10 $R2 10" "acct3 ok - - 10 $R3 10"
  expect "$t: a 5h window that reset since is empty again" "2 left" "$(left)"
  fl acct1 "$M" "acct2 ok - - 10 $R2 98" "acct3 ok - - 10 $R3 10"
  expect "$t: an account at its bucket cap is not ready" "1 left ↻4d15h" "$(left)"
  newst; { hdr "$NOW" acct1 95 98 - fable "$OLD" full; rw acct1 ok - - 57 "$R1" 62 "$NOW"; rw acct2 ok - - 10 "$R2" 99 "$NOW"; rw acct3 ok - - 10 "$R3" 10 "$NOW"; } > "$ST/fleet.tsv"
  expect "$t: with no bucket cap the bucket does not block" "2 left" "$(left)"
  fl acct1 "$M" "acct2 ok 96 - 10 $R2 10" "acct3 ok - - 10 $R3 10"
  expect "$t: a spent account with no known reset gives no comeback" "1 left" "$(left)"
  fl acct1 "$M" "acct2 ok - - 99 $R2 10"
  expect "$t: none left, and when the first one comes back" "none left ↻4d15h" "$(left)"
  fl acct1 "$M"
  expect "$t: a fleet of one has no count" "" "$(left)"
  has "$t: and the rest of the chip" "[acct1 · 7d 57% fable 62%]" "$(pay | line 220 | pp)"
  fl acct1 "$M" "acct2 ok - - 10 $R2 10" "acct3 ok - - 10 $R3 10" "acct4 ok - - 10 $R4 10" "acct5 ok - - 10 $R5 10" "acct6 ok - - 10 $R5 10"
  has "$t: five left is calm" "${ESC}[38;2;${VAL}m5${ESC}[39m" "$(pay | line 220)"

  # --- bare percents pair up; anything else is joined by a dot ---
  newst; calm5 acct1 "$OLD"
  dots=""
  for c in $(seq 30 220); do
    o="$(pay '.rate_limits.five_hour={"used_percentage":20,"resets_at":'"$(( NOW + 9000 ))"'}' | line "$c" | pp)"
    case "$o" in *"5h 20% · 7d"*|*"7d 57% · fable"*|*"5h 20% · fable"*) dots="$dots $c" ;; esac
  done
  expect "$t: two bare percents are never joined by a dot" "" "$dots"
  has "$t: the week and the bucket pair" "7d 57% fable 62%" "$(pay | line 220 | pp)"
  has "$t: a countdown joins the next piece with a dot" "5h 20% ↻2h30m · 7d 57% fable 62%" "$(pay '.rate_limits.five_hour={"used_percentage":20,"resets_at":'"$(( NOW + 9000 ))"'}' | line 220 | pp)"
  has "$t: flat never pairs" "7d 57% · fable 62%" "$(pay | STYLE=flat line 220 | pp)"

  # --- the width ladder in a fleet ---
  newst; calm5 acct1 "$OLD"
  full="$(pay | line 220 | pp)"; n=${#full}
  o="$(pay | line $(( n + 4 - 1 )) | pp)"
  expect "$t: one cell short, the cost is the first piece to go" "[✻ Fable 5.2] [ctx ▬▬▬▬▬▬▬▬▬▬ 52% · cache 42m] [acct1 · 7d 57% fable 62% · 4 left] [/nowhere/project]" "$o"
  o="$(pay | line $(( ${#o} + 4 - 1 )) | pp)"
  expect "$t: one cell short of that, the slug goes next (and the cost, smaller, fits again)" "[✻ Fable 5.2] [ctx ▬▬▬▬▬▬▬▬▬▬ 52% · cache 42m] [7d 57% fable 62% · 4 left] [/nowhere/project] [\$44]" "$o"
  # just switched: the slug is why the numbers changed, and stays while smaller pieces go
  SWL=$(( NOW - 300 )); newst; calm5 acct1 "$SWL"
  full="$(pay "$(lr 120 "$SWL")" | line 220 | pp)"
  has "$t: just switched: the full row" "[⇄ acct1 · 7d 57% fable 62% · 4 left] [/nowhere/project] [\$44]" "$full"
  o="$(pay "$(lr 120 "$SWL")" | line $(( ${#full} + 4 - 1 - 6 )) | pp)"
  has "$t: just switched: the slug outlives the cost and a calm count" "[⇄ acct1 · 7d 57% fable 62%] [/nowhere/project]" "$o"
  o="$(pay "$(lr 120 "$SWL")" | line 64 | pp)"
  hasnt "$t: just switched: in a short row the slug has gone" "acct1" "$o"
  has "$t: and the binding window stays" "fable 62%" "$o"
  newst; calm5 acct1 "$OLD"
  ladder=""
  for c in $(seq 40 220); do
    o="$(pay | line "$c" | pp)"
    case "$o" in *"4 left"*) case "$o" in *"✻"*) ;; *) ladder="$ladder calm-left-outlived-✻@$c" ;; esac ;; esac
    case "$o" in *"4 left"*) case "$o" in *"▬"*) ;; *) ladder="$ladder calm-left-outlived-gauge@$c" ;; esac ;; esac
    case "$o" in *"7d 57%"*) case "$o" in *"fable 62%"*) ;; *) ladder="$ladder roomier-week-outlived-bucket@$c" ;; esac ;; esac
  done
  expect "$t: a calm count goes before the ✻ and the gauge; the roomier window before the binding one" "" "$ladder"
  # the week with more room under its cap goes first; with the bucket roomier, the bucket does
  o="$(pay | line 60 | pp)"
  has "$t: narrow: the binding window (the bucket, 36 points under its cap) stays" "fable 62%" "$o"
  hasnt "$t: narrow: the roomier week went" "7d 57%" "$o"
  newst; { hdr "$NOW" acct1 95 98 98 fable "$OLD" full; rw acct1 ok - - 90 "$R1" 20 "$NOW"; rw acct2 ok - - 10 "$R2" 10 "$NOW"; rw acct3 ok - - 10 "$R3" 10 "$NOW"; rw acct4 ok - - 10 "$R4" 10 "$NOW"; rw acct5 ok - - 10 "$R5" 10 "$NOW"; } > "$ST/fleet.tsv"
  inv=""
  for c in $(seq 40 140); do
    o="$(pay '.rate_limits.seven_day.used_percentage=90' | line "$c" | pp)"
    case "$o" in *"fable 20%"*) case "$o" in *"7d 90%"*) ;; *) inv="$inv $c" ;; esac ;; esac
  done
  expect "$t: with the bucket roomier, the week outlives it" "" "$inv"
  # a short count outlives every calm piece but the windows' alarms
  newst; { hdr "$NOW" acct1 95 98 98 fable "$OLD" full; rw acct1 ok - - 57 "$R1" 62 "$NOW"; rw acct2 ok - - 10 "$R2" 10 "$NOW"; rw acct3 ok - - 99 "$R3" 10 "$NOW"; } > "$ST/fleet.tsv"
  inv=""
  for c in $(seq 30 140); do
    o="$(pay | line "$c" | pp)"
    case "$o" in *"1 left"*) ;; *) case "$o" in *"▬"*|*"/nowhere"*|*"fable 62%"*|*"7d 57%"*|*"cache"*) inv="$inv $c" ;; esac ;; esac
  done
  expect "$t: one left outlives the gauge, the place, the calm windows and the cache" "" "$inv"
  has "$t: narrow: one left beside the model and the context" "[1 left]" "$(pay | line 36 | pp)"
  # width: never past COLUMNS-4, never empty, in either look, at any width
  for STYLE in chips flat; do
    over=""
    for f in calm5 spent; do
      newst
      if [ "$f" = calm5 ]; then calm5 acct2 $(( NOW - 300 )); else { hdr "$NOW" acct1 95 98 98 fable $(( NOW - 120 )) full; rw acct1 ok 96 $(( NOW + 3000 )) 98 "$R1" 98 "$NOW"; rw acct2 ok - - 99 "$R2" 99 "$NOW"; } > "$ST/fleet.tsv"; fi
      for c in 16 20 24 30 40 50 60 70 80 90 100 110 120 140 170 220; do
        o="$(pay '.rate_limits.five_hour={"used_percentage":96,"resets_at":'"$(( NOW + 3000 ))"'}' | line "$c" | plain)"
        [ "${#o}" -le $(( c - 4 )) ] || over="$over $f@$c:${#o}"; [ "${#o}" -gt 0 ] || over="$over $f@$c:empty"
      done
    done
    expect "$t: $STYLE: a fleet row fits COLUMNS-4 at every width" "" "$over"
  done
  unset STYLE

  # --- vitals: in a fleet the week's field is the worst of the week, the bucket and the count ---
  newst; calm5 acct1 "$OLD"; pay | line 220 >/dev/null
  expect "$t: vitals: all calm" "52${TAB}${TAB}calm${TAB}warm" "$(vitals)"
  fl acct1 "$M" "acct2 ok - - 10 $R2 10" "acct3 ok - - 10 $R3 10"; pay | line 220 >/dev/null
  expect "$t: vitals: a short count while this account has room is no alarm" "52${TAB}${TAB}calm${TAB}warm" "$(vitals)"
  fl acct1 "acct1 ok - - 57 $R1 98" "acct2 ok - - 10 $R2 10" "acct3 ok - - 10 $R3 10" "acct4 ok - - 10 $R4 10" "acct5 ok - - 10 $R5 10"; pay | line 220 >/dev/null
  expect "$t: vitals: the bucket at its cap makes it over" "52${TAB}${TAB}over${TAB}warm" "$(vitals)"
  fl acct1 "$M" "acct2 ok - - 99 $R2 10"; pay | line 220 >/dev/null
  expect "$t: vitals: none left while this account has room is no alarm either" "52${TAB}${TAB}calm${TAB}warm" "$(vitals)"
  fl acct1 "$M" "acct2 ok - - 99 $R2 10"; pay '.rate_limits.seven_day.used_percentage=94' | line 220 >/dev/null
  expect "$t: vitals: none left and the week near its cap is over" "52${TAB}${TAB}over${TAB}warm" "$(vitals)"
  fl acct1 "acct1 ok - - 98 $R1 62" "acct2 ok - - 99 $R2 10"; pay '.rate_limits.seven_day.used_percentage=98' | line 220 >/dev/null
  expect "$t: vitals: none left and the week at its cap is crit" "52${TAB}${TAB}crit${TAB}warm" "$(vitals)"
  newst; calm5 acct1 "$OLD"; pay '.rate_limits.seven_day.used_percentage=97 | .rate_limits.five_hour={"used_percentage":95,"resets_at":'"$(( NOW + 9000 ))"'}' | line 220 >/dev/null
  expect "$t: vitals: the 5h field is the 5h window's own" "52${TAB}over${TAB}watch${TAB}warm" "$(vitals)"
  newst; calm5 acct2 $(( NOW - 300 )); pay "$(lr -1 $(( NOW - 300 )))" | line 220 >/dev/null
  expect "$t: vitals: moved: the active account's week, the cache cold" "52${TAB}${TAB}calm${TAB}cold" "$(vitals)"
  expect "$t: vitals: still four fields" "4" "$(vitals | awk -F'\t' '{print NF}')"

  # --- the cache after a switch ---
  SW=$(( NOW - 300 ))
  newst; calm5 acct1 "$SW"
  has "$t: a miss soon after the switch, cause unknown, is the switch" "cache 57m miss: account switch" "$(pay "$(lr 120 "$SW")"' | .prompt_cache.last_miss_at='"$(( SW + 30 ))"' | .prompt_cache.last_miss_cause={"causes":[]}' | line 220 | pp)"
  has "$t: and when it looked server-side" "cache 57m miss: account switch" "$(pay "$(lr 120 "$SW")"' | .prompt_cache.last_miss_at='"$(( SW + 30 ))"' | .prompt_cache.last_miss_cause={"causes":["likely_server_side"]}' | line 220 | pp)"
  has "$t: in yellow" "${ESC}[38;2;${YEL}mmiss: account switch" "$(pay "$(lr 120 "$SW")"' | .prompt_cache.last_miss_at='"$(( SW + 30 ))"' | .prompt_cache.last_miss_cause={"causes":["likely_server_side"]}' | line 220)"
  has "$t: a cause on this side keeps its name" "miss: tools changed" "$(pay "$(lr 120 "$SW")"' | .prompt_cache.last_miss_at='"$(( SW + 30 ))"' | .prompt_cache.last_miss_cause={"causes":["tools_changed"]}' | line 220 | pp)"
  hasnt "$t: a miss before the switch is not the switch" "miss" "$(pay "$(lr 120 "$SW")"' | .prompt_cache.last_miss_at='"$(( SW - 10 ))"' | .prompt_cache.last_miss_cause={"causes":["likely_server_side"]}' | line 220 | pp)"
  hasnt "$t: an expired TTL is not the switch" "miss" "$(pay "$(lr 120 "$SW")"' | .prompt_cache.last_miss_at='"$(( SW + 30 ))"' | .prompt_cache.last_miss_cause={"causes":["ttl_expired"]}' | line 220 | pp)"
  SW=$(( NOW - 1000 ))
  newst; calm5 acct1 "$SW"
  has "$t: a miss 899 s after the switch is still it" "miss: account switch" "$(pay "$(lr 900 "$SW")"' | .prompt_cache.last_miss_at='"$(( SW + 899 ))"' | .prompt_cache.last_miss_cause={"causes":[]}' | line 220 | pp)"
  hasnt "$t: 900 s after, it is not" "miss" "$(pay "$(lr 901 "$SW")"' | .prompt_cache.last_miss_at='"$(( SW + 900 ))"' | .prompt_cache.last_miss_cause={"causes":[]}' | line 220 | pp)"
  newst
  hasnt "$t: without a fleet a server-side miss is not news" "miss" "$(pay '.prompt_cache.last_miss_at='"$(( NOW - 100 ))"' | .prompt_cache.last_miss_cause={"causes":["likely_server_side"]}' | line 220 | pp)"

  # --- no alt beside a fleet: it says more about the other accounts ---
  newst; printf '%s\t11\t%s\t26\t%s\t%s\n' "$R2" $(( NOW + 3000 )) "$R2" $(( NOW - 120 )) > "$ST/usage.tsv"
  has "$t: without a fleet the other account shows as alt" "alt 11% 26%" "$(pay | line 220 | pp)"
  calm5 acct1 "$OLD"
  hasnt "$t: with one it does not" "alt" "$(pay | line 220 | pp)"
  newst; printf '%s\t11\t%s\t26\t%s\t%s\n' "$R2" $(( NOW + 3000 )) "$R2" $(( NOW - 120 )) > "$ST/usage.tsv"; calm5 acct2 $(( NOW - 3000 ))
  o="$(pay "$(lr 600 $(( NOW - 3000 )))" | line 220 | pp)"
  has "$t: a pinned session (the slug, no count)" "[acct1 · 7d 57%↗ ↻6d4h · fable 62%↗]" "$o"
  hasnt "$t: shows no alt either" "alt" "$o"

  # --- the helper, run in the background at most every 120 s machine-wide ---
  STUB="$TMP/stub"; mkdir -p "$STUB"
  printf '#!/bin/sh\necho run >> "%s/runs"\nprintf "#fleet\\t%%s\\tacct9\\t95\\t98\\t-\\t-\\t-\\tlocal\\nacct9\\tok\\t-\\t-\\t5\\t-\\t-\\t%%s\\n" "$STATUSLINE_NOW" "$STATUSLINE_NOW"\n' "$STUB" > "$STUB/ok.sh"
  printf '#!/bin/sh\necho run >> "%s/runs"\necho "not a fleet"\n' "$STUB" > "$STUB/junk.sh"
  printf '#!/bin/sh\necho run >> "%s/runs"\nprintf "#fleet\\t1\\n"\nexit 3\n' "$STUB" > "$STUB/fails.sh"
  printf '#!/bin/sh\necho run >> "%s/runs"\nsleep 3\n' "$STUB" > "$STUB/slow.sh"
  cp "$STUB/ok.sh" "$STUB/noexec.sh"
  chmod +x "$STUB/ok.sh" "$STUB/junk.sh" "$STUB/fails.sh" "$STUB/slow.sh"
  runs() { wc -l < "$STUB/runs" 2>/dev/null | tr -d ' ' || echo 0; }
  waitfor() { local i=0; while [ "$i" -lt 60 ] && ! [ -e "$1" ]; do sleep 0.05; i=$(( i + 1 )); done; sleep 0.1; }
  : > "$STUB/runs"
  newst; pay | FCMD="$STUB/ok.sh" line 220 >/dev/null; waitfor "$ST/fleet.tsv"
  expect "$t: refresh: no earlier try: the helper runs" "1" "$(runs)"
  expect "$t: refresh: the try is stamped" "$NOW" "$(cat "$ST/fleet.tsv.try" 2>/dev/null)"
  expect "$t: refresh: its #fleet answer becomes fleet.tsv" "#fleet${TAB}${NOW}${TAB}acct9" "$(head -1 "$ST/fleet.tsv" 2>/dev/null | cut -f1-3)"
  has "$t: refresh: and the next run shows it" "acct9 · 7d 57%" "$(pay | line 220 | pp)"
  ls "$ST" | grep -q '^fleet\.tsv\.[0-9]' && bad "$t: refresh: no temp file is left behind" "$(ls "$ST")" || ok
  : > "$STUB/runs"; printf '%s\n' $(( NOW - 119 )) > "$ST/fleet.tsv.try"
  pay | FCMD="$STUB/ok.sh" line 220 >/dev/null; sleep 0.4
  expect "$t: refresh: a try 119 s old: not again" "0" "$(runs)"
  printf '%s\n' $(( NOW - 120 )) > "$ST/fleet.tsv.try"
  pay | FCMD="$STUB/ok.sh" line 220 >/dev/null; i=0; while [ "$i" -lt 60 ] && [ "$(runs)" = 0 ]; do sleep 0.05; i=$(( i + 1 )); done
  expect "$t: refresh: a try 120 s old: again" "1" "$(runs)"
  : > "$STUB/runs"; printf '%s\n' $(( NOW + 500 )) > "$ST/fleet.tsv.try"
  pay | FCMD="$STUB/ok.sh" line 220 >/dev/null; i=0; while [ "$i" -lt 60 ] && [ "$(runs)" = 0 ]; do sleep 0.05; i=$(( i + 1 )); done
  expect "$t: refresh: a try stamped in the future (the clock stepped back): again" "1" "$(runs)"
  : > "$STUB/runs"; printf 'junk\n' > "$ST/fleet.tsv.try"
  pay | FCMD="$STUB/ok.sh" line 220 >/dev/null; i=0; while [ "$i" -lt 60 ] && [ "$(runs)" = 0 ]; do sleep 0.05; i=$(( i + 1 )); done
  expect "$t: refresh: a junk try: again" "1" "$(runs)"
  newst; calm5 acct1 "$OLD"; cp "$ST/fleet.tsv" "$TMP/keep.tsv"; : > "$STUB/runs"
  pay | FCMD="$STUB/junk.sh" line 220 >/dev/null; i=0; while [ "$i" -lt 60 ] && [ "$(runs)" = 0 ]; do sleep 0.05; i=$(( i + 1 )); done; sleep 0.2
  expect "$t: refresh: an answer that is not #fleet is ignored" "" "$(cmp -s "$ST/fleet.tsv" "$TMP/keep.tsv" || echo replaced)"
  expect "$t: refresh: but the try still counts" "$NOW" "$(cat "$ST/fleet.tsv.try" 2>/dev/null)"
  newst; calm5 acct1 "$OLD"; cp "$ST/fleet.tsv" "$TMP/keep.tsv"; : > "$STUB/runs"
  pay | FCMD="$STUB/fails.sh" line 220 >/dev/null; i=0; while [ "$i" -lt 60 ] && [ "$(runs)" = 0 ]; do sleep 0.05; i=$(( i + 1 )); done; sleep 0.2
  expect "$t: refresh: a helper that fails installs nothing" "" "$(cmp -s "$ST/fleet.tsv" "$TMP/keep.tsv" || echo replaced)"
  newst; : > "$STUB/runs"
  pay | FCMD="" line 220 >/dev/null; sleep 0.3
  expect "$t: refresh: STATUSLINE_FLEET_CMD empty: never run" "0" "$(runs)"
  expect "$t: refresh: and no try stamped" "" "$(ls "$ST" | grep fleet)"
  pay | FCMD="$STUB/noexec.sh" line 220 >/dev/null; sleep 0.3
  expect "$t: refresh: a helper that is not executable: never run" "0" "$(runs)"
  pay | FCMD="$STUB/missing.sh" line 220 >/dev/null; sleep 0.1
  expect "$t: refresh: a missing helper: no try stamped" "" "$(ls "$ST" | grep fleet)"
  mkdir -p "$FAKEHOME/.claude"; cp "$STUB/ok.sh" "$FAKEHOME/.claude/statusline-fleet.sh"; chmod +x "$FAKEHOME/.claude/statusline-fleet.sh"
  newst; : > "$STUB/runs"
  pay | env -u STATUSLINE_FLEET_CMD COLUMNS=220 STATUSLINE_STYLE=chips STATUSLINE_NOW="$NOW" STATUSLINE_USAGE_CACHE="$ST/usage.tsv" STATUSLINE_STATE_DIR="$ST" HOME="$FAKEHOME" "$SH" "$SCRIPT" >/dev/null
  waitfor "$ST/fleet.tsv"
  expect "$t: refresh: unset, the helper is ~/.claude/statusline-fleet.sh" "1" "$(runs)"
  newst; : > "$STUB/runs"
  SECONDS=0; pay | FCMD="$STUB/slow.sh" line 220 >/dev/null
  [ "$SECONDS" -le 1 ] && ok || bad "$t: refresh: a slow helper never holds the line" "${SECONDS}s"
  newst; err="$(pay | FCMD="$STUB/ok.sh" line 220 2>&1 >/dev/null)"
  expect "$t: refresh: nothing on stderr" "" "$err"

  # --- hostile and broken fleet files never break the line ---
  for junk in "$(printf '#fleet\t%s\tacct1\n' "$NOW")" "$(printf '#fleet\t%s\tacct1\t95\t98\t98\tfable\t%s\tfull\nacct1\tok\tx\ty\tz\tw\tv\tu\n' "$NOW" "$OLD")" "$(head -c 3000 /dev/urandom | LC_ALL=C tr -d '\000')" ; do
    newst; printf '%s\n' "$junk" > "$ST/fleet.tsv"
    err="$(pay | line 220 2>&1 >/dev/null)"
    expect "$t: a broken fleet file prints nothing on stderr" "" "$err"
    o="$(pay | line 220 | pp)"
    has "$t: and the line still renders" "Fable 5.2" "$o"
  done
  newst; calm5 acct1 "$OLD"; chmod 000 "$ST/fleet.tsv"
  expect "$t: an unreadable fleet file prints nothing on stderr" "" "$(pay | line 220 2>&1 >/dev/null)"
  chmod 644 "$ST/fleet.tsv"
  newst; calm5 acct2 $(( NOW - 3000 )); mkdir -p "$ST/pin"; chmod 555 "$ST/pin"
  expect "$t: a pin dir that cannot be written prints nothing on stderr" "" "$(pay "$(lr 600 $(( NOW - 3000 )))" | line 220 2>&1 >/dev/null)"
  chmod 755 "$ST/pin"

  # --- the daily prune takes old pins too ---
  P="$TMP/pstate"; mkdir -p "$P/pin"; : > "$P/pin/oldsess"; : > "$P/pin/newsess"; touch -t 202001010000 "$P/pin/oldsess"
  pay | COLUMNS=200 STATUSLINE_NOW="$(date +%s)" STATUSLINE_USAGE_CACHE="$P/usage.tsv" STATUSLINE_STATE_DIR="$P" STATUSLINE_FLEET_CMD="" HOME="$FAKEHOME" "$SH" "$SCRIPT" >/dev/null
  i=0; while [ "$i" -lt 60 ] && [ -e "$P/pin/oldsess" ]; do sleep 0.05; i=$(( i + 1 )); done
  expect "$t: the prune drops a pin untouched for 3 days and keeps a fresh one" "newsess" "$(ls "$P/pin" | tr '\n' ' ' | sed 's/ $//')"
done

echo "statusline-fleet: $pass passed, $fail failed"
exit $((fail > 0))
