#!/usr/bin/env bash
# Regression suite for the status line's rendering (statusline/statusline.sh): the two looks
# (chips and flat) and how one is chosen, layout and width ladder, the effort shown only off
# its standing level, the context gauge and window size, tinted grounds, countdown formats,
# prompt cache, pace of the 5h/7d windows, the other account, the mod bus, the vitals file left
# for mize-coworker, the git segment and its per-session cache, the PR, repo and folder links,
# the session's name, numbers with leading zeros, and hostile input. The usage cache's write
# rules and the account fleet have their own suites (test-statusline-usage-cache.sh,
# test-statusline-fleet.sh).
# By default it tests statusline/statusline.sh; STATUSLINE_SCRIPT points the suite at another
# copy (a candidate before it is installed, or ~/.claude/statusline.sh). The script is driven
# with fake payloads, a
# fixed clock (STATUSLINE_NOW), a temp usage cache and a temp state dir, under both the
# Homebrew bash and the system bash 3.2, in the look STATUSLINE_STYLE pins (chips unless a
# check says flat). Exit non-zero on any failure.
SCRIPT="${STATUSLINE_SCRIPT:-$(cd "$(dirname "$0")/.." && pwd)/statusline.sh}"
export LC_ALL=en_US.UTF-8   # ${#var} below counts cells, not bytes
pass=0; fail=0
ok()  { pass=$((pass+1)); }
bad() { fail=$((fail+1)); echo "FAIL [$1]${2:+ — $2}"; }
expect()   { if [ "$2" = "$3" ]; then ok; else bad "$1" "want '$2', got '$3'"; fi; }
has()      { case "$3" in *"$2"*) ok ;; *) bad "$1" "want '$2' in '$3'" ;; esac; }
hasnt()    { case "$3" in *"$2"*) bad "$1" "did not want '$2' in '$3'" ;; *) ok ;; esac; }
TMP="$(cd "$(mktemp -d)" && pwd -P)"; trap 'rm -rf "$TMP"' EXIT
NOW=2000000000
ESC=$'\033'
CL=$'\xee\x82\xb6'; CR=$'\xee\x82\xb4'; BRG=$'\xee\x82\xa0'   # a chip's caps and the branch glyph (private use)

# plain: the visible text (SGR and OSC 8 removed)
plain() { sed "s/${ESC}\\[[0-9;]*m//g; s/${ESC}\\]8;;[^${ESC}]*${ESC}\\\\//g"; }
# pp: the visible text with the private-use glyphs made readable: a chip is [ ], the branch ⎇
pp() { plain | sed "s/${CL}/[/g; s/${CR}/]/g; s/${BRG}/⎇/g"; }
# line <cols> [state-dir] ; payload on stdin -> raw output, in the look STYLE names (chips by default)
line() { COLUMNS="$1" STATUSLINE_STYLE="${STYLE:-chips}" STATUSLINE_NOW="$NOW" STATUSLINE_USAGE_CACHE="$CACHE" STATUSLINE_STATE_DIR="${2:-$STATE}" HOME="$FAKEHOME" "$SH" "$SCRIPT"; }
# detect <env assignments...> ; payload on stdin -> raw output, the look left to the script
detect() { env -u STATUSLINE_STYLE -u TERM_PROGRAM "$@" COLUMNS=200 STATUSLINE_NOW="$NOW" STATUSLINE_USAGE_CACHE="$CACHE" STATUSLINE_STATE_DIR="$STATE" HOME="$FAKEHOME" "$SH" "$SCRIPT"; }
# pay <jq filter over the base payload> -> payload
BASE='{"session_id":"s1","model":{"id":"m","display_name":"Fable 5.1"},"effort":{"level":"xhigh"},"thinking":{"enabled":true},"fast_mode":false,"output_style":{"name":"default"},"workspace":{"current_dir":"/nowhere/project","project_dir":"/nowhere/project"},"cost":{"total_cost_usd":44.4},"context_window":{"total_input_tokens":523000,"context_window_size":1000000,"used_percentage":52.3},"prompt_cache":{"warm":true,"ttl":"1h","expires_at":2000003420,"recache_tokens_if_cold":523000},"rate_limits":{"five_hour":{"used_percentage":20,"resets_at":2000009000},"seven_day":{"used_percentage":30,"resets_at":2000302400}}}'
pay() { printf '%s' "$BASE" | jq -c "${1:-.}"; }
# wide characters take two cells: measured in cells (python's east_asian_width), not characters
cells() { python3 -c 'import sys,unicodedata; s=sys.stdin.read(); print(sum(2 if unicodedata.east_asian_width(c) in "WF" else 1 for c in s))'; }
# gauge_cells: the gauge's ten cells as "r;g;b" each, from a raw line
gauge_cells() { python3 -c 'import re,sys; s=sys.stdin.read(); print(" ".join(c for c, run in re.findall("\x1b\\[38;2;([0-9;]+)m(▬+)", s) for _ in run))'; }
# chips: the ground of every chip in a raw line, or where the line stops being well-formed chips.
# A chip is its left cap in the ground's color, that ground set, content that never drops it (no
# full or background reset, no other ground), a full reset, the right cap in the same color, a
# full reset; chips are one space apart and nothing sits outside them.
chips() { python3 -c '
import re, sys
s = sys.stdin.read(); E = "\x1b"
chip = re.compile(E + r"\[38;2;(\d+;\d+;\d+)m" + E + r"\[48;2;\1m((?:(?!" + E + r"\[0m|" + E + r"\[49m|" + E + r"\[48;||).)*)"
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
# pua: the private-use characters in a line (U+E000 to U+F8FF), as code points
pua() { python3 -c 'import sys; print(" ".join("%04X" % ord(c) for c in sys.stdin.read() if 0xE000 <= ord(c) <= 0xF8FF))'; }
K="38;39;55"; KW="58;51;36"; KF="61;37;48"   # chip grounds: any group, a bus warning, a failure
KO="62;45;36"                                 # a group whose worst visible piece is over (spent ones take KF)
TRACK="69;71;90"
TRACK2="88;91;112"; LAB2="147;153;178"        # the track and the labels on a tinted ground

for SH in "$(command -v bash)" /bin/bash; do
  t="bash$("$SH" -c 'echo ${BASH_VERSINFO[0]}')"
  rm -rf "$TMP"/*; CACHE="$TMP/usage.tsv"; STATE="$TMP/state"; FAKEHOME="$TMP/home"; mkdir -p "$STATE" "$FAKEHOME/Dev"

  # --- the whole line, wide, in both looks ---
  out="$(pay | line 200 | pp)"
  expect "$t: chips: the full line" \
    "[✻ Fable 5.1] [ctx ▬▬▬▬▬▬▬▬▬▬ 52% · cache 57m] [5h 20% ↻2h30m · 7d 30% ↻3d12h] […/nowhere/project] [\$44]" \
    "$(printf '%s' "$out" | sed 's|/nowhere/project|…/nowhere/project|; s|……|…|')"
  out="$(pay | STYLE=flat line 200 | pp)"
  expect "$t: flat: the full line" \
    "✻ Fable 5.1 │ ctx ▬▬▬▬▬▬▬▬▬▬ 52% · cache 57m │ 5h 20% ↻2h30m · 7d 30% ↻3d12h │ …/nowhere/project │ \$44" \
    "$(printf '%s' "$out" | sed 's|/nowhere/project|…/nowhere/project|; s|……|…|')"
  for STYLE in chips flat; do
    expect "$t: $STYLE: one row, no trailing newline" "0" "$(pay | line 200 | wc -l | tr -d ' ')"
    raw="$(pay | line 200)"
    hasnt "$t: $STYLE: no SGR faint" "${ESC}[2m" "$raw"
    hasnt "$t: $STYLE: no SGR bold" "${ESC}[1m" "$raw"
    has "$t: $STYLE: truecolor" "${ESC}[38;2;" "$raw"
    has "$t: $STYLE: the ✻ in Claude orange" "${ESC}[38;2;217;119;87m✻" "$raw"
  done
  unset STYLE
  raw="$(pay | line 200)"
  expect "$t: chips: every group is a well-formed chip on the chip ground" "$K $K $K $K $K" "$(printf '%s' "$raw" | chips)"
  hasnt "$t: chips: nothing on a chip is darker than its labels" "108;112;134" "$raw"
  has "$t: chips: the dot between pieces" "${ESC}[38;2;88;91;112m·" "$raw"
  hasnt "$t: flat: no chip ground" "${ESC}[48;" "$(pay | STYLE=flat line 200)"

  # --- which look: STATUSLINE_STYLE when it names one, else chips in Ghostty, flat elsewhere ---
  for tp in ghostty Ghostty GHOSTTY; do
    has "$t: TERM_PROGRAM=$tp draws chips" "$CL" "$(pay | detect TERM_PROGRAM="$tp")"
  done
  o="$(pay | detect TERM_PROGRAM=Apple_Terminal)"
  hasnt "$t: another terminal draws flat" "$CL" "$o"
  has "$t: another terminal draws rails" "│" "$(printf '%s' "$o" | plain)"
  hasnt "$t: no TERM_PROGRAM draws flat" "$CL" "$(pay | detect)"
  hasnt "$t: STATUSLINE_STYLE=flat wins in Ghostty" "$CL" "$(pay | detect TERM_PROGRAM=ghostty STATUSLINE_STYLE=flat)"
  has "$t: STATUSLINE_STYLE=chips wins elsewhere" "$CL" "$(pay | detect TERM_PROGRAM=vscode STATUSLINE_STYLE=chips)"
  has "$t: an unknown STATUSLINE_STYLE falls back to the terminal" "$CL" "$(pay | detect TERM_PROGRAM=ghostty STATUSLINE_STYLE=neon)"
  hasnt "$t: an empty STATUSLINE_STYLE falls back to the terminal" "$CL" "$(pay | detect TERM_PROGRAM=xterm STATUSLINE_STYLE=)"

  # --- width: never wider than COLUMNS-4-reserve, at any width, in either look ---
  busy="$(pay '.rate_limits.five_hour={"used_percentage":92,"resets_at":2000002400} | .rate_limits.seven_day={"used_percentage":81,"resets_at":2000172800} | .prompt_cache.warm=false | .prompt_cache.expires_at=null | .effort.level="max" | .agent={"name":"security-reviewer"} | .output_style.name="Explanatory" | .fast_mode=true')"
  mkdir -p "$STATE/bus/s1"; printf 'warn\tagents 37/40\n' > "$STATE/bus/s1/mize-agent-tree"; printf 'fail\tops: 2 failing\n' > "$STATE/bus/s1/ops"
  printf 'info\tdeploy 3/4\n' > "$STATE/bus/s1/deploy"
  for STYLE in chips flat; do
    for rsv in none 22; do
      rm -f "$STATE/bus/s1/.reserve"; [ "$rsv" = none ] || printf '22\t10\t110\n' > "$STATE/bus/s1/.reserve"
      over=""
      for c in 18 20 24 30 40 50 60 70 80 90 95 100 110 120 140 170 220; do
        r=0; [ "$rsv" = none ] || { r=22; [ "$c" -lt 110 ] && r=10; }
        for p in "$(pay)" "$busy"; do
          o="$(printf '%s' "$p" | line "$c" | plain)"; n=${#o}
          [ "$n" -le $(( c - 4 - r )) ] || over="$over $c:$n"
          [ "$n" -gt 0 ] || over="$over $c:empty"
        done
      done
      expect "$t: $STYLE, reserve $rsv: every width fits COLUMNS-4-reserve and is never empty" "" "$over"
    done
  done
  rm -f "$STATE/bus/s1/.reserve" "$STATE/bus/s1/ops" "$STATE/bus/s1/deploy"
  for STYLE in chips flat; do
    printf 'warn\t%s\n' "代代代代代代代代代代代代" > "$STATE/bus/s1/cjk"
    over=""
    for c in 60 80 100 120 170; do
      n="$(pay '.workspace.current_dir="/Users/x/Dev/日本語のプロジェクト名前テスト" | .agent={"name":"检查员"}' | line "$c" | plain | cells)"
      [ "$n" -le $(( c - 4 )) ] || over="$over $c:$n"
    done
    expect "$t: $STYLE: wide characters never push the line past COLUMNS-4" "" "$over"
    rm -f "$STATE/bus/s1/cjk"
  done
  unset STYLE
  expect "$t: chips: a very narrow terminal keeps what fits" "[Fable 5.1] [5h 20%]" "$(pay | line 24 | pp)"
  expect "$t: flat: a very narrow terminal keeps what fits" "Fable 5.1 │ ctx 52%" "$(pay | STYLE=flat line 24 | pp)"
  expect "$t: chips: and the model alone below that" "[Fable 5.1]" "$(pay | line 16 | pp)"
  expect "$t: flat: and the model alone below that" "✻ Fable 5.1" "$(pay | STYLE=flat line 16 | pp)"
  expect "$t: chips: narrower still, the model's name is cut" "[Fable 5…]" "$(pay | line 14 | pp)"
  expect "$t: flat: narrower still, the model's name is cut" "Fable…" "$(pay | STYLE=flat line 10 | pp)"
  expect "$t: the cut keeps the red flags" "[F… fast no-think]" "$(pay '.fast_mode=true | .thinking.enabled=false' | line 22 | pp)"
  has "$t: and their color" "${ESC}[38;2;243;139;168mno-think" "$(pay '.fast_mode=true | .thinking.enabled=false' | line 22)"
  expect "$t: then the flags too" "[F… fast…]" "$(pay '.fast_mode=true | .thinking.enabled=false' | line 15 | pp)"
  rm -rf "$STATE/bus"; rm -f "$CACHE"
  # the count is exact, not merely safe: caps, gaps and the tight window join add up to the budget
  o="$(pay | line 95 | plain)"
  expect "$t: chips: at 95 the line fills its 91 cells exactly" "91" "${#o}"
  # the effort shows only off its standing level (xhigh), so the ✻-before-effort order needs one
  expect "$t: chips: the ✻ goes before the effort" "[Fable 5.1 high] [ctx 52%] [5h 20%]" "$(pay '.effort.level="high"' | line 40 | pp)"
  # The time until the 5h window resets is the owner's priority (2026-10-03): it outlives every
  # other detail. The week's countdown, the ✻, the effort and then the gauge go before it; only
  # the model's name, the place, the percentages and a loud bus segment outlive it.
  expect "$t: chips: 80 columns keeps the gauge and the 5h countdown: the ✻ and the effort went for them" "[Fable 5.1] [ctx ▬▬▬▬▬▬▬▬▬▬ 52%] [5h 20% ↻2h30m · 7d 30%] [/nowhere/project]" "$(pay | line 80 | pp)"
  expect "$t: chips: with an effort to show, 80 columns still gives the ✻ and the effort for the gauge and the countdown" "[Fable 5.1] [ctx ▬▬▬▬▬▬▬▬▬▬ 52%] [5h 20% ↻2h30m · 7d 30%] [/nowhere/project]" "$(pay '.effort.level="high"' | line 80 | pp)"
  expect "$t: flat: 80 columns keeps the gauge and the 5h countdown" "✻ Fable 5.1 │ ctx ▬▬▬▬▬▬▬▬▬▬ 52% │ 5h 20% ↻2h30m · 7d 30% │ /nowhere/project" "$(pay | STYLE=flat line 80 | pp)"
  expect "$t: chips: the week's countdown goes long before the 5h one" "[✻ Fable 5.1] [ctx ▬▬▬▬▬▬▬▬▬▬ 52%] [5h 20% ↻2h30m · 7d 30%] [/nowhere/project] [\$44]" "$(pay | line 88 | pp)"
  expect "$t: chips: the 5h countdown outlives the gauge" "[✻ Fable 5.1] [ctx 52%] [5h 20% ↻2h30m · 7d 30%] [/nowhere/project]" "$(pay | line 72 | pp)"
  expect "$t: flat: the 5h countdown outlives the gauge" "✻ Fable 5.1 │ ctx 52% │ 5h 20% ↻2h30m · 7d 30% │ /nowhere/project" "$(pay | STYLE=flat line 71 | pp)"
  expect "$t: chips: the place outlives the countdown, the bare windows paired" "[Fable 5.1] [ctx 52%] [5h 20% 7d 30%] [/nowhere/project]" "$(pay | line 60 | pp)"
  expect "$t: flat: very narrow, the countdown comes back before the effort does" "Fable 5.1 │ ctx 52% │ 5h 20% ↻2h30m" "$(pay | STYLE=flat line 40 | pp)"
  # the window's size shows only when it is not the 1M one; with no size, the tokens in use
  has "$t: a 1M window shows no size" "ctx ▬▬▬▬▬▬▬▬▬▬ 52% · cache 57m]" "$(pay | line 200 | pp)"
  hasnt "$t: and no tokens in use" "523k" "$(pay | line 200 | pp)"
  has "$t: a 200k window" "ctx ▬▬▬▬▬▬▬▬▬▬ 52% 200k · cache 57m]" "$(pay '.context_window.context_window_size=200000 | .context_window.total_input_tokens=104600' | line 200 | pp)"
  hasnt "$t: shows its size, not the tokens in use" "104k" "$(pay '.context_window.context_window_size=200000 | .context_window.total_input_tokens=104600' | line 200 | pp)"
  has "$t: a 2M window" "ctx ▬▬▬▬▬▬▬▬▬▬ 52% 2M ·" "$(pay '.context_window.context_window_size=2000000' | line 200 | pp)"
  has "$t: no window size: the tokens in use say the scale" "ctx ▬▬▬▬▬▬▬▬▬▬ 52% 523k · cache 57m]" "$(pay 'del(.context_window.context_window_size)' | line 200 | pp)"
  has "$t: no window size and no tokens: the percent alone" "ctx ▬▬▬▬▬▬▬▬▬▬ 52% · cache 57m]" "$(pay 'del(.context_window.context_window_size) | .context_window.total_input_tokens=0' | line 200 | pp)"
  has "$t: with less room the size is the context's first detail to go" "[✻ Fable 5.1] [ctx ▬▬▬▬▬▬▬▬▬▬ 52%] [5h 20% ↻2h30m · 7d 30% ↻3d12h]" "$(pay '.context_window.context_window_size=200000' | line 90 | pp)"
  has "$t: no COLUMNS shows everything" "\$44" "$(pay | COLUMNS= line "" | plain)"
  narrow="$(printf '%s' "$busy" | line 80 | plain)"
  has "$t: a window over pace keeps its mark when narrow" "5h 92%↗" "$narrow"
  has "$t: off-nominal flags outlive the effort" "fast" "$narrow"

  # --- the owner's row: 95 columns, mize-coworker's Claude reserving 10 cells, 81 left ---
  O="$TMP/ostate"; mkdir -p "$O/bus/own" "$O/git"; printf '22\t10\t110\n' > "$O/bus/own/.reserve"; printf 'info\tagents 7/40\n' > "$O/bus/own/mize-agent-tree"
  printf '%s\n%s\n%s\n' "$NOW" "/Users/x/Dev/Limerino" "$(printf '/Users/x/Dev/Limerino\037/Users/x/Dev/Limerino/.git\037/Users/x/Dev/Limerino/.git\037main\0370\0370\0370')" > "$O/git/own"
  rm -f "$CACHE"; printf '2000500000\t11\t2000003000\t26\t2000500000\t%s\n' $(( NOW - 120 )) > "$CACHE"
  own='.session_id="own" | .workspace={"current_dir":"/Users/x/Dev/Limerino","project_dir":"/Users/x/Dev/Limerino","repo":{"name":"Limerino"}} | .context_window={"total_input_tokens":390000,"context_window_size":1000000,"used_percentage":39.2} | .rate_limits.five_hour={"used_percentage":69,"resets_at":2000010800} | .rate_limits.seven_day={"used_percentage":67,"resets_at":2000345600}'
  o="$(pay "$own" | line 95 "$O" | pp)"
  expect "$t: chips at 95 with the reserve: model, gauge, both marked windows, the 5h countdown, place and branch" \
    "[✻ Fable 5.1] [ctx ▬▬▬▬▬▬▬▬▬▬ 39%] [5h 69%↗ ↻3h00m · 7d 67%↗] [Limerino ⎇ main]" "$o"
  o="$(pay "$own" | line 95 "$O" | plain)"; [ "${#o}" -le 81 ] && ok || bad "$t: and within its 81 cells" "${#o}"
  o="$(pay "$own" | line 93 "$O" | plain)"
  expect "$t: chips: with the branch glyph the count is still exact (93 columns: 79 cells)" "79" "${#o}"
  o="$(pay "$own" | STYLE=flat line 95 "$O" | plain)"; [ "${#o}" -le 81 ] && ok || bad "$t: flat at 95 with the reserve fits 81 cells" "${#o}: $o"
  has "$t: flat keeps the gauge there too" "ctx ▬▬▬▬▬▬▬▬▬▬ 39% │" "$o"
  has "$t: and the 5h countdown" "│ 5h 69%↗ ↻3h00m · 7d 67%↗" "$o"
  # 99 columns (the owner's windows on 2026-10-03), the reserve 11 below 110: 84 cells, in a
  # repo with dirty and ahead counts. Before, the counts stayed and the row never said when the
  # window resets; now the countdown stays and the counts and the size go.
  ownrow() { rm -f "$CACHE"; printf '2000500000\t11\t2000003000\t26\t2000500000\t%s\n' $(( NOW - 120 )) > "$CACHE"; pay "$own${2:+ | $2}" | line "$1" "$O" | pp; }
  owngit() { printf '%s\n%s\n%s\n' "$NOW" "/Users/x/Dev/Limerino" "$(printf '/Users/x/Dev/Limerino\037/Users/x/Dev/Limerino/.git\037/Users/x/Dev/Limerino/.git\037%s\037%s\037%s\0370' "$1" "$2" "$3")" > "$O/git/own"; }
  printf '22\t11\t110\n' > "$O/bus/own/.reserve"; owngit main 3 2
  expect "$t: chips at 99 with the reserve: the 5h countdown outlives the dirty counts" \
    "[✻ Fable 5.1] [ctx ▬▬▬▬▬▬▬▬▬▬ 39%] [5h 69%↗ ↻3h00m · 7d 67%↗ ↻4d] [Limerino ⎇ main]" "$(ownrow 99)"
  # countdowns keep their width for the hour, so a longer one is an hour's against minutes'
  expect "$t: a countdown under an hour leaves room for the ✻" \
    "[✻ Fable 5.1] [ctx ▬▬▬▬▬▬▬▬▬▬ 39%] [5h 92%↗ ↻24m · 7d 67%↗] [Limerino ⎇ main]" "$(ownrow 92 '.rate_limits.five_hour={"used_percentage":92,"resets_at":2000001440}')"
  expect "$t: a longer countdown takes the ✻'s cells, not the gauge's" \
    "[Fable 5.1] [ctx ▬▬▬▬▬▬▬▬▬▬ 39%] [5h 92%↗ ↻2h37m · 7d 67%↗] [Limerino ⎇ main]" "$(ownrow 92 '.rate_limits.five_hour={"used_percentage":92,"resets_at":2000009420}')"
  owngit feature/statusline-ladder 0 0
  expect "$t: a long branch: the gauge goes, the countdown and the branch stay" \
    "[Fable 5.1] [ctx 39%] [5h 69%↗ ↻3h00m · 7d 67%↗] [Limerino ⎇ feature/statusline-ladder]" "$(ownrow 102)"
  expect "$t: and the branch outlives the countdown where both cannot stay" \
    "[✻ Fable 5.1] [ctx 39%] [5h 69%↗ 7d 67%↗] [Limerino ⎇ feature/statusline-ladder]" "$(ownrow 95)"
  # The week's countdown goes long before the 5h one (d7:1), so no width shows it without the
  # 5h one: the pass that gives back what still fits must not hand the week's back alone.
  for STYLE in chips flat; do
    inv=""
    for br in main feature/statusline-ladder; do
      owngit "$br" 3 2
      for c in 50 52 56 60 62 66 70 73 76 80 85 90 95 100 105 110; do
        o="$(ownrow "$c")"
        case "$o" in *"7d "*"↻"*) case "$o" in *"5h "*"↻"*"7d "*) ;; *) inv="$inv $br@$c" ;; esac ;; esac
      done
    done
    expect "$t: $STYLE: the week's countdown never shows without the 5h one" "" "$inv"
  done
  unset STYLE
  owngit main 3 2
  rm -f "$CACHE"

  # --- model flags ---
  out="$(printf '%s' "$busy" | line 300 | plain)"
  has "$t: flags" "✻ Fable 5.1 max fast @security-reviewer Explanatory" "$out"
  has "$t: thinking off is flagged" "no-think" "$(pay '.thinking.enabled=false' | line 200 | plain)"
  hasnt "$t: nominal state shows no flag" "think" "$(pay | line 200 | plain)"
  # a model with no effort level: the agent name is the only extra, and dropping it keeps the model
  has "$t: no effort, an agent name" "[✻ Opus @reviewer]" "$(pay 'del(.effort) | .model.display_name="Opus" | .agent={"name":"reviewer"}' | line 200 | pp)"
  expect "$t: narrow drops the extra, never the model" "[✻ Opus] [ctx 52%] [5h 20% 7d 30%] [project]" "$(pay 'del(.effort) | .model.display_name="Opus" | .agent={"name":"reviewer"}' | line 48 | pp)"
  # the effort shows only when it is off the standing one (STATUSLINE_EFFORT_DEFAULT, xhigh unset;
  # empty: always shown)
  has "$t: the standing effort goes unshown" "[✻ Fable 5.1] [ctx" "$(pay | line 200 | pp)"
  hasnt "$t: so xhigh never shows by default" "xhigh" "$(pay | line 300 | plain)"
  has "$t: max is shown" "[✻ Fable 5.1 max] [ctx" "$(pay '.effort.level="max"' | line 200 | pp)"
  has "$t: in the value color" "${ESC}[38;2;186;194;222mmax" "$(pay '.effort.level="max"' | line 200)"
  has "$t: high is shown" "[✻ Fable 5.1 high] [ctx" "$(pay '.effort.level="high"' | line 200 | pp)"
  has "$t: in the label color" "${ESC}[38;2;127;132;156mhigh" "$(pay '.effort.level="high"' | line 200)"
  has "$t: an empty STATUSLINE_EFFORT_DEFAULT shows xhigh too" "[✻ Fable 5.1 xhigh] [ctx" "$(pay | STATUSLINE_EFFORT_DEFAULT= line 200 | pp)"
  has "$t: another default hides that effort" "[✻ Fable 5.1] [ctx" "$(pay '.effort.level="high"' | STATUSLINE_EFFORT_DEFAULT=high line 200 | pp)"
  has "$t: and shows xhigh" "[✻ Fable 5.1 xhigh] [ctx" "$(pay | STATUSLINE_EFFORT_DEFAULT=high line 200 | pp)"
  has "$t: flags still show beside a hidden effort" "[✻ Fable 5.1 fast] [ctx" "$(pay '.fast_mode=true' | line 200 | pp)"

  # --- context: the gauge (ten cells, colors checked against the gradient math) ---
  o="$(pay '.context_window.used_percentage=null | .context_window.total_input_tokens=0' | line 200)"
  has "$t: a fresh session has the track alone and --, not 0%" "ctx ▬▬▬▬▬▬▬▬▬▬ -- · cache" "$(printf '%s' "$o" | pp)"
  has "$t: a fresh session on a 200k window says the size" "ctx ▬▬▬▬▬▬▬▬▬▬ -- 200k · cache" "$(pay '.context_window.used_percentage=null | .context_window.total_input_tokens=0 | .context_window.context_window_size=200000' | line 200 | pp)"
  expect "$t: and every cell is track" "$(printf "$TRACK %.0s" 1 2 3 4 5 6 7 8 9 10 | sed 's/ $//')" "$(printf '%s' "$o" | gauge_cells)"
  expect "$t: under 70%: blue to lavender to mauve; the fifth cell's 20% shown as a faint quarter" \
    "137;180;250 147;182;251 156;184;252 166;187;253 175;189;254 98;100;131 $TRACK $TRACK $TRACK $TRACK" "$(pay | line 200 | gauge_cells)"
  expect "$t: 39%: three cells and nine tenths of the fourth" \
    "137;180;250 147;182;251 156;184;252 156;175;237 $TRACK $TRACK $TRACK $TRACK $TRACK $TRACK" "$(pay '.context_window.used_percentage=39' | line 200 | gauge_cells)"
  expect "$t: 69% is still the cool gradient" \
    "137;180;250 147;182;251 156;184;252 166;187;253 175;189;254 183;187;253 176;171;236 $TRACK $TRACK $TRACK" "$(pay '.context_window.used_percentage=69' | line 200 | gauge_cells)"
  expect "$t: from 70%: lavender to yellow to peach" \
    "180;190;254 195;198;236 211;206;219 226;214;201 241;222;184 249;221;171 249;210;162 $TRACK $TRACK $TRACK" "$(pay '.context_window.used_percentage=70' | line 200 | gauge_cells)"
  # from 85% the context is spent (red) and its chip sits on the tinted ground, where the track
  # steps up one tone (surface2); flat has no ground and keeps the track
  expect "$t: 86%, its track a tone up on the tinted ground" \
    "180;190;254 195;198;236 211;206;219 226;214;201 241;222;184 249;221;171 249;210;162 250;200;153 178;142;122 $TRACK2" "$(pay '.context_window.used_percentage=86' | line 200 | gauge_cells)"
  expect "$t: flat: 86% keeps the track" \
    "180;190;254 195;198;236 211;206;219 226;214;201 241;222;184 249;221;171 249;210;162 250;200;153 178;142;122 $TRACK" "$(pay '.context_window.used_percentage=86' | STYLE=flat line 200 | gauge_cells)"
  expect "$t: from 90%: yellow to peach to red" \
    "249;226;175 249;216;166 249;205;157 250;195;148 250;184;139 249;175;139 248;166;146 246;157;153 245;148;161 156;105;129" "$(pay '.context_window.used_percentage=95' | line 200 | gauge_cells)"
  expect "$t: 100% is ten cells, ending red" \
    "249;226;175 249;216;166 249;205;157 250;195;148 250;184;139 249;175;139 248;166;146 246;157;153 245;148;161 243;139;168" "$(pay '.context_window.used_percentage=100' | line 200 | gauge_cells)"
  expect "$t: 1% lights a faint first cell" \
    "86;98;130 $TRACK $TRACK $TRACK $TRACK $TRACK $TRACK $TRACK $TRACK $TRACK" "$(pay '.context_window.used_percentage=1.2' | line 200 | gauge_cells)"
  expect "$t: under 1% with tokens in use still does" \
    "86;98;130 $TRACK $TRACK $TRACK $TRACK $TRACK $TRACK $TRACK $TRACK $TRACK" "$(pay '.context_window.used_percentage=0.4 | .context_window.total_input_tokens=3000' | line 200 | gauge_cells)"
  has "$t: and reads 0%" "ctx ▬▬▬▬▬▬▬▬▬▬ 0% · cache" "$(pay '.context_window.used_percentage=0.4 | .context_window.total_input_tokens=3000' | line 200 | pp)"
  has "$t: the percent is red from 85%" "${ESC}[38;2;243;139;168m86%" "$(pay '.context_window.used_percentage=86' | line 200)"
  has "$t: and yellow from 70%" "${ESC}[38;2;249;226;175m70%" "$(pay '.context_window.used_percentage=70' | line 200)"
  expect "$t: flat draws the same gauge" "$(pay | line 200 | gauge_cells)" "$(pay | STYLE=flat line 200 | gauge_cells)"
  has "$t: millions" "52% 1.2M ·" "$(pay 'del(.context_window.context_window_size) | .context_window.total_input_tokens=1234567' | line 200 | plain)"
  # tinted grounds: a group whose worst visible piece is spent sits on the failure ground
  expect "$t: chips: 84% leaves the context on the chip ground" "$K $K $K $K $K" "$(pay '.context_window.used_percentage=84' | line 200 | chips)"
  expect "$t: chips: from 85% the context's chip is tinted" "$K $KF $K $K $K" "$(pay '.context_window.used_percentage=85' | line 200 | chips)"
  raw="$(pay '.context_window.used_percentage=85' | line 200)"
  has "$t: its label a tone up" "${ESC}[48;2;${KF}m${ESC}[38;2;${LAB2}mctx" "$raw"
  has "$t: and its track" "${ESC}[38;2;${TRACK2}m▬" "$raw"
  hasnt "$t: the plain label is gone from it" "${ESC}[38;2;127;132;156mctx" "$raw"
  has "$t: the other chips keep theirs" "${ESC}[38;2;127;132;156m5h" "$raw"
  raw="$(pay '.context_window.used_percentage=85' | STYLE=flat line 200)"
  hasnt "$t: flat: no tint" "${ESC}[48;" "$raw"
  has "$t: flat: the plain label" "${ESC}[38;2;127;132;156mctx" "$raw"
  hasnt "$t: flat: no stepped-up track" "${TRACK2}m" "$raw"

  # --- prompt cache ---
  has "$t: warm cache counts down" "cache 57m" "$(pay | line 200 | plain)"
  has "$t: the last ten minutes" "cache 07m" "$(pay '.prompt_cache.expires_at=2000000420' | line 200 | plain)"
  has "$t: a cold cache says what the next prompt re-caches" "cache cold 523k" "$(pay '.prompt_cache.warm=false | .prompt_cache.expires_at=null' | line 200 | plain)"
  has "$t: an expired warm cache is cold" "cache cold 523k" "$(pay '.prompt_cache.expires_at=1999999999' | line 200 | plain)"
  has "$t: a small cold cache is quiet" "cache cold]" "$(pay '.prompt_cache.warm=false | .prompt_cache.recache_tokens_if_cold=40000' | line 200 | pp)"
  has "$t: flat: a small cold cache is quiet" "cache cold │" "$(pay '.prompt_cache.warm=false | .prompt_cache.recache_tokens_if_cold=40000' | STYLE=flat line 200 | pp)"
  hasnt "$t: no prompt_cache, no segment" "cache" "$(pay 'del(.prompt_cache)' | line 200 | plain)"
  has "$t: a recent miss with a cause on this side says why" "cache 57m miss: tools changed" "$(pay '.prompt_cache.last_miss_at=1999999900 | .prompt_cache.last_miss_cause={"causes":["tools_changed"],"tools_added":2}' | line 200 | plain)"
  hasnt "$t: a server-side miss is not news" "miss" "$(pay '.prompt_cache.last_miss_at=1999999900 | .prompt_cache.last_miss_cause={"causes":["likely_server_side"]}' | line 200 | plain)"
  hasnt "$t: a miss older than ten minutes is forgotten" "miss" "$(pay '.prompt_cache.last_miss_at=1999999300 | .prompt_cache.last_miss_cause={"causes":["tools_changed"]}' | line 200 | plain)"
  hasnt "$t: the miss cause carries nothing odd" "$(printf '\033')" "$(pay '.prompt_cache.last_miss_at=1999999900 | .prompt_cache.last_miss_cause={"causes":["x\u001b[31m;rm -rf /"]}' | line 200 | plain | sed 's/.*miss: //; s/ .*//')"

  # --- spend in the current 5h window (<state>/spend/<session>: "<5h reset>\t<cost at window start>") ---
  has "$t: a session first seen with a large cost shows only its total" "[\$44]" "$(pay '.session_id="sp1"' | line 200 | pp)"
  hasnt "$t: and nothing per window yet" "/5h" "$(pay '.session_id="sp1"' | line 200 | plain)"
  has "$t: once the cost grows, the growth is this window's" "[\$6/5h · \$50]" "$(pay '.session_id="sp1" | .cost.total_cost_usd=50.2' | line 200 | pp)"
  has "$t: a new window starts the count over" "[\$50]" "$(pay '.session_id="sp1" | .cost.total_cost_usd=50.2 | .rate_limits.five_hour.resets_at=2000027000' | line 200 | pp)"
  has "$t: and grows again" "\$3/5h · \$53" "$(pay '.session_id="sp1" | .cost.total_cost_usd=53.4 | .rate_limits.five_hour.resets_at=2000027000' | line 200 | plain)"
  has "$t: a brand-new session's whole cost is this window's" "[\$2]" "$(pay '.session_id="sp2" | .cost.total_cost_usd=2.4' | line 200 | pp)"
  has "$t: so after it grows the window share is all of it, shown once" "[\$9]" "$(pay '.session_id="sp2" | .cost.total_cost_usd=9.1' | line 200 | pp)"
  hasnt "$t: not twice" "/5h" "$(pay '.session_id="sp2" | .cost.total_cost_usd=9.1' | line 200 | plain)"
  rm -f "$CACHE"
  expect "$t: the per-window spend goes first when narrow" "\$53" "$(pay '.session_id="sp1" | .cost.total_cost_usd=53.4 | .rate_limits.five_hour.resets_at=2000027000' | line 110 | pp | sed 's/.*\[//; s/\]$//')"
  expect "$t: flat: the per-window spend goes first when narrow" "\$53" "$(pay '.session_id="sp1" | .cost.total_cost_usd=53.4 | .rate_limits.five_hour.resets_at=2000027000' | STYLE=flat line 110 | pp | sed 's/.*│ //')"
  has "$t: while the rest of the row stays" "cache 57m] [5h 20% ↻5h00m · 7d 30% ↻3d12h] [/nowhere/project] [" "$(pay '.session_id="sp1" | .cost.total_cost_usd=53.4 | .rate_limits.five_hour.resets_at=2000027000' | line 110 | pp)"

  # --- pace: 5h = 18000 s, 7d = 604800 s (a fresh usage cache per case: the cache keeps the
  # newest window it has seen, which is the other suite's subject) ---
  pace() { rm -f "$CACHE"; pay "$1" | line 200; }
  # 50% used with 4 h left (1 h gone, 20% of the window): P = 250, dry in 1 h
  has "$t: over pace is marked, then when it resets" "5h 50%↗ ↻4h" "$(pace '.rate_limits.five_hour={"used_percentage":50,"resets_at":2000014400}' | plain)"
  # 30% used with 12 minutes gone: too early to judge
  has "$t: an early burst is not extrapolated" "5h 30% ↻4h48m" "$(pace '.rate_limits.five_hour={"used_percentage":30,"resets_at":2000017280}' | plain)"
  # 43% used at 42% of the window: on pace to end near the cap, calm
  has "$t: on pace stays calm" "5h 43% ↻2h54m" "$(pace '.rate_limits.five_hour={"used_percentage":43,"resets_at":2000010440}' | plain)"
  # 92% used, 40 min left: P = 106 but past 75% any shortfall counts; dry in 22 m is inside the 30 m crit runway
  has "$t: nearly out: peach-marked, no runway" "5h 92%↗ ↻40m" "$(pace '.rate_limits.five_hour={"used_percentage":92,"resets_at":2000002400}' | plain)"
  # 92% used, 5 min left: it lasts to the reset
  has "$t: high but lasting is a watch mark" "5h 92%↗ ↻05m" "$(pace '.rate_limits.five_hour={"used_percentage":92,"resets_at":2000000300}' | plain)"
  has "$t: a spent window shows its reset" "5h 100% ↻40m" "$(pace '.rate_limits.five_hour={"used_percentage":100,"resets_at":2000002400}' | plain)"
  # 7d: 26% after 18 h is not judged (under a day and under half); 57% after 16 h is (over half)
  has "$t: the week is not judged before a day has passed" "7d 26% ↻6d6h" "$(pace '.rate_limits.seven_day={"used_percentage":26,"resets_at":2000540000}' | plain)"
  has "$t: half the week gone in 16 h is judged: a mark" "7d 57%↗ ↻6d8h" "$(pace '.rate_limits.seven_day={"used_percentage":57,"resets_at":2000547200}' | plain)"
  raw="$(pace '.rate_limits.five_hour={"used_percentage":92,"resets_at":2000002400}')"
  has "$t: over pace from 90% is peach" "${ESC}[38;2;250;179;135m92%" "$raw"
  has "$t: a countdown beside a window joins the next with a dot" "5h 92%↗ ↻40m · 7d 30% ↻3d12h" "$(printf '%s' "$raw" | plain)"
  raw="$(pace '.rate_limits.five_hour={"used_percentage":50,"resets_at":2000014400}')"
  has "$t: on pace to run dry is yellow" "${ESC}[38;2;249;226;175m50%" "$raw"
  raw="$(pace '.rate_limits.five_hour={"used_percentage":100,"resets_at":2000002400}')"
  has "$t: spent is red" "${ESC}[38;2;243;139;168m100%" "$raw"
  has "$t: the week at 90% is peach-marked, still no runway" "7d 91%↗ ↻2d" "$(pace '.rate_limits.seven_day={"used_percentage":91,"resets_at":2000172800}' | plain)"
  hasnt "$t: nothing ever says out in" "out in" "$(pace '.rate_limits.five_hour={"used_percentage":92,"resets_at":2000002400} | .rate_limits.seven_day={"used_percentage":91,"resets_at":2000172800}' | plain)"
  hasnt "$t: no rate limits, no windows" "5h" "$(rm -f "$CACHE"; pay 'del(.rate_limits)' | line 200 | plain)"
  # the windows' chip is tinted by its worst visible piece: over (peach) or spent (red); watch is
  # the text's color alone
  expect "$t: chips: a window over pace tints its chip" "$K $K $KO $K $K" "$(pace '.rate_limits.five_hour={"used_percentage":92,"resets_at":2000002400}' | chips)"
  expect "$t: chips: a spent window tints it red" "$K $K $KF $K $K" "$(pace '.rate_limits.five_hour={"used_percentage":100,"resets_at":2000002400}' | chips)"
  expect "$t: chips: a spent week too" "$K $K $KF $K $K" "$(pace '.rate_limits.seven_day={"used_percentage":100,"resets_at":2000172800}' | chips)"
  expect "$t: chips: spent outranks over" "$K $K $KF $K $K" "$(pace '.rate_limits.five_hour={"used_percentage":92,"resets_at":2000002400} | .rate_limits.seven_day={"used_percentage":100,"resets_at":2000172800}' | chips)"
  expect "$t: chips: a window on watch keeps the chip ground" "$K $K $K $K $K" "$(pace '.rate_limits.five_hour={"used_percentage":50,"resets_at":2000014400}' | chips)"
  raw="$(pace '.rate_limits.five_hour={"used_percentage":92,"resets_at":2000002400}')"
  has "$t: on the tint the labels step up a tone" "${ESC}[48;2;${KO}m${ESC}[38;2;${LAB2}m5h" "$raw"
  has "$t: the other window's label too" "${ESC}[38;2;${LAB2}m7d" "$raw"
  has "$t: and the countdowns" "${ESC}[38;2;${LAB2}m↻40m" "$raw"
  hasnt "$t: the context's chip keeps its own label" "${ESC}[38;2;${LAB2}mctx" "$raw"
  hasnt "$t: flat: no tint for a window over pace" "${ESC}[48;" "$(rm -f "$CACHE"; pay '.rate_limits.five_hour={"used_percentage":92,"resets_at":2000002400}' | STYLE=flat line 200)"
  # countdowns: whole days with their hours; hours with two-digit minutes; minutes two digits
  cd5() { pace ".rate_limits.five_hour={\"used_percentage\":1,\"resets_at\":$(( NOW + $1 ))}" | pp | sed 's/.*5h 1% //; s/ ·.*//'; }
  cd7() { pace ".rate_limits.seven_day={\"used_percentage\":1,\"resets_at\":$(( NOW + $1 ))}" | pp | sed 's/.*7d 1% //; s/\].*//'; }
  for c in "30 ↻<1m" "59 ↻<1m" "60 ↻01m" "540 ↻09m" "599 ↻09m" "600 ↻10m" "1440 ↻24m" "3599 ↻59m" "3600 ↻1h00m" "3660 ↻1h01m" "7740 ↻2h09m" "10800 ↻3h00m" "17999 ↻4h59m"; do
    expect "$t: a 5h reset ${c%% *} s away reads ${c#* }" "${c#* }" "$(cd5 "${c%% *}")"
  done
  for c in "86400 ↻1d" "90000 ↻1d1h" "345600 ↻4d" "360000 ↻4d4h" "547200 ↻6d8h"; do
    expect "$t: a 7d reset ${c%% *} s away reads ${c#* }" "${c#* }" "$(cd7 "${c%% *}")"
  done
  for c in "30 <1m" "540 09m" "3540 59m" "3599 59m" "3600 60m" "3659 60m" "3660 1h01m"; do
    expect "$t: a cache ${c%% *} s from cold reads ${c#* }" "cache ${c#* }" "$(pay ".prompt_cache.expires_at=$(( NOW + ${c%% *} ))" | line 200 | pp | grep -o 'cache [^] ]*')"
  done
  # numbers with leading zeros are decimal, not octal, wherever they reach arithmetic
  rm -f "$CACHE"; err="$(pay '.rate_limits.five_hour.used_percentage="09" | .rate_limits.seven_day.used_percentage="08"' | line 200 2>&1 >/dev/null)"
  expect "$t: a payload percent with a leading zero is no error" "" "$err"
  has "$t: and reads as decimal" "5h 9% ↻2h30m · 7d 8% ↻3d12h" "$(rm -f "$CACHE"; pay '.rate_limits.five_hour.used_percentage="09" | .rate_limits.seven_day.used_percentage="08"' | line 200 | plain)"
  rm -f "$CACHE"; printf '2000302400\t08\t2000009000\t09\t2000302400\t%s\n' $(( NOW - 10 )) > "$CACHE"
  expect "$t: a usage-cache row with leading zeros is no error" "" "$(pay 'del(.rate_limits)' | line 200 2>&1 >/dev/null)"
  has "$t: and reads as decimal" "5h 8% ↻2h30m · 7d 9% ↻3d12h" "$(pay 'del(.rate_limits)' | line 200 | plain)"
  rm -f "$CACHE"
  expect "$t: a re-cache count with a leading zero is no error" "" "$(pay '.prompt_cache.warm=false | .prompt_cache.recache_tokens_if_cold="0900000"' | line 200 2>&1 >/dev/null)"
  has "$t: and reads as decimal" "cache cold 900k" "$(pay '.prompt_cache.warm=false | .prompt_cache.recache_tokens_if_cold="0900000"' | line 200 | plain)"
  has "$t: a window size with a leading zero reads as decimal" "52% 200k ·" "$(pay '.context_window.context_window_size="0200000"' | line 200 | plain)"
  rm -f "$CACHE"

  # --- the other account (usage cache rows: key f5pct f5reset f7pct f7reset epoch) ---
  rm -f "$CACHE"; printf '2000500000\t11\t2000003000\t26\t2000500000\t%s\n' $(( NOW - 120 )) > "$CACHE"
  has "$t: alt shows the other account" "· alt 11% 26%]" "$(pay | line 200 | pp)"
  rm -f "$CACHE"; printf '2000500000\t11\t1999999000\t26\t2000500000\t%s\n' $(( NOW - 7200 )) > "$CACHE"
  has "$t: a reset 5h window reads 0, an old sample says its age" "alt 0% 26% 2h00m ago" "$(pay | line 200 | plain)"
  rm -f "$CACHE"; printf '1999990000\t11\t1999980000\t26\t1999990000\t%s\n' $(( NOW - 120 )) > "$CACHE"
  hasnt "$t: a rolled week is not shown" "alt" "$(pay | line 200 | plain)"
  rm -f "$CACHE"; printf '2000500000\t11\t2000003000\t26\t2000500000\t%s\n' $(( NOW - 120 )) > "$CACHE"
  hasnt "$t: no alt while this session's account is unknown" "alt" "$(pay 'del(.rate_limits)' | line 200 | plain)"
  for STYLE in chips flat; do
    has "$t: $STYLE: the gauge outlives alt even when this account is over pace" "▬" "$(pay '.rate_limits.five_hour={"used_percentage":50,"resets_at":2000014400}' | line 90 | plain)"
    hasnt "$t: $STYLE: and alt is what went" "alt" "$(pay '.rate_limits.five_hour={"used_percentage":50,"resets_at":2000014400}' | line 90 | plain)"
    has "$t: $STYLE: the 5h countdown outlives alt too" "5h 50%↗ ↻4h" "$(pay '.rate_limits.five_hour={"used_percentage":50,"resets_at":2000014400}' | line 90 | plain)"
  done
  unset STYLE
  rm -f "$CACHE"

  # --- the mod bus: <state>/bus/<session>/<publisher> holds "<level>\t<text>" (publisher names here are samples) ---
  mkdir -p "$STATE/bus/s1" "$STATE/bus/other"
  printf 'info\tagents 7/40\n' > "$STATE/bus/s1/mize-agent-tree"
  printf 'info\tnot mine\n' > "$STATE/bus/other/mize-agent-tree"
  out="$(pay | line 200 | pp)"
  has "$t: bus segment, a chip of its own" "] [agents 7/40] [" "$out"
  has "$t: flat: bus segment" "│ agents 7/40 │" "$(pay | STYLE=flat line 200 | pp)"
  hasnt "$t: another session's bus is not read" "not mine" "$out"
  printf 'fail\tci red\n' > "$STATE/bus/s1/zz-ci"; printf 'warn\tqueue 3\n' > "$STATE/bus/s1/aa-queue"
  has "$t: loudest first, with a cue beside the color: a chip each" "[✗ ci red] [▲ queue 3] [agents 7/40]" "$(pay | line 200 | pp)"
  has "$t: flat: loudest first" "✗ ci red · ▲ queue 3 · agents 7/40" "$(pay | STYLE=flat line 200 | pp)"
  raw="$(pay | line 200)"
  expect "$t: the failure on a red ground, the warning on a yellow one, the info on the chip ground" "$K $K $K $K $KF $KW $K $K" "$(printf '%s' "$raw" | chips)"
  has "$t: the failure's text is red" "${ESC}[48;2;${KF}m${ESC}[38;2;243;139;168m✗ ci red" "$raw"
  has "$t: the warning's text is yellow" "${ESC}[48;2;${KW}m${ESC}[38;2;249;226;175m▲ queue 3" "$raw"
  expect "$t: narrow: warnings and failures outlive the info segment and the place" "[✻ Fable 5.1] [ctx 52%] [5h 20% 7d 30%] [✗ ci red] [▲ queue 3] [\$44]" "$(pay | line 72 | pp)"
  expect "$t: the two loud chips keep their grounds" "$K $K $K $KF $KW $K" "$(pay | line 72 | chips)"
  expect "$t: narrower: the loudest one alone" "[✻ Fable 5.1] [ctx 52%] [5h 20% 7d 30%] [✗ ci red]" "$(pay | line 56 | pp)"
  expect "$t: flat: narrow: warnings and failures outlive the info segment and the place" "✻ Fable 5.1 │ ctx 52% │ 5h 20% · 7d 30% │ ✗ ci red · ▲ queue 3" "$(pay | STYLE=flat line 70 | pp)"
  expect "$t: flat: narrower: the loudest one alone" "✻ Fable 5.1 │ ctx 52% │ 5h 20% · 7d 30% │ ✗ ci red" "$(pay | STYLE=flat line 56 | pp)"
  printf 'warn\tqueue 4\n' > "$STATE/bus/s1/ab-queue"
  has "$t: two warnings share their chip" "[▲ queue 3 · ▲ queue 4]" "$(pay | line 200 | pp)"
  rm -f "$STATE/bus/s1/ab-queue" "$STATE/bus/s1/zz-ci"
  expect "$t: a warning alone opens the bus on its own ground" "$K $K $K $K $KW $K $K" "$(pay | line 200 | chips)"
  rm -f "$STATE/bus/s1/aa-queue"; printf 'fail\tci red\n' > "$STATE/bus/s1/zz-ci"
  expect "$t: a failure beside info" "$K $K $K $K $KF $K $K" "$(pay | line 200 | chips)"
  printf 'fail\tci red\n' > "$STATE/bus/s1/zz-ci"; printf 'warn\tqueue 3\n' > "$STATE/bus/s1/aa-queue"
  # a segment past its <until> epoch is a publisher that stopped without clearing
  printf 'warn\tagents 27/30\t%s\n' $(( NOW - 1 )) > "$STATE/bus/s1/stale"; printf 'info\tfresh one\t%s\n' $(( NOW + 60 )) > "$STATE/bus/s1/fresh"
  o="$(pay | line 300 | plain)"
  hasnt "$t: an expired segment is not shown" "agents 27/30" "$o"
  has "$t: an unexpired one is" "fresh one" "$o"
  rm -f "$STATE/bus/s1/stale" "$STATE/bus/s1/fresh"
  # long warnings must not collapse the line: what does not fit goes, the rest comes back
  mkdir -p "$STATE/bus/long"; printf 'warn\tdeploy queue blocked on review\n' > "$STATE/bus/long/aa"; printf 'fail\tci red on main: 4 jobs failing\n' > "$STATE/bus/long/bb"
  expect "$t: two long loud segments at 80: the loudest stays and the line is not emptied" "[✻ Fable 5.1] [ctx 52%] [5h 20% 7d 30%] [✗ ci red on main: 4 jobs failing]" "$(pay '.session_id="long"' | line 80 | pp)"
  expect "$t: at 50 the failure outlives the gauges" "[Fable 5.1] [✗ ci red on main: 4 jobs failing]" "$(pay '.session_id="long"' | line 50 | pp)"
  expect "$t: at 40 it cannot fit and the gauges come back" "[✻ Fable 5.1] [ctx 52%] [5h 20%]" "$(pay '.session_id="long"' | line 40 | pp)"
  expect "$t: flat: two long loud segments at 80" "✻ Fable 5.1 │ ctx 52% │ 5h 20% · 7d 30% │ ✗ ci red on main: 4 jobs failing" "$(pay '.session_id="long"' | STYLE=flat line 80 | pp)"
  rm -f "$STATE/bus/s1/zz-ci" "$STATE/bus/s1/aa-queue"
  : > "$STATE/bus/s1/mize-agent-tree"
  hasnt "$t: an empty file shows nothing" "agents" "$(pay | line 200 | plain)"
  printf 'info\t\033[31mred\033]8;;http://x\033\\\\link and a very long text that goes on and on and on\n' > "$STATE/bus/s1/hostile"
  # C1 controls (CSI, OSC as UTF-8) beside an invalid byte, and a multi-megabyte line
  printf 'info\t\302\233' > "$STATE/bus/s1/c1"; printf '31;7mC1\302\235' >> "$STATE/bus/s1/c1"; printf '8;;http://y\377\n' >> "$STATE/bus/s1/c1"
  { printf 'info\tbig'; head -c 3000000 /dev/zero | tr '\0' '\001'; printf 'x\n'; } > "$STATE/bus/s1/huge"
  SECONDS=0; raw="$(pay | line 300)"
  [ "$SECONDS" -le 3 ] && ok || bad "$t: a huge bus file does not stall the line" "${SECONDS}s"
  hasnt "$t: a C1 CSI in bus text does not reach the terminal" "$(printf '\302\233')" "$raw"
  hasnt "$t: a C1 OSC in bus text does not reach the terminal" "$(printf '\302\235')" "$raw"
  rm -f "$STATE/bus/s1/c1" "$STATE/bus/s1/huge"
  raw="$(pay | line 200)"
  hasnt "$t: bus text cannot carry an escape" "${ESC}[31m" "$raw"
  hasnt "$t: bus text cannot carry a link" "${ESC}]8;;http://x" "$raw"
  expect "$t: hostile bus text stays inside a well-formed chip" "$K $K $K $K $K $K" "$(printf '%s' "$raw" | chips)"
  o="$(printf '%s' "$raw" | plain)"; o="[31mred${o#*\[31mred}"; o="${o%%"${CR} ${CL}\$44"*}"
  expect "$t: bus text is capped at 32 cells" "32" "${#o}"
  # a mod drawing at the row's right end reserves cells: <full>\t<compact>\t<compactBelow>
  rm -rf "$STATE/bus"; mkdir -p "$STATE/bus/s1"; printf '18\t8\t110\n' > "$STATE/bus/s1/.reserve"
  o="$(pay | line 120 | plain)"
  [ "${#o}" -le $(( 120 - 4 - 18 )) ] && ok || bad "$t: the reserve is kept free at 120" "${#o} cells: $o"
  o="$(pay | line 100 | plain)"
  [ "${#o}" -le $(( 100 - 4 - 8 )) ] && [ "${#o}" -gt $(( 100 - 4 - 18 )) ] && ok || bad "$t: the compact reserve applies below its threshold" "${#o} cells: $o"
  hasnt "$t: the reserve file is not a segment" "18" "$(pay | line 300 | pp | sed 's/.*\[\$44\]//')"
  # the machine-wide default holds the cells until the session writes its own file
  rm -rf "$STATE/bus"; mkdir -p "$STATE/bus"; printf '22\t11\t110\n' > "$STATE/bus/.reserve-default"
  o="$(pay | line 120 | plain)"
  [ "${#o}" -le $(( 120 - 4 - 22 )) ] && ok || bad "$t: a session with no reserve file of its own keeps the default" "${#o} cells: $o"
  o="$(pay | line 100 | plain)"
  [ "${#o}" -le $(( 100 - 4 - 11 )) ] && [ "${#o}" -gt $(( 100 - 4 - 22 )) ] && ok || bad "$t: the default's compact number applies below its threshold" "${#o} cells: $o"
  mkdir -p "$STATE/bus/s1"; : > "$STATE/bus/s1/.reserve"
  o="$(pay | line 120 | plain)"
  [ "${#o}" -gt $(( 120 - 4 - 22 )) ] && ok || bad "$t: the session's own empty file releases the cells despite the default" "${#o} cells: $o"
  printf '30\t30\t110\n' > "$STATE/bus/s1/.reserve"
  o="$(pay | line 120 | plain)"
  [ "${#o}" -le $(( 120 - 4 - 30 )) ] && ok || bad "$t: the session's own numbers outrank the default" "${#o} cells: $o"
  rm -rf "$STATE/bus"; mkdir -p "$STATE/bus/s1"
  o="$(pay 'del(.session_id)' | line 120 | plain)"; printf '22\t11\t110\n' > "$STATE/bus/.reserve-default"
  o2="$(pay 'del(.session_id)' | line 120 | plain)"
  [ "$o" = "$o2" ] && ok || bad "$t: no session id, no default" "$o2"
  rm -f "$STATE/bus/.reserve-default"
  printf '999999999999\t8\t110\n' > "$STATE/bus/s1/.reserve"
  o="$(pay | line 120 | plain)"
  [ "${#o}" -le $(( 120 - 4 - 40 )) ] && [ "${#o}" -gt 20 ] && ok || bad "$t: an absurd reserve is capped at 40" "${#o} cells: $o"
  printf 'x; rm -rf /\t$(id)\t`id`\n' > "$STATE/bus/s1/.reserve"
  expect "$t: a junk reserve reserves nothing" "$(rm -f "$STATE/bus/s1/.reserve.bak"; mv "$STATE/bus/s1/.reserve" "$STATE/bus/s1/.reserve.bak"; pay | line 120 | plain)" "$(mv "$STATE/bus/s1/.reserve.bak" "$STATE/bus/s1/.reserve"; pay | line 120 | plain)"
  : > "$STATE/bus/s1/.reserve"
  expect "$t: an empty reserve reserves nothing" "$(pay | line 120 "$TMP/nostate" | plain)" "$(pay | line 120 | plain)"
  hasnt "$t: a session id that is not a plain name reads no bus" "agents" "$(mkdir -p "$STATE/bus/x"; printf 'info\tagents 1/40\n' > "$STATE/bus/x/a"; pay '.session_id="../bus/x"' | line 200 | plain)"
  rm -rf "$STATE/bus"

  # --- vitals for mize-coworker: <state>/bus/<session>/.vitals, "<ctx %>\t<5h>\t<7d>\t<cache>" ---
  V="$TMP/vstate"; TAB=$'\t'
  pay | line 200 "$V" >/dev/null
  expect "$t: vitals: the context, both windows' states, the cache" "52${TAB}calm${TAB}calm${TAB}warm" "$(cat "$V/bus/s1/.vitals" 2>/dev/null)"
  expect "$t: vitals are one line" "1" "$(wc -l < "$V/bus/s1/.vitals" | tr -d ' ')"
  touch -t 202001010000 "$V/bus/s1/.vitals"; touch -t 202101010000 "$TMP/vref"
  pay | line 200 "$V" >/dev/null
  [ "$V/bus/s1/.vitals" -nt "$TMP/vref" ] && bad "$t: unchanged vitals are not rewritten" || ok
  hasnt "$t: the vitals file is not a bus segment" "calm" "$(pay | line 300 "$V" | plain)"
  rm -f "$CACHE"; pay '.context_window.used_percentage=87 | .prompt_cache.warm=false | .prompt_cache.expires_at=null | .rate_limits.five_hour={"used_percentage":92,"resets_at":2000002400} | .rate_limits.seven_day={"used_percentage":100,"resets_at":2000172800}' | line 200 "$V" >/dev/null
  expect "$t: vitals follow the session: a full context, a window over pace, a spent one, a cold cache" "87${TAB}over${TAB}crit${TAB}cold" "$(cat "$V/bus/s1/.vitals" 2>/dev/null)"
  [ "$V/bus/s1/.vitals" -nt "$TMP/vref" ] && ok || bad "$t: changed vitals are rewritten"
  rm -f "$CACHE"; pay '.rate_limits.five_hour={"used_percentage":50,"resets_at":2000014400}' | line 200 "$V" >/dev/null
  expect "$t: a window on pace to run dry is watch" "52${TAB}watch${TAB}calm${TAB}warm" "$(cat "$V/bus/s1/.vitals" 2>/dev/null)"
  rm -f "$CACHE"; pay 'del(.rate_limits) | del(.prompt_cache) | .context_window.used_percentage=null' | line 200 "$V" >/dev/null
  expect "$t: what is unknown is empty" "${TAB}${TAB}${TAB}" "$(cat "$V/bus/s1/.vitals" 2>/dev/null)"
  ls -a "$V/bus/s1" | grep -q '^\.vitals\.' && bad "$t: no temp file is left behind" "$(ls -a "$V/bus/s1")" || ok
  V2="$TMP/vstate2"; mkdir -p "$V2"
  pay 'del(.session_id)' | line 200 "$V2" >/dev/null
  pay '.session_id="../bus/x"' | line 200 "$V2" >/dev/null
  expect "$t: no session id, no vitals" "" "$(find "$V2" -name '.vitals*' 2>/dev/null)"
  rm -f "$CACHE"

  # --- where: outside git ---
  has "$t: home is a tilde" "[~/Dev]" "$(pay ".workspace.current_dir=\"$FAKEHOME/Dev\"" | line 200 | pp)"
  has "$t: home itself" "[~]" "$(pay ".workspace.current_dir=\"$FAKEHOME\"" | line 200 | pp)"
  has "$t: a long path keeps its tail" "…/deep/target" "$(pay '.workspace.current_dir="/a/very/long/path/that/keeps/going/deep/target"' | line 200 | plain)"
  # the path is an OSC 8 link to the folder, for a plain path only; the visible text is the same
  raw="$(pay | line 200)"
  has "$t: the path links to the folder" "${ESC}]8;;file:///nowhere/project${ESC}\\${ESC}[38;2;137;180;250m/nowhere/project" "$raw"
  has "$t: and the link closes after it" "/nowhere/project${ESC}[39m${ESC}]8;;${ESC}\\" "$raw"
  has "$t: under home the link has the whole path" "${ESC}]8;;file://$FAKEHOME/Dev${ESC}\\" "$(pay ".workspace.current_dir=\"$FAKEHOME/Dev\"" | line 200)"
  has "$t: and the text the tilde" "[~/Dev]" "$(pay ".workspace.current_dir=\"$FAKEHOME/Dev\"" | line 200 | pp)"
  has "$t: a narrow row's folder name is still the link" "${ESC}]8;;file:///nowhere/project${ESC}\\${ESC}[38;2;137;180;250mproject" "$(pay | line 56)"
  for d in "/nowhere/my project" "/nowhere/a;b" "/nowhere/プロ" "/nowhere/café" "/nowhere/a'b" "relative/dir"; do
    raw="$(pay ".workspace.current_dir=\"$d\"" | line 200)"
    hasnt "$t: no link for the path '$d'" "${ESC}]8;;" "$raw"
    has "$t: and its text is unchanged" "${d##*/}]" "$(printf '%s' "$raw" | pp)"
  done
  # the session's name follows the path outside git (it tells apart sessions in one folder)
  has "$t: the session's name beside the path" "[/nowhere/project · statusline ideas]" "$(pay '.session_name="statusline ideas"' | line 200 | pp)"
  has "$t: flat: the session's name beside the path" "│ /nowhere/project · statusline ideas │" "$(pay '.session_name="statusline ideas"' | STYLE=flat line 200 | pp)"
  has "$t: in the secondary color, outside the link" "${ESC}]8;;${ESC}\\ ${ESC}[38;2;88;91;112m·${ESC}[39m ${ESC}[38;2;166;173;200mstatusline ideas" "$(pay '.session_name="statusline ideas"' | line 200)"
  o="$(pay '.session_name="a very long session name that goes on"' | line 200 | pp)"
  has "$t: a long name is cut to 24 cells" "[/nowhere/project · a very long session nam…]" "$o"
  o="$(pay '.session_name="日本語のセッション名前テストですよね"' | line 200 | pp | sed 's/.*project · //; s/\].*//')"
  [ "$(printf '%s' "$o" | cells)" -le 24 ] && ok || bad "$t: a wide name is cut to 24 cells too" "$(printf '%s' "$o" | cells) cells: $o"
  expect "$t: the name is the place's first detail to go" "[✻ Fable 5.1] [ctx ▬▬▬▬▬▬▬▬▬▬ 52%] [5h 20% ↻2h30m · 7d 30% ↻3d12h] [/nowhere/project] [\$44]" "$(pay '.session_name="statusline ideas"' | line 100 | pp)"
  # the name is wide and the window's title says it too: it goes before a quiet cache does
  seen=0; bad_w=""
  for c in $(seq 60 200); do
    o="$(pay '.session_name="statusline ideas"' | line "$c" | pp)"
    case "$o" in *"statusline ideas"*) case "$o" in *"cache 57m"*) ;; *) bad_w="$bad_w $c" ;; esac ;;
                 *"cache 57m"*) seen=1 ;; esac
  done
  expect "$t: the session's name never shows while the quiet cache is hidden" "" "$bad_w"
  expect "$t: and there are widths where the cache shows without it" "1" "$seen"
  raw="$(pay '.session_name="a\u001b[31mb\u009bc\u0007d"' | line 200)"
  has "$t: a name's control characters are dropped" "· a [31mb c d]" "$(printf '%s' "$raw" | pp)"
  hasnt "$t: no escape from the name reaches the terminal" "${ESC}[31m" "$raw"
  hasnt "$t: no C1 from the name reaches the terminal" "$(printf '\302\233')" "$raw"
  hasnt "$t: no bell either" "$(printf '\007')" "$raw"
  has "$t: an empty name adds nothing" "[/nowhere/project] [\$44]" "$(pay '.session_name=""' | line 200 | pp)"

  # --- where: git (a real repo, a linked worktree, a submodule, a detached head) ---
  # The first run for a session asks only rev-parse (repo and branch at once); the status scan
  # runs in the background and its counts show on the next run. settle waits for it to land.
  settle() { local i=0; while [ "$i" -lt 100 ] && { [ -e "$G/git/$1.lock" ] || ! [ -s "$G/git/$1" ] || [ "$(head -1 "$G/git/$1" 2>/dev/null)" = "0" ]; }; do sleep 0.05; i=$(( i + 1 )); done; }
  # gline <session> <dir> [cols] [extra jq]: first run, settle, second run -> readable text
  gline() { pay ".workspace.current_dir=\"$2\" | .session_id=\"$1\"${4:+ | $4}" | line "${3:-200}" "$G" >/dev/null; settle "$1"; pay ".workspace.current_dir=\"$2\" | .session_id=\"$1\"${4:+ | $4}" | line "${3:-200}" "$G" | pp; }
  R="$TMP/repo"; git init -q -b main "$R" 2>/dev/null && (
    cd "$R" && git config user.email t@t && git config user.name t && git config commit.gpgsign false &&
    echo a > a && git add a && git commit -q -m one &&
    git init -q --bare "$TMP/remote.git" && git remote add origin "$TMP/remote.git" && git push -q -u origin main 2>/dev/null &&
    echo b > b && git add b && git commit -q -m two && echo c > c && echo d >> a &&
    git worktree add -q -b feature/login-flow "$TMP/login-flow" 2>/dev/null &&
    git worktree add -q -b fix/rapid-retry "$TMP/api" 2>/dev/null &&
    git worktree add -q -b topic "$TMP/scratch-tree" 2>/dev/null && mkdir -p sub/dir "$TMP/glob[1]"
  )
  G="$TMP/gstate"
  has "$t: the first run shows repo and branch at once, without counts" "[repo ⎇ main]" "$(pay ".workspace.current_dir=\"$R\"" | line 200 "$G" | pp)"
  settle s1
  has "$t: the next run has dirty and ahead" "[repo ⎇ main *2 ↑1]" "$(pay ".workspace.current_dir=\"$R\"" | line 200 "$G" | pp)"
  has "$t: the branch glyph is in the label color" "${ESC}[38;2;127;132;156m${BRG}" "$(pay ".workspace.current_dir=\"$R\"" | line 200 "$G")"
  has "$t: flat: repo and branch, no glyph" "│ repo main *2 ↑1 │" "$(pay ".workspace.current_dir=\"$R\"" | STYLE=flat line 200 "$G" | pp)"
  mkdir -p "$G/bus/s1"; printf 'warn\tqueue 3\n' > "$G/bus/s1/q"
  expect "$t: flat needs no private-use glyph" "" "$(pay ".workspace.current_dir=\"$R\"" | STYLE=flat line 200 "$G" | pua)"
  rm -f "$G/bus/s1/q"
  has "$t: a subdirectory" "repo/sub/dir ⎇ main" "$(gline s2 "$R/sub/dir")"
  has "$t: a worktree whose branch names it gets a tag" "[repo ⎇ feature/login-flow wt]" "$(gline s3 "$TMP/login-flow")"
  has "$t: a worktree whose branch does not name it is named" "[repo/scratch-tree ⎇ topic]" "$(gline s4 "$TMP/scratch-tree")"
  has "$t: a short worktree name inside an unrelated branch is still named" "[repo/api ⎇ fix/rapid-retry]" "$(gline s4b "$TMP/api")"
  has "$t: the payload's repo name wins" "[Limerino ⎇ main" "$(gline s5 "$R" 200 '.workspace.repo={"name":"Limerino"}')"
  ( cd "$R" && git checkout -q --detach 2>/dev/null )
  has "$t: detached head" "repo ⎇ @" "$(gline s6 "$R")"
  ( cd "$R" && git checkout -q main 2>/dev/null )
  # a submodule is not a linked worktree: its own name, no tag
  ( cd "$TMP" && git init -q -b main lib-src && cd lib-src && git config user.email t@t && git config user.name t && git config commit.gpgsign false && echo l > l && git add l && git commit -q -m lib &&
    cd "$R" && git -c protocol.file.allow=always submodule add -q "$TMP/lib-src" vendor/lib 2>/dev/null )
  if [ -d "$R/vendor/lib" ]; then
    has "$t: a submodule shows its own name, not a worktree" "[lib ⎇ main]" "$(gline s6b "$R/vendor/lib")"
  else bad "$t: a submodule shows its own name, not a worktree" "the submodule could not be created"; fi
  # a repo root with glob characters: the subdirectory is still cut literally
  ( cd "$TMP/glob[1]" && git init -q -b main . && mkdir -p src )
  has "$t: glob characters in the repo path" "glob[1]/src ⎇ main" "$(gline s6c "$TMP/glob[1]/src")"
  # the per-session cache: a run within the TTL renders the cached answer
  ( cd "$R" && echo e > e )
  has "$t: within the TTL the cached answer is shown" "main *2 ↑1" "$(pay ".workspace.current_dir=\"$R\"" | line 200 "$G" | plain)"
  NOW=$(( NOW + 60 ))
  pay ".workspace.current_dir=\"$R\"" | line 200 "$G" >/dev/null   # stale: refreshed in the background
  settle s1; i=0; while [ "$i" -lt 100 ] && [ "$(head -1 "$G/git/s1" 2>/dev/null)" != "$NOW" ]; do sleep 0.05; i=$(( i + 1 )); done
  has "$t: a stale answer is refreshed for the next run" "main *5 ↑1" "$(pay ".workspace.current_dir=\"$R\"" | line 200 "$G" | plain)"
  # a cache line from another version of the script (a different field count) is a miss, not garbage
  printf '%s\n%s\n%s\n' "$NOW" "$R" "$(printf 'a\037b\037stale-branch\03799\0370\0370')" > "$G/git/s6e"
  o="$(pay ".workspace.current_dir=\"$R\" | .session_id=\"s6e\"" | line 200 "$G" | pp)"
  hasnt "$t: an old cache layout is not rendered" "stale-branch" "$o"
  has "$t: it is probed again" "repo ⎇ main" "$o"
  has "$t: a session that moved is probed at once" "~/Dev" "$(pay ".workspace.current_dir=\"$FAKEHOME/Dev\"" | line 200 "$G" | plain)"
  # a cache stamped in the future (the clock stepped back) is stale, not frozen
  ( cd "$R" && echo f > f ); printf '%s\n' "$(( NOW + 3600 ))" > "$TMP/stamp"; pay ".workspace.current_dir=\"$R\" | .session_id=\"s6d\"" | line 200 "$G" >/dev/null; settle s6d
  { cat "$TMP/stamp"; sed 1d "$G/git/s6d"; } > "$TMP/g6d" && cp "$TMP/g6d" "$G/git/s6d"; ( cd "$R" && echo g > g )
  pay ".workspace.current_dir=\"$R\" | .session_id=\"s6d\"" | line 200 "$G" >/dev/null
  i=0; while [ "$i" -lt 100 ] && [ "$(head -1 "$G/git/s6d" 2>/dev/null)" != "$NOW" ]; do sleep 0.05; i=$(( i + 1 )); done
  expect "$t: a future stamp is refreshed" "$NOW" "$(head -1 "$G/git/s6d" 2>/dev/null)"
  # one probe at a time: with a slow git, six stale runs start one status scan
  mkdir -p "$TMP/slowbin"; REALGIT="$(command -v git)"
  printf '#!/bin/sh\ncase " $* " in *" status "*) echo x >> "%s/status-runs"; sleep 2 ;; esac\nexec "%s" "$@"\n' "$TMP" "$REALGIT" > "$TMP/slowbin/git"; chmod +x "$TMP/slowbin/git"
  NOW=$(( NOW + 60 )); : > "$TMP/status-runs"
  for i in 1 2 3 4 5 6; do pay ".workspace.current_dir=\"$R\"" | PATH="$TMP/slowbin:$PATH" line 200 "$G" >/dev/null; done
  expect "$t: a slow git gets one probe, however many runs find the cache stale" "1" "$(wc -l < "$TMP/status-runs" | tr -d ' ')"
  # a claim left by a run that died is taken over after a minute
  settle s1; printf '%s\n' "$(( NOW - 120 ))" > "$G/git/s1.lock"; NOW=$(( NOW + 60 )); : > "$TMP/status-runs"
  pay ".workspace.current_dir=\"$R\"" | PATH="$TMP/slowbin:$PATH" line 200 "$G" >/dev/null; sleep 0.3
  expect "$t: a dead claim is taken over" "1" "$(wc -l < "$TMP/status-runs" | tr -d ' ')"
  settle s1
  NOW=2000000000

  # --- the PR is a link on the branch ---
  raw="$(pay ".workspace.current_dir=\"$R\" | .session_id=\"s7\" | .pr={\"number\":12,\"url\":\"https://github.com/o/r/pull/12\",\"review_state\":\"pending\"}" | line 200 "$G")"
  has "$t: OSC 8 link to the PR" "${ESC}]8;;https://github.com/o/r/pull/12${ESC}\\" "$raw"
  has "$t: the link wraps the branch" "${ESC}]8;;https://github.com/o/r/pull/12${ESC}\\${ESC}[38;2;166;173;200mmain" "$raw"
  has "$t: and reads as the branch" "repo ⎇ main" "$(printf '%s' "$raw" | pp)"
  raw="$(pay ".workspace.current_dir=\"$R\" | .session_id=\"s8\" | .pr={\"number\":12,\"url\":\"javascript:alert(1)\"}" | line 200 "$G")"
  hasnt "$t: a URL that is not https is not linked" "${ESC}]8;;" "$raw"
  raw="$(pay ".workspace.current_dir=\"$R\" | .session_id=\"s9\" | .pr={\"number\":12,\"url\":\"https://x/\\u001b]8;;evil\"}" | line 200 "$G")"
  hasnt "$t: a URL with odd characters is not linked" "${ESC}]8;;" "$raw"

  # --- the repo's name is a link to its page on the host (plain host, owner and name only) ---
  rp() { pay ".workspace.current_dir=\"$R\" | .session_id=\"$1\" | .workspace.repo=$2${4:+ | $4}" | line "${3:-200}" "$G"; }
  raw="$(rp s10 '{"host":"github.com","owner":"o","name":"r"}')"
  has "$t: the repo's name links to its page" "${ESC}]8;;https://github.com/o/r${ESC}\\${ESC}[38;2;137;180;250mr${ESC}[39m${ESC}]8;;${ESC}\\" "$raw"
  has "$t: and reads as the name" "[r ⎇ main" "$(printf '%s' "$raw" | pp)"
  has "$t: a narrow row's name is still the link" "${ESC}]8;;https://github.com/o/r${ESC}\\${ESC}[38;2;137;180;250mr" "$(rp s10 '{"host":"github.com","owner":"o","name":"r"}' 40)"
  raw="$(rp s11 '{"host":"github.com","owner":"o","name":"r"}' 200 '.pr={"number":12,"url":"https://github.com/o/r/pull/12"}')"
  has "$t: beside the PR's link on the branch" "${ESC}]8;;https://github.com/o/r${ESC}\\" "$raw"
  has "$t: which stays" "${ESC}]8;;https://github.com/o/r/pull/12${ESC}\\" "$raw"
  has "$t: a dotted owner and name are fine" "${ESC}]8;;https://git.example.co/my-org.x/repo_1.js${ESC}\\" "$(rp s12 '{"host":"git.example.co","owner":"my-org.x","name":"repo_1.js"}')"
  n=13
  for r in '{"host":"evil.com/x","owner":"o","name":"r"}' '{"host":"a@b.com","owner":"o","name":"r"}' '{"owner":"o","name":"r"}' \
           '{"host":"github.com","name":"r"}' '{"host":"github.com","owner":"o w","name":"r"}' '{"host":"github.com","owner":"o","name":"r;x"}' \
           '{"host":"github.com","owner":"o","name":"r\u001b]8;;x"}' '{"host":"github.com","owner":"/o","name":"r"}' '{"host":"github.com","owner":"o","name":"r/"}' \
           '{"host":"github.com","owner":"o//p","name":"r"}' '{"host":"github.com","owner":"o","name":"r?x=1"}' '{"host":"github.com","owner":"o","name":"r#x"}' \
           '{"host":"github.com","owner":"jürgen","name":"r"}' '{"host":"gïthub.com","owner":"o","name":"r"}'; do
    raw="$(rp "s$n" "$r")"; n=$(( n + 1 ))
    hasnt "$t: no repo link for $r" "${ESC}]8;;" "$raw"
    has "$t: and the place still reads" "⎇ main" "$(printf '%s' "$raw" | pp)"
  done
  # the session's name is for sessions outside git: a repo row names the repo instead
  hasnt "$t: no session name in a repo's row" "statusline ideas" "$(gline s30 "$R" 200 '.session_name="statusline ideas"')"
  hasnt "$t: no file link in a repo's row" "file://" "$(pay ".workspace.current_dir=\"$R\" | .session_id=\"s30\"" | line 200 "$G")"

  # --- hostile and broken input ---
  for STYLE in chips flat; do
    out="$(printf 'not json' | line 200 | plain)"
    has "$t: $STYLE: broken JSON still prints a line" "claude" "$out"
    raw="$(pay '.model.display_name="Fa\u001b[31mble\nX" | .workspace.current_dir="/x/\u001b[2Jy"' | line 200)"
    expect "$t: $STYLE: control characters in the payload never reach the terminal" "0" "$(printf '%s' "$raw" | sed "s/${ESC}\\[[34]8;2;[0-9;]*m//g; s/${ESC}\\[0m//g; s/${ESC}\\[39m//g" | tr -cd '\033\n' | wc -c | tr -d ' ')"
    expect "$t: $STYLE: exit status" "0" "$(pay | line 200 >/dev/null; echo $?)"
  done
  unset STYLE
  expect "$t: chips: broken JSON is still well-formed chips" "$K $K $K $K" "$(printf 'not json' | line 200 | chips)"

  # --- nothing on stderr, even with unreadable state ---
  E="$TMP/estate"; mkdir -p "$E/bus/s1" "$E/git"; printf 'info\tx\n' > "$E/bus/s1/a"; printf '1\n' > "$E/.pruned"; printf '1\t1\t1\t1\t1\n' > "$TMP/unreadable.tsv"
  printf '1\t2\t3\t4\n' > "$E/bus/s1/.vitals"
  chmod 000 "$E/bus/s1/a" "$E/.pruned" "$TMP/unreadable.tsv" "$E/bus/s1/.vitals"
  err="$(pay | STATUSLINE_USAGE_CACHE="$TMP/unreadable.tsv" COLUMNS=200 STATUSLINE_NOW="$NOW" STATUSLINE_STATE_DIR="$E" HOME="$FAKEHOME" "$SH" "$SCRIPT" 2>&1 >/dev/null)"
  expect "$t: unreadable state prints nothing on stderr" "" "$err"
  err="$(pay | STATUSLINE_USAGE_CACHE="$TMP/nodir/x.tsv" COLUMNS=200 STATUSLINE_NOW="$NOW" STATUSLINE_STATE_DIR="$TMP/unreadable.tsv/state" HOME="$FAKEHOME" "$SH" "$SCRIPT" 2>&1 >/dev/null)"
  expect "$t: a state dir that cannot exist prints nothing on stderr" "" "$err"
  chmod 755 "$E/bus/s1"; chmod 000 "$E/bus/s1"
  err="$(pay | COLUMNS=200 STATUSLINE_NOW="$NOW" STATUSLINE_USAGE_CACHE="$CACHE" STATUSLINE_STATE_DIR="$E" HOME="$FAKEHOME" "$SH" "$SCRIPT" 2>&1 >/dev/null)"
  expect "$t: a bus dir that cannot be written prints nothing on stderr" "" "$err"
  chmod 755 "$E/bus/s1"
  chmod 644 "$E/bus/s1/a" "$E/.pruned" "$TMP/unreadable.tsv" "$E/bus/s1/.vitals" 2>/dev/null

  # --- the daily prune: files untouched for 3 days go, fresh ones and anything outside stay ---
  P="$TMP/pstate"; mkdir -p "$P/bus/old" "$P/bus/new" "$P/git" "$TMP/outside"
  : > "$P/bus/old/a"; : > "$P/git/oldsess"; : > "$P/bus/new/a"; : > "$P/git/newsess"; : > "$TMP/outside/keep"
  ln -s "$TMP/outside" "$P/bus/link"
  touch -t 202001010000 "$P/bus/old/a" "$P/bus/old" "$P/git/oldsess" "$TMP/outside/keep"
  REAL="$(date +%s)"
  pay | COLUMNS=200 STATUSLINE_NOW="$REAL" STATUSLINE_USAGE_CACHE="$CACHE" STATUSLINE_STATE_DIR="$P" HOME="$FAKEHOME" "$SH" "$SCRIPT" >/dev/null
  i=0; while [ "$i" -lt 60 ] && [ -e "$P/git/oldsess" ]; do sleep 0.05; i=$(( i + 1 )); done; sleep 0.1
  # (the run's own session, s1, now has a git cache and vitals: both fresh)
  expect "$t: prune removes old files and their empty dirs, keeps fresh ones and what a link points at" "new newsess keep" \
    "$(ls "$P/bus" | grep -v '^link$' | grep -v '^s1$' | tr '\n' ' ' | sed 's/ $//') $(ls "$P/git" | grep -v '^s1' | tr '\n' ' ' | sed 's/ $//') $(ls "$TMP/outside")"
  : > "$P/git/aged"; touch -t 202001010000 "$P/git/aged"
  pay | COLUMNS=200 STATUSLINE_NOW="$(( REAL + 100 ))" STATUSLINE_USAGE_CACHE="$CACHE" STATUSLINE_STATE_DIR="$P" HOME="$FAKEHOME" "$SH" "$SCRIPT" >/dev/null; sleep 0.3
  [ -e "$P/git/aged" ] && ok || bad "$t: the prune runs once a day, not on every run"
done

echo "statusline: $pass passed, $fail failed"
exit $((fail > 0))
