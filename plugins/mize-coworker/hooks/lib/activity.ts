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
/**
 * No sign of a background agent for this long (no tool event of one, no stop
 * that reported one) and Claude stops minding them: as long as he takes to
 * fall asleep, so a quiet ten minutes ends in sleep either way.
 */
export const QUIET_MS = SLEEP_MS
/** An agent last heard from this long ago no longer counts as one at work (its end never came). */
export const SEEN_MS = 3 * 60_000
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
 * The background task types that are not agents: a shell or a monitor runs on
 * with nobody thinking in it. Every other type (subagent, workflow, a type a
 * later Claude Code adds) is agent work.
 */
const PASSIVE_TASK = /shell|bash|monitor|mcp/i
/** A task status that says the task is over, should a report ever list one. */
const ENDED_TASK = /^(completed|failed|killed|stopped|cancelled|canceled)$/i

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
  supervising: '',
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

/**
 * The loop of an agent whose id is not known. `classic.PreToolUse` carries no
 * agent id (the end events do), so a call that starts while no turn of the
 * main loop runs is some agent's, and is held under this name until it ends.
 */
export const SOME_AGENT = '?'

/** One tool call in flight: `loop` is the agent that made it (SOME_AGENT when only that much is known), empty for the main loop. */
export type Call = { activity: Activity; word: string; startedAt: number; loop: string }

/**
 * The session's background work as a stop hook reports it: the tasks that are
 * agents at work (subagents, workflows), the ones that only run (shells,
 * monitors), and whether a workflow is among them.
 */
export type Background = { agents: number; shells: number; hasWorkflow: boolean }

/** No background work. */
export const NO_BACKGROUND: Background = { agents: 0, shells: 0, hasWorkflow: false }

/**
 * A stop hook's `background_tasks` as counts. A task is read by its `type`
 * alone (never its command or description): shells and monitors only run; any
 * other type is agent work; one whose status says it is over is not counted.
 */
export function backgroundOf(tasks: readonly unknown[]): Background {
  const out = { agents: 0, shells: 0, hasWorkflow: false }

  for (const task of tasks) {
    const type = isRecord(task) && typeof task.type === 'string' ? task.type : ''
    const status = isRecord(task) && typeof task.status === 'string' ? task.status : ''

    if (ENDED_TASK.test(status)) {
      continue
    }

    if (PASSIVE_TASK.test(type)) {
      out.shells += 1
    } else {
      out.agents += 1
      out.hasWorkflow = out.hasWorkflow || /workflow/i.test(type)
    }
  }

  return out
}

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
  /** The last tool event (start or end), when it came and which loop's it was (empty: the main loop's). */
  last: { activity: Activity; word: string; at: number; loop: string } | undefined
  /**
   * Permission dialogs that may still be open, by `<loop>|<tool>` (the loop is
   * the agent id, empty for the main loop): when each was raised. The API has
   * no event for an answered dialog, so an ask lasts until that loop's call
   * ends (done, failed or denied) or its turn does.
   */
  asks: Map<string, number>
  /** Background work the session reported at the last stop (agents and workflows, shells and monitors), and when. */
  background: Background & { at: number }
  /** The agents heard from and not yet ended: agent id -> when its last tool event came. */
  agents: Map<string, number>
  /** When an agent was last known to be at work (a tool event of one, a stop that reported some); 0 for never. */
  agentsAt: number
  /** When the present stretch of agent work began (the first sign after none); undefined while no agent is at work. */
  agentsSince: number | undefined
  /** When a background agent last finished, until the report it brings has been shown or has gone stale. */
  report: number | undefined
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
    background: { ...NO_BACKGROUND, at: now },
    agents: new Map(),
    agentsAt: 0,
    agentsSince: undefined,
    report: undefined,
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

/** A sign that an agent is at work now: the stretch of agent work begins with the first. */
function agentSign(model: Model, now: number): void {
  model.agentsAt = Math.max(model.agentsAt, now)

  if (model.agentsSince === undefined) {
    model.agentsSince = now
  }
}

/** Drops the calls in flight of one loop (an agent that ended), or of every agent. */
function dropCalls(model: Model, isOf: (loop: string) => boolean): void {
  for (const [id, call] of model.calls) {
    if (isOf(call.loop)) {
      model.calls.delete(id)
    }
  }
}

/**
 * How an agent's run ended: when; whether the main loop was resting then (so
 * the agent was one in the background, not one of a running main turn's
 * own); and whether it ended with an answer (not stopped, not on an error).
 */
export type AgentEnd = { at: number; isResting: boolean; isAnswer: boolean }

/**
 * A subagent's or workflow agent's run ended: its asks and its calls in
 * flight go with it and it no longer counts as at work. With `end`, the end
 * is the last sign of agent work (the idle time runs from it, not from the
 * agent's last tool event). One that ended while the main loop rested was a
 * background agent: it is no longer one of the agent tasks last reported
 * (unless a workflow is among them: a workflow is one task of many agents,
 * so the count stands until the main loop's next stop), and when it ended
 * with an answer it leaves a report for Claude to be brought: a helper with a
 * page, shown while the report is fresh. An agent of a running main turn
 * touches neither: that turn's own stop reads the count again.
 */
export function agentEnded(model: Model, agentId: string, end?: AgentEnd): void {
  dropAsks(model, agentId)

  if (agentId === '') {
    return
  }

  dropCalls(model, loop => loop === agentId)
  model.agents.delete(agentId)

  if (end === undefined || !Number.isFinite(end.at)) {
    return
  }

  model.agentsAt = Math.max(model.agentsAt, end.at)

  if (!end.isResting) {
    return
  }

  if (!model.background.hasWorkflow && model.background.agents > 0) {
    model.background = { ...model.background, agents: model.background.agents - 1 }
  }

  if (end.isAnswer) {
    model.report = end.at
  }
}

/**
 * What the session said is still running in the background when a loop
 * stopped. Shells and monitors keep nothing busy; agents and workflows are
 * agent work. The main loop's stop (`isMain`) is the word on it, taken when
 * none of its own calls or agents can still run. Agents there are a sign of
 * agent work now, and every call still in flight is one of theirs (a call an
 * agent started while the main turn ran was held as the main loop's, for
 * want of an agent id): held as some agent's from here on. None there means
 * no agent is at work: every call in flight and the agents heard from are
 * dropped (one that was killed leaves no end event). An agent's own stop can
 * only lower the count (its siblings may be the main turn's own, gone with an
 * interrupt, so it never raises it).
 */
export function backgroundSeen(model: Model, background: Background, now: number, isMain = true): void {
  const agents = Math.max(0, Math.floor(background.agents))
  const shells = Math.max(0, Math.floor(background.shells))

  if (!isMain) {
    const fewer = Math.min(model.background.agents, agents)

    model.background = { agents: fewer, shells, hasWorkflow: model.background.hasWorkflow && fewer > 0, at: model.background.at }

    return
  }

  model.background = { agents, shells, hasWorkflow: background.hasWorkflow && agents > 0, at: now }

  if (agents > 0) {
    agentSign(model, now)

    for (const call of model.calls.values()) {
      if (call.loop === '') {
        call.loop = SOME_AGENT
      }
    }
  } else {
    model.agents.clear()
    model.calls.clear()
  }
}

/** True when anything says an agent may be at work (a cheap check, before the clock is read to ask agentsAtWork). */
export function hasAgentSigns(model: Model): boolean {
  return model.background.agents > 0 || model.agents.size > 0
}

/**
 * True while agents are at work as far as the session has said: a call of
 * one is in flight (its id known or not), or one was heard from (or a stop
 * reported some) within QUIET_MS and none of that has been taken back (an
 * agent's end, a main stop that reported none).
 */
export function agentsAtWork(model: Model, now: number): boolean {
  for (const call of model.calls.values()) {
    if (call.loop !== '') {
      return true
    }
  }

  return (model.background.agents > 0 || model.agents.size > 0) && now - model.agentsAt < QUIET_MS
}

/**
 * How many agents are at work, as near as the events say: the agents with a
 * call in flight or heard from within SEEN_MS, or the agent tasks the last
 * stop reported when that is more (a workflow is one task of several agents;
 * a quiet agent is still a task). At least 1.
 */
export function agentCount(model: Model, now: number): number {
  const ids = new Set<string>()

  for (const [id, at] of model.agents) {
    if (now - at < SEEN_MS) {
      ids.add(id)
    }
  }

  for (const call of model.calls.values()) {
    if (call.loop !== '' && call.loop !== SOME_AGENT) {
      ids.add(call.loop)
    }
  }

  return Math.max(1, ids.size, model.background.agents)
}

/**
 * True while the last tool event still shows with no turn running: it was
 * the main loop's own, came after its turn ended and within DECAY_MS. The
 * main turn's own last call does not linger once the turn is over, and an
 * agent's events show as `supervising`, not as a decay.
 */
function isDecaying(model: Model, now: number): boolean {
  return model.last !== undefined && model.last.loop === '' && model.last.at > model.turnEndedAt && now - model.last.at < DECAY_MS
}

/**
 * The main loop's turn ended. Its own calls cannot still run, and an interrupt
 * or an API error may leave a call with no end event, so the calls held as
 * its own are dropped (after a stop that reported agents none is left held
 * so: backgroundSeen). Calls held as an agent's stay while the session's last
 * stop reported agents in the background; with none reported, only those of
 * some agent that started between main turns stay (they cannot be this
 * turn's), and the agents heard from are forgotten (an interrupt ends the
 * main loop's own agents with no end event). FORGET_MS bounds what stays.
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

  if (model.background.agents > 0) {
    dropCalls(model, loop => loop === '')
  } else {
    dropCalls(model, loop => loop !== SOME_AGENT)
    model.agents.clear()
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

/** Drops calls (and an ask) older than FORGET_MS, and agents not heard from for QUIET_MS: their end event never came. */
function forget(model: Model, now: number): void {
  for (const [id, at] of model.agents) {
    if (now - at >= QUIET_MS) {
      model.agents.delete(id)
    }
  }

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

/**
 * classic.PreToolUse let a call through: it is in flight until its
 * PostToolUse or PostToolUseFailure. `loop` is the agent id of the loop that
 * made it where the event says (today it never does); with none, a call that
 * starts while a turn of the main loop runs is taken for the main loop's (or
 * one of its agents', as before), and one that starts with no such turn is
 * some agent's (SOME_AGENT): the main loop calls nothing between its turns.
 * An agent's call is a sign of it at work.
 */
export function toolStarted(model: Model, id: string, tool: string, input: unknown, now: number, loop = ''): void {
  const owner = loop !== '' ? loop : model.isTurnRunning ? '' : SOME_AGENT
  const call: Call = { activity: activityOf(tool), word: toolWord(tool, input), startedAt: now, loop: owner }

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
  model.last = { activity: call.activity, word: call.word, at: now, loop: owner }
  heardFrom(model, owner, now)
}

/**
 * An agent's tool event: agents are at work as of `now`, and the agent, when
 * its id is known, is one of them. The main loop's (an empty `loop`) says
 * nothing of agents.
 */
function heardFrom(model: Model, loop: string, now: number): void {
  if (loop === '') {
    return
  }

  if (loop !== SOME_AGENT) {
    model.agents.set(loop, now)
  }

  agentSign(model, now)
}

/**
 * A call ended (done, failed or denied); its activity shows for DECAY_MS once
 * nothing else runs. `loop` is the agent id of the loop that made it (empty
 * for the main loop): an ask of that loop for that tool is over.
 */
export function toolEnded(model: Model, id: string, tool: string, input: unknown, now: number, loop = ''): void {
  const call = model.calls.get(id)
  // the end event names the agent; without a name, a call held as some agent's stays one
  const owner = loop !== '' ? loop : (call?.loop ?? '')

  model.calls.delete(id)
  model.last = call === undefined
    ? { activity: activityOf(tool), word: toolWord(tool, input), at: now, loop: owner }
    : { activity: call.activity, word: call.word, at: now, loop: owner }
  model.asks.delete(askKey(loop, tool))
  heardFrom(model, owner, now)
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

/**
 * When Claude went (or goes) idle: the latest of start, turn end, the main
 * loop's last late tool event plus the decay, and the last sign of an agent
 * at work.
 */
export function idleSince(model: Model): number {
  const lastShown = model.last !== undefined && model.last.loop === '' && model.last.at > model.turnEndedAt ? model.last.at + DECAY_MS : 0

  return Math.max(model.startedAt, model.turnEndedAt, lastShown, model.agentsAt)
}

/** The gesture still showing at `now`, if any; one that has run out is cleared. */
function momentAt(model: Model, now: number): CoworkerDoing | undefined {
  if (model.moment === undefined) {
    return undefined
  }

  if (now < model.moment.until) {
    return { activity: model.moment.kind, word: '' }
  }

  model.moment = undefined

  return undefined
}

/**
 * The shown activity. A pending permission ask comes first. Then, while the
 * main loop is at work (`isResting` false: its turn runs and its spinner is
 * drawn): the most recently started call in flight, else a gesture still
 * running, else `thinking`. While it rests (no turn, or a turn left open with
 * no spinner drawn, as between a /goal's iterations): a gesture still running
 * (the hop at the turn's end plays out first), else `supervising` while
 * agents are at work in the background, else the most recently started call
 * in flight, else `thinking` while the turn is open, else the main loop's
 * last late tool event within DECAY_MS, else idle, asleep after SLEEP_MS.
 * Background shells keep nothing busy.
 */
export function shown(model: Model, now: number, isResting = !model.isTurnRunning): CoworkerDoing {
  forget(model, now)

  const isAtWork = agentsAtWork(model, now)

  if (!isAtWork) {
    model.agentsSince = undefined
  }

  if (model.asks.size > 0) {
    return { activity: 'asking', word: VERB.asking }
  }

  const newest = newestCall(model)

  if (!isResting) {
    if (newest !== undefined) {
      return { activity: newest.activity, word: newest.word }
    }

    return momentAt(model, now) ?? { activity: 'thinking', word: '' }
  }

  const moment = momentAt(model, now)

  if (moment !== undefined) {
    return moment
  }

  if (isAtWork) {
    return { activity: 'supervising', word: '' }
  }

  if (newest !== undefined) {
    return { activity: newest.activity, word: newest.word }
  }

  if (model.isTurnRunning) {
    return { activity: 'thinking', word: '' }
  }

  if (model.last !== undefined && isDecaying(model, now)) {
    return { activity: model.last.activity, word: model.last.word }
  }

  return { activity: now - idleSince(model) >= SLEEP_MS ? 'asleep' : 'idle', word: '' }
}

/**
 * Milliseconds until the shown activity can change with no event: a call or
 * ask being forgotten, a gesture or the decay ending, the agents going quiet
 * (QUIET_MS after their last sign, once none of their calls is in flight), or
 * falling asleep. Undefined when only an event can change it (a turn runs, or
 * Claude is asleep).
 */
export function nextChangeIn(model: Model, now: number): number | undefined {
  forget(model, now)
  const due: number[] = []
  const isAtWork = agentsAtWork(model, now)

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

  let hasAgentCall = false

  for (const call of model.calls.values()) {
    hasAgentCall = hasAgentCall || call.loop !== ''
  }

  if (isAtWork && !hasAgentCall) {
    // minding the agents until nothing has been heard of them for QUIET_MS (a call of theirs in
    // flight keeps them at work for as long as it is held)
    due.push(model.agentsAt + QUIET_MS)
  }

  if (model.asks.size === 0 && model.calls.size === 0 && !model.isTurnRunning && !isAtWork) {
    if (model.last !== undefined && isDecaying(model, now)) {
      due.push(model.last.at + DECAY_MS)
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
  /** While he minds background agents: how many are at work. */
  agents?: number
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
  supervising: 'minding the agents',
  idle: 'idle',
  asleep: 'asleep',
}

function onOff(isOn: boolean): string {
  return isOn ? 'on' : 'off'
}

/** The /coworker demo line of the status: the tour under way, or what the command does. */
export const DEMO_HINT = '/coworker demo plays every animation once, about two minutes, in the band above the prompt'

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

  const phrase =
    input.doing.activity === 'supervising' && input.agents !== undefined
      ? `minding ${input.agents} agent${input.agents === 1 ? '' : 's'} in the background`
      : PHRASE[input.doing.activity]

  return `${first}\nClaude is ${phrase} (${isIdle ? 'idle' : 'busy'} for ${formatDuration(input.forMs)})\n${demo}`
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
