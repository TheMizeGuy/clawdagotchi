#!/usr/bin/env bash
# Gallery of the status line's looks, to judge them in a real Ghostty window: style chips at 95
# columns with mize-coworker's 10-cell reserve, the same samples at 150 columns (where the
# reserve is 22), style flat at 95, the context chip alone from 1% to 100% (every gradient
# tier), the row on a machine that rotates over accounts (a fleet file), and the agent panel
# rows of subagent-statusline.sh at 119 and 80 columns. Each line is indented two cells; the dots after it are the cells Claude (the mascot)
# holds at the row's right end, which the line must not reach.
# Needs only the status line script, bash and jq. State lives in a temp dir removed on exit; git
# is never run (each sample's git answer is seeded in the script's per-session cache).
#   bash samples.sh [path/to/statusline.sh]     (default: statusline.sh beside this file)
# SAMPLES picks sections (default all): chips95 chips150 flat95 gauges fleet agents
export LC_ALL=en_US.UTF-8
here="${BASH_SOURCE[0]%/*}"; [ "$here" = "${BASH_SOURCE[0]}" ] && here=.
SCRIPT="${1:-$here/statusline.sh}"
command -v jq >/dev/null 2>&1 || { echo "samples: needs jq" >&2; exit 1; }
[ -r "$SCRIPT" ] || { echo "samples: no status line script at $SCRIPT" >&2; exit 1; }
TMP="$(mktemp -d)" || exit 1
trap 'case "$TMP" in */tmp.*) rm -rf "$TMP" ;; esac' EXIT
NOW=2000000000
US=$'\037'; e=$'\033'; CR=$'\xee\x82\xb4'
dim="${e}[38;2;108;112;134m"; head="${e}[38;2;203;166;247m"; dots="${e}[38;2;69;71;90m"; z="${e}[0m"

# The other account, for the alt piece: a row of the shared usage cache. Each sample gets its own
# copy: the script keeps the newest sample of each account there, and one sample's windows would
# otherwise show in the next.
printf -v ALT '%s\t%s\t%s\t%s\t%s\t%s' 2000500000 11 2000003000 26 2000500000 $(( NOW - 120 ))   # key f5 f5reset f7 f7reset epoch

BASE='{"model":{"id":"m","display_name":"Fable 5.1"},"effort":{"level":"xhigh"},"thinking":{"enabled":true},"fast_mode":false,"output_style":{"name":"default"},"workspace":{"current_dir":"/Users/you/Dev/project","project_dir":"/Users/you/Dev/project","repo":{"name":"project"}},"cost":{"total_cost_usd":4.2},"context_window":{"total_input_tokens":120000,"context_window_size":1000000,"used_percentage":12},"prompt_cache":{"warm":true,"ttl":"1h","expires_at":2000003420,"recache_tokens_if_cold":120000},"rate_limits":{"five_hour":{"used_percentage":20,"resets_at":2000009000},"seven_day":{"used_percentage":30,"resets_at":2000302400}}}'

# sample <session> <branch> <dirty> <ahead> <bus lines ("level<TAB>text", one per line)> <jq filter>
# Seeds the session's state (reserve, bus, git answer), then prints nothing: draw() renders it.
sample() {
  local s=$1 d="$TMP/state/bus/$1" n=0 l
  mkdir -p "$d" "$TMP/state/git"
  printf '22\t10\t110\n' > "$d/.reserve"
  while IFS= read -r l; do [ -n "$l" ] && { n=$(( n + 1 )); printf '%s\n' "$l" > "$d/pub$n"; }; done <<<"$5"
  printf '%s\n%s\n%s\n' "$NOW" "/Users/you/Dev/project" \
    "/Users/you/Dev/project${US}/Users/you/Dev/project/.git${US}/Users/you/Dev/project/.git${US}$2${US}$3${US}$4${US}0" > "$TMP/state/git/$s"
  printf '%s' "$BASE" | jq -c ".session_id=\"$s\" | $6" > "$TMP/$s.json"
  printf '%s\n' "$ALT" > "$TMP/$s.tsv"
}
visible() { # raw line -> R: the text without its SGR and OSC 8 sequences
  local s=$1 out="" rest
  while :; do
    case "$s" in *"$e"*) ;; *) break ;; esac
    out="${out}${s%%"$e"*}"; rest="${s#*"$e"}"
    case "$rest" in "]8;;"*) rest="${rest#*"$e\\"}" ;; *) rest="${rest#*m}" ;; esac
    s="$rest"
  done
  R="${out}${s}"
}
# render <look> <cols> <session> -> R: the script's raw line for that sample
render() {
  R="$(COLUMNS="$2" STATUSLINE_STYLE="$1" STATUSLINE_NOW="$NOW" STATUSLINE_USAGE_CACHE="$TMP/$3.tsv" \
    STATUSLINE_STATE_DIR="$TMP/state" HOME="$TMP/home" bash "$SCRIPT" < "$TMP/$3.json")"
}
# draw <look> <cols> <session> <label>
draw() {
  local look=$1 cols=$2 rsv=10 max out v i pad=""
  [ "$cols" -ge 110 ] && rsv=22
  max=$(( cols - 4 - rsv ))
  render "$look" "$cols" "$3"; out="$R"
  visible "$out"; v="$R"
  i=0; while [ "$i" -lt "$rsv" ]; do pad="${pad}·"; i=$(( i + 1 )); done
  printf '%s  %-40s%3s of %s cells%s\n' "$dim" "$4" "${#v}" "$max" "$z"
  printf '  %s%s[%dG%s%s%s\n\n' "$out" "$e" $(( 2 + max + 1 )) "$dots" "$pad" "$z"
}

sample calm  main 0 0 ''                                                     '.'
sample owner main 0 0 "info$(printf '\t')agents 7/40" \
  '.cost.total_cost_usd=44.4 | .context_window={"total_input_tokens":390000,"context_window_size":1000000,"used_percentage":39.2} | .rate_limits.five_hour={"used_percentage":69,"resets_at":2000010800} | .rate_limits.seven_day.used_percentage=67'
sample full  main 0 0 '' \
  '.cost.total_cost_usd=61 | .context_window={"total_input_tokens":870000,"context_window_size":1000000,"used_percentage":87} | .prompt_cache={"warm":false,"ttl":"1h","recache_tokens_if_cold":870000}'
sample burn  main 0 0 '' \
  '.cost.total_cost_usd=18.6 | .context_window={"total_input_tokens":420000,"context_window_size":1000000,"used_percentage":42} | .rate_limits.five_hour={"used_percentage":92,"resets_at":2000002400}'
sample loud  main 0 0 "warn$(printf '\t')agents 37/40
fail$(printf '\t')ops: 2 failing" \
  '.cost.total_cost_usd=12 | .context_window={"total_input_tokens":260000,"context_window_size":1000000,"used_percentage":26}'
sample long  feature/statusline-chips-with-gradient-gauge 3 2 '' \
  '.cost.total_cost_usd=9.4 | .context_window={"total_input_tokens":610000,"context_window_size":1000000,"used_percentage":61}'
sample fresh main 0 0 '' \
  'del(.cost) | .context_window={"total_input_tokens":0,"context_window_size":1000000,"used_percentage":null} | del(.prompt_cache)'

gallery() { # look cols
  printf '%s%s, %s columns%s\n\n' "$head" "$1" "$2" "$z"
  draw "$1" "$2" calm  "calm"
  draw "$1" "$2" owner "the owner's row: 5h and 7d over pace"
  draw "$1" "$2" full  "context 87%, cache cold"
  draw "$1" "$2" burn  "5h at 92%"
  draw "$1" "$2" loud  "a bus warning and a failure"
  draw "$1" "$2" long  "a long branch, dirty and ahead"
  draw "$1" "$2" fresh "no usage yet"
}
gauges() { # the context chip alone (the second chip of a wide chips line), across every tier
  local p rest
  printf '%sthe context gauge, 1%% to 100%% (chips)%s\n\n' "$head" "$z"
  for p in 1 12 39 52 69 70 86 90 95 100; do
    sample "g$p" main 0 0 '' ".context_window={\"total_input_tokens\":$(( p * 10000 )),\"context_window_size\":1000000,\"used_percentage\":$p}"
    render chips 200 "g$p"
    rest="${R#*"$CR"}"; rest="${rest#"$z "}"; rest="${rest%%"$CR"*}${CR}${z}"
    printf '  %s%4s%s  %s\n' "$dim" "$p%" "$z" "$rest"
  done
  printf '\n'
}
# fleet: the row when a helper reports the accounts a switcher rotates over (statusline.sh, "the
# account fleet"). Its own state dir, so the fleet file touches no other sample.
fleet() {
  local F="$TMP/fleet" r1=$(( NOW + 532800 )) n=0 name sw rows payload out v
  printf '%sa fleet of accounts (chips, 150 columns)%s\n\n' "$head" "$z"
  while IFS='|' read -r name sw rows payload; do
    n=$(( n + 1 )); mkdir -p "$F/$n/git" "$F/$n/bus/f"
    printf '22\t10\t110\n' > "$F/$n/bus/f/.reserve"
    printf '%s\n%s\n%s\n' "$NOW" "/Users/you/Dev/project" \
      "/Users/you/Dev/project${US}/Users/you/Dev/project/.git${US}/Users/you/Dev/project/.git${US}main${US}3${US}2${US}0" > "$F/$n/git/f"
    { printf '#fleet\t%s\tacct1\t95\t98\t98\tfable\t%s\tfull\n' $(( NOW - 60 )) "$sw"; printf '%b' "$rows"; } > "$F/$n/fleet.tsv"
    out="$(printf '%s' "$BASE" | jq -c ".session_id=\"f\" | del(.rate_limits.five_hour) | .rate_limits.seven_day.resets_at=$r1 | .context_window={\"total_input_tokens\":523000,\"context_window_size\":1000000,\"used_percentage\":52} | .prompt_cache={\"warm\":true,\"ttl\":\"1h\",\"expires_at\":$(( NOW + 2520 )),\"recache_tokens_if_cold\":523000} | $payload" \
      | COLUMNS=150 STATUSLINE_STYLE=chips STATUSLINE_NOW="$NOW" STATUSLINE_USAGE_CACHE="$F/$n/usage.tsv" STATUSLINE_STATE_DIR="$F/$n" STATUSLINE_FLEET_CMD="" HOME="$TMP/home" bash "$SCRIPT")"
    visible "$out"; v="$R"
    printf '%s  %-62s%3s of 124 cells%s\n  %s\n\n' "$dim" "$name" "${#v}" "$z" "$out"
  done <<EOF
calm: the account, its week, the model bucket, accounts left|$(( NOW - 86400 ))|acct1\\tok\\t-\\t-\\t57\\t$r1\\t62\\t$NOW\\nacct2\\tok\\t-\\t-\\t12\\t$(( NOW + 400000 ))\\t11\\t$NOW\\nacct3\\tok\\t-\\t-\\t40\\t$(( NOW + 300000 ))\\t30\\t$NOW\\nacct4\\tok\\t-\\t-\\t50\\t$(( NOW + 200000 ))\\t20\\t$NOW\\nacct5\\tok\\t-\\t-\\t60\\t$(( NOW + 100000 ))\\t10\\t$NOW\\n|.rate_limits.seven_day.used_percentage=57
the machine just switched: this tab asked before it|$(( NOW - 300 ))|acct1\\tok\\t-\\t-\\t12\\t$(( NOW + 600000 ))\\t11\\t$NOW\\nacct2\\tok\\t-\\t-\\t98\\t$r1\\t84\\t$NOW\\nacct3\\tok\\t-\\t-\\t40\\t$(( NOW + 300000 ))\\t30\\t$NOW\\nacct4\\tok\\t-\\t-\\t50\\t$(( NOW + 200000 ))\\t20\\t$NOW\\n|.rate_limits.seven_day.used_percentage=98
the bucket at its cap, one account left|$(( NOW - 86400 ))|acct1\\tok\\t-\\t-\\t91\\t$r1\\t98\\t$NOW\\nacct2\\tok\\t-\\t-\\t98\\t$(( NOW + 21600 ))\\t84\\t$NOW\\nacct3\\tok\\t-\\t-\\t99\\t$(( NOW + 300000 ))\\t30\\t$NOW\\nacct4\\tok\\t-\\t-\\t50\\t$(( NOW + 200000 ))\\t20\\t$NOW\\n|.rate_limits.seven_day.used_percentage=91
EOF
}
# agents: the agent panel rows (subagent-statusline.sh beside the status line script), as the
# engine would show them under the prompt: its own mark, then the row's body.
agents() {
  local sub="${SCRIPT%/*}/subagent-statusline.sh" c l
  [ "${SCRIPT%/*}" = "$SCRIPT" ] && sub="./subagent-statusline.sh"
  [ -r "$sub" ] || return 0
  local tasks='[
   {"id":"1","status":"completed","description":"fix: double-click commits on guided try press","model":"claude-opus-4-1","tokenCount":496000},
   {"id":"2","status":"running","description":"design: the cache-switch rule","label":"Reading statusline.sh","startTime":1999999640000,"model":"claude-fable-5","tokenCount":410000,"tokenSamples":[300000,300000,301000,340000,340000,340000,352000,352000,360000,360000,360000,395000,395000,401000,401000,410000]},
   {"id":"3","status":"running","description":"find: every caller of the usage cache writer","label":"Running rg over the hooks tree","startTime":1999999880000,"model":"claude-opus-4-1","tokenCount":88200,"tokenSamples":[0,46000,46000,52000,61000,61000,88200]},
   {"id":"4","status":"failed","description":"map the bus contract","model":"claude-opus-4-1","tokenCount":18000},
   {"id":"5","status":"running","description":"verify: ladder widths under bash 3.2","startTime":1999999990000,"model":"claude-opus-4-1","tokenCount":0,"tokenSamples":[0]}]'
  for c in 119 80; do
    printf '%sthe agent panel rows, %s columns%s\n\n' "$head" "$c" "$z"
    printf '%s' "$tasks" | jq -c "{columns: $(( c - 6 )), cwd: \"/w\", tasks: .}" | STATUSLINE_NOW="$NOW" bash "$sub" | jq -r '.content' \
      | while IFS= read -r l; do printf '  %s◯%s %s%s\n' "$dim" "$z" "$l" "$z"; done
    printf '\n'
  done
}
printf '\n%sThe dots are the cells mize-coworker'"'"'s Claude holds; the line must end before them.%s\n\n' "$dim" "$z"
for part in ${SAMPLES:-chips95 chips150 flat95 gauges fleet agents}; do
  case "$part" in
    chips95) gallery chips 95 ;; chips150) gallery chips 150 ;; flat95) gallery flat 95 ;;
    gauges) gauges ;; fleet) fleet ;; agents) agents ;;
  esac
done
