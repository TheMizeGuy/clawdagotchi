#!/usr/bin/env bash
# Claude Code agent panel rows (the subagentStatusLine command in ~/.claude/settings.json): the
# body of each subagent's row under the prompt, as one aligned table in the status line's
# palette.
#
#   opus   fix: double-click commits on guided try press  done                                            496k
#   fable  design: the cache-switch rule                  Reading statusline.sh             ▁▁▆▁▁▅▁▄   6m 410k
#   opus   find: payload fields the script never reads    Running rg over the hooks tree    ▁▁▁▁▁▁▁▁  12m 126k
#
# Columns (the engine draws its own mark before the body, gives the usable width as "columns"
# and cuts anything past it):
#   class   the model class the agent runs on, from its resolved model id. Quiet, except
#           fable (and mythos) in mauve, the hue the status line gives the model; "…" until
#           the model is resolved
#   name    the description, the agent's stable name and the brightest thing in a running
#           row: one column as wide as the longest one (64 cells at most), so the names and
#           everything after them line up
#   now     what a running agent is doing, the engine's live progress label; for a finished
#           one how it ended (done, failed in red, stopped), and nothing stale after that
#   trace   a running agent's last steps of token count (the engine samples it every five
#           seconds). A step that grew is two to seven eighths tall, by how much, on a
#           doubling scale from 1k; a step that did not is the low track cell, so a flat
#           track is an agent that produced nothing for that long. Eight steps where there
#           is room, down to four
#   age     time since a running agent started, in one unit (45s, 12m, 3h)
#   tokens  the engine's running count for the agent: its last request's input plus all it
#           has written so far; nothing until the first answer. Not its context in use (the
#           count never falls and passes the window on a long agent), so no share of the
#           window is drawn from it. The last column, so every row with a count ends at the
#           same cell
# A finished row is one tone dimmer throughout: the running agents are what the eye lands on.
#
# Nothing moves between ticks: the layout follows the names and the width, never the labels;
# the age is three cells and the count four whatever they hold; the class is four cells at
# least. It changes when an agent joins or the last running one ends.
#
# How wide. The engine's labels run to about thirty cells, so beside running agents the "now"
# column gets 32 cells before anything else and up to 48, and the table stops there: it does
# not stretch to the edge. As the panel narrows the trace gives way to the labels, from eight
# steps down to four, then goes; a name past 56 cells gives up what the labels still need;
# under 28 cells the "now" column goes, and the names stand alone with as much of the trace,
# the age and the tokens as fit beside them, the age column then also saying how a finished
# agent ended; the trace goes first, then the tokens, and the age only when it would leave a
# name under 24 cells cut. With nothing running there is no label, trace or age to make room
# for, and the table closes up: name, ending, tokens.
#
# Width is counted in cells: one for the ranges that hold no wide character (ordinary text,
# punctuation, arrows), two for everything else, the widest it can be, so a row never
# exceeds columns - 1.
#
# One jq run and no other process: the engine runs this every five seconds while agents are
# shown, with every visible row in one JSON object on stdin, and reads one {"id","content"}
# line per row. A row this does not print keeps the engine's own rendering, so any failure
# falls back to the default rows. Test seam: STATUSLINE_NOW (clock, epoch seconds).
PROG='
def E: "\u001b[";
def fg($c): E + "38;2;" + $c + "m";
def R: E + "39m";
def VAL: "186;194;222"; def LIT: "147;153;178"; def LAB: "127;132;156"; def LOW: "108;112;134"; def TRK: "69;71;90";
def MAUVE: "203;166;247"; def RED: "243;139;168";
def clean: if . == null then "" else tostring | .[0:300] | gsub("[\\p{Cc}\\p{Cf}\\p{Co}\\p{Zl}\\p{Zp}]"; " ") | gsub(" +"; " ") | sub("^ "; "") | sub(" $"; "") end;
# one cell for the ranges that hold no wide character (Latin, Greek, Cyrillic and their kin, punctuation,
# arrows, math, box and block drawing), two for everything else: never too few, and exact for ordinary text
def cw: if . < 4352 or (. >= 7680 and . < 8960) or (. >= 9472 and . < 9632) then 1 else 2 end;
def wd: [explode[] | cw] | add // 0;
def fit($n): if $n <= 0 then "" elif wd <= $n then . elif $n == 1 then "…"
  else (reduce explode[] as $c ({o: [], w: 0, full: false};
          if .full then . else ($c | cw) as $x
          | if .w + $x > $n - 1 then .full = true else .o += [$c] | .w += $x end end) | .o | implode | sub(" +$"; "")) + "…" end;
def lpad($n): wd as $w | if $w >= $n then . else (" " * ($n - $w)) + . end;
def rpad($n): wd as $w | if $w >= $n then . else . + (" " * ($n - $w)) end;
def num: if type == "number" then . else 0 end;
def kfmt: if . >= 10000000 then ([. / 1000000 | floor, 999] | min | tostring) + "M"
          elif . >= 1000000 then ((. / 100000 | floor) / 10 | tostring | sub("\\.0$"; "")) + "M"
          elif . >= 1000 then (. / 1000 | floor | tostring) + "k" else (. | floor | tostring) end;
def age: if . < 60 then "\(. | floor)s" elif . < 3600 then "\(. / 60 | floor)m"
         elif . < 360000 then "\(. / 3600 | floor)h" else "\([. / 86400 | floor, 99] | min)d" end;
def klass: (.model // "" | tostring | ascii_downcase) as $m
  | if $m == "" then "…" elif ($m | test("fable")) then "fable" elif ($m | test("mythos")) then "mythos"
    elif ($m | test("opus")) then "opus" elif ($m | test("sonnet")) then "sonnet" elif ($m | test("haiku")) then "haiku"
    else ($m | sub("^claude-"; "") | gsub("[^a-z0-9.-]"; "") | .[0:6] | if . == "" then "…" else . end) end;
def kcol: if . == "fable" or . == "mythos" then MAUVE else LAB end;
# A step that grew is two to seven eighths tall (under 1k, then one more per doubling, 16k and up
# alike), so work reads as a shape and not only as a tone; a step that did not is the low track
# cell. No cell is full height: it would touch the row above.
def bars: ["▂", "▃", "▄", "▅", "▆", "▇"];
def trace($n): [.[] | num] as $s
  | [range(1; $s | length) | $s[.] - $s[. - 1]] | .[-$n:]
  | (fg(TRK) + ("▁" * ($n - length)))
    + (map(if . < 1 then fg(TRK) + "▁"
           else fg(LIT) + bars[(if . < 1000 then 0 else ([(. / 1000 | log2 | floor) + 1, 5] | min) end)] end) | join(""))
    + R;

(($now | tonumber?) // now) as $t
| 2 as $G                                                         # between columns; one cell between the age and the tokens
| (.columns | num | if . < 20 then 20 elif . > 1000 then 1000 else . end) as $cols
| [ .tasks[]? | select(type == "object" and (.id | type) == "string")
    | (.status // "running" | tostring) as $st
    | (.description | clean) as $desc | (.label | clean) as $lab
    | { id, run: ($st == "running"), bad: ($st == "failed"), k: klass, desc: $desc,
        lab: (if $lab == $desc then "" else $lab end),
        tk: (.tokenCount | num | if . < 1 then "" else kfmt end),
        age: (if $st == "running" and (.startTime | type) == "number" then ([$t - .startTime / 1000, 0] | max | age) else "" end),
        end: (if $st == "running" then "" elif $st == "completed" then "done" elif $st == "failed" then "failed"
              elif $st == "killed" then "stopped" else ($st | clean | fit(7)) end),
        samples: (.tokenSamples | if type == "array" then . else null end) } ] as $rows
| ($cols - 1) as $W
| ([$rows[] | .k | length] + [4] | max) as $kw                    # never under four cells: nothing moves when a model resolves
| ([$rows[] | .desc | wd] | max // 0 | if . > 64 then 64 else . end) as $dmax
# an age is three cells at most and a count four, and their columns are always that wide, so
# nothing shifts when an agent passes ten minutes or a hundred thousand tokens
| 4 as $tokw
| (if any($rows[]; .age != "") then 3 else 0 end) as $agw         # the ages alone
| ([$rows[] | (.end | wd), (if .age != "" then 3 else 0 end)] | max // 0) as $aew   # ages and endings in one column
| ([$rows[] | select(.run)] | length > 0) as $live
| ([$rows[] | .end | wd] | max // 0) as $endw
# after the text come a trace of $n steps, a column of $a cells (age, or age and ending) and the tokens
| def tail($n; $a; $tok): (if $n > 0 then $G + $n else 0 end) + (if $a > 0 then $G + $a else 0 end) + (if $tok then 1 + $tokw else 0 end);
  # a trace is four to eight steps: what is left of $spare cells after its gutter, or none
  def steps($spare): if $live and $spare - $G >= 4 then ([$spare - $G, 8] | min) else 0 end;
  ($W - $kw - $G) as $room
# beside a "now" column a name past 56 cells gives up what the labels need to stay whole
| (if $live then ([$dmax, ([56, $room - $G - 32 - tail(0; $agw; true)] | max)] | min) else $dmax end) as $dnow
| ($room - $dnow - $G - tail(0; $agw; true)) as $wide             # cells a "now" column and a trace would share
| ($room - $dmax - tail(0; $aew; true)) as $bare                  # cells left for a trace beside the names alone
| ( if steps($wide - 32) > 0 then steps($wide - 32) as $n | {now: ([$wide - $G - $n, 48] | min), n: $n, tok: true, last: $agw}
    elif $live and $wide >= 28 then {now: ([$wide, 48] | min), n: 0, tok: true, last: $agw}
    # nothing is running: no label, trace or age can come, so the column is as wide as the endings
    elif ($live | not) and $endw > 0 and $wide >= $endw then {now: $endw, n: 0, tok: true, last: 0}
    elif $bare >= 0 then {now: 0, n: steps($bare), tok: true, last: $aew}
    elif $room - tail(0; $aew; false) >= ([$dmax, 24] | min) then {now: 0, n: 0, tok: false, last: $aew}
    else {now: 0, n: 0, tok: false, last: 0} end ) as $m
| (if $m.now > 0 then $dnow else ([$dmax, $room - tail($m.n; $m.last; $m.tok)] | min) end) as $dw
| $rows[]
| (if .run then LAB else LOW end) as $dim
| (if $m.now > 0 then .age else (if .run then .age else .end end) end) as $lastv
| { id: .id,
    content: ((
      fg(if .run then (.k | kcol) else LOW end) + (.k | rpad($kw)) + R + (" " * $G)
      + fg(if .run then VAL else LOW end) + (.desc | fit($dw) | rpad($dw)) + R
      + (if $m.now > 0 then (" " * $G) + fg(if .bad then RED else $dim end) + ((if .run then .lab else .end end) | fit($m.now) | rpad($m.now)) + R else "" end)
      + (if $m.n > 0 then (" " * $G) + (if .run and .samples != null then (.samples | trace($m.n)) else " " * $m.n end) else "" end)
      + (if $m.last > 0 then (" " * $G) + fg(if .bad and $m.now == 0 then RED else $dim end) + ($lastv | lpad($m.last)) + R else "" end)
      + (if $m.tok and .tk != "" then " " + fg($dim) + (.tk | lpad($tokw)) + R else "" end)
    ) | sub("(?<t>( |\u001b\\[[0-9;]*m)*)$"; .t | gsub(" "; ""))) }
'
if command -v jq >/dev/null 2>&1; then exec jq -c --arg now "${STATUSLINE_NOW:-}" "$PROG" 2>/dev/null; fi
exec /usr/bin/jq -c --arg now "${STATUSLINE_NOW:-}" "$PROG" 2>/dev/null
