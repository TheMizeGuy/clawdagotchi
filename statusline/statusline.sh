#!/usr/bin/env bash
# Claude Code status line (the statusLine command in ~/.claude/settings.json). One row, always.
#
#   (✻ Fable 5.1 xhigh) (ctx ▬▬▬▬▬▬▬▬▬▬ 52% 523k/1M · cache 42m) (5h 43% ↻2h39m · 7d 57%↗ ↻6d8h · alt 11% 26%) (Limerino ⎇ main *3 ↑2) (agents 7/40) ($12/5h · $44)
#
# Two looks. STATUSLINE_STYLE picks one (chips or flat); unset, chips in Ghostty, flat elsewhere.
#   chips  each group is a rounded chip, drawn above as ( ): the caps U+E0B6 and U+E0B4 (Ghostty
#          draws both itself) in the chip's ground color, the content on that ground (#262637),
#          one space between chips. A bus warning or failure gets a chip of its own tint. The
#          branch glyph is U+E0A0, drawn above as ⎇. The ✻ in Claude orange is the row's left
#          bookend; mize-coworker's Claude at the right end is the other one.
#   flat   for terminals that do not draw the caps: groups split by │ rails, no private-use glyph
#          (the branch glyph is left out); the same gauge, ✻ and size suffix.
#
# Groups, left to right (pieces drop by priority when COLUMNS is short; nothing ever wraps):
#   model    ✻, model name and reasoning effort, plus a red flag only when something is
#            off-nominal (fast mode on, thinking off), an --agent name, a non-default output style
#   ctx      context window: a ten-cell gauge whose filled cells run a gradient that warms as the
#            window fills (blue to mauve; lavender to peach from 70%; yellow to red from 90%), the
#            cell the fill ends in blended into the track as far as it is filled; the percent;
#            the window size (1M), or used/size (523k/1M) where there is room
#   cache    prompt cache: minutes until the cached prefix goes cold (quiet), a warning in the
#            last ten minutes, or "cold" with what the next prompt re-caches; for ten minutes
#            after a miss with a cause on this side (tools changed, system prompt changed), why
#   5h, 7d   Max-plan usage windows. Judged by PACE, not by the bare percent: the projection at
#            the reset if the window keeps its average burn. ↗ marks a window on pace to run
#            dry before it resets (yellow; peach from 90% used; red once spent). ↻<eta> is
#            when the window resets. The 5h one is the owner's priority (2026-10-03): in a
#            short row it outlives every other detail, the context gauge included
#   alt      the other Max account's 5h and 7d use, from the shared cache (which account has room)
#   where    repo, branch (an OSC 8 link to the open PR), dirty count, ahead/behind; a path
#            outside git
#   bus      segments mods publish for this session (one file per mod: "agents 7/40"); a mod
#            drawing at the row's right end (mize-coworker's Claude) reserves its cells here too
#   cost     the session's notional list price, and the part of it that fell in the current 5h
#            window ("$12/5h"): which tab is burning the window
#
# Color carries state: everything is neutral until it needs attention, then yellow (watch),
# peach (over pace) or red (act now). The model (mauve), the place (blue), the gauge's gradient
# and the ✻ (Claude orange) are the only standing hues. Every glyph is one cell wide. Ghostty
# draws the caps itself and bundles Nerd Font symbols for the branch glyph; the rest come from
# the terminal font or its fallback.
#
# The script also leaves the session's vitals for mize-coworker, which makes its Claude react
# to them: <state>/bus/<session id>/.vitals, one line "<context %>\t<5h>\t<7d>\t<cache>" (a
# window calm, watch, over or crit; the cache warm or cold; empty when unknown), rewritten only
# when it changes.
#
# Payload fields per code.claude.com/docs/en/statusline (v2.1.287). The script is bash 3.2
# compatible and forks only jq (once) and git (cached per session, refreshed in the
# background): keep it that way, it runs on every assistant message and on the refresh timer
# in every open session.
#
# Test seams: STATUSLINE_NOW (clock), STATUSLINE_USAGE_CACHE (usage cache file),
# STATUSLINE_STATE_DIR (git cache, bus, vitals, window spend, prune marker), COLUMNS (width),
# STATUSLINE_STYLE (look). Suites: statusline/tests/test-statusline.sh and
# statusline/tests/test-statusline-usage-cache.sh (scripts/check-all.sh runs both).
set -o pipefail
export LC_ALL=en_US.UTF-8 2>/dev/null   # ${#var} must count characters, not bytes

input="$(cat)"
jq_bin="$(command -v jq || echo /usr/bin/jq)"
now="${STATUSLINE_NOW:-${EPOCHSECONDS:-$(date +%s)}}"
case "$now" in ''|*[!0-9]*) now="$(date +%s)" ;; esac
STATE="${STATUSLINE_STATE_DIR:-$HOME/.claude/state/statusline}"
cols="${COLUMNS:-0}"; case "$cols" in ''|*[!0-9]*) cols=0 ;; esac

# --- payload ---------------------------------------------------------------------------------
# One jq run; fields joined by the unit separator, which (unlike a tab) is not IFS whitespace,
# so an empty field stays a field instead of collapsing into its neighbor.
US=$'\037'
IFS="$US" read -r model dir project pct tin win f5pct f5reset f7pct f7reset effort thinking fast \
  style agent sid cwarm cexp crecache cttl cmissat cmisscause cost_c wt_name repo_name pr_url _ <<<"$(
  printf '%s' "$input" | "$jq_bin" -r '
    def s: if . == null then "" else tostring | gsub("[[:cntrl:]]"; " ") end;
    [ (.model.display_name // .model.id // "claude"),
      (.workspace.current_dir // .cwd),
      .workspace.project_dir,
      (.context_window.used_percentage | if . == null then null else floor end),
      (.context_window.total_input_tokens // 0),
      (.context_window.context_window_size // 0),
      .rate_limits.five_hour.used_percentage,
      .rate_limits.five_hour.resets_at,
      .rate_limits.seven_day.used_percentage,
      .rate_limits.seven_day.resets_at,
      .effort.level,
      .thinking.enabled,
      .fast_mode,
      .output_style.name,
      .agent.name,
      .session_id,
      .prompt_cache.warm,
      (.prompt_cache.expires_at | if . == null then null else floor end),
      .prompt_cache.recache_tokens_if_cold,
      .prompt_cache.ttl,
      (.prompt_cache.last_miss_at | if . == null then null else floor end),
      (.prompt_cache.last_miss_cause.causes[0]? // null),
      (.cost.total_cost_usd | if . == null then null else (. * 100 | round) end),
      .workspace.git_worktree,
      .workspace.repo.name,
      .pr.url,
      "end"
    ] | map(s) | join("\u001f")' 2>/dev/null
)"
[ -n "$model" ] || model="claude"
[ -n "$dir" ] || dir="$PWD"
int() { case "$1" in ''|*[!0-9]*) R="${2-0}" ;; *) R="$1" ;; esac; }    # digits, or the default (which may be empty)
case "$sid" in *[!A-Za-z0-9_-]*) sid="" ;; esac                          # it names files below

# --- shared usage cache (2026-07-08; one row per account since 2026-10-02) -------------------
# The payload's rate_limits reflect THIS session's last API response: idle tabs freeze at stale
# values and the tabs disagree. Usage is ACCOUNT-level, so the freshest sample any session ON
# THE SAME ACCOUNT has seen is the truth for all of them. The payload names no account, but
# each account's seven-day window has its own reset time, so that timestamp is the row's key.
# Within a row writes are monotonic-guarded: accept a later five-hour reset (a real rollover),
# higher usage in the same window, or any sample from the same window once the row is >300s
# stale; never a sample from an older window, so an idle tab re-rendering old numbers can
# never clobber fresh ones. Pair with settings statusLine.refreshInterval.
# Rows: key f5pct f5reset f7pct f7reset epoch ("-" for an absent value). Rows untouched for 8
# days are dropped. The rows of the OTHER accounts feed the alt segment.
CACHE="${STATUSLINE_USAGE_CACHE:-$HOME/.claude/state/usage-cache.tsv}"
key="${f7reset%%.*}"; case "$key" in ''|*[!0-9]*) key="" ;; esac
others=""; mine=""; newest=""; newest_ts=0; newest_key=""
if [ -f "$CACHE" ]; then
  while IFS=$'\t' read -r k a b c d ts; do
    case "$ts" in ''|*[!0-9]*) continue ;; esac            # the old one-row format, or junk
    [ $(( now - ts )) -gt 691200 ] && continue
    row="${a}"$'\t'"${b}"$'\t'"${c}"$'\t'"${d}"$'\t'"${ts}"
    if [ -n "$key" ] && [ "$k" = "$key" ]; then mine="$row"; else others="${others}${k}"$'\t'"${row}"$'\n'; fi
    if [ "$ts" -gt "$newest_ts" ]; then newest_ts="$ts"; newest="$row"; newest_key="$k"; fi
  done 2>/dev/null < "$CACHE"
fi
if [ -n "$f5pct" ] && [ -n "$key" ]; then
  c5=""; c5r=""; c7=""; cts=0
  [ -n "$mine" ] && IFS=$'\t' read -r c5 c5r c7 _ cts <<<"$mine"
  p5r="${f5reset%%.*}"; case "$p5r" in ''|*[!0-9]*) p5r=0 ;; esac
  o5r="${c5r%%.*}"; case "$o5r" in ''|*[!0-9]*) o5r=0 ;; esac
  take=0
  if [ -z "$c5" ] || [ "$p5r" -gt "$o5r" ]; then take=1
  elif [ "$p5r" -lt "$o5r" ]; then take=0
  elif [ $(( now - ${cts:-0} )) -gt 300 ] \
       || [ "${f5pct%%.*}" -gt "${c5%%.*}" 2>/dev/null ] \
       || [ "${f7pct%%.*}" -gt "${c7%%.*}" 2>/dev/null ]; then take=1
  fi
  if [ "$take" -eq 1 ]; then
    mine="${f5pct}"$'\t'"${f5reset:--}"$'\t'"${f7pct:--}"$'\t'"${f7reset}"$'\t'"${now}"
    newest="$mine"; newest_key="$key"
    tmp="${CACHE}.$$"
    { printf '%s' "$others"; printf '%s\t%s\n' "$key" "$mine"; } 2>/dev/null > "$tmp" && mv -f "$tmp" "$CACHE" 2>/dev/null
  fi
fi
# Render from this account's row whenever it's fresher than a minute and a half: the newest
# sample any tab on the account has seen (covers idle tabs). A payload with no rate_limits
# block names no account, so it shows the newest row.
use="$mine"; usekey="$key"
[ -n "$key" ] || { use="$newest"; usekey="$newest_key"; }
if [ -n "$use" ]; then
  IFS=$'\t' read -r c5 c5r c7 c7r cts <<<"$use"
  if [ -n "${c5:-}" ] && [ $(( now - ${cts:-0} )) -lt 90 ]; then
    f5pct="$c5"; f5reset="$c5r"; f7pct="$c7"; f7reset="$c7r"
    [ "$f5reset" = "-" ] && f5reset=""
    [ "$f7pct" = "-" ] && f7pct=""
  fi
fi

# --- palette (Catppuccin Mocha, truecolor: what the Claude Code theme and Ghostty use) --------
# Explicit colors only: SGR faint and bold render muddy or heavy.
e=$'\033'; rz="${e}[0m"
c_val="${e}[38;2;186;194;222m"    # numbers and names in their quiet state (subtext1)
c_sub="${e}[38;2;166;173;200m"    # secondary names: branch, effort, info bus (subtext0)
c_lab="${e}[38;2;127;132;156m"    # labels: ctx, 5h, 7d, alt, cache, the branch glyph (overlay1)
c_low="${e}[38;2;108;112;134m"    # countdowns and other third-rank text (overlay0)
c_rail="${e}[38;2;69;71;90m"      # rails, and the gauge's track (surface1)
c_mauve="${e}[38;2;203;166;247m"; c_blue="${e}[38;2;137;180;250m"; c_lav="${e}[38;2;180;190;254m"
c_yellow="${e}[38;2;249;226;175m"; c_peach="${e}[38;2;250;179;135m"; c_red="${e}[38;2;243;139;168m"
c_claude="${e}[38;2;217;119;87m"  # the ✻
K_CHIP="38;39;55"; K_WARN="58;51;36"; K_FAIL="61;37;48"   # chip grounds: any group, a bus warning, a failure
CL=$'\xee\x82\xb6'; CR=$'\xee\x82\xb4'   # a chip's left and right caps (U+E0B6, U+E0B4)
BRG=$'\xee\x82\xa0'                     # the branch glyph (U+E0A0)
# The look: chips in Ghostty unless STATUSLINE_STYLE says otherwise, flat anywhere else.
look="${STATUSLINE_STYLE:-}"
case "$look" in
  chips|flat) ;;
  *) case "${TERM_PROGRAM:-}" in [Gg][Hh][Oo][Ss][Tt][Tt][Yy]) look=chips ;; *) look=flat ;; esac ;;
esac
if [ "$look" = chips ]; then
  # Inside a chip a colored run ends by restoring the foreground alone, so the ground stays.
  rst="${e}[39m"
  c_low="$c_lab"                  # nothing on a chip's ground is darker than its labels
  c_dot="${e}[38;2;88;91;112m"    # the · between pieces (surface2)
  CAPW=2; GAPW=1                  # a chip's two caps; the space between chips
else
  rst="$rz"; c_dot="$c_rail"; BRG=""
  CAPW=0; GAPW=3                  # " │ " between groups
fi
SEPW=3   # " · " between the pieces of one group
# state: calm | watch | over | crit  ->  R = its color
scol() { case "$1" in crit) R="$c_red" ;; over) R="$c_peach" ;; watch) R="$c_yellow" ;; *) R="$c_val" ;; esac; }

# --- humanize (results in R: no subshells on the hot path) ------------------------------------
fmtk() { # tokens -> 950, 147k, 1M, 1.2M
  local n=$1
  if [ "$n" -ge 1000000 ]; then
    local t=$(( (n + 50000) / 100000 )); R="$(( t / 10 ))"; [ $(( t % 10 )) -ne 0 ] && R="${R}.$(( t % 10 ))"; R="${R}M"
  elif [ "$n" -ge 1000 ]; then R="$(( n / 1000 ))k"
  else R="$n"; fi
}
eta() { # seconds -> 6d8h, 3h1m, 24m, <1m
  local s=$1 d h m; d=$(( s / 86400 )); h=$(( (s % 86400) / 3600 )); m=$(( (s % 3600) / 60 ))
  if   [ "$d" -gt 0 ]; then R="${d}d"; [ "$h" -gt 0 ] && R="${R}${h}h"
  elif [ "$h" -gt 0 ]; then R="${h}h"; [ "$m" -gt 0 ] && R="${R}${m}m"
  elif [ "$m" -gt 0 ]; then R="${m}m"
  else R="<1m"; fi
}
gauge() { # pct, any (1: some tokens in use) -> R: ten ▬ cells, colored
  # The filled cells run a gradient over three stops picked by how full the window is; the
  # cell the fill ends in is its gradient color blended into the track's as far as the cell
  # is filled (a quarter at least, so any use, even under 1%, lights a faint first cell).
  # Fixed point: t is the position along the two gradient legs in thousandths.
  local p=$1 any=$2 i=0 lit full q t k f r g b w
  local r0 g0 b0 r1 g1 b1 r2 g2 b2
  if [ "$p" -ge 90 ]; then r0=249 g0=226 b0=175 r1=250 g1=179 b1=135 r2=243 g2=139 b2=168   # yellow peach red
  elif [ "$p" -ge 70 ]; then r0=180 g0=190 b0=254 r1=249 g1=226 b1=175 r2=250 g2=179 b2=135 # lavender yellow peach
  else r0=137 g0=180 b0=250 r1=180 g1=190 b1=254 r2=203 g2=166 b2=247; fi                     # blue lavender mauve
  [ "$p" -gt 100 ] && p=100
  full=$(( p / 10 )); q=$(( p % 10 ))
  [ "$p" -eq 0 ] && [ "$any" -eq 1 ] && q=1
  lit=$full; [ "$q" -gt 0 ] && lit=$(( full + 1 ))
  R=""
  while [ "$i" -lt "$lit" ]; do
    t=$(( i * 2000 / 9 )); k=$(( t / 1000 )); [ "$k" -gt 1 ] && k=1; f=$(( t - k * 1000 ))
    if [ "$k" -eq 0 ]; then
      r=$(( (r0 * (1000 - f) + r1 * f + 500) / 1000 )); g=$(( (g0 * (1000 - f) + g1 * f + 500) / 1000 )); b=$(( (b0 * (1000 - f) + b1 * f + 500) / 1000 ))
    else
      r=$(( (r1 * (1000 - f) + r2 * f + 500) / 1000 )); g=$(( (g1 * (1000 - f) + g2 * f + 500) / 1000 )); b=$(( (b1 * (1000 - f) + b2 * f + 500) / 1000 ))
    fi
    if [ "$i" -eq "$full" ]; then   # the partial cell, blended into the track (69;71;90)
      w=$(( q * 100 )); [ "$w" -lt 250 ] && w=250
      r=$(( (69 * (1000 - w) + r * w + 500) / 1000 )); g=$(( (71 * (1000 - w) + g * w + 500) / 1000 )); b=$(( (90 * (1000 - w) + b * w + 500) / 1000 ))
    fi
    R="${R}${e}[38;2;${r};${g};${b}m▬"; i=$(( i + 1 ))
  done
  if [ "$i" -lt 10 ]; then
    R="${R}${c_rail}"
    while [ "$i" -lt 10 ]; do R="${R}▬"; i=$(( i + 1 )); done
  fi
  R="${R}${rst}"
}

# --- segments ----------------------------------------------------------------------------------
# seg <id> <level> <plain> <colored>: one rendering of a segment. Level 0 is hidden; the layout
# pass lowers levels until the line fits. LV_<id> holds the level in use.
# Width is counted in cells. ASCII and the script's own glyphs are one cell each; any other
# character (a CJK or emoji directory, branch or bus text) is counted as two, the widest it can
# be, so the estimate can only err toward a shorter line. A chip's caps and the spaces and rails
# between groups are not part of a segment: the layout pass counts them.
seg() {
  local x="${3//[[:ascii:]]/}" g   # the class, not a range: bash 3.2 collates [ -~] by locale
  for g in ▬ ✻ ↻ · … ▲ ✗ ↗ ↑ ↓ $BRG; do x="${x//$g/}"; done   # one by one: bash 3.2 has no multibyte bracket sets
  printf -v "P_$1_$2" '%s' "$(( ${#3} + ${#x} ))"; printf -v "T_$1_$2" '%s' "$4"; printf -v "LV_$1" '%s' "$2"
}

# model: name, effort, and only the flags that are off-nominal. Levels: 1 the name (and flags),
# 2 with the effort, 3 with the ✻ before it, 4 with the agent and output style.
int "$pct" ""; pct="$R"
model="${model:0:28}"
m_p="$model"; m_c="${c_mauve}${model}${rst}"
f_p=""; f_c=""
[ "$fast" = "true" ] && { f_p="${f_p} fast"; f_c="${f_c} ${c_red}fast${rst}"; }
[ "$thinking" = "false" ] && { f_p="${f_p} no-think"; f_c="${f_c} ${c_red}no-think${rst}"; }
seg model 1 "${m_p}${f_p}" "${m_c}${f_c}"
mf_p="$f_p"; mf_c="$f_c"   # kept for the last-resort cut in the layout (the bus reuses f_p, f_c)
if [ -n "$effort" ]; then
  ecol="$c_lab"; [ "$effort" = "max" ] && ecol="$c_val"
  m_p="${m_p} ${effort:0:8}"; m_c="${m_c} ${ecol}${effort:0:8}${rst}"
  seg model 2 "${m_p}${f_p}" "${m_c}${f_c}"
fi
m_p="✻ ${m_p}${f_p}"; m_c="${c_claude}✻${rst} ${m_c}${f_c}"
seg model 3 "$m_p" "$m_c"
x_p=""; x_c=""
[ -n "$agent" ] && { x_p="${x_p} @${agent:0:20}"; x_c="${x_c} ${c_lav}@${agent:0:20}${rst}"; }
[ -n "$style" ] && [ "$style" != "default" ] && { x_p="${x_p} ${style:0:16}"; x_c="${x_c} ${c_lab}${style:0:16}${rst}"; }
[ -n "$x_p" ] && seg model 4 "${m_p}${x_p}" "${m_c}${x_c}"

# ctx: gauge, percent, then the window's size, or used/size. The gauge comes before the percent
# so a percent growing a digit moves nothing. Levels: 1 the percent, 2 with the gauge, 3 with
# the size, 4 with used/size.
LV_ctx=0
int "$tin" 0; tin="$R"; int "$win" 0; win="$R"
sz_p=""; sz_c=""; us_p=""; us_c=""
if [ "$win" -gt 0 ]; then
  fmtk "$win"; sz="$R"; sz_p=" ${sz}"; sz_c=" ${c_low}${sz}${rst}"
  [ "$tin" -gt 0 ] && { fmtk "$tin"; us_p=" ${R}/${sz}"; us_c=" ${c_low}${R}/${sz}${rst}"; }
elif [ "$tin" -gt 0 ]; then
  fmtk "$tin"; us_p=" ${R}"; us_c=" ${c_low}${R}${rst}"
fi
if [ -n "$pct" ]; then
  [ "$pct" -gt 100 ] && pct=100
  if [ "$pct" -ge 85 ]; then cc="$c_red"; elif [ "$pct" -ge 70 ]; then cc="$c_yellow"; else cc="$c_val"; fi
  any=0; [ "$tin" -gt 0 ] && any=1
  gauge "$pct" "$any"; v_p="${pct}%"; v_c="${cc}${pct}%${rst}"
else
  gauge 0 0; v_p="--"; v_c="${c_low}--${rst}"   # a fresh or just-compacted session: the track alone, never a made-up 0%
fi
gauge_c="$R"
seg ctx 1 "ctx ${v_p}" "${c_lab}ctx${rst} ${v_c}"
seg ctx 2 "ctx ▬▬▬▬▬▬▬▬▬▬ ${v_p}" "${c_lab}ctx${rst} ${gauge_c} ${v_c}"
[ -n "$sz_p" ] && seg ctx 3 "ctx ▬▬▬▬▬▬▬▬▬▬ ${v_p}${sz_p}" "${c_lab}ctx${rst} ${gauge_c} ${v_c}${sz_c}"
[ -n "$us_p" ] && seg ctx 4 "ctx ▬▬▬▬▬▬▬▬▬▬ ${v_p}${us_p}" "${c_lab}ctx${rst} ${gauge_c} ${v_c}${us_c}"

# cache: how long the cached prefix stays warm, or what a cold one costs. Loud only when the
# re-cache is big enough to matter (100k tokens and up). For ten minutes after a miss whose
# cause is on this side (a mod reload that changed the tools, a changed system prompt) it says
# why; a server-side miss or an expired TTL is not news.
LV_cache=0; cache_urgent=0; cstate=""   # cstate: warm, cold or unknown (empty), for the vitals
int "$cexp" ""; cexp="$R"; int "$crecache" 0; crecache="$R"; int "$cmissat" 0; cmissat="$R"
miss=""
if [ "$cmissat" -gt 0 ] && [ "$cmissat" -le "$now" ] && [ $(( now - cmissat )) -lt 600 ]; then
  case "$cmisscause" in
    ''|likely_server_side|ttl_expired*) ;;
    *) miss="${cmisscause//_/ }"; miss="${miss//[^a-z0-9 ]/}"; miss="${miss:0:22}"; [ -n "$miss" ] && miss="miss: ${miss}" ;;
  esac
fi
if [ "$cwarm" = "true" ] && [ -n "$cexp" ] && [ "$cexp" -gt "$now" ]; then
  cstate=warm; left=$(( cexp - now )); eta "$left"; ce="$R"
  if [ "$left" -le 600 ] && [ "$cttl" != "5m" ] && [ "$crecache" -ge 100000 ]; then
    cache_urgent=1; cw_c="${c_lab}cache${rst} ${c_yellow}${ce}${rst}"
  else
    cw_c="${c_lab}cache${rst} ${c_low}${ce}${rst}"
  fi
  seg cache 1 "cache ${ce}" "$cw_c"
  if [ -n "$miss" ]; then
    cache_urgent=1; seg cache 2 "cache ${ce} ${miss}" "${cw_c} ${c_yellow}${miss}${rst}"
  fi
elif [ -n "$cwarm" ] && [ "$crecache" -ge 100000 ]; then
  cstate=cold; fmtk "$crecache"
  if [ "$crecache" -ge 500000 ]; then ccol="$c_peach"; cache_urgent=1
  elif [ "$crecache" -ge 200000 ]; then ccol="$c_yellow"; cache_urgent=1
  else ccol="$c_sub"; fi
  seg cache 1 "cache cold" "${c_lab}cache${rst} ${ccol}cold${rst}"
  seg cache 2 "cache cold ${R}" "${c_lab}cache${rst} ${ccol}cold ${R}${rst}"
elif [ "$cwarm" = "false" ] || { [ "$cwarm" = "true" ] && [ -n "$cexp" ]; }; then
  cstate=cold; seg cache 1 "cache cold" "${c_lab}cache${rst} ${c_low}cold${rst}"
fi

# 5h / 7d: use against the share of the window already gone.
#   P    = used / elapsed share: the percent the window reaches at its reset at the average burn
#   out  = seconds until 100% at that burn
# The pace is judged once <min elapsed> of the window has passed (30 minutes; a full day of the
# week, so one sleep is averaged in) or half of it is used; before that a burst extrapolates
# to nonsense. A window merely on pace to end near its cap stays calm, so the line does not
# blink around P = 100. States: watch (on pace to run dry before the reset: P >= 110, or any
# shortfall once 75% is used), over (that from 90% used), crit (spent). Every state above
# calm carries a ↗ beside the percent, a second cue beside the color.
# plan <id> <label> <pct> <resets_at> <window seconds> <min elapsed>
plan() {
  local id=$1 label=$2 p=$3 r=$4 W=$5 minel=$6 pint rem=0 el=0 P=0 out="" state=calm judged=0
  local t_rst_p="" t_rst_c="" mark_p="" mark_c="" col
  printf -v "LV_$id" '%s' 0; printf -v "ST_$id" '%s' calm
  [ -n "$p" ] || return 0
  pint=${p%%.*}; int "$pint" 0; pint="$R"
  r=${r%%.*}; int "$r" ""; r="$R"
  if [ -n "$r" ] && [ "$r" -gt "$now" ]; then
    rem=$(( r - now )); [ "$rem" -gt "$W" ] && rem=$W; el=$(( W - rem ))
    if [ "$el" -gt 0 ] && [ "$pint" -gt 0 ]; then
      { [ "$el" -ge "$minel" ] || [ "$pint" -ge 50 ]; } && judged=1
      P=$(( pint * W / el )); out=$(( el * (100 - pint) / pint ))
    fi
  fi
  if [ "$pint" -ge 100 ]; then state=crit
  elif [ "$judged" -eq 1 ] && [ "$out" -lt "$rem" ] && { [ "$P" -ge 110 ] || [ "$pint" -ge 75 ]; }; then
    state=watch; [ "$pint" -ge 90 ] && state=over
  elif [ "$pint" -ge 90 ]; then state=over
  fi
  scol "$state"; col="$R"
  [ "$state" != "calm" ] && [ "$pint" -lt 100 ] && { mark_p="↗"; mark_c="${col}↗${rst}"; }
  if [ "$rem" -gt 0 ]; then eta "$rem"; t_rst_p=" ↻${R}"; t_rst_c=" ${c_low}↻${R}${rst}"; fi
  seg "$id" 1 "${label} ${pint}%${mark_p}" "${c_lab}${label}${rst} ${col}${pint}%${rst}${mark_c}"
  [ -n "$t_rst_p" ] && seg "$id" 2 "${label} ${pint}%${mark_p}${t_rst_p}" "${c_lab}${label}${rst} ${col}${pint}%${rst}${mark_c}${t_rst_c}"
  printf -v "ST_$id" '%s' "$state"
}
plan h5 5h "$f5pct" "$f5reset" 18000 1800
plan d7 7d "$f7pct" "$f7reset" 604800 86400
hot=0; [ "${ST_h5}${ST_d7}" = "calmcalm" ] || hot=1   # a window on pace to run dry: the other account matters

# alt: the freshest other account whose seven-day window is still the one sampled. Its 5h
# number is 0 once that window's reset has passed; a sample over an hour old says how old.
LV_alt=0
if [ -n "$others" ] && [ -n "$key" ]; then   # only when this session's own account is known
  best_ts=0; b5=""; b5r=""; b7=""
  while IFS=$'\t' read -r k a b c d ts; do
    [ -n "$k" ] || continue
    [ "$k" = "$usekey" ] && continue
    case "$k" in *[!0-9]*) continue ;; esac
    [ "$k" -gt "$now" ] || continue                          # that week rolled over: numbers unknown
    [ "$ts" -gt "$best_ts" ] && { best_ts="$ts"; b5="$a"; b5r="$b"; b7="$c"; }
  done <<<"$others"
  if [ "$best_ts" -gt 0 ]; then
    a5=${b5%%.*}; int "$a5" 0; a5="$R"; a7=${b7%%.*}; int "$a7" 0; a7="$R"
    b5r=${b5r%%.*}; int "$b5r" 0; [ "$R" -gt 0 ] && [ "$R" -le "$now" ] && a5=0   # its 5h window has reset since
    age=$(( now - best_ts )); acol="$c_sub"; [ "$age" -ge 3600 ] && acol="$c_low"
    seg alt 1 "alt ${a5}% ${a7}%" "${c_lab}alt${rst} ${acol}${a5}% ${a7}%${rst}"
    if [ "$age" -ge 3600 ]; then
      eta "$age"; seg alt 2 "alt ${a5}% ${a7}% ${R} ago" "${c_lab}alt${rst} ${acol}${a5}% ${a7}% ${R} ago${rst}"
    fi
  fi
fi

# where: repo, branch, *dirty ↑ahead ↓behind, or a path outside git.
# git never holds the line. A session's first run (or a change of directory) asks only
# `git rev-parse` in the foreground, which answers at once with the repo and the branch; the
# full `git status` runs in the background and its counts show on the next run. After that the
# cached answer is rendered and refreshed in the background once it is GIT_TTL seconds old.
# One refresh per session at a time: a claim file (created with noclobber) marks a probe in
# flight, so a slow or hung git never piles up processes; a claim over a minute old is a
# probe that died with its run and is taken over.
# Cache file <state>/git/<session id>: epoch (0: counts not probed yet), directory, then
# root<US>common-dir<US>git-dir<US>branch<US>dirty<US>ahead<US>behind (empty outside git).
GIT_TTL=5
git_quick() { # dir -> the cache line with zero counts, from one rev-parse
  local d=$1 root="" common="" gdir="" branch=""
  { IFS= read -r root; IFS= read -r common; IFS= read -r gdir; IFS= read -r branch; } <<<"$(git -C "$d" rev-parse --path-format=absolute --show-toplevel --git-common-dir --git-dir --abbrev-ref HEAD 2>/dev/null)"
  [ -n "$root" ] || return 0
  [ "$branch" = "HEAD" ] && branch=""              # detached or unborn: the full probe names it
  branch="${branch//[^[:print:]]/}"
  printf '%s\037%s\037%s\037%s\0370\0370\0370\n' "$root" "$common" "$gdir" "$branch"
}
git_probe() { # dir -> the cache line, counts included (rev-parse + status)
  local d=$1 root="" common="" gdir="" branch="" oid="" ab_a=0 ab_b=0 dirty=0 line
  { IFS= read -r root; IFS= read -r common; IFS= read -r gdir; } <<<"$(git -C "$d" rev-parse --path-format=absolute --show-toplevel --git-common-dir --git-dir 2>/dev/null)"
  [ -n "$root" ] || return 0
  while IFS= read -r line; do
    case "$line" in
      "# branch.oid "*) oid="${line#\# branch.oid }" ;;
      "# branch.head "*) branch="${line#\# branch.head }" ;;
      "# branch.ab "*) line="${line#\# branch.ab +}"; ab_a="${line%% *}"; ab_b="${line##*-}" ;;
      "#"*) ;;
      ?*) dirty=$(( dirty + 1 )) ;;
    esac
  done <<<"$(git -C "$d" --no-optional-locks status --porcelain=v2 --branch 2>/dev/null)"
  [ "$branch" = "(detached)" ] && branch="@${oid:0:7}"
  branch="${branch//[^[:print:]]/}"
  printf '%s\037%s\037%s\037%s\037%s\037%s\037%s\n' "$root" "$common" "$gdir" "$branch" "$dirty" "$ab_a" "$ab_b"
}
git_refresh() { # start the background probe unless one is in flight
  local c=0
  if ! ( set -C; printf '%s\n' "$now" 2>/dev/null > "$gfile.lock" ) 2>/dev/null; then
    IFS= read -r c 2>/dev/null < "$gfile.lock"; int "$c" 0; c="$R"
    [ "$c" -le "$now" ] && [ $(( now - c )) -lt 60 ] && return 0
    printf '%s\n' "$now" 2>/dev/null > "$gfile.lock" || return 0
  fi
  ( l="$(git_probe "$dir")"
    t="$now"; [ -n "${STATUSLINE_NOW:-}" ] || t="${EPOCHSECONDS:-$(date +%s)}"   # stamped when it lands
    printf '%s\n%s\n%s\n' "$t" "$dir" "$l" 2>/dev/null > "$gfile.$$" && mv -f "$gfile.$$" "$gfile" 2>/dev/null
    rm -f "$gfile.lock" 2>/dev/null ) >/dev/null 2>&1 &
}
g_root=""; g_common=""; g_gitdir=""; g_branch=""; g_dirty=0; g_ahead=0; g_behind=0
gfile=""; [ -n "$sid" ] && gfile="$STATE/git/$sid"
g_line=""; g_dir=""; g_ts=0
if [ -n "$gfile" ] && [ -f "$gfile" ]; then
  { IFS= read -r g_ts; IFS= read -r g_dir; IFS= read -r g_line; } 2>/dev/null < "$gfile"
  int "$g_ts" 0; g_ts="$R"
  if [ -n "$g_line" ]; then
    seps="${g_line//[^$US]/}"
    [ "${#seps}" -eq 6 ] || { g_line=""; g_dir=""; }   # another version's layout: probe again
  fi
fi
if [ -z "$gfile" ]; then
  g_line="$(git_probe "$dir")"                     # no session id: nothing to cache under
elif [ "$g_dir" != "$dir" ]; then
  g_line="$(git_quick "$dir")"
  mkdir -p "$STATE/git" 2>/dev/null
  g_ts=0; [ -n "$g_line" ] || g_ts="$now"          # outside git there are no counts to wait for
  printf '%s\n%s\n%s\n' "$g_ts" "$dir" "$g_line" 2>/dev/null > "$gfile.$$" && mv -f "$gfile.$$" "$gfile" 2>/dev/null
  [ -n "$g_line" ] && git_refresh
else
  ttl="$GIT_TTL"; [ -n "$g_line" ] || ttl=60       # a directory outside git is asked again once a minute
  if [ "$g_ts" -gt "$now" ] || [ $(( now - g_ts )) -ge "$ttl" ]; then git_refresh; fi
fi
[ -n "$g_line" ] && IFS="$US" read -r g_root g_common g_gitdir g_branch g_dirty g_ahead g_behind <<<"$g_line"
int "$g_dirty" 0; g_dirty="$R"; int "$g_ahead" 0; g_ahead="$R"; int "$g_behind" 0; g_behind="$R"

short_path() { # absolute path -> ~/a/b, middle-elided past 32 cells
  local p=$1 rest="${1#$HOME}"
  case "$p" in "$HOME") p="~" ;; "$HOME"/*) p="~${rest}" ;; esac
  if [ "${#p}" -gt 32 ]; then
    local tail="${p##*/}" head="${p%/*}"; head="${head##*/}"
    local q="…/${head}/${tail}"; [ "${#q}" -gt 32 ] && q="…/${tail:0:29}"
    p="$q"
  fi
  R="$p"
}
link_a=""; link_z=""   # the open PR, as an OSC 8 link on the branch (the footer shows the PR badge itself)
case "$pr_url" in https://*) case "$pr_url" in *[!A-Za-z0-9:/._~%#?=\&+-]*) ;; *) link_a="${e}]8;;${pr_url}${e}\\"; link_z="${e}]8;;${e}\\" ;; esac ;; esac
LV_loc=0
if [ -n "$g_root" ]; then
  # A linked worktree is a checkout whose git dir is not the common dir (a submodule's git dir
  # IS its common dir, under the superproject's .git/modules).
  linked=0; [ -n "$g_gitdir" ] && [ "$g_gitdir" != "$g_common" ] && linked=1
  name="$repo_name"
  if [ -z "$name" ]; then
    if [ "$linked" -eq 1 ]; then
      case "$g_common" in */.git) name="${g_common%/.git}"; name="${name##*/}" ;; *) name="${g_common##*/}"; name="${name%.git}" ;; esac
    else name="${g_root##*/}"; fi
  fi
  [ -n "$name" ] || name="${g_root##*/}"
  name="${name//[^[:print:]]/}"; name="${name:0:24}"
  sub=""; case "$dir" in "$g_root"/*) sub=/${dir#"$g_root"/} ;; esac
  [ "${#sub}" -gt 24 ] && sub="/…/${sub##*/}"; sub="${sub//[^[:print:]]/}"; sub="${sub:0:28}"
  # Name the worktree unless the branch already says it: the same name once punctuation is
  # dropped (integration-362 on integration/362), the branch's last path part
  # (login-flow on feature/login-flow), or Claude Code's own worktree-<name> branch.
  wt=""; wt_tag=""
  if [ "$linked" -eq 1 ]; then
    w="${wt_name:-${g_root##*/}}"; w="${w//[^[:print:]]/}"
    wn="${w//[^A-Za-z0-9]/}"; bn="${g_branch//[^A-Za-z0-9]/}"; tn="${g_branch##*/}"; tn="${tn//[^A-Za-z0-9]/}"
    if [ -n "$wn" ] && { [ "$bn" = "$wn" ] || [ "$tn" = "$wn" ] || [ "$bn" = "worktree${wn}" ]; }; then wt_tag=" wt"
    else wt="/${w:0:24}"; fi
  fi
  br="$g_branch"; br_s="$br"; [ "${#br_s}" -gt 24 ] && br_s="${br_s:0:23}…"
  n_p="${name}${wt}"; n_c="${c_blue}${name}${c_lab}${wt}${rst}"
  b_p=""; b_c=""; bs_p=""; bs_c=""
  if [ -n "$br" ]; then
    gl_p=" "; gl_c=" "; [ -n "$BRG" ] && { gl_p=" ${BRG} "; gl_c=" ${c_lab}${BRG}${rst} "; }   # chips: the branch glyph
    b_p="${gl_p}${br}"; b_c="${gl_c}${link_a}${c_sub}${br}${rst}${link_z}"
    bs_p="${gl_p}${br_s}"; bs_c="${gl_c}${link_a}${c_sub}${br_s}${rst}${link_z}"
  fi
  x_p="$wt_tag"; x_c=""; [ -n "$wt_tag" ] && x_c=" ${c_low}wt${rst}"
  [ "$g_dirty" -gt 0 ] && { x_p="${x_p} *${g_dirty}"; x_c="${x_c} ${c_val}*${g_dirty}${rst}"; }
  [ "$g_ahead" -gt 0 ] && { x_p="${x_p} ↑${g_ahead}"; x_c="${x_c} ${c_val}↑${g_ahead}${rst}"; }
  [ "$g_behind" -gt 0 ] && { x_p="${x_p} ↓${g_behind}"; x_c="${x_c} ${c_val}↓${g_behind}${rst}"; }
  seg loc 1 "$name" "${c_blue}${name}${rst}"
  seg loc 2 "${n_p}${bs_p}" "${n_c}${bs_c}"
  seg loc 3 "${n_p}${bs_p}${x_p}" "${n_c}${bs_c}${x_c}"
  seg loc 4 "${name}${wt}${sub}${b_p}${x_p}" "${c_blue}${name}${c_lab}${wt}${sub}${rst}${b_c}${x_c}"
else
  short_path "$dir"; lp="$R"; base="${dir##*/}"; base="${base:0:32}"
  [ -n "$base" ] || base="/"
  seg loc 1 "$base" "${c_blue}${base}${rst}"
  seg loc 2 "$lp" "${c_blue}${lp}${rst}"
fi

# bus: what mods published for this session, one file each: "<level>\t<text>[\t<until>]".
# Each file is read once (a publisher may rewrite it at any moment) and only its first 256
# characters; a segment past its <until> epoch is a publisher that stopped without clearing.
# Dotfiles (.reserve, .vitals) are not segments, and the glob skips them.
# In chips the failures, the warnings and the info segments are a chip each, failures on a red
# ground and warnings on a yellow one: KO_bus_<level> and KC_bus_<level> name the ground of the
# first and the last chip, for the layout pass to draw their outer caps. The step from one
# chip to the next (cap, space, cap) is as wide as the " · " that joins them in flat.
LV_bus=0
f_p=""; f_c=""; w_p=""; w_c=""; i_p=""; i_c=""; one_p=""; one_c=""; one_k=""
bjoin() { # ground before, ground after -> R: what goes between two of the bus's classes
  if [ "$look" = chips ]; then R="${rz}${e}[38;2;${1}m${CR}${rz} ${e}[38;2;${2}m${CL}${e}[48;2;${2}m"
  else R=" ${c_dot}·${rst} "; fi
}
if [ -n "$sid" ] && [ -d "$STATE/bus/$sid" ]; then
  for f in "$STATE/bus/$sid"/*; do
    [ -f "$f" ] && [ -s "$f" ] || continue
    lvl=""; txt=""; til=""; IFS=$'\t' read -r -n 256 lvl txt til 2>/dev/null < "$f"
    txt="${txt:0:64}"; txt="${txt//[^[:print:]]/}"; txt="${txt:0:32}"; [ -n "$txt" ] || continue
    int "$til" ""; [ -n "$R" ] && [ "$now" -gt "$R" ] && continue
    case "$lvl" in
      fail) [ -n "$f_p" ] && { f_p="${f_p} · "; f_c="${f_c} ${c_dot}·${rst} "; }
            f_p="${f_p}✗ ${txt}"; f_c="${f_c}${c_red}✗ ${txt}${rst}" ;;
      warn) [ -n "$w_p" ] && { w_p="${w_p} · "; w_c="${w_c} ${c_dot}·${rst} "; }
            w_p="${w_p}▲ ${txt}"; w_c="${w_c}${c_yellow}▲ ${txt}${rst}"
            [ -n "$one_p" ] || { one_p="▲ ${txt}"; one_c="${c_yellow}▲ ${txt}${rst}"; one_k="$K_WARN"; } ;;
      *)    [ -n "$i_p" ] && { i_p="${i_p} · "; i_c="${i_c} ${c_dot}·${rst} "; }
            i_p="${i_p}${txt}"; i_c="${i_c}${c_sub}${txt}${rst}" ;;
    esac
    [ "$lvl" = "fail" ] && [ "${one_p:0:1}" != "✗" ] && { one_p="✗ ${txt}"; one_c="${c_red}✗ ${txt}${rst}"; one_k="$K_FAIL"; }
  done
  # failures, then warnings, then info. Level 1: the loudest one alone; 2: every failure and
  # warning; 3: everything.
  loud_p="$f_p"; loud_c="$f_c"; loud_k0=""; loud_k1=""; [ -n "$f_p" ] && { loud_k0="$K_FAIL"; loud_k1="$K_FAIL"; }
  if [ -n "$w_p" ]; then
    if [ -n "$loud_p" ]; then bjoin "$K_FAIL" "$K_WARN"; loud_p="${loud_p} · "; loud_c="${loud_c}${R}"; else loud_k0="$K_WARN"; fi
    loud_p="${loud_p}${w_p}"; loud_c="${loud_c}${w_c}"; loud_k1="$K_WARN"
  fi
  bus_p="$loud_p"; bus_c="$loud_c"; bus_k0="$loud_k0"
  if [ -n "$i_p" ]; then
    if [ -n "$bus_p" ]; then bjoin "$loud_k1" "$K_CHIP"; bus_p="${bus_p} · "; bus_c="${bus_c}${R}"; else bus_k0="$K_CHIP"; fi
    bus_p="${bus_p}${i_p}"; bus_c="${bus_c}${i_c}"
  fi
  [ -n "$one_p" ] && { seg bus 1 "$one_p" "$one_c"; KO_bus_1="$one_k"; KC_bus_1="$one_k"; }
  [ -n "$loud_p" ] && [ "$loud_p" != "$one_p" ] && { seg bus 2 "$loud_p" "$loud_c"; KO_bus_2="$loud_k0"; KC_bus_2="$loud_k1"; }
  [ -n "$bus_p" ] && [ "$bus_p" != "$loud_p" ] && { seg bus 3 "$bus_p" "$bus_c"; KO_bus_3="$bus_k0"; KC_bus_3="$K_CHIP"; }
fi

# cost: the session's notional list price, whole dollars, and the part of it that fell in the
# current 5h window. <state>/spend/<session id> holds "<5h reset>\t<cost in cents when that
# window was first seen>"; it is rewritten only when the window rolls over.
LV_cost=0
int "$cost_c" 0; cost_c="$R"
spend=""
w5="${f5reset%%.*}"; int "$w5" 0; w5="$R"
if [ -n "$sid" ] && [ "$w5" -gt "$now" ] && [ "$cost_c" -gt 0 ]; then
  sfile="$STATE/spend/$sid"; sr=""; sb=""
  [ -f "$sfile" ] && IFS=$'\t' read -r sr sb 2>/dev/null < "$sfile"
  int "$sr" 0; sr="$R"; int "$sb" ""; sb="$R"
  if [ "$sr" -ne "$w5" ] || [ -z "$sb" ] || [ "$sb" -gt "$cost_c" ]; then
    # A session never seen before and still under $3 is new: all of it is this window's.
    if [ "$sr" -eq 0 ] && [ "$cost_c" -lt 300 ]; then sb=0; else sb="$cost_c"; fi
    mkdir -p "$STATE/spend" 2>/dev/null
    printf '%s\t%s\n' "$w5" "$sb" 2>/dev/null > "$sfile.$$" && mv -f "$sfile.$$" "$sfile" 2>/dev/null
  fi
  spend=$(( cost_c - sb ))
fi
if [ "$cost_c" -ge 100 ]; then
  d=$(( (cost_c + 50) / 100 )); seg cost 1 "\$${d}" "${c_low}\$${d}${rst}"
  if [ -n "$spend" ] && [ "$spend" -ge 100 ] && [ "$spend" -lt "$cost_c" ]; then
    w=$(( (spend + 50) / 100 ))
    seg cost 2 "\$${w}/5h · \$${d}" "${c_sub}\$${w}/5h${rst} ${c_dot}·${rst} ${c_low}\$${d}${rst}"
  fi
fi

# vitals for mize-coworker's Claude (he sweats as the context fills, checks an hourglass when a
# window runs short, sleeps under frost when the cache is cold): <state>/bus/<session>/.vitals,
# one line "<context %>\t<5h state>\t<7d state>\t<cache state>", empty where unknown. Rewritten
# only when it changes, so the hot path costs one read.
if [ -n "$sid" ]; then
  vt5=""; [ -n "$f5pct" ] && vt5="$ST_h5"; vt7=""; [ -n "$f7pct" ] && vt7="$ST_d7"
  vit="${pct}"$'\t'"${vt5}"$'\t'"${vt7}"$'\t'"${cstate}"
  vfile="$STATE/bus/$sid/.vitals"; vold=""
  [ -f "$vfile" ] && IFS= read -r vold 2>/dev/null < "$vfile"
  if [ "$vold" != "$vit" ]; then
    [ -d "$STATE/bus/$sid" ] || mkdir -p "$STATE/bus/$sid" 2>/dev/null
    printf '%s\n' "$vit" 2>/dev/null > "$vfile.$$" && mv -f "$vfile.$$" "$vfile" 2>/dev/null
  fi
fi

# --- layout: lower levels, least important first, until the line fits ------------------------
ORDER="model ctx cache h5 d7 alt loc bus cost"
GROUP_model=1; GROUP_ctx=2; GROUP_cache=2; GROUP_h5=3; GROUP_d7=3; GROUP_alt=3; GROUP_loc=4; GROUP_bus=5; GROUP_cost=6
# In chips the two windows' bare percents pair up with one space ("5h 69%↗ 7d 67%↗"); any
# other two pieces of a group are joined by " · ". width and the drawing below share the rule.
width() { # -> W: cells the current levels take, caps, gaps and joins included
  local id lv n v g prev=0 pid="" plv=0; W=0
  for id in $ORDER; do
    n="LV_$id"; lv="${!n}"; [ "$lv" -gt 0 ] || continue
    v="P_${id}_${lv}"; g="GROUP_$id"; g="${!g}"
    if [ "$g" -ne "$prev" ]; then
      W=$(( W + CAPW )); [ "$prev" -eq 0 ] || W=$(( W + GAPW ))
    elif [ "$look" = chips ] && [ "$pid$plv$id$lv" = h51d71 ]; then W=$(( W + 1 ))
    else W=$(( W + SEPW )); fi
    W=$(( W + ${!v} )); prev="$g"; pid="$id"; plv="$lv"
  done
  return 0
}
lower() { # id floor: down to the next level that was defined, while above the floor. A floor
          # that was itself never defined is passed through to the next defined level below
          # it (level 0, hidden, when there is none).
  local n="LV_$1" lv v; lv="${!n}"
  [ "$lv" -gt "$2" ] || return 1
  while [ "$lv" -gt 0 ]; do
    lv=$(( lv - 1 )); v="P_$1_${lv}"
    if [ "$lv" -eq 0 ] || [ -n "${!v:-}" ]; then printf -v "$n" '%s' "$lv"; return 0; fi
  done
  return 1
}
if [ "$cols" -gt 0 ]; then
  # Four cells for the TUI's own inset, and what a mod drawing at the row's right end reserved
  # (<full>\t<compact>\t<compactBelow>: mize-coworker's Claude sits there; if the two do not
  # fit, the engine wraps it onto a row of its own and the prompt jumps).
  # A session's own file rules once it exists (empty: released). Before it exists, the mod's
  # machine-wide default, bus/.reserve-default (the numbers it wrote at its last session start),
  # holds the cells: the engine's first render of a session precedes the mod's reserve, and the
  # site wrapped onto a row of its own for one refresh at every session start (2026-10-02).
  rsv=0; rfile=""
  if [ -n "$sid" ]; then
    if [ -f "$STATE/bus/$sid/.reserve" ]; then rfile="$STATE/bus/$sid/.reserve"
    elif [ -s "$STATE/bus/.reserve-default" ]; then rfile="$STATE/bus/.reserve-default"; fi
  fi
  if [ -n "$rfile" ] && [ -s "$rfile" ]; then
    rf=""; rc=""; rb=""; IFS=$'\t' read -r -n 64 rf rc rb 2>/dev/null < "$rfile"
    int "$rf" 0; rf="$R"; int "$rc" 0; rc="$R"; int "$rb" 0; rb="$R"
    rsv="$rf"; [ "$cols" -lt "$rb" ] && rsv="$rc"
    [ "${#rsv}" -gt 2 ] && rsv=40; [ "$rsv" -gt 40 ] && rsv=40
  fi
  max=$(( cols - 4 - rsv )); [ "$max" -lt 1 ] && max=1
  # What needs attention outlives what does not: a quiet cache, the week's countdown and the
  # bus's info segments go early; an urgent cache, a window over pace and the bus's warnings
  # and failures go late. Two details are the owner's priorities and outlive all the others:
  # the context bar, which the owner reads first (in a 95-column window an older order dropped
  # the bar and gave the smaller pieces back), and above it the time until the 5h window resets
  # (h5:1; 2026-10-03: it used to go with the week's countdown, before the dirty counts, and a
  # 99-column row in a repo never showed it). So the dirty counts, the other account, the
  # cache, the ✻ and the effort all go before the bar, and the bar before the 5h countdown.
  # Only the model's name, the place with its branch, the windows' percentages and the bus's
  # loudest segment outlive the countdown. bus:2 keeps the warnings and failures (or nothing,
  # if the bus holds only info); bus:1 the loudest one alone.
  cq="cache:0"; cu=""; cz=""; [ "$cache_urgent" -eq 1 ] && { cq=""; cu="cache:1"; cz="cache:0"; }
  aq="alt:0"; au=""; [ "$hot" -eq 1 ] && { aq=""; au="alt:0"; }
  # a calm window is hidden before the context; one on pace to run dry outlives everything but the model
  h5q="h5:0"; [ "$ST_h5" = "calm" ] || h5q=""
  d7q="d7:0"; [ "$ST_d7" = "calm" ] || d7q=""
  undo=""
  # The context's size suffix and used/size are its first details to go (ctx:3, ctx:2); the ✻
  # is the row's bookend and goes just before the effort (model:2), after every smaller piece,
  # so it comes and goes only where the bar or the 5h countdown needs its two cells.
  for step in cost:1 cost:0 model:3 ctx:3 ctx:2 $cq $aq loc:3 bus:2 d7:1 loc:2 $au $cu model:2 model:1 ctx:1 h5:1 loc:1 \
              $cz loc:0 bus:1 $d7q $h5q ctx:0 bus:0 d7:0 h5:0; do
    width; [ "$W" -le "$max" ] && break
    id="${step%%:*}"; fl="${step##*:}"; n="LV_$id"
    while width && [ "$W" -gt "$max" ]; do
      was="${!n}"; lower "$id" "$fl" || break
      undo="${id}:${was} ${undo}"
    done
  done
  # Hiding one wide piece late (a long bus warning, the place) can leave room for pieces that
  # went earlier: give each back, the last one lowered first, wherever it still fits.
  for u in $undo; do
    id="${u%%:*}"; n="LV_$id"; cur="${!n}"
    printf -v "$n" '%s' "${u##*:}"; width
    [ "$W" -le "$max" ] || printf -v "$n" '%s' "$cur"
  done
  # Still too wide means the model alone (a very narrow pane, or long flags): cut its name with
  # an ellipsis, keeping the red flags, then the flags too, down to a lone "…" if it must. Only
  # a budget under 3 cells, too small for any chip, is still overrun.
  width
  if [ "$W" -gt "$max" ]; then
    k=${#model}; x="$model"
    while [ "$W" -gt "$max" ] && [ "$k" -gt 1 ]; do
      k=$(( k - 1 )); x="${model:0:k}"; x="${x% }…"; seg model 1 "${x}${mf_p}" "${c_mauve}${x}${rst}${mf_c}"; width
    done
    t="${x}${mf_p}"; k=${#t}
    while [ "$W" -gt "$max" ] && [ "$k" -gt 0 ]; do
      k=$(( k - 1 )); x="${t:0:k}"; x="${x% }"; x="${x%…}…"; seg model 1 "$x" "${c_mauve}${x}${rst}"; width
    done
  fi
fi

# Draw. A chip: its left cap in the ground's color on the terminal's own background, the
# content on the ground, then a full reset and the right cap the same way.
out=""; prev=0; pid=""; plv=0; kc="$K_CHIP"
for id in $ORDER; do
  n="LV_$id"; lv="${!n}"; [ "$lv" -gt 0 ] || continue
  v="T_${id}_${lv}"; g="GROUP_$id"; g="${!g}"
  if [ "$look" = chips ]; then
    if [ "$g" -ne "$prev" ]; then
      [ "$prev" -eq 0 ] || out="${out}${rz}${e}[38;2;${kc}m${CR}${rz} "
      k="KO_${id}_${lv}"; k="${!k:-$K_CHIP}"
      out="${out}${e}[38;2;${k}m${CL}${e}[48;2;${k}m"
    elif [ "$pid$plv$id$lv" = h51d71 ]; then out="${out} "
    else out="${out} ${c_dot}·${rst} "; fi
    k="KC_${id}_${lv}"; kc="${!k:-$K_CHIP}"
  elif [ "$prev" -ne 0 ]; then
    if [ "$g" -eq "$prev" ]; then out="${out} ${c_dot}·${rst} "; else out="${out} ${c_rail}│${rst} "; fi
  fi
  prev="$g"; pid="$id"; plv="$lv"; out="${out}${!v}"
done
[ "$look" = chips ] && [ "$prev" -ne 0 ] && out="${out}${rz}${e}[38;2;${kc}m${CR}${rz}"
printf '%s' "$out"

# --- housekeeping: once a day, drop per-session files nobody touched for 3 days ---------------
case "$STATE" in /*/*) [ -d "$STATE" ] && prune_ok=1 ;; esac
if [ "${prune_ok:-0}" -eq 1 ]; then
  pruned=0; [ -f "$STATE/.pruned" ] && { IFS= read -r pruned 2>/dev/null < "$STATE/.pruned"; int "$pruned" 0; pruned="$R"; }
  if [ "$pruned" -gt "$now" ] || [ $(( now - pruned )) -gt 86400 ]; then
    printf '%s\n' "$now" 2>/dev/null > "$STATE/.pruned"
    ( find "$STATE/bus" "$STATE/git" "$STATE/spend" -depth -mindepth 1 -mtime +3 -delete ) >/dev/null 2>&1 &
  fi
fi
exit 0
