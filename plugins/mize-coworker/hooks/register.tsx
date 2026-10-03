/**
 * mize-coworker: Claude as a tiny coworker in the terminal.
 *
 * - SessionMode (the dim mode labels at the right of the prompt footer): the
 *   engine's own labels, then a dim caption (`reading`, `needs you`) and an
 *   orange pixel-art Claude (an `Image` of 8x2 cells that spans the status row
 *   and the short mode row under it; 4x1 with the `big` option off; the
 *   colored braille with the `picture` option off) that animates with what
 *   the session and its agents are doing. Idle he breathes, blinks and lives
 *   on the reserved cells of the row (strolls, looks, hops, yawns, sips a
 *   coffee; sweats near a full context, eyes an hourglass when a usage window
 *   runs hot, sits by a pumpkin in late October); after 10 idle minutes he
 *   sleeps, frosted once the prompt cache has gone cold.
 * - Spinner (the main loop's only): the word becomes what is happening
 *   (`Reading register.ts`, `Running npm`); the engine keeps its glyph,
 *   shimmer, time, tokens and effort. While the main loop's turn runs, Claude
 *   sits left of that line (`next(e)` is the engine's own drawing, placed as a
 *   child) in a scene of 12x2 cells for every spinner word (a thought bubble, a
 *   pen on a notepad, a book, a magnifying glass over text or over a globe, a
 *   laptop, a terminal, a globe, small helpers, a speech bubble, a gear, a
 *   scroll, a plug), and the footer keeps only the engine's labels.
 * - AbovePrompt (the band above the prompt): `/coworker demo`'s tour, every
 *   animation once with its spinner word or move name, about a minute.
 * - `/coworker` prints the switches and what Claude is doing; `/coworker off`
 *   and `/coworker on`, typed at the prompt, switch both for the session, and
 *   `/coworker demo` starts or stops the tour.
 *
 * Sources: turn.start / turn.complete (the main loop's; a subagent's run
 * raises no turn.start and its turn.complete carries agentId), and the
 * classic tool events (PreToolUse, PostToolUse, PostToolUseFailure,
 * PermissionDenied, PermissionRequest), which fire for the main loop and its
 * agents alike. No `tool.call` hook (docs/BUILD-SPEC.md rule 7a); no tool call
 * is ever changed.
 *
 * It only draws: no processes, no store, no model calls, no network, nothing
 * the model reads, and two files: the cells Claude needs on the status row,
 * reserved on the status bus so the status line script keeps them free
 * (./lib/statusline-bus), and the machine-wide default of that reserve, which
 * the script holds for a session that has not reserved yet. It reads the
 * default before writing it, and the session's vitals the status line script
 * writes on the same bus, at most once every 10 s, when an idle Claude picks
 * his next move or a sleeping one turns over. A headless session registers the
 * command and does nothing else. All mods share one worker, so every hook and
 * timer body here catches what it calls and logs to the debug sink; nothing is
 * thrown out.
 *
 * Every function that touches `$` is declared at the top level of this file;
 * the pure logic is in ./lib/activity, ./lib/sprite, ./lib/wander and ./lib/demo.
 */

import { atom, read } from 'claude-code'
import type { EngineInterface, Register, RenderElement, Timer } from 'claude-code'

import type { CoworkerActivity, CoworkerDemo, CoworkerDoing, CoworkerSpot } from '../types'
import { DEMO_ACTS, demoSteps, type DemoStep } from './lib/demo'
import {
  agentEnded,
  backgroundSeen,
  doingKey,
  greeted,
  idleSince,
  isCheering,
  narration,
  newModel,
  nextChangeIn,
  parseCommand,
  permissionAsked,
  shown,
  statusText,
  teamSize,
  toolEnded,
  toolFailed,
  toolStarted,
  turnEnded,
  turnStarted,
  USAGE,
  type Model,
  type Switches,
} from './lib/activity'
import {
  ASLEEP_COLOR,
  BLINK,
  BLINK_EVERY_MS,
  boxOf,
  brailleOf,
  BREATH_MS,
  CLAUDE_COLOR,
  footerPieces,
  frameFile,
  isBusy,
  isClaude,
  isFrameName,
  movingView,
  normalView,
  PICTURE,
  poseOf,
  RESERVE,
  SCENE_BOX,
  sceneFor,
  sizeOf,
  SLEEP_FRAME_MS,
  SPINNER_FRESH_MS,
  soloOf,
  spinnerFrame,
  TICK_MS,
  viewKey,
  viewOf,
  viewOfFrame,
  wanderRoom,
  type FrameContext,
  type FrameName,
  type Piece,
  type Size,
} from './lib/sprite'
import { parseVitals, reserveDefaultPath, reserveLine, reservePath, vitalsPath, type Vitals } from './lib/statusline-bus'
import { chooseMove, DROWSY_MS, gatedMoves, nextWait, seeded, WANDER_RANGE, type Rng, type Step } from './lib/wander'

const COMMAND = 'coworker'
/**
 * The main loop's spinner instance. The terminal raises it under the session's
 * id (seen in a live 2.1.287 session's debug log: `ui.render ... key=<session id>`);
 * the engine's own fallback is `agentId ?? "main"`. A subagent's carries its agent id.
 */
const MAIN_SPINNER = 'main'
/**
 * The row of the engine's spinner drawing that holds its line: a live 2.1.287
 * session drew a blank row first, then `· Running sleep… (3s · ↓ 11 tokens)`.
 * The one-row picture (`big` off) steps down to it; the two-row picture spans
 * both rows and needs no step (seen in Ghostty 1.3.1 on 2.1.288).
 */
const SPINNER_ROW = 1
/** The step counter wraps here: a multiple of every loop length (12, 8, 6, 4, 3, 2, 1). */
const STEP_WRAP = 480
/** The vitals file is read at most this often; between reads the last answer stands. */
const VITALS_EVERY_MS = 10_000

const DOING_REF = { plugin: 'mize-coworker', key: 'doing' } as const
const VIEW_REF = { plugin: 'mize-coworker', key: 'view' } as const
const IS_OFF_REF = { plugin: 'mize-coworker', key: 'isOff' } as const
const SPOT_REF = { plugin: 'mize-coworker', key: 'spot' } as const
const DEMO_REF = { plugin: 'mize-coworker', key: 'demo' } as const

/** No tour: the band draws nothing. */
const NO_DEMO: CoworkerDemo = { frame: '', label: '' }

const DOING = atom(DOING_REF, { activity: 'idle', word: '' })
const VIEW = atom(VIEW_REF, viewOfFrame('idle'))
const IS_OFF = atom(IS_OFF_REF, false)
const SPOT = atom(SPOT_REF, { where: 'footer', x: 0 } as CoworkerSpot)
const DEMO = atom(DEMO_REF, NO_DEMO)

/** The options beyond the /coworker status line's three. */
type Options = Switches & {
  /** Claude as the orange PNG frames (`Image`); off, the colored braille text. */
  picture: boolean
  /** While the main loop's turn runs, Claude sits beside its spinner instead of in the footer. */
  besideSpinner: boolean
  /** The picture in 8x2 cells (two rows); off, 0.2.0's 4x1. */
  big: boolean
  /** Beside the spinner, the 12x2 scenes (Claude and a prop); off, the solo frames there too. */
  scenes: boolean
  /** The date-bound idle moves: the pumpkin in the last week of October. */
  seasonal: boolean
}

/** The module's own view of the session; a hot reload starts it over from $.state. */
const S = {
  isInteractive: false,
  options: { sprite: true, narrate: true, animate: true, picture: true, besideSpinner: true, big: true, scenes: true, seasonal: true } as Options,
  /** The `gestures` option: the wave at session start, the hop after a good turn, the flinch after a failed call. */
  gestures: true,
  /** `/coworker off`, mirrored from $.state so timers can check it. */
  isOff: false,
  model: newModel(0) as Model,
  /** The activity the frames are drawn for. */
  activity: 'idle' as CoworkerActivity,
  step: 0,
  /** Idle: where the blink is: 0 open, else the phase BLINK[blinkAt - 1] (half shut, shut, half shut). */
  blinkAt: 0,
  /** Idle: the top of a breath (idleUp), every other BREATH_MS. */
  isBreathIn: false,
  /** Asleep: the prompt cache has gone cold (the vitals say so), so he sleeps frosted. */
  isCold: false,
  /** What was last written to $.state, so an unchanged value is never written. */
  doingKey: '',
  viewKey: '',
  wasBusy: false,
  /** When the current busy stretch began (the idle stretch is idleSince). */
  busySince: 0,
  ticker: null as Timer | null,
  blinker: null as Timer | null,
  /** Idle: idle and idleUp in turn, every BREATH_MS. */
  breather: null as Timer | null,
  /** Asleep: the next frame of the sleep loop, every SLEEP_FRAME_MS. */
  sleeper: null as Timer | null,
  waker: null as Timer | null,
  /** When the waker is due, so an event that does not move it does not reschedule it. */
  wakeAt: undefined as number | undefined,
  /** What was last written as the spot, so an unchanged one is never written. */
  spotKey: '',
  /** The clock's time when the main loop's spinner last drew him (a turn start counts, so the spinner gets its chance first). */
  spinnerAt: 0,
  /** Blank cells to Claude's right on the footer's row: where his wander has taken him. */
  x: 0,
  /** The wander's generator, seeded from the session start time. */
  rng: seeded(0) as Rng,
  /** Waits 12 to 30 s for the next move while idle. */
  wanderer: null as Timer | null,
  /** Steps through a move, one step per tick. */
  walker: null as Timer | null,
  /** The move under way and the next step of it. */
  steps: undefined as Step[] | undefined,
  stepAt: 0,
  /** The frame the move shows over the idle frame. */
  moveFrame: undefined as FrameName | undefined,
  /** How far the wander may go on the row the footer was last drawn on (narrower in a narrow terminal). */
  wanderRange: WANDER_RANGE.big.full as number,
  /** The plugin's directory, which holds assets/frames/; read once at session start. */
  root: undefined as string | undefined,
  /** The session's id: what the main loop's spinner is drawn under. A /clear or /resume changes it. */
  sessionId: undefined as string | undefined,
  home: undefined as string | undefined,
  /** The reserve last written to the status bus: its file, its content, and when. */
  reserve: undefined as { path: string; line: string; at: number } | undefined,
  /** The vitals last read from the status bus, and when (read at most every VITALS_EVERY_MS). */
  vitals: undefined as { value: Vitals; at: number } | undefined,
  /** Set when the session ended for good (not a /clear or /resume): nothing is recorded, drawn or scheduled after it. */
  isEnded: false,
  /** `/coworker demo`: the tour's steps and the one on screen; undefined while no tour runs. */
  demo: undefined as { steps: DemoStep[]; at: number } | undefined,
  /** Shows the tour's next step: one `after` at a time, the length of the step on screen. */
  demoTimer: null as Timer | null,
  /** What was last written as the tour's step: '' for none, '?' when a write failed (the next one always goes). */
  demoKey: '',
}

/** How old a reserve may get before a turn start writes it again: the status line's sweep deletes files untouched for 3 days. */
const RESERVE_REFRESH_MS = 24 * 60 * 60_000

/** True while the session has a screen and has not ended. */
function isLive(): boolean {
  return S.isInteractive && !S.isEnded
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** A line in the debug log (led by the plugin's name there); never throws. */
function debug($: EngineInterface, text: string): void {
  try {
    $.ui.log(text, { to: 'debug' })
  } catch {
    // nowhere to log it
  }
}

function stop(timer: Timer | null): null {
  try {
    timer?.cancel()
  } catch {
    // a timer that cannot be cancelled is dropped with the module
  }

  return null
}

/** Ends the wander: no next move, no move under way. Claude stays where it took him. */
function stopWander(): void {
  S.wanderer = stop(S.wanderer)
  S.walker = stop(S.walker)
  S.steps = undefined
  S.stepAt = 0
  S.moveFrame = undefined
}

/**
 * Cancels every timer, the tour's too (endDemo, where the session goes on,
 * also takes its last step off the band).
 */
function cancelTimers(): void {
  S.ticker = stop(S.ticker)
  S.blinker = stop(S.blinker)
  S.breather = stop(S.breather)
  S.sleeper = stop(S.sleeper)
  S.waker = stop(S.waker)
  S.wakeAt = undefined
  S.blinkAt = 0
  S.isBreathIn = false
  stopWander()
  S.demoTimer = stop(S.demoTimer)
  S.demo = undefined
}

function isDrawing(): boolean {
  return isLive() && !S.isOff && S.options.sprite
}

function isNarrating(): boolean {
  return isLive() && !S.isOff && S.options.narrate
}

/** True when the options let Claude sit beside the main loop's spinner (the picture only). */
function isBesideOn(): boolean {
  return S.options.sprite && S.options.picture && S.options.besideSpinner
}

/** The size Claude is drawn at: the two-row picture (`big`), or one row (`big` or `picture` off). */
function sizeNow(): Size {
  return sizeOf(S.options.picture, S.options.big)
}

/** True while an idle Claude may wander: drawn, animated, with gestures, and idle (not asleep, no turn). */
function canWander(): boolean {
  return isDrawing() && S.options.animate && S.gestures && S.activity === 'idle'
}

/** Where Claude is drawn now: beside the spinner while the main loop's turn runs, else the footer. */
function spotNow(): CoworkerSpot {
  return { where: isBesideOn() && S.model.isTurnRunning ? 'spinner' : 'footer', x: S.x }
}

function spotKey(spot: CoworkerSpot): string {
  return `${spot.where}|${spot.x}`
}

/** The plugin's directory: read at session start, or here the first time a drawing needs it. */
function rootOf($: EngineInterface): string {
  if (S.root === undefined) {
    S.root = $.plugin.root
  }

  return S.root
}

/**
 * Asks for this plugin's drawings again. The footer is first drawn before
 * `session.start` has said the session is interactive, and a hook that passed
 * then never read $.state, so no later write would reach it.
 */
function redraw($: EngineInterface): void {
  try {
    $.ui.invalidate('ui.render')
  } catch (error) {
    debug($, `redraw not asked: ${messageOf(error)}`)
  }
}

/**
 * Reserves Claude's cells at the right end of the status row for this session,
 * or releases them (sprite off, `/coworker off`, the session ending). Written
 * only when the file or its content changes, or with `isRefresh` to keep the
 * file young in a session that stays open for days. Never throws.
 */
async function reserve($: EngineInterface, isRefresh = false): Promise<void> {
  try {
    if (!isLive()) {
      return
    }

    if (S.home === undefined) {
      S.home = await $.env.get('HOME')
    }

    const path = S.sessionId === undefined ? undefined : reservePath(S.home, S.sessionId)

    if (path === undefined) {
      return
    }

    const line = reserveLine(isDrawing() ? RESERVE[sizeNow()] : undefined)

    if (S.reserve?.path === path && S.reserve.line === line && !(isRefresh && line !== '')) {
      return
    }

    // the session id changed with no session.end in between (/branch): the old id's cells go back
    if (S.reserve !== undefined && S.reserve.path !== path && S.reserve.line !== '') {
      await $.fs.write(S.reserve.path, '').catch(() => undefined)
    }

    S.reserve = { path, line, at: await $.clock.now() }
    // written even when empty: the status line holds the machine-wide default's cells for a session
    // with no file of its own, so a session that reserves nothing (sprite off, off) says so
    await $.fs.write(path, line)
  } catch (error) {
    S.reserve = undefined
    debug($, `status row not reserved: ${messageOf(error)}`)
  }
}

/** Releases the cells of the session that is ending: its file is named by that session's id. */
async function release($: EngineInterface): Promise<void> {
  const last = S.reserve

  S.reserve = undefined

  if (last === undefined || last.line === '') {
    return
  }

  try {
    await $.fs.write(last.path, '')
  } catch (error) {
    debug($, `status row not released: ${messageOf(error)}`)
  }
}

/** Takes the session's id (it names the main loop's spinner and the reserve file): the one given, else read from the engine. */
async function readSessionId($: EngineInterface, given?: unknown): Promise<void> {
  const before = S.sessionId

  if (typeof given === 'string' && given !== '') {
    S.sessionId = given
  } else {
    try {
      S.sessionId = await $.session.id()
    } catch {
      S.sessionId = undefined
    }
  }

  // the vitals are the session's: another id has its own file
  if (S.sessionId !== before) {
    S.vitals = undefined
  }
}

/**
 * The session's vitals as the status line script last wrote them (context
 * share, the usage windows, the prompt cache): read from the status bus at
 * most once every VITALS_EVERY_MS, the last answer standing between reads. A
 * missing or unreadable file, or one it cannot parse, is all unknown. Never throws.
 */
async function vitalsOf($: EngineInterface): Promise<Vitals> {
  let now: number

  try {
    now = await $.clock.now()
  } catch (error) {
    debug($, `vitals not read: ${messageOf(error)}`)

    return {}
  }

  if (S.vitals !== undefined && now >= S.vitals.at && now - S.vitals.at < VITALS_EVERY_MS) {
    return S.vitals.value
  }

  let value: Vitals = {}

  try {
    if (S.home === undefined && S.sessionId !== undefined) {
      S.home = await $.env.get('HOME')
    }

    const path = S.sessionId === undefined ? undefined : vitalsPath(S.home, S.sessionId)

    if (path !== undefined) {
      // missing until the status line's first run, and after a sweep: unknown, and quietly so
      value = parseVitals(await $.fs.read(path).catch(() => ''))
    }
  } catch (error) {
    debug($, `vitals not read: ${messageOf(error)}`)
  }

  // a failed read counts too: the next try waits its turn
  S.vitals = { value, at: now }

  return value
}

/** True when the vitals say the prompt cache has gone cold. Never throws. */
async function isCacheCold($: EngineInterface): Promise<boolean> {
  return (await vitalsOf($)).cache === 'cold'
}

/**
 * Writes the doing the Spinner reads, only when it changed: for its word, and
 * for the scene beside it, which follows the word whether or not it is shown.
 */
async function writeDoing($: EngineInterface, doing: CoworkerDoing): Promise<void> {
  if (!isNarrating() && !isDrawing()) {
    return
  }

  const key = doingKey(doing)

  if (key === S.doingKey) {
    return
  }

  S.doingKey = key

  try {
    await $.state.set(DOING_REF, doing)
  } catch (error) {
    S.doingKey = ''
    debug($, `activity not written: ${messageOf(error)}`)
  }
}

/**
 * Writes the frame the render hooks draw, only when the frame or caption
 * changed, then where Claude is, only when that changed. A move under way
 * shows its frame over the idle one.
 */
async function draw($: EngineInterface): Promise<void> {
  if (!isDrawing()) {
    return
  }

  const view = S.moveFrame !== undefined && S.activity === 'idle' ? movingView(S.moveFrame) : viewOf(S.activity, S.step, frameContext())
  const key = viewKey(view)

  if (key !== S.viewKey) {
    S.viewKey = key

    try {
      await $.state.set(VIEW_REF, view)
    } catch (error) {
      S.viewKey = ''
      debug($, `frame not drawn: ${messageOf(error)}`)
    }
  }

  await place($)
}

/** What picks the frame besides the activity and the step: motion, the blink and breath, the team, the cheer, the cold. */
function frameContext(): FrameContext {
  const blinking = S.blinkAt === 0 ? undefined : BLINK[S.blinkAt - 1]?.frame

  return {
    isAnimated: S.options.animate,
    isBlinking: blinking === 'blink',
    isBlinkHalf: blinking === 'blinkHalf',
    isBreathIn: S.isBreathIn,
    team: teamSize(S.model),
    isCheer: isCheering(S.model),
    isCold: S.isCold,
  }
}

/** Writes where Claude is drawn, only when the place or x changed. */
async function place($: EngineInterface): Promise<void> {
  const spot = spotNow()
  const key = spotKey(spot)

  if (key === S.spotKey) {
    return
  }

  S.spotKey = key

  try {
    await $.state.set(SPOT_REF, spot)
  } catch (error) {
    S.spotKey = ''
    debug($, `place not written: ${messageOf(error)}`)
  }
}

/** One animation step; the 250 ms timer's body. */
async function tick($: EngineInterface): Promise<void> {
  try {
    if (!isDrawing() || !S.options.animate || !isBusy(S.activity)) {
      S.ticker = stop(S.ticker)

      return
    }

    S.step = (S.step + 1) % STEP_WRAP
    await draw($)
  } catch (error) {
    debug($, `tick failed: ${messageOf(error)}`)
  }
}

function scheduleBlink($: EngineInterface, ms: number): void {
  S.blinker = $.clock.after(ms, () => {
    void blink($)
  })
}

/**
 * The idle blink, one phase at a time while idle: open for BLINK_EVERY_MS,
 * then half shut, shut and half shut again, each for its BLINK phase's ms.
 */
async function blink($: EngineInterface): Promise<void> {
  try {
    S.blinker = null

    if (!isDrawing() || !S.options.animate || S.activity !== 'idle') {
      S.blinkAt = 0

      return
    }

    S.blinkAt = (S.blinkAt + 1) % (BLINK.length + 1)
    scheduleBlink($, S.blinkAt === 0 ? BLINK_EVERY_MS : (BLINK[S.blinkAt - 1]?.ms ?? BLINK_EVERY_MS))
    await draw($)
  } catch (error) {
    debug($, `blink failed: ${messageOf(error)}`)
  }
}

/** The idle breath: idle and idleUp in turn, every BREATH_MS, while idle. */
async function breathe($: EngineInterface): Promise<void> {
  try {
    if (!isDrawing() || !S.options.animate || S.activity !== 'idle') {
      S.breather = stop(S.breather)
      S.isBreathIn = false

      return
    }

    S.isBreathIn = !S.isBreathIn
    await draw($)
  } catch (error) {
    debug($, `breath failed: ${messageOf(error)}`)
  }
}

/** Asleep: the next frame of the sleep loop, frosted while the vitals say the prompt cache is cold. */
async function snore($: EngineInterface): Promise<void> {
  try {
    if (!isDrawing() || !S.options.animate || S.activity !== 'asleep') {
      S.sleeper = stop(S.sleeper)

      return
    }

    S.step = (S.step + 1) % STEP_WRAP
    S.isCold = await isCacheCold($)
    await draw($)
  } catch (error) {
    debug($, `sleep frame failed: ${messageOf(error)}`)
  }
}

function scheduleWander($: EngineInterface): void {
  S.wanderer = $.clock.after(nextWait(S.rng), () => {
    void wander($)
  })
}

/** The wait is over: an idle Claude starts his next move, its first step now and one per tick after. */
async function wander($: EngineInterface): Promise<void> {
  try {
    S.wanderer = null

    if (!canWander() || S.walker !== null) {
      return
    }

    const now = await $.clock.now()
    const vitals = await vitalsOf($)

    // the read took a moment: the session may have moved on, or another move begun
    if (!canWander() || S.walker !== null) {
      return
    }

    const date = new Date(now)
    const gated = gatedMoves(vitals, date.getMonth(), date.getDate(), S.options.seasonal)
    const move = chooseMove(S.rng, S.x, S.wanderRange, { gated, isDrowsy: now - idleSince(S.model) >= DROWSY_MS })

    S.steps = move.steps
    S.stepAt = 0
    S.walker = $.clock.every(TICK_MS, () => {
      void walk($)
    })
    await walk($)
  } catch (error) {
    debug($, `wander failed: ${messageOf(error)}`)
  }
}

/** One step of the move under way; past its last, the move ends and the next wait begins. */
async function walk($: EngineInterface): Promise<void> {
  try {
    if (!canWander() || S.steps === undefined) {
      stopWander()

      return
    }

    const step = S.steps[S.stepAt]

    if (step === undefined) {
      stopWander()
      scheduleWander($)
      await draw($)

      return
    }

    S.stepAt += 1
    S.moveFrame = step.frame
    S.x = step.x
    await draw($)
  } catch (error) {
    debug($, `walk failed: ${messageOf(error)}`)
  }
}

/** Runs the tick while busy; the blink, the breath and the wander while idle; the sleep loop asleep. */
function syncAnimation($: EngineInterface): void {
  const isAnimated = isDrawing() && S.options.animate

  if (isAnimated && isBusy(S.activity)) {
    if (S.ticker === null) {
      S.ticker = $.clock.every(TICK_MS, () => {
        void tick($)
      })
    }
  } else {
    S.ticker = stop(S.ticker)
  }

  if (isAnimated && S.activity === 'idle') {
    if (S.blinker === null) {
      S.blinkAt = 0
      scheduleBlink($, BLINK_EVERY_MS)
    }

    if (S.breather === null) {
      S.isBreathIn = false
      S.breather = $.clock.every(BREATH_MS, () => {
        void breathe($)
      })
    }
  } else {
    S.blinker = stop(S.blinker)
    S.blinkAt = 0
    S.breather = stop(S.breather)
    S.isBreathIn = false
  }

  if (isAnimated && S.activity === 'asleep') {
    if (S.sleeper === null) {
      S.sleeper = $.clock.every(SLEEP_FRAME_MS, () => {
        void snore($)
      })
    }
  } else {
    S.sleeper = stop(S.sleeper)
  }

  if (canWander()) {
    if (S.wanderer === null && S.walker === null) {
      scheduleWander($)
    }
  } else {
    stopWander()
  }
}

/**
 * One `after` for the next change no event brings: decay, sleep, a forgotten
 * call. Left alone when an event did not move its time (tool calls in a turn).
 */
function scheduleWake($: EngineInterface, now: number): void {
  const ms = nextChangeIn(S.model, now)
  const at = ms === undefined ? undefined : now + ms

  if (S.waker !== null && at === S.wakeAt) {
    return
  }

  S.waker = stop(S.waker)
  S.wakeAt = undefined

  if (ms === undefined) {
    return
  }

  S.waker = $.clock.after(ms, () => {
    void wake($)
  })
  S.wakeAt = at
}

async function wake($: EngineInterface): Promise<void> {
  try {
    S.waker = null
    S.wakeAt = undefined
    await refresh($, await $.clock.now())
  } catch (error) {
    debug($, `wake failed: ${messageOf(error)}`)
  }
}

/**
 * Works out what is shown now and brings the timers and $.state in line:
 * a new activity starts its loop at its first frame. Never throws.
 */
async function refresh($: EngineInterface, now: number): Promise<void> {
  try {
    if (!isLive()) {
      return
    }

    if (!isDrawing() && !isNarrating()) {
      cancelTimers()
      await endDemo($)

      return
    }

    const doing = shown(S.model, now)
    const busy = isBusy(doing.activity)

    if (busy !== S.wasBusy) {
      S.wasBusy = busy
      S.busySince = now
    }

    if (doing.activity !== S.activity) {
      S.activity = doing.activity
      S.step = 0
      S.blinkAt = 0
      S.isBreathIn = false

      // falling asleep: frosted from the first frame when the prompt cache has gone cold
      if (S.activity === 'asleep' && isDrawing()) {
        S.isCold = await isCacheCold($)
      }
    }

    try {
      syncAnimation($)
      scheduleWake($, now)
    } catch (error) {
      debug($, `timers not set: ${messageOf(error)}`)
    }

    await writeDoing($, doing)
    await draw($)
  } catch (error) {
    debug($, `refresh failed: ${messageOf(error)}`)
  }
}

/** The clock's time, or undefined (logged) when it cannot be read. */
async function nowOf($: EngineInterface): Promise<number | undefined> {
  try {
    return await $.clock.now()
  } catch (error) {
    debug($, `clock not read: ${messageOf(error)}`)

    return undefined
  }
}

/** True while the main loop's spinner drew Claude within SPINNER_FRESH_MS: his seat there still holds. */
async function isSpinnerFresh($: EngineInterface): Promise<boolean> {
  const now = await nowOf($)

  return now !== undefined && now - S.spinnerAt <= SPINNER_FRESH_MS
}

/** Starts the session's coworker; on a hot reload, takes over what $.state holds. */
async function start($: EngineInterface): Promise<void> {
  try {
    cancelTimers()

    const now = await $.clock.now()

    S.model = newModel(now)
    S.activity = 'idle'
    S.step = 0
    S.blinkAt = 0
    S.isBreathIn = false
    S.isCold = false
    S.vitals = undefined
    S.wasBusy = false
    S.busySince = now
    S.rng = seeded(now)
    await readSessionId($)
    await adopt($)
    await reserve($)
    await reserveDefault($)
    if (S.gestures) {
      greeted(S.model, now)
    }

    await refresh($, now)
    redraw($)
  } catch (error) {
    debug($, `start failed: ${messageOf(error)}`)
  }
}

/**
 * Reads what the host holds, so a value it already has is not written again;
 * a tour step the module no longer plays (a reload, a /resume) is taken off
 * the band.
 */
async function adopt($: EngineInterface): Promise<void> {
  S.isOff = await read($, IS_OFF)
  S.viewKey = viewKey(await read($, VIEW))
  S.doingKey = doingKey(await read($, DOING))

  const spot = await read($, SPOT)

  S.spotKey = spotKey(spot)
  S.x = Number.isFinite(spot.x) ? Math.max(0, Math.min(WANDER_RANGE[sizeNow()].full, Math.floor(spot.x))) : 0
  S.demoKey = demoKey(await read($, DEMO))

  if (S.demo === undefined) {
    await writeDemo($, NO_DEMO)
  }
}

/**
 * Keeps the machine-wide default reserve (the status bus's .reserve-default)
 * equal to the line this session reserved: the status line holds those cells
 * for a session with no .reserve of its own yet, so the next session's first
 * status line, drawn before this mod starts there, already leaves Claude his
 * cells. Written when the file differs, and when it is a day old (the status
 * line's daily sweep deletes bus files untouched for three days); a release
 * (an empty line) never writes it. Never throws.
 */
async function reserveDefault($: EngineInterface): Promise<void> {
  try {
    const line = S.reserve?.line
    const path = reserveDefaultPath(S.home)

    if (!isLive() || line === undefined || line === '' || path === undefined) {
      return
    }

    // asked first, so a missing file (the first start, or after the sweep) costs no failed read in the debug log
    const text = (await $.fs.exists(path).catch(() => false)) ? await $.fs.read(path).catch(() => undefined) : undefined
    const stat = text === line ? await $.fs.stat(path).catch(() => undefined) : undefined
    const now = await $.clock.now()

    if (text === line && stat !== undefined && now - stat.mtimeMs < RESERVE_REFRESH_MS) {
      return
    }

    await $.fs.write(path, line)
  } catch (error) {
    debug($, `default reserve not written: ${messageOf(error)}`)
  }
}

/** A tour step's identity: '' for none. */
function demoKey(demo: CoworkerDemo): string {
  const label = typeof demo.label === 'string' ? demo.label : ''

  return isFrameName(demo.frame) ? `${demo.frame}|${label}` : ''
}

/** Writes the tour's step the band draws, only when it changed. Never throws. */
async function writeDemo($: EngineInterface, demo: CoworkerDemo): Promise<void> {
  const key = demoKey(demo)

  if (key === S.demoKey) {
    return
  }

  S.demoKey = key

  try {
    await $.state.set(DEMO_REF, demo)
  } catch (error) {
    // unknown now: the next write goes through, whatever it is
    S.demoKey = '?'
    debug($, `demo step not drawn: ${messageOf(error)}`)
  }
}

/** Ends the tour: its timer stops and the band draws nothing again. Never throws. */
async function endDemo($: EngineInterface): Promise<void> {
  S.demoTimer = stop(S.demoTimer)
  S.demo = undefined
  await writeDemo($, NO_DEMO)
}

/** Shows the tour's step on screen and waits its length for the next; past the last, the tour ends. Never throws. */
async function showDemo($: EngineInterface): Promise<void> {
  try {
    const demo = S.demo
    const step = demo?.steps[demo.at]

    if (demo === undefined || step === undefined || !isLive()) {
      await endDemo($)

      return
    }

    S.demoTimer = $.clock.after(step.ms, () => {
      void nextDemo($)
    })
    await writeDemo($, { frame: step.frame, label: step.label })
  } catch (error) {
    debug($, `demo stopped: ${messageOf(error)}`)
    await endDemo($)
  }
}

/** The tour's timer: the next step. */
async function nextDemo($: EngineInterface): Promise<void> {
  try {
    S.demoTimer = null

    if (S.demo === undefined) {
      return
    }

    S.demo.at += 1
    await showDemo($)
  } catch (error) {
    debug($, `demo step failed: ${messageOf(error)}`)
  }
}

/** `/coworker demo`: starts the tour, or stops the one under way; the reply. */
async function toggleDemo($: EngineInterface): Promise<string> {
  if (S.demo !== undefined) {
    await endDemo($)

    return 'demo stopped'
  }

  if (!isLive()) {
    return 'headless session, nothing is drawn here; the demo plays in an interactive terminal'
  }

  if (S.isOff) {
    return 'switched off for this session: /coworker on first, then /coworker demo'
  }

  if (!S.options.sprite) {
    return 'the sprite option is off, so there is no Claude to show; it is in /config'
  }

  if (S.model.isTurnRunning) {
    return 'the demo plays between turns and a turn is running: /coworker demo again once it ends'
  }

  const steps = demoSteps(S.options.animate)
  const seconds = Math.round(steps.reduce((sum, step) => sum + step.ms, 0) / 1000)

  S.demo = { steps, at: 0 }
  await showDemo($)

  if (S.demo === undefined) {
    return 'the demo could not start; the debug log (claude --debug) says why'
  }

  const what = S.options.animate ? 'every animation once' : 'every animation by its first frame (the animate option is off)'

  return `demo: ${what}, ${DEMO_ACTS} acts in ${seconds}s, in the band above the prompt; /coworker demo again stops it, and so does a new turn`
}

/** The loop an event came from: its agent id, or '' for the main loop. */
function loopOf(e: unknown): string {
  const id = (e as { agent_id?: unknown }).agent_id

  return typeof id === 'string' ? id : ''
}

/** A tool call of `loop` ended (done, failed or denied); `isFailure` when it failed. */
async function ended($: EngineInterface, id: string, tool: string, input: unknown, loop: string, isFailure = false): Promise<void> {
  if (!isLive()) {
    return
  }

  try {
    const now = await nowOf($)

    if (now !== undefined) {
      toolEnded(S.model, id, tool, input, now, loop)

      // a flinch for the main loop's own failed call; an agent's failures are its own business
      if (isFailure && loop === '' && S.gestures) {
        toolFailed(S.model, now)
      }

      await refresh($, now)
    }
  } catch (error) {
    debug($, `tool end not recorded: ${messageOf(error)}`)
  }
}

/** Records the session's background work as a stop hook reports it; an event without the list changes nothing. */
async function background($: EngineInterface, tasks: unknown): Promise<void> {
  if (!isLive() || !Array.isArray(tasks)) {
    return
  }

  try {
    const now = await nowOf($)

    if (now !== undefined) {
      backgroundSeen(S.model, tasks.length, now)
      await refresh($, now)
    }
  } catch (error) {
    debug($, `background work not recorded: ${messageOf(error)}`)
  }
}

/** `/coworker off` and `/coworker on`. */
async function setOff($: EngineInterface, isOff: boolean): Promise<void> {
  // the host first: if it refuses the write, the module must not believe a switch the render hooks never saw
  await $.state.set(IS_OFF_REF, isOff)
  S.isOff = isOff

  await reserve($)

  if (isOff) {
    // the tour goes too
    cancelTimers()
    await endDemo($)
    redraw($)

    return
  }

  const now = await nowOf($)

  if (now !== undefined) {
    await refresh($, now)
  }

  redraw($)
}

async function statusOf($: EngineInterface): Promise<string> {
  const now = (await nowOf($)) ?? 0
  const doing: CoworkerDoing = S.isInteractive ? shown(S.model, now) : { activity: 'idle', word: '' }
  const forMs = isBusy(doing.activity) ? now - S.busySince : now - idleSince(S.model)
  const step = S.demo?.steps[S.demo.at]
  const demo = step === undefined ? undefined : { act: step.act + 1, of: DEMO_ACTS, label: step.label }

  return statusText({ isInteractive: S.isInteractive, isOff: S.isOff, options: S.options, doing, forMs, demo })
}

/**
 * A command's answer: with a screen, dim transcript rows the model never
 * reads; headless, the command's text (all `claude -p "/coworker"` prints).
 */
function reply($: EngineInterface, text: string): { text?: string } {
  if (!S.isInteractive) {
    return { text }
  }

  try {
    for (const line of text.split('\n')) {
      $.ui.log(line)
    }

    return {}
  } catch {
    return { text }
  }
}

// ---------------------------------------------------------------------------

export const register: Register = (on, options) => {
  S.isInteractive = false
  S.options = {
    sprite: options.sprite !== false,
    narrate: options.narrate !== false,
    animate: options.animate !== false,
    picture: options.picture !== false,
    besideSpinner: options.besideSpinner !== false,
    big: options.big !== false,
    scenes: options.scenes !== false,
    seasonal: options.seasonal !== false,
  }
  S.gestures = options.gestures !== false
  S.isOff = false
  S.model = newModel(0)
  S.activity = 'idle'
  S.step = 0
  S.blinkAt = 0
  S.isBreathIn = false
  S.isCold = false
  S.doingKey = ''
  S.viewKey = ''
  S.wasBusy = false
  S.busySince = 0
  S.ticker = null
  S.blinker = null
  S.breather = null
  S.sleeper = null
  S.waker = null
  S.wakeAt = undefined
  S.spotKey = ''
  S.x = 0
  S.rng = seeded(0)
  S.wanderer = null
  S.walker = null
  S.steps = undefined
  S.stepAt = 0
  S.moveFrame = undefined
  S.wanderRange = WANDER_RANGE.big.full
  S.root = undefined
  S.spinnerAt = 0
  S.sessionId = undefined
  S.home = undefined
  S.reserve = undefined
  S.vitals = undefined
  S.isEnded = false
  S.demo = undefined
  S.demoTimer = null
  S.demoKey = ''

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: COMMAND,
        description: 'Claude by the prompt footer: what he is doing; on or off for this session; demo plays every animation once',
        argumentHint: '[on | off | demo]',
        immediate: true,
      })
    } catch (error) {
      debug($, `/${COMMAND} was not registered: ${messageOf(error)}`)
    }

    S.isInteractive = e.isInteractive
    S.isEnded = false

    try {
      S.root = $.plugin.root
    } catch (error) {
      debug($, `plugin directory not read: ${messageOf(error)}`)
    }

    if (e.isInteractive) {
      await start($)
    } else {
      cancelTimers()
    }

    return next(e)
  })

  // /clear resets $.state, and /resume and /branch (source `fork`) move to another session id,
  // none of them through session.start: take the new id, read $.state again, move the reserve
  // (and keep the machine-wide default in step); a tour ends with the session it played in
  on('classic.SessionStart', async ($, e, next) => {
    const result = await next(e)

    if (S.isInteractive && e.source !== 'startup' && e.source !== 'compact') {
      try {
        S.isEnded = false
        await endDemo($)
        await readSessionId($, e.session_id)
        await adopt($)
        await reserve($)
        await reserveDefault($)

        const now = await nowOf($)

        if (now !== undefined) {
          await refresh($, now)
        }

        redraw($)
      } catch (error) {
        debug($, `new session not adopted: ${messageOf(error)}`)
      }
    }

    return result
  })

  on('session.end', async ($, e, next) => {
    // a tour ends with the session it played in (a /clear or /resume too; the next one's adopt clears the band)
    S.demoTimer = stop(S.demoTimer)
    S.demo = undefined

    if (e.reason !== 'clear' && e.reason !== 'resume') {
      // for good: a late tool event must not start the timers again
      cancelTimers()
      S.isEnded = true
    }

    // the reserve was this session's; after a /clear the next id reserves its own
    await release($)

    return next(e)
  })

  // The main loop's turn: a subagent's run raises no turn.start (and the check is kept in case one does).
  on('turn.start', async ($, e, next) => {
    if (isLive() && (e as { agentId?: unknown }).agentId === undefined) {
      try {
        // the tour plays between turns: a new one ends it
        await endDemo($)

        const now = await nowOf($)

        if (now !== undefined) {
          turnStarted(S.model, now)
          S.spinnerAt = now
          await refresh($, now)

          // a session open for days: keep the reserve file younger than the status line's sweep
          if (S.reserve !== undefined && S.reserve.line !== '' && now - S.reserve.at > RESERVE_REFRESH_MS) {
            await reserve($, true)
          }
        }
      } catch (error) {
        debug($, `turn start not recorded: ${messageOf(error)}`)
      }
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (isLive() && e.agentId !== undefined) {
      try {
        // an agent's run ended: a dialog of its cannot still be open
        agentEnded(S.model, e.agentId)

        const now = await nowOf($)

        if (now !== undefined) {
          await refresh($, now)
        }
      } catch (error) {
        debug($, `agent end not recorded: ${messageOf(error)}`)
      }
    }

    if (isLive() && e.agentId === undefined) {
      try {
        const now = await nowOf($)

        if (now !== undefined) {
          // a hop for a turn that ended with an answer (a cheer after a long one), none after an interrupt or an error
          turnEnded(S.model, now, S.gestures && !e.isAborted && e.reason === 'answer', e.durationMs)
          // the engine takes its spinner down with the turn: the footer has him at once
          S.spinnerAt = 0
          await refresh($, now)
        }
      } catch (error) {
        debug($, `turn end not recorded: ${messageOf(error)}`)
      }
    }

    return next(e)
  })

  // A call is in flight once the PreToolUse chain let it through; never changed here.
  on('classic.PreToolUse', async ($, e, next) => {
    const result = await next(e)

    if (isLive() && result.deny === undefined) {
      try {
        const now = await nowOf($)

        if (now !== undefined) {
          toolStarted(S.model, e.tool_use_id, String(e.tool), e, now)
          await refresh($, now)
        }
      } catch (error) {
        debug($, `tool start not recorded: ${messageOf(error)}`)
      }
    }

    return result
  })

  on('classic.PostToolUse', async ($, e, next) => {
    await ended($, e.tool_use_id, e.tool_name, e.tool_input, loopOf(e))

    return next(e)
  })

  on('classic.PostToolUseFailure', async ($, e, next) => {
    await ended($, e.tool_use_id, e.tool_name, e.tool_input, loopOf(e), true)

    return next(e)
  })

  on('classic.PermissionDenied', async ($, e, next) => {
    await ended($, e.tool_use_id, e.tool_name, e.tool_input, loopOf(e))

    return next(e)
  })

  // A dialog opens only when nothing beneath decided the ask. The API has no event for its
  // answer, so `needs you` lasts until that loop's call ends or its turn does.
  on('classic.PermissionRequest', async ($, e, next) => {
    const result = await next(e)

    if (isLive() && (result as { decision?: unknown }).decision === undefined) {
      try {
        const now = await nowOf($)

        if (now !== undefined) {
          permissionAsked(S.model, now, loopOf(e), e.tool_name)
          await refresh($, now)
        }
      } catch (error) {
        debug($, `permission ask not recorded: ${messageOf(error)}`)
      }
    }

    return result
  })

  // What still runs in the background when a loop stops (shells, agents, workflows): while
  // that is not nothing, Claude keeps the calls in flight and neither idles nor sleeps.
  on('classic.Stop', async ($, e, next) => {
    await background($, e.background_tasks)

    return next(e)
  })

  on('classic.SubagentStop', async ($, e, next) => {
    await background($, (e as { background_tasks?: unknown }).background_tasks)

    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    try {
      const verb = parseCommand(e.args)

      if (verb === 'status') {
        return reply($, await statusOf($))
      }

      if (verb === 'unknown') {
        return reply($, USAGE)
      }

      if (e.origin.kind !== 'composer') {
        return reply($, `/${COMMAND} ${verb} works only when typed at the prompt (this run came from ${e.origin.kind}); nothing changed`)
      }

      if (verb === 'demo') {
        return reply($, await toggleDemo($))
      }

      await setOff($, verb === 'off')

      return reply(
        $,
        verb === 'off'
          ? 'off for this session: no Claude by the footer, and the spinner keeps its own words. /coworker on brings both back'
          : `on for this session: ${(await statusOf($)).split('\n')[0] ?? ''}`,
      )
    } catch (error) {
      return reply($, `failed: ${messageOf(error)}`)
    }
  })

  // The footer's mode labels, then the caption, Claude and the cells he wanders; only the labels
  // while he sits beside the main loop's spinner.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    if (!S.isInteractive || !S.options.sprite || e.surface !== 'terminal') {
      return next(e)
    }

    let tree: RenderElement | undefined

    try {
      const spot = (await read($, IS_OFF)) ? undefined : await read($, SPOT)
      // the frame is read before the choice, so the footer follows the frames while he sits beside
      // the spinner too: that is how it notices the spinner has stopped drawing him
      const view = spot === undefined ? undefined : normalView(await read($, VIEW))
      // his seat beside the spinner holds while that site keeps drawing him, wherever the spot says he is
      const isBeside = spot !== undefined && isBesideOn() && (await isSpinnerFresh($))

      if (spot !== undefined && view !== undefined && !isBeside) {
        const size = sizeNow()
        const isCompact = (e.viewport?.columns ?? RESERVE[size].compactBelow) < RESERVE[size].compactBelow
        const isPicture = S.options.picture
        // the footer draws solo frames only: a scene's own solo frame stands in for it
        const frame = soloOf(view.frame)
        const box = boxOf(frame, size)
        const pieces: Piece[] = footerPieces(e.props.modes, { ...view, sprite: brailleOf(frame) }, { isCompact, x: spot.x, isPicture, size })
        const file = isPicture ? frameFile(rootOf($), frame) : ''
        const { Box, Text, Image } = $.ui.resolve(e)

        S.wanderRange = wanderRoom(isCompact, isPicture, size)
        tree = (
          <Box flexDirection="row">
            {pieces.map(piece =>
              isPicture && isClaude(piece) ? (
                <Image key="claude" source={{ file, format: 'png' }} columns={box.columns} rows={box.rows} alt={piece.text} />
              ) : piece.tone === 'dim' ? (
                <Text dimColor wrap="truncate">
                  {piece.text}
                </Text>
              ) : piece.tone === 'blank' ? (
                <Text wrap="truncate">{piece.text}</Text>
              ) : (
                <Text color={piece.tone === 'claude' ? CLAUDE_COLOR : ASLEEP_COLOR} wrap="truncate">
                  {piece.text}
                </Text>
              ),
            )}
          </Box>
        )
      }
    } catch (error) {
      debug($, `footer not drawn: ${messageOf(error)}`)
      tree = undefined
    }

    return tree ?? next(e)
  })

  // The main loop's spinner: its word says what is happening (message, suffix, glyph, time and
  // tokens stay the engine's), and while the main turn runs Claude sits left of the whole line.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    const isMain = e.requestId === MAIN_SPINNER || (S.sessionId !== undefined && e.requestId === S.sessionId)
    const canSit = isBesideOn() && e.surface === 'terminal'

    if (!S.isInteractive || !isMain || e.props.message !== null || (!S.options.narrate && !canSit)) {
      return next(e)
    }

    let word: string | undefined
    let claude: { alt: string; file: string; frame: FrameName } | undefined

    try {
      if (!(await read($, IS_OFF))) {
        // he sits beside the main spinner whenever the engine draws it, whether or not the mod saw
        // the turn start: a /goal's later iterations draw it again with the turn still open
        const isSitting = canSit
        // what the spinner says (narrate on) or would say: the scene beside it follows it either way
        const saying = S.options.narrate || isSitting ? narration(await read($, DOING), e.props.mode) : undefined

        if (S.options.narrate) {
          word = saying
        }

        // the frame is read only while he sits here, so the line redraws at the frame rate only then
        if (isSitting) {
          // the scene for the word and the mode (a pen while writing, a scroll for a skill, ...) where
          // scenes may be drawn, else its solo frame
          const scene = sceneFor(normalView(await read($, VIEW)).frame, saying ?? e.props.word, e.props.mode)
          const frame = spinnerFrame(scene, S.options.scenes, sizeNow())

          claude = { alt: brailleOf(frame), file: frameFile(rootOf($), frame), frame }
          const wasStale = !(await isSpinnerFresh($))

          S.spinnerAt = (await nowOf($)) ?? S.spinnerAt

          // the footer still had him: it gives him up now, not at his next frame
          if (wasStale) {
            redraw($)
          }
        }
      }
    } catch (error) {
      debug($, `spinner not read: ${messageOf(error)}`)
      word = undefined
      claude = undefined
    }

    const said = word === undefined || word === e.props.word ? e : { ...e, props: { ...e.props, word } }

    if (claude === undefined || e.surface !== 'terminal') {
      return next(said)
    }

    const line = await next(said)

    try {
      const { Box, Text, Image } = $.ui.resolve(e)
      const size = sizeNow()
      const box = boxOf(claude.frame, size)
      const picture = <Image key="claude" source={{ file: claude.file, format: 'png' }} columns={box.columns} rows={box.rows} alt={claude.alt} />
      // where scenes are drawn, his seat is a scene's width and a space whatever the frame, so the
      // spinner line keeps its place when a solo frame (the flinch) comes between two scenes; the
      // text after him pads it as a sibling of his row, never inside it: the engine centers a picture
      // in the row Box that holds it, so a solo frame in a 13-cell row drew two cells right and
      // clipped (seen in Ghostty, 2026-10-02)
      const isSceneSeat = S.options.scenes && size === 'big'

      // the engine's line opens with a blank row (seen in a live 2.1.287 session): the two-row
      // picture spans that row and the line, the line's text right of him on the second row; the
      // one-row picture steps down one row to sit on the line itself. Neither shrinks when the
      // line is long.
      return (
        <Box flexDirection="row">
          {isSceneSeat ? (
            <Box flexDirection="row" flexShrink={0}>
              {picture}
            </Box>
          ) : null}
          {isSceneSeat ? (
            <Text>{' '.repeat(SCENE_BOX.columns + 1 - box.columns)}</Text>
          ) : size === 'big' ? (
            <Box flexDirection="row" flexShrink={0}>
              {picture}
              <Text> </Text>
            </Box>
          ) : (
            <Box flexDirection="row" flexShrink={0} marginTop={SPINNER_ROW}>
              {picture}
              <Text> </Text>
            </Box>
          )}
          {line}
        </Box>
      )
    } catch (error) {
      debug($, `Claude not drawn beside the spinner: ${messageOf(error)}`)

      return line
    }
  })

  // `/coworker demo`: the tour's step in the band above the prompt, the picture as the spinner or
  // the footer would draw it and, right of it, what it is and the frame's name; over whatever the
  // mods beneath draw there. Nothing while no tour runs, on another surface, or under a survey.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!S.isInteractive || e.surface !== 'terminal' || e.props.hasSurvey) {
      return next(e)
    }

    let row: RenderElement | undefined

    try {
      const demo = await read($, DEMO)

      if (isFrameName(demo.frame)) {
        const size = sizeNow()
        // a scene where scenes may be drawn, else its solo frame
        const frame = spinnerFrame(demo.frame, S.options.scenes, size)
        const box = boxOf(frame, size)
        const alt = brailleOf(frame)
        const label = `${typeof demo.label === 'string' ? demo.label : ''} · ${frame}`
        // his seat is the widest frame's and a space, so the label holds its place from frame to frame:
        // a scene's, a solo frame's with scenes off, the 5-cell braille's (or alt's) in one row
        const seat = size === 'big' ? (S.options.scenes ? SCENE_BOX.columns : PICTURE.big.columns) + 1 : [...alt].length + 1
        // the seat is padded by the text after him, never by a minWidth on his box: with one, a solo
        // frame in a scene-wide seat drew shifted right and clipped (Ghostty, 2026-10-02)
        const width = S.options.picture ? box.columns : [...alt].length
        const { Box, Text, Image } = $.ui.resolve(e)
        const picture = S.options.picture ? (
          <Image key="demo" source={{ file: frameFile(rootOf($), frame), format: 'png' }} columns={box.columns} rows={box.rows} alt={alt} />
        ) : (
          <Text color={poseOf(frame) === 'sleep' ? ASLEEP_COLOR : CLAUDE_COLOR}>{alt}</Text>
        )

        // a two-row picture gets a two-row label column beside it (a blank over the label), as the
        // engine's spinner line sits beside him: in a one-row band the picture was squashed into the
        // row, and with a label row under the seat the band grew to three rows (seen 2026-10-02)
        row =
          S.options.picture && box.rows > 1 ? (
            <Box flexDirection="row">
              <Box flexDirection="row" flexShrink={0}>
                {picture}
              </Box>
              <Text>{' '.repeat(seat - width)}</Text>
              <Box flexDirection="column">
                <Text> </Text>
                <Text dimColor wrap="truncate">
                  {label}
                </Text>
              </Box>
            </Box>
          ) : (
            <Box flexDirection="row">
              <Box flexDirection="row" flexShrink={0}>
                {picture}
              </Box>
              <Text>{' '.repeat(seat - width)}</Text>
              <Text dimColor wrap="truncate">
                {label}
              </Text>
            </Box>
          )
      }
    } catch (error) {
      debug($, `demo not drawn: ${messageOf(error)}`)
      row = undefined
    }

    if (row === undefined) {
      return next(e)
    }

    // keep the bands of the mods beneath this one (mize-ops-health, mize-ci-watch, mize-railway-meter)
    const below = await next(e)

    try {
      const { Box } = $.ui.resolve(e)

      return (
        <Box flexDirection="column">
          {row}
          {below}
        </Box>
      )
    } catch (error) {
      debug($, `demo not drawn: ${messageOf(error)}`)

      return below
    }
  })
}
