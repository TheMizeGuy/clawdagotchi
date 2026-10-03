// What Claude is doing: tool -> activity, the safe object a spinner word may
// name, the activity model (turns, tool calls in flight, decay, sleep), the
// spinner word, and the /coworker text. Pure: no `$`.
//
// Safety: tool inputs are read only to derive a short object. A file is named
// by its basename, a Bash command by its program name (never an argument, so
// never a token or a password), a URL by its host. Nothing here logs.

import type { CoworkerActivity, CoworkerDoing } from '../../types'

export type Activity = CoworkerActivity

/** The Spinner's `mode` prop. */
export type SpinnerMode = 'requesting' | 'responding' | 'thinking' | 'tool-input' | 'tool-use'

/** A tool event this long ago still shows its activity once nothing else runs. */
export const DECAY_MS = 8_000
/** Idle this long and Claude falls asleep. */
export const SLEEP_MS = 10 * 60_000
/** A tool call (or permission ask) with no end after this long is forgotten. */
export const FORGET_MS = 30 * 60_000
/** At most this many tool calls are held in flight; the oldest is dropped. */
export const MAX_CALLS = 200
/** The longest spinner word, in characters. */
export const MAX_WORD = 40
/**
 * How long each gesture shows: the wave at session start, the hop after a
 * good turn (`done`), the cheer after a long one (`cheer`: its six frames
 * once, then a breath of idle), the flinch after a failed call.
 */
export const MOMENT_MS = { greeting: 2_000, done: 1_500, cheer: 2_000, oops: 1_250 } as const
/** A main turn at least this long ends in a cheer instead of a hop. */
export const LONG_TURN_MS = 2 * 60_000
/** At least this long between two flinches, so a run of failing commands is not a tic. */
export const OOPS_EVERY_MS = 10_000

const ACTIVITY_OF_TOOL: ReadonlyMap<string, Activity> = new Map<string, Activity>([
  ['Read', 'reading'],
  ['NotebookRead', 'reading'],
  ['Grep', 'searching'],
  ['Glob', 'searching'],
  ['ToolSearch', 'searching'],
  ['LS', 'searching'],
  ['Edit', 'editing'],
  ['Write', 'editing'],
  ['NotebookEdit', 'editing'],
  ['MultiEdit', 'editing'],
  ['Bash', 'running'],
  ['BashOutput', 'running'],
  ['Monitor', 'running'],
  ['WebFetch', 'browsing'],
  ['WebSearch', 'browsing'],
  ['Agent', 'delegating'],
  ['Task', 'delegating'],
  ['Workflow', 'delegating'],
  ['SendMessage', 'delegating'],
  ['AskUserQuestion', 'asking'],
])

/**
 * The spinner words a scene beside the spinner keys on (sprite.ts sceneFor):
 * a web search's, a skill's, and the lead of an MCP call's (`Calling <server>`).
 */
export const WORDS = { webSearch: 'Searching the web', skill: 'Loading a skill', calling: 'Calling ' } as const

/** The spinner word of each tool activity when the tool names no object. */
const VERB: Readonly<Record<Activity, string>> = {
  thinking: 'Thinking',
  reading: 'Reading',
  searching: 'Searching',
  editing: 'Editing',
  running: 'Running',
  browsing: 'Browsing',
  delegating: 'Delegating',
  asking: 'Asking you',
  working: 'Working',
  greeting: '',
  done: '',
  oops: '',
  idle: '',
  asleep: '',
}

/** The activity a tool call shows; any tool not listed (MCP tools, Skill, TodoWrite) is `working`. */
export function activityOf(tool: string): Activity {
  return ACTIVITY_OF_TOOL.get(tool) ?? 'working'
}

// Control characters, format characters (bidi marks and overrides, zero-width
// and other invisible ones), line and paragraph separators: none of them may
// reach a terminal row.
const UNSAFE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu
const PROGRAM = /^[A-Za-z0-9._+-]{1,24}$/
const HOST = /^[a-z0-9.-]{1,40}$/
const SERVER = /^[A-Za-z0-9._-]{1,32}$/
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*\+?=/
/** How far into a command the program search reads. */
const MAX_SCAN = 4_096
/** How many `cd <dir> &&` (or empty) segments the program search steps over. */
const MAX_HOPS = 4

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The last path segment (`/a/b/register.ts` -> `register.ts`), trailing slashes ignored. */
export function basename(path: string): string {
  // a loop, not /\/+$/: that regex is quadratic on a long run of slashes
  let end = path.length

  while (end > 0 && path.charCodeAt(end - 1) === 47) {
    end -= 1
  }

  const at = path.lastIndexOf('/', end - 1)

  return path.slice(at + 1, end)
}

/** At most MAX_WORD characters, an ellipsis marking a cut. */
export function fit(word: string): string {
  const chars = [...word]

  return chars.length <= MAX_WORD ? word : `${chars.slice(0, MAX_WORD - 1).join('')}\u2026`
}

function withObject(verb: string, object: string | undefined): string {
  const safe = object === undefined ? '' : object.replace(UNSAFE, '').trim()

  return safe === '' ? verb : fit(`${verb} ${safe}`)
}

function fileOf(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? basename(value) : undefined
}

/**
 * One word: its text with quotes removed, whether it opened with a quote or
 * escape, whether it expands, and whether it holds an `=` written plainly with
 * no quote or escape before it (only such a word is a `NAME=value` assignment).
 */
type Word = { text: string; isNameQuoted: boolean; isDynamic: boolean; hasPlainEq: boolean }
type Simple = { words: Word[]; end: number }

/**
 * The words of one simple command starting at `from`, quotes removed, up to
 * the next control operator (`&&`, `||`, `;`, `|`, `&`, newline, a paren).
 * A word holding `$` or a backquote outside single quotes is dynamic.
 */
function lexSimple(src: string, from: number): Simple {
  const words: Word[] = []
  const limit = Math.min(src.length, MAX_SCAN)
  let text = ''
  let isNameQuoted = false
  let isDynamic = false
  let isInWord = false
  let isMarked = false
  let hasPlainEq = false
  let at = from

  const close = (): void => {
    if (isInWord) {
      words.push({ text, isNameQuoted, isDynamic, hasPlainEq })
    }

    text = ''
    isNameQuoted = false
    isDynamic = false
    isInWord = false
    isMarked = false
    hasPlainEq = false
  }

  while (at < limit) {
    const ch = src[at] ?? ''

    if (ch === ' ' || ch === '\t') {
      close()
      at += 1
      continue
    }

    if (ch === '\n' || ch === ';' || ch === '&' || ch === '|' || ch === '(' || ch === ')') {
      close()
      const pair = src.slice(at, at + 2)

      return { words, end: at + (pair === '&&' || pair === '||' ? 2 : 1) }
    }

    if (!isInWord) {
      isInWord = true
      isNameQuoted = ch === '\\' || ch === "'" || ch === '"'
    }

    if (ch === '\\') {
      isMarked = true
      text += src[at + 1] ?? ''
      at += 2
      continue
    }

    if (ch === "'") {
      isMarked = true
      const stop = src.indexOf("'", at + 1)
      const last = stop < 0 ? limit : Math.min(stop, limit)

      text += src.slice(at + 1, last)
      at = last + 1
      continue
    }

    if (ch === '"') {
      isMarked = true
      at += 1

      while (at < limit && src[at] !== '"') {
        const inner = src[at] ?? ''

        if (inner === '\\' && at + 1 < limit) {
          text += src[at + 1] ?? ''
          at += 2
          continue
        }

        if (inner === '$' || inner === '`') {
          isDynamic = true
        }

        text += inner
        at += 1
      }

      at += 1
      continue
    }

    if (ch === '$' || ch === '`') {
      isDynamic = true
    }

    if (ch === '=' && !isMarked) {
      hasPlainEq = true
    }

    text += ch
    at += 1
  }

  close()

  return { words, end: limit }
}

/**
 * The program a Bash command runs first, for the spinner word: the basename of
 * the first word after any `NAME=value` assignments, stepping over a leading
 * `cd <dir> &&`. Undefined unless it matches `^[A-Za-z0-9._+-]{1,24}$`, so no
 * argument, path, expansion or secret can come out of it. The lexer does not
 * follow shell grammar past words and quotes, so wherever a word boundary
 * cannot be trusted the answer is undefined: an assignment that expands
 * (`H=\`cmd secret\``, `N=$((..))`), a command of assignments alone (the array
 * `NAME=(a b)` reads that way), a redirection in the program's place.
 */
export function programOf(command: string): string | undefined {
  let from = 0

  for (let hop = 0; hop < MAX_HOPS && from < Math.min(command.length, MAX_SCAN); hop += 1) {
    const { words, end } = lexSimple(command, from)
    let index = 0

    while (index < words.length && (words[index]?.hasPlainEq ?? false) && ASSIGNMENT.test(words[index]?.text ?? '')) {
      if (words[index]?.isDynamic ?? false) {
        return undefined
      }

      index += 1
    }

    const first = words[index]

    if (first === undefined) {
      if (index > 0) {
        return undefined
      }

      from = end
      continue
    }

    if (first.text === 'cd' && index === 0) {
      from = end
      continue
    }

    if (first.isDynamic || /[<>]/.test(first.text)) {
      return undefined
    }

    const name = basename(first.text)

    return PROGRAM.test(name) ? name : undefined
  }

  return undefined
}

/** The host of an http(s) or other `scheme://` URL, lowercase, without user info or port. */
export function hostOf(url: string): string | undefined {
  const text = url.trim()

  if (!/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(text)) {
    return undefined
  }

  let host: string

  try {
    // the URL parser, not a hand split: a backslash or odd userinfo cannot move path text into the host
    host = new URL(text).hostname.toLowerCase()
  } catch {
    return undefined
  }

  return HOST.test(host) ? host : undefined
}

/** The server of an MCP tool name `mcp__<server>__<tool>`. */
export function mcpServerOf(tool: string): string | undefined {
  if (!tool.startsWith('mcp__')) {
    return undefined
  }

  const rest = tool.slice('mcp__'.length)
  const at = rest.indexOf('__')
  const server = at > 0 ? rest.slice(0, at) : ''

  return SERVER.test(server) ? server : undefined
}

/** The spinner word for one tool call: the activity's verb and a safe object. */
export function toolWord(tool: string, input: unknown): string {
  const args = isRecord(input) ? input : {}

  switch (tool) {
    case 'Read':
      return withObject('Reading', fileOf(args.file_path))
    case 'NotebookRead':
      return withObject('Reading', fileOf(args.notebook_path))
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
      return withObject('Editing', fileOf(args.file_path))
    case 'NotebookEdit':
      return withObject('Editing', fileOf(args.notebook_path))
    case 'Bash':
      return withObject('Running', typeof args.command === 'string' ? programOf(args.command) : undefined)
    case 'Grep':
    case 'Glob':
      return 'Searching'
    case 'WebFetch':
      return withObject('Browsing', typeof args.url === 'string' ? hostOf(args.url) : undefined)
    case 'WebSearch':
      return WORDS.webSearch
    case 'Agent':
    case 'Task':
      return 'Delegating'
    case 'Workflow':
      return 'Orchestrating agents'
    case 'Skill':
      return WORDS.skill
    case 'AskUserQuestion':
      return 'Asking you'
    default:
      break
  }

  if (tool.startsWith('mcp__')) {
    const server = mcpServerOf(tool)

    return server === undefined ? 'Working' : fit(`${WORDS.calling}${server}`)
  }

  return VERB[activityOf(tool)] || 'Working'
}

/** One tool call in flight. */
export type Call = { activity: Activity; word: string; startedAt: number }

/** What the activity model holds; one per session, mutated by the functions below. */
export type Model = {
  /** When the model was made (session start or module load). */
  startedAt: number
  /** True between the main loop's turn.start and its turn.complete. */
  isTurnRunning: boolean
  /** When the main loop's running turn began, if known (a hot reload in mid-turn does not know). */
  turnStartedAt: number | undefined
  turnEndedAt: number
  /** Tool calls in flight by tool_use_id, oldest first. */
  calls: Map<string, Call>
  /** The last tool event (start or end) and when it came. */
  last: { activity: Activity; word: string; at: number } | undefined
  /**
   * Permission dialogs that may still be open, by `<loop>|<tool>` (the loop is
   * the agent id, empty for the main loop): when each was raised. The API has
   * no event for an answered dialog, so an ask lasts until that loop's call
   * ends (done, failed or denied) or its turn does.
   */
  asks: Map<string, number>
  /** Background work the session reported at the main loop's last stop (shells, agents, workflows), and when. */
  background: { count: number; at: number }
  /**
   * A short gesture and when it ends. It shows over thinking, the decay and
   * idle; a permission ask or a call in flight shows instead. `isLong` marks
   * the end of a long turn (LONG_TURN_MS): a cheer instead of a hop.
   */
  moment: { kind: 'greeting' | 'done' | 'oops'; until: number; isLong?: boolean } | undefined
  /** When Claude last flinched (OOPS_EVERY_MS apart at least). */
  oopsAt: number
}

export function newModel(now: number): Model {
  return {
    startedAt: now,
    isTurnRunning: false,
    turnStartedAt: undefined,
    turnEndedAt: 0,
    calls: new Map(),
    last: undefined,
    asks: new Map(),
    background: { count: 0, at: now },
    moment: undefined,
    oopsAt: -OOPS_EVERY_MS,
  }
}

/** The session opened: a wave. */
export function greeted(model: Model, now: number): void {
  model.moment = { kind: 'greeting', until: now + MOMENT_MS.greeting }
}

/** One of the main loop's own tool calls failed: a flinch, at most one per OOPS_EVERY_MS. */
export function toolFailed(model: Model, now: number): void {
  if (now - model.oopsAt < OOPS_EVERY_MS) {
    return
  }

  model.oopsAt = now
  model.moment = { kind: 'oops', until: now + MOMENT_MS.oops }
}

/** The main loop's turn began at `now` (a subagent's run raises no turn.start). */
export function turnStarted(model: Model, now?: number): void {
  model.isTurnRunning = true
  model.turnStartedAt = now !== undefined && Number.isFinite(now) ? now : undefined
  dropAsks(model, '')
  model.moment = undefined
}

function askKey(loop: string, tool: string): string {
  return `${loop}|${tool}`
}

/** Forgets one loop's asks: its turn began or ended, so no dialog of its can be open. */
function dropAsks(model: Model, loop: string): void {
  for (const key of model.asks.keys()) {
    if (key.startsWith(`${loop}|`)) {
      model.asks.delete(key)
    }
  }
}

/** A subagent's or workflow agent's run ended: its asks go with it. */
export function agentEnded(model: Model, agentId: string): void {
  dropAsks(model, agentId)
}

/**
 * What the session said is still running in the background when the main loop
 * stopped (or an agent did): while that is not nothing, calls in flight are
 * kept past the main turn's end and Claude neither idles nor sleeps.
 */
export function backgroundSeen(model: Model, count: number, now: number): void {
  model.background = { count: Math.max(0, Math.floor(count)), at: now }
}

/**
 * True while the last tool event still shows with no turn running: it came
 * after the main turn ended (an agent working in the background) and within
 * DECAY_MS. The main turn's own last call does not linger once the turn is over.
 */
function isDecaying(model: Model, now: number): boolean {
  return model.last !== undefined && model.last.at > model.turnEndedAt && now - model.last.at < DECAY_MS
}

/** True while background work was reported and something has been heard from the session within FORGET_MS. */
function hasBackground(model: Model, now: number): boolean {
  return model.background.count > 0 && now - Math.max(model.background.at, model.last?.at ?? 0) < FORGET_MS
}

/**
 * The main loop's turn ended. Its own calls cannot still run, and an interrupt
 * or an API error may leave a call with no end event, so the calls in flight
 * are dropped, unless the session reported background work: then they may be
 * an agent's and stay (FORGET_MS still bounds them).
 * A turn that ended with an answer (not interrupted, no error) gets a hop, or
 * a cheer when it ran LONG_TURN_MS or more: `durationMs` as the engine
 * measured it, else from the turn's start as recorded here.
 */
export function turnEnded(model: Model, now: number, isAnswered = false, durationMs?: number): void {
  const ran =
    durationMs !== undefined && Number.isFinite(durationMs) && durationMs >= 0
      ? durationMs
      : model.isTurnRunning && model.turnStartedAt !== undefined
        ? now - model.turnStartedAt
        : 0
  const isLong = ran >= LONG_TURN_MS

  model.isTurnRunning = false
  model.turnStartedAt = undefined
  model.turnEndedAt = now
  dropAsks(model, '')

  if (!hasBackground(model, now)) {
    model.calls.clear()
  }

  model.moment = isAnswered ? { kind: 'done', until: now + (isLong ? MOMENT_MS.cheer : MOMENT_MS.done), isLong } : undefined
}

/** True while the shown moment is the cheer after a long turn. */
export function isCheering(model: Model): boolean {
  return model.moment?.kind === 'done' && model.moment.isLong === true
}

/**
 * How many delegating calls (Agent, Task, Workflow, SendMessage) are in flight,
 * 1 to 3: the helpers the delegating scene draws. None in flight (delegating
 * shown for background work) is one; more than three are three.
 */
export function teamSize(model: Model): 1 | 2 | 3 {
  let count = 0

  for (const call of model.calls.values()) {
    if (call.activity === 'delegating') {
      count += 1
    }
  }

  return count >= 3 ? 3 : count === 2 ? 2 : 1
}

/** Drops calls (and an ask) older than FORGET_MS: their end event never came. */
function forget(model: Model, now: number): void {
  for (const [id, call] of model.calls) {
    if (now - call.startedAt < FORGET_MS) {
      break
    }

    model.calls.delete(id)
  }

  for (const [key, at] of model.asks) {
    if (now - at >= FORGET_MS) {
      model.asks.delete(key)
    }
  }
}

/** classic.PreToolUse let a call through: it is in flight until its PostToolUse or PostToolUseFailure. */
export function toolStarted(model: Model, id: string, tool: string, input: unknown, now: number): void {
  const call: Call = { activity: activityOf(tool), word: toolWord(tool, input), startedAt: now }

  forget(model, now)
  model.calls.delete(id)

  while (model.calls.size >= MAX_CALLS) {
    const oldest = model.calls.keys().next()

    if (oldest.done === true) {
      break
    }

    model.calls.delete(oldest.value)
  }

  model.calls.set(id, call)
  model.last = { activity: call.activity, word: call.word, at: now }
}

/**
 * A call ended (done, failed or denied); its activity shows for DECAY_MS once
 * nothing else runs. `loop` is the agent id of the loop that made it (empty
 * for the main loop): an ask of that loop for that tool is over.
 */
export function toolEnded(model: Model, id: string, tool: string, input: unknown, now: number, loop = ''): void {
  const call = model.calls.get(id)

  model.calls.delete(id)
  model.last = call === undefined
    ? { activity: activityOf(tool), word: toolWord(tool, input), at: now }
    : { activity: call.activity, word: call.word, at: now }
  model.asks.delete(askKey(loop, tool))
}

/**
 * A permission dialog opened for a call of `loop` (empty: the main loop):
 * `needs you` until that call ends or that loop's turn does. Other loops'
 * tool events leave it alone.
 */
export function permissionAsked(model: Model, now: number, loop = '', tool = ''): void {
  model.asks.set(askKey(loop, tool), now)
}

function newestCall(model: Model): Call | undefined {
  let newest: Call | undefined

  for (const call of model.calls.values()) {
    newest = call
  }

  return newest
}

/** When Claude went (or goes) idle: the latest of start, turn end and last tool event plus the decay. */
export function idleSince(model: Model): number {
  const lastShown = model.last !== undefined && model.last.at > model.turnEndedAt ? model.last.at + DECAY_MS : 0

  return Math.max(model.startedAt, model.turnEndedAt, lastShown)
}

/**
 * The shown activity: a pending permission ask; else the most recently
 * started call in flight; else a gesture still running; else `thinking` while
 * the main turn runs; else the last tool event's activity within DECAY_MS when
 * it came after the main turn ended (an agent in the background); else
 * `delegating` while the session has background work; else idle, asleep after
 * SLEEP_MS.
 */
export function shown(model: Model, now: number): CoworkerDoing {
  forget(model, now)

  if (model.asks.size > 0) {
    return { activity: 'asking', word: VERB.asking }
  }

  const newest = newestCall(model)

  if (newest !== undefined) {
    return { activity: newest.activity, word: newest.word }
  }

  if (model.moment !== undefined) {
    if (now < model.moment.until) {
      return { activity: model.moment.kind, word: '' }
    }

    model.moment = undefined
  }

  if (model.isTurnRunning) {
    return { activity: 'thinking', word: '' }
  }

  if (model.last !== undefined && isDecaying(model, now)) {
    return { activity: model.last.activity, word: model.last.word }
  }

  if (hasBackground(model, now)) {
    return { activity: 'delegating', word: '' }
  }

  return { activity: now - idleSince(model) >= SLEEP_MS ? 'asleep' : 'idle', word: '' }
}

/**
 * Milliseconds until the shown activity can change with no event: a call or
 * ask being forgotten, the decay ending, or falling asleep. Undefined when only
 * an event can change it (a turn runs, or Claude is asleep).
 */
export function nextChangeIn(model: Model, now: number): number | undefined {
  forget(model, now)
  const due: number[] = []

  for (const at of model.asks.values()) {
    due.push(at + FORGET_MS)
  }

  const oldest = model.calls.values().next()

  if (oldest.done !== true) {
    due.push(oldest.value.startedAt + FORGET_MS)
  }

  if (model.moment !== undefined && model.moment.until > now) {
    due.push(model.moment.until)
  }

  if (model.asks.size === 0 && model.calls.size === 0 && !model.isTurnRunning) {
    if (model.last !== undefined && isDecaying(model, now)) {
      due.push(model.last.at + DECAY_MS)
    } else if (hasBackground(model, now)) {
      // delegating until nothing has been heard for FORGET_MS
      due.push(Math.max(model.background.at, model.last?.at ?? 0) + FORGET_MS)
    } else {
      const sleepAt = idleSince(model) + SLEEP_MS

      if (sleepAt > now) {
        due.push(sleepAt)
      }
    }
  }

  return due.length === 0 ? undefined : Math.max(1, Math.min(...due) - now)
}

/** The doing's identity: equal keys narrate the same. */
export function doingKey(doing: CoworkerDoing): string {
  return `${doing.activity}|${doing.word}`
}

/**
 * The main loop's spinner word: the tool activity's word, else from the
 * spinner's own mode (`responding` -> Writing, `tool-use` with nothing known
 * -> Working, the rest -> Thinking).
 */
export function narration(doing: CoworkerDoing, mode: SpinnerMode): string {
  const isTool = doing.word !== '' && doing.activity !== 'thinking' && doing.activity !== 'idle' && doing.activity !== 'asleep'

  if (isTool && doing.word !== '') {
    return doing.word
  }

  switch (mode) {
    case 'responding':
      return 'Writing'
    case 'tool-use':
      return 'Working'
    default:
      return 'Thinking'
  }
}

/** `45s`, `2m 10s`, `1h 5m`. */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))

  if (seconds < 60) {
    return `${seconds}s`
  }

  const minutes = Math.floor(seconds / 60)

  if (minutes < 60) {
    return `${minutes}m ${seconds % 60}s`
  }

  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

export type Switches = { sprite: boolean; narrate: boolean; animate: boolean }

export type StatusInput = {
  isInteractive: boolean
  /** `/coworker off` is in force for this session. */
  isOff: boolean
  options: Switches
  doing: CoworkerDoing
  /** How long the current busy or idle stretch has lasted. */
  forMs: number
  /** The `/coworker demo` tour under way: which act (1-based) of how many, and what it shows. */
  demo?: { act: number; of: number; label: string }
}

const PHRASE: Readonly<Record<Activity, string>> = {
  thinking: 'thinking',
  reading: 'reading',
  searching: 'searching',
  editing: 'editing',
  running: 'running something',
  browsing: 'browsing',
  delegating: 'delegating to agents',
  asking: 'waiting on you',
  working: 'working',
  greeting: 'saying hi',
  done: 'done with the turn',
  oops: 'wincing at a failed call',
  idle: 'idle',
  asleep: 'asleep',
}

function onOff(isOn: boolean): string {
  return isOn ? 'on' : 'off'
}

/** The /coworker demo line of the status: the tour under way, or what the command does. */
export const DEMO_HINT = '/coworker demo plays every animation once, about a minute, in the band above the prompt'

/**
 * The /coworker status: one line of switches, one of what Claude is doing and
 * for how long, and one about `/coworker demo` (the act under way while it
 * plays).
 */
export function statusText(input: StatusInput): string {
  const switches = `sprite ${onOff(input.options.sprite)}, narration ${onOff(input.options.narrate)}, animation ${onOff(input.options.animate)}`

  if (!input.isInteractive) {
    return `headless session, nothing is drawn here; in an interactive terminal: ${switches}`
  }

  const first = input.isOff ? `switched off for this session (/coworker on brings it back); options: ${switches}` : switches
  const isIdle = input.doing.activity === 'idle' || input.doing.activity === 'asleep'
  const demo = input.demo === undefined ? DEMO_HINT : `demo playing: ${input.demo.act} of ${input.demo.of}, ${input.demo.label}; /coworker demo again stops it`

  return `${first}\nClaude is ${PHRASE[input.doing.activity]} (${isIdle ? 'idle' : 'busy'} for ${formatDuration(input.forMs)})\n${demo}`
}

export type CommandVerb = 'status' | 'on' | 'off' | 'demo' | 'unknown'

/** What `/coworker <args>` asks for. */
export function parseCommand(args: string): CommandVerb {
  const word = args.trim().toLowerCase()

  if (word === '' || word === 'status') {
    return 'status'
  }

  return word === 'on' || word === 'off' || word === 'demo' ? word : 'unknown'
}

export const USAGE =
  'usage: /coworker [on | off | demo]  (on and off switch Claude and the spinner words for this session; demo plays every animation once in the band above the prompt, and again stops it; typed at the prompt only)'
