#!/usr/bin/env bash
# Regression suite for the agent panel rows (statusline/subagent-statusline.sh): one
# {"id","content"} line per subagent, the table's columns and their alignment, the model class
# and its color, the "now" column (a running agent's label, how a finished one ended), the
# trace, the token count, ages, how the table narrows (each boundary), that no row ever
# exceeds columns - 1 (wide characters included) and that the table does not stretch, and
# hostile input.
# By default it tests the copy in this repo; SUBAGENT_STATUSLINE_SCRIPT points
# the suite at a candidate before it is installed. Driven with fake input and a fixed clock
# (STATUSLINE_NOW) under both the Homebrew bash and the system bash 3.2. Exit non-zero on any
# failure.
SCRIPT="${SUBAGENT_STATUSLINE_SCRIPT:-$(cd "$(dirname "$0")/.." && pwd)/subagent-statusline.sh}"
export LC_ALL=en_US.UTF-8
pass=0; fail=0
ok()  { pass=$((pass+1)); }
bad() { fail=$((fail+1)); echo "FAIL [$1]${2:+ — $2}"; }
expect() { if [ "$2" = "$3" ]; then ok; else bad "$1" "want '$2', got '$3'"; fi; }
has()    { case "$3" in *"$2"*) ok ;; *) bad "$1" "want '$2' in '$3'" ;; esac; }
hasnt()  { case "$3" in *"$2"*) bad "$1" "did not want '$2' in '$3'" ;; *) ok ;; esac; }
ESC=$'\033'
NOW=2000000000
MAUVE="38;2;203;166;247"; SUB="38;2;166;173;200"; LAB="38;2;127;132;156"; VAL="38;2;186;194;222"
RED="38;2;243;139;168"; TRK="38;2;69;71;90"; LOW="38;2;108;112;134"
plain() { sed "s/${ESC}\\[[0-9;]*m//g"; }
# task <jq filter over the base task> -> one task object
TASK='{"id":"t1","type":"local_agent","agentType":"general-purpose","status":"running","description":"verify: the ladder","label":"verify: the ladder","startTime":1999999640000,"model":"claude-opus-5-5","contextWindowSize":1000000,"tokenCount":410000,"tokenSamples":[400000,400000,401000,410000],"cwd":"/w"}'
task() { printf '%s' "$TASK" | jq -c "${1:-.}"; }
# rows <columns> <task json>... -> the script's raw output
rows() { local c="$1"; shift; printf '%s\n' "$@" | jq -c -s --argjson c "$c" '{session_id:"s1",cwd:"/w",columns:$c,tasks:.}' | STATUSLINE_NOW="$NOW" "$SH" "$SCRIPT"; }
# body <columns> <task json> -> the first row's content, raw
body() { rows "$@" | head -n 1 | jq -r '.content'; }
# widths: the visible width of every row's content, space separated
widths() { jq -r '.content' | python3 -c 'import re,sys,unicodedata; print(" ".join(str(sum(2 if unicodedata.east_asian_width(c) in "WF" else 1 for c in re.sub("\x1b\\[[0-9;]*m", "", l.rstrip("\n")))) for l in sys.stdin))'; }

sp() { printf '%*s' "$1" ''; }   # that many spaces
D30='.description="verify: ladder at thirty cells"|.label="verify: ladder at thirty cells"'   # a 30-cell description

for SH in "$(command -v bash)" /bin/bash; do
  t="bash$("$SH" -c 'echo ${BASH_VERSINFO[0]}')"
  N30="verify: ladder at thirty cells"

  # --- one line per task, in order, each a JSON object with the task's id ---
  out="$(rows 144 "$(task)" "$(task '.id="t2"')" "$(task '.id="t3"')")"
  expect "$t: one line per task" "3" "$(printf '%s\n' "$out" | wc -l | tr -d ' ')"
  expect "$t: ids in order" "t1 t2 t3" "$(printf '%s\n' "$out" | jq -r '.id' | tr '\n' ' ' | sed 's/ $//')"
  expect "$t: only id and content" "content,id" "$(printf '%s\n' "$out" | head -n 1 | jq -r 'keys | join(",")')"

  # --- the row: class, name, now, trace, age, tokens; two cells between columns, one before the tokens ---
  expect "$t: the row at 100 columns" "opus  verify: the ladder$(sp 50)  ▁▁▁▁▁▁▃▆   6m 410k" "$(body 100 "$(task)" | plain)"
  expect "$t: the live label has a column of its own" "opus  verify: the ladder  Reading statusline.sh$(sp 27)  ▁▁▁▁▁▁▃▆   6m 410k" "$(body 100 "$(task '.label="Reading statusline.sh"')" | plain)"
  r="$(body 100 "$(task '.label="Reading statusline.sh"')")"
  has "$t: the name is the brightest thing in the row" "${ESC}[${VAL}mverify: the ladder" "$r"
  has "$t: the label is quiet" "${ESC}[${LAB}mReading statusline.sh" "$r"
  has "$t: so are the age and the tokens" "${ESC}[${LAB}m 6m${ESC}[39m ${ESC}[${LAB}m410k" "$r"
  hasnt "$t: the agent type is not drawn" "Explore" "$(body 200 "$(task '.agentType="Explore"')" | plain)"
  hasnt "$t: nor a mark for a directory of its own" "wt" "$(body 200 "$(task '.cwd="/elsewhere"')" | plain)"
  # the names are one column as wide as the longest, so everything after them lines up
  out="$(rows 100 "$(task '.label="Reading a file"')" "$(task '.id="t2"|.description="find: callers"|.label="Running rg"|.tokenCount=950|.startTime=1999992500000')" | jq -r '.content' | plain)"
  expect "$t: two rows of one tick line up, column by column" "opus  verify: the ladder  Reading a file$(sp 34)  ▁▁▁▁▁▁▃▆   6m 410k
opus  find: callers       Running rg$(sp 38)  ▁▁▁▁▁▁▃▆   2h  950" "$out"
  expect "$t: the table does not stretch to a wide panel" "94" "$(rows 300 "$(task)" | widths)"
  expect "$t: an absurd columns is bounded" "94" "$(rows 100000000 "$(task)" | widths)"
  expect "$t: a name past 64 cells is cut there" "opus  $(printf 'x%.0s' 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36 37 38 39 40 41 42 43 44 45 46 47 48 49 50 51 52 53 54 55 56 57 58 59 60 61 62 63)…  ▁" \
    "$(body 200 "$(task '.description=("x" * 90)|.label=""')" | plain | sed 's/  *▁.*/  ▁/')"

  # --- how the table narrows: one running row, a 30-cell name, tokens 4 cells, age 2 ---
  lab() { task "$D30|.label=\"Reading a file\""; }
  expect "$t: 91 columns: the now column has 32 cells beside the eight-step trace" "opus  $N30  Reading a file$(sp 18)  ▁▁▁▁▁▁▃▆   6m 410k" "$(body 91 "$(lab)" | plain)"
  expect "$t: 90: the trace gives way first, a step at a time" "opus  $N30  Reading a file$(sp 18)  ▁▁▁▁▁▃▆   6m 410k" "$(body 90 "$(lab)" | plain)"
  expect "$t: 87: down to four steps, the now column still 32" "opus  $N30  Reading a file$(sp 18)  ▁▁▃▆   6m 410k" "$(body 87 "$(lab)" | plain)"
  expect "$t: 86: then no trace, the label kept" "opus  $N30  Reading a file$(sp 23)   6m 410k" "$(body 86 "$(lab)" | plain)"
  expect "$t: 77: down to 28 cells of now" "opus  $N30  Reading a file$(sp 14)   6m 410k" "$(body 77 "$(lab)" | plain)"
  expect "$t: 76: the now column goes, and the name stands with the full trace" "opus  $N30  ▁▁▁▁▁▁▃▆   6m 410k" "$(body 76 "$(lab)" | plain)"
  expect "$t: 57: still" "opus  $N30  ▁▁▁▁▁▁▃▆   6m 410k" "$(body 57 "$(lab)" | plain)"
  expect "$t: 56: seven steps" "opus  $N30  ▁▁▁▁▁▃▆   6m 410k" "$(body 56 "$(lab)" | plain)"
  expect "$t: 53: four" "opus  $N30  ▁▁▃▆   6m 410k" "$(body 53 "$(lab)" | plain)"
  expect "$t: 52: no trace" "opus  $N30   6m 410k" "$(body 52 "$(lab)" | plain)"
  expect "$t: 47: still the name whole, age and tokens" "opus  $N30   6m 410k" "$(body 47 "$(lab)" | plain)"
  expect "$t: 46: the age alone" "opus  $N30   6m" "$(body 46 "$(lab)" | plain)"
  expect "$t: 42: the name still whole" "opus  $N30   6m" "$(body 42 "$(lab)" | plain)"
  expect "$t: 41: the name is cut before the age goes" "opus  verify: ladder at thirty cel…   6m" "$(body 41 "$(lab)" | plain)"
  expect "$t: 36: down to 24 cells of name" "opus  verify: ladder at thirt…   6m" "$(body 36 "$(lab)" | plain)"
  expect "$t: 35: the name alone" "opus  verify: ladder at thirty ce…" "$(body 35 "$(lab)" | plain)"
  expect "$t: a label longer than its column is cut there, and moves nothing" "opus  $N30  a label far too long to fit bes…  ▁▁▁▁▁▁▃▆   6m 410k" \
    "$(body 91 "$(task "$D30|.label=\"a label far too long to fit beside the description\"")" | plain)"
  expect "$t: a label that repeats the name is not drawn" "opus  $N30$(sp 34)  ▁▁▁▁▁▁▃▆   6m 410k" "$(body 91 "$(task "$D30")" | plain)"
  # a name past 56 cells gives up what the labels need: with one 70-cell name at 113 columns the now column still has 32
  out="$(rows 113 "$(task '.description=("n" * 70)|.label="Checking UI.Badge word field one"')" "$(task '.id="t2"|.label="Running rg over the hooks tree xx"')" | jq -r '.content' | plain)"
  has "$t: a 70-cell name is cut so that a 32-cell label stays whole" "…  Checking UI.Badge word field one  " "$out"
  has "$t: on every row" "  Running rg over the hooks tree…  " "$out"
  has "$t: a 55-cell name is never cut for a label" "$(printf 'n%.0s' 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36 37 38 39 40 41 42 43 44 45 46 47 48 49 50 51 52 53 54 55)  Checking" \
    "$(body 113 "$(task '.description=("n" * 55)|.label="Checking UI.Badge word field"')" | plain)"
  # ordinary punctuation is one cell: a curly quote or a dash in a label moves nothing
  expect "$t: a label with a curly quote, a dash and an arrow keeps the row's width" "$(rows 113 "$(task '.label="Checking the users config - a to b"')" | widths)" \
    "$(rows 113 "$(task '.label="Checking the user’s config — a → b"')" | widths)"
  expect "$t: so does an accented name" "$(rows 113 "$(task '.description="fix: cafe menu rows"|.label="Reading"')" | widths)" "$(rows 113 "$(task '.description="fix: café menu rows"|.label="Reading"')" | widths)"
  expect "$t: a short name keeps its age in a narrow panel" "opus  probe: nineteen cel   6m" "$(body 35 "$(task '.description="probe: nineteen cel"|.label="Reading"')" | plain)"
  expect "$t: the now column is 48 cells at most" "opus  $N30  $(printf 'y%.0s' 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36 37 38 39 40 41 42 43 44 45 46 47)…  ▁▁▁▁▁▁▃▆   6m 410k" \
    "$(body 200 "$(task "$D30|.label=(\"y\" * 80)")" | plain)"

  # --- bounds: no row is ever wider than columns - 1; full rows end at the same cell ---
  all=("$(task)" "$(task '.id="t2"|.label="Running the width harness under bash 3.2 and collecting every failure for the report"')"
       "$(task '.id="t3"|.cwd="/elsewhere"|.agentType="Explore"')" "$(task '.id="t4"|.status="completed"')"
       "$(task '.id="t5"|.status="failed"|.model="claude-haiku-5-5"')" "$(task '.id="t6"|del(.model)|del(.contextWindowSize)|del(.tokenSamples)|del(.startTime)')"
       "$(task '.id="t7"|.model="claude-fable-5-2"|.description="x"|.label=""')"
       "$(task '.id="t8"|.description="a description that is rather long for a narrow panel, as some are"')")
  wrong=""; ragged=""
  c=20; while [ "$c" -le 200 ]; do
    w="$(rows "$c" "${all[@]}" | widths)"
    for x in $w; do [ "$x" -le "$(( c - 1 ))" ] || wrong="${wrong} ${c}:${x}"; done
    set -- $w; [ "$1" = "$2" ] && [ "$1" = "$4" ] || { [ "$c" -lt 40 ] || ragged="${ragged} ${c}:${1}/${2}/${4}"; }
    c=$(( c + 1 ))
  done
  expect "$t: no row is wider than columns - 1 at any width from 20 to 200" "" "$wrong"
  expect "$t: running and finished rows end at the same cell at every width from 40" "" "$ragged"
  expect "$t: a width under 20 is drawn as 20" "19" "$(rows 5 "$(task '.description="a name longer than nineteen cells"')" | widths)"
  expect "$t: no columns is drawn as 20" "19" "$(printf '%s' "{\"tasks\":[$(task '.description="a name longer than nineteen cells"')]}" | STATUSLINE_NOW="$NOW" "$SH" "$SCRIPT" | widths)"
  expect "$t: no trailing spaces" "" "$(rows 120 "${all[@]}" | jq -r '.content' | plain | grep ' $')"

  # --- the model class: quiet, but for the one the status line colors too ---
  for pair in "claude-fable-5-2:fable:$MAUVE" "claude-mythos-5-2:mythos:$MAUVE" "claude-opus-5-5:opus:$LAB" "claude-sonnet-5-5:sonnet:$LAB" \
              "claude-haiku-5-5:haiku:$LAB" "us.anthropic.claude-opus-5-5-v1:opus:$LAB" "claude-nova-1:nova-1:$LAB"; do
    m="${pair%%:*}"; rest="${pair#*:}"; k="${rest%%:*}"; col="${rest#*:}"
    has "$t: $m reads $k in its color" "${ESC}[${col}m${k}" "$(body 100 "$(task ".model=\"$m\"")")"
  done
  has "$t: an unresolved model reads …" "${ESC}[${LAB}m…" "$(body 100 "$(task 'del(.model)')")"
  expect "$t: and holds four cells, so nothing moves when the model resolves" "…     verify: the ladder$(sp 50)  ▁▁▁▁▁▁▃▆   6m 410k" "$(body 100 "$(task 'del(.model)')" | plain)"
  out="$(rows 100 "$(task)" "$(task '.id="t2"|.model="claude-sonnet-5-5"')" | jq -r '.content' | plain)"
  has "$t: the class column is as wide as the longest class" "opus    verify" "$out"; has "$t: and holds it" "sonnet  verify" "$out"

  # --- the tokens: the engine's running count, never a share of the window ---
  hasnt "$t: no percent is drawn from the count" "%" "$(body 100 "$(task '.tokenCount=900000')" | plain)"
  has "$t: thousands" " 6m 126k" "$(body 100 "$(task '.tokenCount=126999')" | plain)"
  has "$t: millions" " 6m 1.2M" "$(body 100 "$(task '.tokenCount=1249000')" | plain)"
  has "$t: whole millions drop the .0" " 6m   2M" "$(body 100 "$(task '.tokenCount=2000000')" | plain)"
  has "$t: under a thousand" " 6m  950" "$(body 100 "$(task '.tokenCount=950')" | plain)"
  has "$t: ten million and up in whole millions: four cells at most" " 6m  12M" "$(body 100 "$(task '.tokenCount=12345678')" | plain)"
  has "$t: a hundred million and up" " 6m 250M" "$(body 100 "$(task '.tokenCount=250400000')" | plain)"
  expect "$t: an absurd count still fits the row" "ok" "$([ "$(rows 100 "$(task '.tokenCount=1e30')" | widths)" -le 99 ] && echo ok)"
  expect "$t: no count before the first answer: the row ends at its age" "6m" "$(body 100 "$(task '.tokenCount=0')" | plain | grep -o '..$')"
  expect "$t: a negative count is no count" "6m" "$(body 100 "$(task '.tokenCount=-5')" | plain | grep -o '..$')"

  # --- the trace: the last steps, each by how much it grew ---
  tr_of() { body 100 "$(task ".tokenSamples=$1")" | plain | grep -o '[▁▂▃▄▅▆▇█]\{8\}'; }
  expect "$t: any growth has a shape: two eighths under 1k, one more per doubling, 16k and up alike" "▁▂▃▄▅▆▇▇" "$(tr_of '[0,0,500,1500,3500,7500,15500,31500,63500]')"
  expect "$t: one token is growth too" "▁▁▁▁▁▁▁▂" "$(tr_of '[5,5,6]')"
  expect "$t: no cell is ever full height" "▁▁▁▁▁▁▁▇" "$(tr_of '[0,0,0,0,0,0,0,0,64000000]')"
  expect "$t: only the last eight steps" "▁▁▁▁▁▁▁▃" "$(tr_of '[0,90000,90000,90000,90000,90000,90000,90000,90000,90000,91000]')"
  expect "$t: fewer steps are padded on the left" "▁▁▁▁▁▁▃▆" "$(tr_of '[400000,400000,401000,410000]')"
  expect "$t: a falling count (a compaction) is a quiet step" "▁▁▁▁▁▁▁▃" "$(tr_of '[500000,100000,101000]')"
  raw="$(body 100 "$(task '.tokenSamples=[5,5,5,2005]')")"
  has "$t: a step that grew is lit, a tone under the text" "${ESC}[38;2;147;153;178m▄" "$raw"; has "$t: a step that did not is the track" "${ESC}[${TRK}m▁" "$raw"
  has "$t: a five-step trace is the last five steps" "  ▄▅▆▇▇  " "$(body 88 "$(task "$D30|.tokenSamples=[0,0,500,1500,3500,7500,15500,31500,63500]")" | plain)"
  has "$t: no samples yet: the track alone" "  ▁▁▁▁▁▁▁▁   6m 410k" "$(body 100 "$(task '.tokenSamples=[]')" | plain)"
  has "$t: samples that are not a list: a blank slot, the row still aligned" "$(sp 13)6m 410k" "$(body 100 "$(task '.tokenSamples="x"')" | plain)"

  # --- age ---
  has "$t: seconds" "  40s 410k" "$(body 100 "$(task '.startTime=1999999960000')" | plain)"
  has "$t: minutes" "  59m 410k" "$(body 100 "$(task '.startTime=1999996460000')" | plain)"
  has "$t: hours, and nothing finer" "   2h 410k" "$(body 100 "$(task '.startTime=1999992500000')" | plain)"
  has "$t: a start in the future reads 0s" "   0s 410k" "$(body 100 "$(task '.startTime=2000000900000')" | plain)"
  has "$t: a start at the epoch reads 99d" "  99d 410k" "$(body 100 "$(task '.startTime=0')" | plain)"
  has "$t: a hundred hours and up read in days" "   4d 410k" "$(body 100 "$(task '.startTime=1999640000000')" | plain)"
  out="$(rows 100 "$(task '.startTime=1999999995000|.tokenCount=900')" "$(task '.id="t2"')" | jq -r '.content' | plain)"
  expect "$t: the age and token columns keep their width whatever is in them" "opus  verify: the ladder$(sp 50)  ▁▁▁▁▁▁▃▆   5s  900
opus  verify: the ladder$(sp 50)  ▁▁▁▁▁▁▃▆   6m 410k" "$out"
  has "$t: no start time: no age column" "▁▁▁▁▁▁▃▆ 410k" "$(body 100 "$(task 'del(.startTime)')" | plain)"

  # --- finished agents: how it ended, in the now column, a tone dimmer, nothing stale ---
  r="$(body 100 "$(task '.status="completed"|.label="Composing the final report"')")"
  expect "$t: nothing running: the table closes up to name, ending, tokens" "opus  verify: the ladder  done 410k" "$(printf '%s' "$r" | plain)"
  has "$t: its name is a tone dimmer" "${ESC}[${LOW}mverify: the ladder" "$r"
  has "$t: so is its class, whatever it is" "${ESC}[${LOW}mfable" "$(body 100 "$(task '.status="completed"|.model="claude-fable-5-2"')")"
  has "$t: and its tokens" "${ESC}[${LOW}m410k" "$r"
  hasnt "$t: its last label is not drawn" "Composing" "$r"
  has "$t: failed reads so, in red" "${ESC}[${RED}mfailed" "$(body 100 "$(task '.status="failed"')")"
  has "$t: killed reads stopped" "  stopped 410k" "$(body 100 "$(task '.status="killed"')" | plain)"
  has "$t: another status is shown as it is" "  paused 410k" "$(body 100 "$(task '.status="paused"')" | plain)"
  out="$(rows 100 "$(task '.label="Reading a file"')" "$(task '.id="t2"|.status="completed"')" | jq -r '.content' | plain)"
  expect "$t: a finished row beside a running one keeps the columns and the right edge" "opus  verify: the ladder  Reading a file$(sp 34)  ▁▁▁▁▁▁▃▆   6m 410k
opus  verify: the ladder  done$(sp 44)$(sp 15) 410k" "$out"
  out="$(rows 113 "$(task '.status="completed"|.tokenCount=212000')" "$(task '.id="t2"|.status="failed"|.tokenCount=731000')" "$(task '.id="t3"|.status="killed"|.tokenCount=1249000')" "$(task '.id="t4"|.status="failed"|.tokenCount=0')" | jq -r '.content' | plain)"
  expect "$t: nothing running: the endings are one column as wide as the longest, the counts right after" "opus  verify: the ladder  done    212k
opus  verify: the ladder  failed  731k
opus  verify: the ladder  stopped 1.2M
opus  verify: the ladder  failed" "$out"
  out="$(rows 113 "$(task '.label="Reading"')" "$(task '.id="t2"|.status="failed"|.tokenCount=0')" | jq -r '.content')"
  expect "$t: a finished row with no count beside a running one ends at its last word" "opus  verify: the ladder  failed" "$(printf '%s\n' "$out" | sed -n 2p | plain)"
  # with no now column the ending takes the age's place
  expect "$t: narrow: a finished agent says how it ended where the age is" "opus  $N30  done 410k" "$(body 60 "$(task "$D30|.status=\"completed\"")" | plain)"
  expect "$t: narrower: and still does" "opus  $N30  done" "$(body 46 "$(task "$D30|.status=\"completed\"")" | plain)"
  has "$t: narrow: failed is red there" "${ESC}[${RED}mfailed" "$(body 60 "$(task "$D30|.status=\"failed\"")")"
  out="$(rows 60 "$(task "$D30")" "$(task "$D30|.id=\"t2\"|.status=\"failed\"")" | jq -r '.content' | plain)"
  expect "$t: narrow: ages and endings share one column" "opus  $N30  ▁▁▁▁▁▁▃▆      6m 410k
opus  $N30$(sp 10)  failed 410k" "$out"

  # --- hostile and malformed input ---
  r="$(body 100 "$(task '.description="a\u001b[31mb\u0007c‮d​e\nf"|.label="l\u001b]8;;http://x\u0007"')")"
  expect "$t: no escape or control character survives but the row's own colors" "" \
    "$(printf '%s' "$r" | plain | LC_ALL=C tr -d '\040-\176' | python3 -c 'import sys; s=sys.stdin.buffer.read().decode("utf-8","replace"); print("".join(c for c in s if c not in "·…▁▂▃▄▅▆▇█"))')"
  hasnt "$t: no OSC survives" "${ESC}]" "$r"
  expect "$t: a hostile status is cleaned and cut" "ok" "$([ "$(rows 100 "$(task '.status="x\u001b[2Jyyyyyyyyyyyyyyyyyyyy"')" | widths)" -le 99 ] && echo ok)"
  hasnt "$t: and carries no escape" "${ESC}[2J" "$(body 100 "$(task '.status="x\u001b[2Jyyyyyyyyyyyyyyyyyyyy"')")"
  expect "$t: a task without an id is skipped" "t2" "$(rows 100 "$(task 'del(.id)')" "$(task '.id="t2"')" | jq -r '.id' | tr '\n' ' ' | sed 's/ $//')"
  expect "$t: wrong types are survived" "t1" "$(rows 100 "$(task '.tokenCount="many"|.contextWindowSize=null|.tokenSamples="x"|.startTime="soon"|.model=5|.description=null|.label={}|.agentType=7|.status=3')" | jq -r '.id')"
  expect "$t: no tasks, no output" "" "$(printf '{"columns":100}' | "$SH" "$SCRIPT")"
  expect "$t: tasks that is not a list, no output" "" "$(printf '{"columns":100,"tasks":"x"}' | "$SH" "$SCRIPT" 2>&1)"
  expect "$t: input that is not JSON prints nothing, not even an error" "" "$(printf 'garbage' | "$SH" "$SCRIPT" 2>&1)"
  expect "$t: empty input prints nothing" "" "$(printf '' | "$SH" "$SCRIPT" 2>&1)"
  # wide characters: counted as two cells each, so the row is never wider than columns - 1
  wrong=""
  for c in 24 30 44 60 80 100 113 144; do
    for x in $(rows "$c" "$(task '.description="日本語の説明文です。エージェントの仕事を確認する"')" "$(task '.id="t2"|.label="🔍 find payload fields 🚀🚀🚀"')" \
               "$(task '.id="t3"|.label="調査員エージェント型式番号一二三四五六七八九十調査員エージェント"')" "$(task '.id="t4"|.status="完了しました完了しました"')" | widths); do
      [ "$x" -le "$(( c - 1 ))" ] || wrong="${wrong} ${c}:${x}"
    done
  done
  expect "$t: wide characters never push a row past columns - 1" "" "$wrong"
  expect "$t: a huge label costs nothing: it is bounded before it is cleaned" "t1" "$(rows 100 "$(task ".label=(\"a\\n\" * 40000)")" | jq -r '.id')"
  many=(); for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36 37 38 39 40; do many+=("$(task ".id=\"t$i\"")"); done
  expect "$t: every line is valid JSON for 40 rows" "40" "$(rows 144 "${many[@]}" | jq -c 'select(.id and .content)' | wc -l | tr -d ' ')"
done

echo "subagent-statusline: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
