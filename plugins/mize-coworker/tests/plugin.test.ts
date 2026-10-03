// The hooks through the engine: the footer drawing (the picture, or the
// braille with `picture` off), Claude beside the main spinner while a turn
// runs (the 12x2 scenes, the scene each spinner word and mode puts there, or
// solo frames with `scenes` off), the spinner word, the idle life (breath,
// the three-phase blink, the wander and its vitals- and date-gated moves), the
// sleep loop and its cold form, the done gesture's two forms, the team, the
// 250 ms timer and the writes it makes (mock.clock), subagent turns,
// /coworker and its demo tour in the band above the prompt, the reserve and
// its machine-wide default, reduced motion, headless runs, and stubs that
// throw.

import type { On, PromptOrigin } from 'claude-code'
import { expect, mock, test, type Engine } from 'claude-code/testing'

import { DEMO_ACTS, demoActs, demoSteps } from '../hooks/lib/demo'

const PLUGIN = 'mize-coworker'
const IDLE = '⢼⢽⠿⡯⡧'
const BLINK = '⢼⢿⠿⡿⡧'
const FOCUS = '⢼⢯⠿⡽⡧'
const LOOK_L = '⢼⢽⠿⡽⡧'
const STEP_A = '⡼⡽⠿⢯⢧'
const STEP_B = '⠼⣽⠿⣯⠧'
const HOP = '⠺⠺⠛⠗⠗'
const SLEEP = '⢴⢶⠶⡶⡦'
const WAVE = '⢼⢽⠿⡯⡏'
const FLINCH = '⢸⢿⠿⡿⡇'
const LOOK_R = '⢼⢯⠿⡯⡧'
const ARMS_IN = '⢸⢽⠿⡯⡇'
const START = 1_000_000
const ORANGE = '#d97757'
const MUTED = '#7d5a50'

type World = {
  /** Transcript lines: command replies and the observer's records. */
  logs: string[]
  /** The plugin's debug lines. */
  debug: string[]
  registered: string[]
  /** The tool_use_id of every call that reached the tool. */
  toolIds: string[]
  /** Every `$.ui.invalidate(event)` the plugin made. */
  invalidated: string[]
  /** What the chain beneath answers a PermissionRequest with (nothing: the dialog opens). */
  permission: Record<string, unknown>
}

function world(): World {
  return { logs: [], debug: [], registered: [], toolIds: [], invalidated: [], permission: {} }
}

/** Claude Code's side of every call the plugin makes. */
function stubs(on: On, w: World): void {
  on('session.start', () => ({ cwd: '/work' }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('command.register', ($, e) => {
    w.registered.push(e.name)

    return { value: { command: e.name } }
  })
  on('ui.log', ($, e) => {
    ;(e.to === 'debug' ? w.debug : w.logs).push(e.text)

    return { value: undefined }
  })
  on('ui.invalidate', ($, e) => {
    w.invalidated.push(e.event)

    return { value: undefined }
  })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', ($, e) => {
    w.toolIds.push(e.tool_use_id)

    return { result: 'ok' }
  })
  // no settings hooks beneath: the classic events answer nothing
  on('classic.PostToolUse', () => ({}))
  on('classic.PostToolUseFailure', () => ({}))
  on('classic.PermissionDenied', () => ({}))
  on('classic.PermissionRequest', () => w.permission)
  on('classic.SessionStart', () => ({}))
  on('classic.Stop', () => ({}))
  on('classic.SubagentStop', () => ({}))
  // the engine's own drawings: its labels, and its spinner line; and what the mods beneath draw in the band
  on('ui.render', { component: 'SessionMode' }, ($, e) => ({ type: 'Text', props: { dimColor: true }, children: [e.props.modes.join(' & ')] }))
  on('ui.render', { component: 'Spinner' }, ($, e) => ({ type: 'Text', props: {}, children: [`${e.props.message ?? e.props.word}${e.props.suffix}`] }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Text', props: {}, children: ['beneath'] }))
}

/**
 * An inline plugin that records, through `$.ui.log`, every value the plugin
 * writes to $.state and every clock wait it asks for. It runs in an
 * environment of its own (no closure over this file).
 */
const observer = {
  name: 'coworker-observer',
  register(on2: On) {
    on2('state.set', { plugin: 'mize-coworker', key: 'view' }, async ($2, e, next) => {
      $2.ui.log(`set view ${JSON.stringify({ ...(e.value as object), at: await $2.clock.now() })}`)

      return next(e)
    })
    on2('state.set', { plugin: 'mize-coworker', key: 'doing' }, async ($2, e, next) => {
      $2.ui.log(`set doing ${JSON.stringify(e.value)}`)

      return next(e)
    })
    on2('state.set', { plugin: 'mize-coworker', key: 'isOff' }, async ($2, e, next) => {
      $2.ui.log(`set isOff ${JSON.stringify(e.value)}`)

      return next(e)
    })
    on2('state.set', { plugin: 'mize-coworker', key: 'spot' }, async ($2, e, next) => {
      $2.ui.log(`set spot ${JSON.stringify({ ...(e.value as object), at: await $2.clock.now() })}`)

      return next(e)
    })
    on2('state.set', { plugin: 'mize-coworker', key: 'demo' }, async ($2, e, next) => {
      $2.ui.log(`set demo ${JSON.stringify({ ...(e.value as object), at: await $2.clock.now() })}`)

      return next(e)
    })
    on2('clock.every', async ($2, e, next) => {
      $2.ui.log(`every ${e.ms}`)

      return next(e)
    })
    on2('clock.after', async ($2, e, next) => {
      $2.ui.log(`after ${e.ms}`)

      return next(e)
    })
  },
}

type View = { frame: string; sprite: string; caption: string; isAsleep: boolean }
/** A view write and the clock's time when it was made. */
type ViewAt = View & { at: number }
type Doing = { activity: string; word: string }
/** A spot write and the clock's time when it was made. */
type Spot = { where: 'footer' | 'spinner'; x: number; at: number }
/** A tour step written for the band, and the clock's time when it was written. */
type DemoAt = { frame: string; label: string; at: number }

function writes<T>(w: World, key: 'view' | 'doing' | 'isOff' | 'spot' | 'demo'): T[] {
  const lead = `set ${key} `

  return w.logs.filter(text => text.startsWith(lead)).map(text => JSON.parse(text.slice(lead.length)) as T)
}

function views(w: World): View[] {
  return writes<ViewAt>(w, 'view').map(({ at: _, ...view }) => view)
}

function viewsAt(w: World): ViewAt[] {
  return writes<ViewAt>(w, 'view')
}

/** The frames written, in order. */
function frames(w: World): string[] {
  return views(w).map(view => view.frame)
}

function doings(w: World): Doing[] {
  return writes<Doing>(w, 'doing')
}

function spots(w: World): Spot[] {
  return writes<Spot>(w, 'spot')
}

function demos(w: World): DemoAt[] {
  return writes<DemoAt>(w, 'demo')
}

/** How many clock waits of a kind were asked for (an interval asks once per period), of one length if given. */
function waits(w: World, kind: 'every' | 'after', ms?: number): number {
  return w.logs.filter(text => (ms === undefined ? text.startsWith(`${kind} `) : text === `${kind} ${ms}`)).length
}

async function start($: Engine, isInteractive = true): Promise<void> {
  await $.session.start({ surface: isInteractive ? 'terminal' : null, isInteractive, cwd: '/work' })
}

async function run($: Engine, args: string, origin: PromptOrigin = { kind: 'composer' }): Promise<string | undefined> {
  const out = await $.command.run({ command: 'coworker', args, origin, presentation: { isFullscreen: true, columns: 160 } })

  return out.text
}

async function turnStart($: Engine, turnId = 't1'): Promise<void> {
  await $.turn.start({ text: 'go', turnId })
}

async function turnEnd($: Engine, agentId?: string, durationMs = 5): Promise<void> {
  await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs, isAborted: false, reason: 'answer', ...(agentId === undefined ? {} : { agentId }) })
}

/** A tool call through the engine (classic.PreToolUse runs on the way); its tool_use_id. */
async function call($: Engine, w: World, input: Record<string, unknown> & { tool: string }): Promise<string> {
  await $.tool.call(input as never)

  return w.toolIds.at(-1) ?? ''
}

async function done($: Engine, id: string, tool: string, input: Record<string, unknown>): Promise<void> {
  await $.classic.PostToolUse({ tool_name: tool, tool_input: input, tool_response: 'ok', tool_use_id: id })
}

async function footer($: Engine, modes: string[] = [], surface: 'terminal' | 'desktop' = 'terminal') {
  return $.ui.mount({ plugin: PLUGIN, surface, component: 'SessionMode', requestId: 'session-mode', props: { modes } })
}

type SpinnerProps = { word: string; message: string | null; suffix: string; mode: 'requesting' | 'responding' | 'thinking' | 'tool-input' | 'tool-use' }

async function spinner($: Engine, over: Partial<SpinnerProps> = {}, requestId = 'main') {
  const props: SpinnerProps = { word: 'Sauteing', message: null, suffix: '…', mode: 'thinking', ...over }

  return $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Spinner', requestId, props })
}

type Drawing = { find: (query: { type?: string; text?: string | RegExp }) => Promise<{ text: string; props: Record<string, unknown> } | undefined>; findAll: (query: { type?: string }) => Promise<{ text: string; props: Record<string, unknown> }[]> }

/** The engine's own spinner line in a drawing: the last Text (Claude and a space come before it while he sits there). */
async function lineOf(ui: Drawing): Promise<string> {
  return (await ui.findAll({ type: 'Text' })).at(-1)?.text ?? ''
}

async function spinnerText($: Engine, over: Partial<SpinnerProps> = {}, requestId = 'main'): Promise<string> {
  const ui = await spinner($, over, requestId)
  const text = await lineOf(ui)

  await ui.unmount()

  return text
}

/** Claude in a drawing as the picture: its alt (the frame's braille), the PNG it names, its box. */
async function pictureIn(ui: Drawing): Promise<{ alt: unknown; file: unknown; format: unknown; columns: unknown; rows: unknown; key: unknown } | undefined> {
  const image = await ui.find({ type: 'Image' })

  if (image === undefined) {
    return undefined
  }

  const source = image.props.source as { file?: unknown; format?: unknown }

  return { alt: image.props.alt, file: source.file, format: source.format, columns: image.props.columns, rows: image.props.rows, key: image.props.key }
}

/** Claude beside the main spinner: the picture, or undefined when the line is the engine's alone. */
async function besideSpinner($: Engine, over: Partial<SpinnerProps> = {}, requestId = 'main') {
  const ui = await spinner($, over, requestId)
  const picture = await pictureIn(ui)

  await ui.unmount()

  return picture
}

/** Claude in the footer: the picture (`as: 'image'`, its alt as the text) or the colored braille (`as`: its color). */
async function spritePiece($: Engine, modes: string[] = []): Promise<{ text: string; as: unknown } | undefined> {
  const ui = await footer($, modes)
  const picture = await pictureIn(ui)
  const all = await ui.findAll({ type: 'Text' })
  const sprite = all.find(element => element.props.color !== undefined)

  await ui.unmount()

  if (picture !== undefined) {
    return { text: String(picture.alt), as: 'image' }
  }

  return sprite === undefined ? undefined : { text: sprite.text, as: sprite.props.color }
}

/** The PNG the footer's picture names now, by frame name ('' when none is drawn). */
async function footerFrame($: Engine): Promise<string> {
  const ui = await footer($)
  const picture = await pictureIn(ui)

  await ui.unmount()

  return /\/([A-Za-z0-9]+)\.png$/.exec(String(picture?.file ?? ''))?.[1] ?? ''
}

/** The PNG a frame's picture names. */
const PNG = (frame: string): RegExp => new RegExp(`^/.*/assets/frames/${frame}\\.png$`)

const READ = { tool: 'Read', file_path: '/work/hooks/register.ts' }
const BASH = { tool: 'Bash', command: 'TOKEN=abc curl -H "Authorization: x" https://h' }

test('headless: /coworker answers, and nothing is drawn, written or scheduled', { plugins: [observer] }, async ($, on) => {
  const w = world()

  stubs(on, w)
  mock.clock(on, { now: START })
  await start($, false)

  expect(w.registered).toEqual(['coworker'])
  expect(await run($, '', { kind: 'sdk' })).toBe(
    'headless session, nothing is drawn here; in an interactive terminal: sprite on, narration on, animation on',
  )
  expect(await run($, 'off', { kind: 'sdk' })).toMatch(/^\/coworker off works only when typed at the prompt \(this run came from sdk\); nothing changed$/)

  await turnStart($)
  const id = await call($, w, READ)

  await done($, id, 'Read', READ)
  await turnEnd($)

  const ui = await footer($, ['focus'])

  expect((await ui.find({ type: 'Text' }))?.text).toBe('focus')
  expect(await ui.find({ text: IDLE })).toBeUndefined()
  await ui.unmount()
  expect(await spinnerText($)).toBe('Sauteing…')

  expect(views(w)).toEqual([])
  expect(doings(w)).toEqual([])
  expect(writes(w, 'isOff')).toEqual([])
  expect(waits(w, 'every')).toBe(0)
  expect(waits(w, 'after')).toBe(0)
})

test('interactive: Claude sits after the engine\'s labels, idle, breathing every 2 s and blinking every 6 s, and only on the terminal', { options: { gestures: false }, plugins: [observer] }, async ($, on) => {
  const w = world()

  stubs(on, w)
  const clock = mock.clock(on, { now: START })

  await start($)

  // the host already holds the idle frame: nothing is written for it
  expect(views(w)).toEqual([])
  expect(doings(w)).toEqual([])

  const ui = await footer($, ['focus'])
  const labels = await ui.find({ type: 'Text', text: 'focus' })
  const picture = await pictureIn(ui)

  expect(labels?.props.dimColor).toBe(true)
  // the orange picture, 8 cells by 2 rows (over the status row and the mode row under it), its braille as the alt; nothing to his right yet
  expect(picture).toEqual({ alt: IDLE, file: expect.stringMatching(PNG('idle')), format: 'png', columns: 8, rows: 2, key: 'claude' })
  expect((await ui.findAll({ type: 'Text' })).map(t => t.text)).toEqual(['focus', ' '])
  expect((await ui.drawn()).type).toBe('Box')
  await ui.unmount()

  // the breath: idle and idleUp in turn every 2 s (one braille pose, two pictures); the blink at 6 s
  // (half shut 100 ms, shut 200 ms, half shut 100 ms), then the breath again
  await clock.advance(6_000)
  expect(viewsAt(w).map(v => [v.frame, v.at - START])).toEqual([
    ['idleUp', 2_000],
    ['idle', 4_000],
    ['blinkHalf', 6_000],
  ])
  await clock.advance(400)
  expect(viewsAt(w).slice(2).map(v => [v.frame, v.at - START])).toEqual([
    ['blinkHalf', 6_000],
    ['blink', 6_100],
    ['blinkHalf', 6_300],
    ['idleUp', 6_400],
  ])
  expect(views(w).map(v => v.sprite)).toEqual([IDLE, IDLE, BLINK, BLINK, BLINK, IDLE])
  await clock.advance(1_600)
  expect(frames(w).at(-1)).toBe('idle')
  // the next blink 6 s after the eyes opened
  await clock.advance(4_500)
  expect(viewsAt(w).slice(-4).map(v => [v.frame, v.at - START])).toEqual([
    ['idleUp', 10_000],
    ['idle', 12_000],
    ['blinkHalf', 12_400],
    ['blink', 12_500],
  ])
  // no 250 ms timer while idle: the breath is a 2 s one
  expect(waits(w, 'every', 250)).toBe(0)
  expect(waits(w, 'every', 2_000)).toBeGreaterThan(0)

  const desk = await footer($, ['focus'], 'desktop')

  expect(await desk.find({ type: 'Image' })).toBeUndefined()
  expect(await desk.find({ text: IDLE })).toBeUndefined()
  expect((await desk.find({ type: 'Text' }))?.text).toBe('focus')
  await desk.unmount()
})

test('a turn starts the 250 ms timer, unchanged frames are not written, and the turn end stops it', { options: { gestures: false }, plugins: [observer] }, async ($, on) => {
  const w = world()

  stubs(on, w)
  const clock = mock.clock(on, { now: START })

  await start($)
  await turnStart($)

  // thinking: the thought bubble (think1, its solo frame lookUp has the idle pose)
  expect(views(w)).toEqual([{ frame: 'think1', sprite: IDLE, caption: 'thinking', isAsleep: false }])
  expect(doings(w)).toEqual([{ activity: 'thinking', word: '' }])
  expect(waits(w, 'every', 250)).toBeGreaterThan(0)

  // think1 x2, think2 x2, think3 x4: a frame held for several ticks is written once
  await clock.advance(250)
  expect(frames(w)).toEqual(['think1'])
  await clock.advance(250)
  expect(frames(w)).toEqual(['think1', 'think2'])
  await clock.advance(500)
  expect(frames(w)).toEqual(['think1', 'think2', 'think3'])
  await clock.advance(750)
  expect(frames(w)).toHaveLength(3)
  await clock.advance(250)
  expect(frames(w).at(-1)).toBe('think1')

  const id = await call($, w, READ)

  // a new activity starts its loop at its first frame: the book, eyes on the left page
  expect(views(w).at(-1)).toEqual({ frame: 'read1', sprite: FOCUS, caption: 'reading', isAsleep: false })
  expect(doings(w).at(-1)).toEqual({ activity: 'reading', word: 'Reading register.ts' })
  await clock.advance(500)
  expect(frames(w).at(-1)).toBe('read1')
  await clock.advance(250)
  expect(frames(w).at(-1)).toBe('read2')

  await done($, id, 'Read', READ)
  expect(views(w).at(-1)?.caption).toBe('thinking')

  await turnEnd($)
  // the turn is over: its own last call does not linger
  expect(views(w).at(-1)).toEqual({ frame: 'idle', sprite: IDLE, caption: '', isAsleep: false })
  await clock.advance(1_000)
  expect(views(w).at(-1)).toEqual({ frame: 'idle', sprite: IDLE, caption: '', isAsleep: false })
  expect(doings(w).at(-1)).toEqual({ activity: 'idle', word: '' })

  const ticks = waits(w, 'every', 250)

  // idle: no 250 ms ticks, only the breath
  await clock.advance(4_000)
  expect(waits(w, 'every', 250)).toBe(ticks)
  expect(frames(w).slice(-2)).toEqual(['idleUp', 'idle'])

  // asleep 10 idle minutes after the turn ended: muted, the first frame of the sleep loop
  await clock.advance(10 * 60_000 - 5_000)
  expect(views(w).at(-1)).toEqual({ frame: 'sleep1', sprite: SLEEP, caption: '', isAsleep: true })
  expect(doings(w).at(-1)).toEqual({ activity: 'asleep', word: '' })

  // asleep, only the sleep loop runs: one frame every 3 s, no tick, no breath, no blink, no wake timer
  const asleep = { ticks: waits(w, 'every', 250), breaths: waits(w, 'every', 2_000), after: waits(w, 'after'), written: views(w).length }

  await clock.advance(9_000)
  expect(viewsAt(w).slice(-3).map(v => [v.frame, v.at - viewsAt(w).at(-4)!.at])).toEqual([
    ['sleep2', 3_000],
    ['sleep3', 6_000],
    ['sleep1', 9_000],
  ])
  expect(views(w).slice(-3).every(v => v.isAsleep && v.sprite === SLEEP)).toBe(true)
  expect({ ticks: waits(w, 'every', 250), breaths: waits(w, 'every', 2_000), after: waits(w, 'after'), written: views(w).length - 3 }).toEqual(asleep)

  const grey = await footer($, ['focus'])
  const z = await grey.find({ type: 'Text', text: ' z' })

  expect(await pictureIn(grey)).toMatchObject({ alt: SLEEP, file: expect.stringMatching(PNG('sleep1')) })
  expect(z?.props.color).toBe(MUTED)
  await grey.unmount()

  // a tool event wakes it, and the sleep loop stops
  await call($, w, { tool: 'Grep', pattern: 'x' })
  expect(views(w).at(-1)?.caption).toBe('searching')

  const sleeps = waits(w, 'every', 3_000)

  await clock.advance(30_000)
  expect(waits(w, 'every', 3_000)).toBe(sleeps)
})

test('tool calls inside a turn neither reschedule the wake timer nor rewrite an unchanged word', { plugins: [observer] }, async ($, on) => {
  const w = world()

  stubs(on, w)
  mock.clock(on, { now: START })
  await start($)
  await turnStart($)

  const first = await call($, w, { tool: 'Bash', command: 'npm run build' })
  const afters = waits(w, 'after')
  const narrated = doings(w).length

  for (let i = 0; i < 5; i += 1) {
    const id = await call($, w, { tool: 'Bash', command: 'npm test' })

    await done($, id, 'Bash', { command: 'npm test' })
  }

  // the oldest call in flight (the build) still sets the wake time
  expect(waits(w, 'after')).toBe(afters)
  // Running npm throughout: one write when the build started, none since
  expect(doings(w)).toHaveLength(narrated)
  expect(doings(w).at(-1)).toEqual({ activity: 'running', word: 'Running npm' })

  await done($, first, 'Bash', { command: 'npm run build' })
  expect(doings(w).at(-1)).toEqual({ activity: 'thinking', word: '' })
})

test('the footer keeps the engine\'s labels, then the caption and the orange braille, inside the full reserve', { plugins: [observer], options: { picture: false, besideSpinner: false } }, async ($, on) => {
  const w = world()

  stubs(on, w)
  mock.clock(on, { now: START })
  await start($)
  await turnStart($)
  await call($, w, BASH)

  const ui = await footer($, ['focus', 'memory paused'])
  const texts = await ui.findAll({ type: 'Text' })

  expect(texts.map(t => [t.text, t.props.dimColor ?? null, t.props.color ?? null])).toEqual([
    ['focus & memory paused', true, null],
    [' · running ', true, null],
    [STEP_A, null, ORANGE],
  ])

  const added = texts.slice(1).reduce((sum, t) => sum + [...t.text].length, 0)

  expect(added).toBeLessThanOrEqual(18)
  await ui.unmount()

  const solo = await footer($, [])

  expect((await solo.findAll({ type: 'Text' })).map(t => t.text)).toEqual([' running ', STEP_A])
  await solo.unmount()
})

test('a mounted footer follows the frames as they are written', { plugins: [observer], options: { besideSpinner: false } }, async ($, on) => {
  const w = world()

  stubs(on, w)
  const clock = mock.clock(on, { now: START })

  await start($)
  await turnStart($)
  await call($, w, BASH)

  const ui = await footer($)

  // the footer draws the terminal scene's solo frame: run1 and run2 are stepA and stepB, 8 by 2
  expect(await pictureIn(ui)).toMatchObject({ alt: STEP_A, file: expect.stringMatching(PNG('stepA')), columns: 8, rows: 2 })
  await clock.advance(250)
  expect(await pictureIn(ui)).toMatchObject({ alt: STEP_A, file: expect.stringMatching(PNG('stepA')) })
  await clock.advance(250)
  expect(await pictureIn(ui)).toMatchObject({ alt: STEP_B, file: expect.stringMatching(PNG('stepB')), columns: 8, rows: 2 })
  await ui.unmount()
})

test('the spinner word: the main loop\'s only, from the activity, never over a message', { plugins: [observer] }, async ($, on) => {
  const w = world()

  stubs(on, w)
  const clock = mock.clock(on, { now: START })
  await start($)
  await turnStart($)

  expect(await spinnerText($)).toBe('Thinking…')
  expect(await spinnerText($, { mode: 'responding' })).toBe('Writing…')
  expect(await spinnerText($, { mode: 'tool-use' })).toBe('Working…')

  const id = await call($, w, READ)

  expect(await spinnerText($, { mode: 'tool-use' })).toBe('Reading register.ts…')
  // a state override keeps its message, and a subagent's spinner keeps its word
  expect(await spinnerText($, { message: 'Compacting conversation' })).toBe('Compacting conversation…')
  expect(await spinnerText($, {}, 'agent-1')).toBe('Sauteing…')

  await done($, id, 'Read', READ)
  await call($, w, BASH)

  const said = await spinnerText($, { mode: 'tool-use' })

  expect(said).toBe('Running curl…')

  for (const secret of ['abc', 'TOKEN', 'Authorization', 'https']) {
    expect(said.includes(secret)).toBe(false)
  }

  // a mounted spinner is redrawn when the activity changes
  const ui = await spinner($, { mode: 'tool-use' })

  expect(await lineOf(ui)).toBe('Running curl…')
  await call($, w, { tool: 'WebFetch', url: 'https://user:pw@docs.example.com/x?token=1', prompt: 'p' })
  expect(await lineOf(ui)).toBe('Browsing docs.example.com…')
  await ui.unmount()

  // the word rides the doing, which the 250 ms frames never write
  const narrated = doings(w).length

  await clock.advance(2_000)
  expect(doings(w)).toHaveLength(narrated)
})

test('narrate off leaves the spinner alone; sprite off leaves the footer alone', { plugins: [observer], options: { narrate: false, sprite: false } }, async ($, on) => {
  const w = world()

  stubs(on, w)
  const clock = mock.clock(on, { now: START })

  await start($)
  await turnStart($)
  await call($, w, READ)
  await clock.advance(1_000)

  expect(await spinnerText($)).toBe('Sauteing…')
  expect(await spritePiece($, ['focus'])).toBeUndefined()
  expect(views(w)).toEqual([])
  expect(doings(w)).toEqual([])
  expect(waits(w, 'every')).toBe(0)
})

test('subagent turns neither start nor end the main turn', { options: { gestures: false }, plugins: [observer] }, async ($, on) => {
  const w = world()

  stubs(on, w)
  mock.clock(on, { now: START })
  await start($)

  await turnStart($)
  expect(doings(w).at(-1)?.activity).toBe('thinking')

  // a subagent's (or workflow agent's) run ends: the main turn still runs
  await turnEnd($, 'sub-1')
  expect(doings(w).at(-1)?.activity).toBe('thinking')
  expect(doings(w)).toHaveLength(1)

  await turnEnd($)
  expect(doings(w).at(-1)?.activity).toBe('idle')
})

test('a permission ask needs you until the next tool event; a denied call never counts as in flight', { options: { gestures: false }, plugins: [observer] }, async ($, on) => {
  const w = world()

  stubs(on, w)
  on('classic.PreToolUse', ($, e) => (e.tool === 'Write' ? { deny: 'not here' } : {}))
  mock.clock(on, { now: START })
  await start($)
  await turnStart($)

  const id = await call($, w, { tool: 'Bash', command: 'rm -rf build' })

  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'rm -rf build' } })
  // the speech bubble with its exclamation mark, Claude waving
  expect(views(w).at(-1)).toEqual({ frame: 'ask1', sprite: WAVE, caption: 'needs you', isAsleep: false })
  expect(doings(w).at(-1)).toEqual({ activity: 'asking', word: 'Asking you' })

  await $.classic.PostToolUseFailure({ tool_name: 'Bash', tool_input: { command: 'rm -rf build' }, tool_use_id: id, error: 'Exit code 1' })
  expect(doings(w).at(-1)).toEqual({ activity: 'thinking', word: '' })

  // denied beneath: the call is answered as denied, unchanged, and never shows
  const denied = await $.tool.call({ tool: 'Write', file_path: '/work/x.ts', content: 'x' } as never)

  expect(denied).toMatchObject({ isError: true })
  expect(doings(w).at(-1)).toEqual({ activity: 'thinking', word: '' })

  // a call the auto-mode classifier denied ends too
  const id2 = await call($, w, { tool: 'Edit', file_path: '/work/y.ts', old_string: 'a', new_string: 'b' })

  expect(doings(w).at(-1)).toEqual({ activity: 'editing', word: 'Editing y.ts' })
  await $.classic.PermissionDenied({ tool_name: 'Edit', tool_input: {}, tool_use_id: id2, reason: 'denied' })
  expect(doings(w).at(-1)).toEqual({ activity: 'thinking', word: '' })
})

test('/coworker prints the status; off and on from the composer switch both, other origins are refused', { plugins: [observer] }, async ($, on) => {
  const w = world()

  stubs(on, w)
  const clock = mock.clock(on, { now: START })

  await start($)
  await turnStart($)
  await call($, w, READ)
  await clock.advance(2_000)

  // with a screen the reply is dim transcript rows, never text the model reads
  expect(await run($, '')).toBeUndefined()
  expect(w.logs.slice(-3)).toEqual([
    'sprite on, narration on, animation on',
    'Claude is reading (busy for 2s)',
    '/coworker demo plays every animation once, about a minute, in the band above the prompt',
  ])

  expect(await run($, 'off', { kind: 'sdk' })).toBeUndefined()
  expect(w.logs.at(-1)).toBe('/coworker off works only when typed at the prompt (this run came from sdk); nothing changed')
  expect(writes(w, 'isOff')).toEqual([])

  await run($, 'off')
  expect(writes(w, 'isOff')).toEqual([true])
  expect(w.logs.at(-1)).toMatch(/^off for this session/)
  expect(await spritePiece($)).toBeUndefined()
  expect(await spinnerText($)).toBe('Sauteing…')

  const ticks = waits(w, 'every')
  const written = views(w).length

  await clock.advance(5_000)
  await call($, w, { tool: 'Glob', pattern: '*' })
  expect(waits(w, 'every')).toBe(ticks)
  expect(views(w)).toHaveLength(written)

  await run($, '')
  expect(w.logs.at(-3)).toBe('switched off for this session (/coworker on brings it back); options: sprite on, narration on, animation on')

  await run($, 'on', { kind: 'composer' })
  expect(writes(w, 'isOff')).toEqual([true, false])
  expect(w.logs.at(-1)).toBe('on for this session: sprite on, narration on, animation on')
  // the Glob made while off is the newest call in flight: searching, from its first frame, beside
  // the spinner (the turn still runs), and the footer keeps only its labels
  expect(await besideSpinner($, { mode: 'tool-use' })).toMatchObject({ alt: LOOK_L, file: expect.stringMatching(PNG('search1')), columns: 12, rows: 2 })
  expect(await spinnerText($, { mode: 'tool-use' })).toBe('Searching…')
  expect(await spritePiece($)).toBeUndefined()

  await run($, 'frob')
  expect(w.logs.at(-1)).toMatch(/^usage: \/coworker \[on \| off \| demo\]/)
})

test('reduced motion: the first frame of each activity and no 250 ms timer', { plugins: [observer], options: { gestures: false, animate: false } }, async ($, on) => {
  const w = world()

  stubs(on, w)
  const clock = mock.clock(on, { now: START })

  await start($)
  await turnStart($)
  expect(views(w)).toEqual([{ frame: 'think1', sprite: IDLE, caption: 'thinking', isAsleep: false }])

  const id = await call($, w, { tool: 'Bash', command: 'npm test' })

  expect(views(w).at(-1)).toEqual({ frame: 'run1', sprite: STEP_A, caption: 'running', isAsleep: false })
  await clock.advance(3_000)
  expect(views(w)).toHaveLength(2)

  await done($, id, 'Bash', { command: 'npm test' })
  await turnEnd($)
  await clock.advance(8_000)
  expect(views(w).at(-1)).toEqual({ frame: 'idle', sprite: IDLE, caption: '', isAsleep: false })

  // no idle blink or breath either
  const written = views(w).length

  await clock.advance(7_000)
  expect(views(w)).toHaveLength(written)

  // asleep: the first sleep frame, held; no sleep loop
  await clock.advance(10 * 60_000)
  expect(views(w).at(-1)).toEqual({ frame: 'sleep1', sprite: SLEEP, caption: '', isAsleep: true })
  await clock.advance(30_000)
  expect(views(w).at(-1)?.frame).toBe('sleep1')
  expect(waits(w, 'every')).toBe(0)
})

// A stub that throws is skipped by the engine (its own answer stands), so a
// failing host call is a stub that refuses: the plugin's call then rejects.
test('a state.set that fails never escapes a hook', async ($, on) => {
  const w = world()

  stubs(on, w)
  on('state.set', () => ({ deny: 'state store down' }))
  const clock = mock.clock(on, { now: START })

  await start($)
  expect(await $.turn.start({ text: 'go', turnId: 't1' })).toEqual({ turnId: 't1' })

  const ran = await $.tool.call({ tool: 'Read', file_path: '/work/a.ts' } as never)

  expect(ran).toMatchObject({ result: 'ok' })
  await clock.advance(1_000)
  await done($, w.toolIds.at(-1) ?? '', 'Read', { file_path: '/work/a.ts' })
  await turnEnd($)
  expect(w.debug.some(line => /^frame not drawn: .*state store down/.test(line))).toBe(true)
  expect(w.debug.some(line => /^activity not written: .*state store down/.test(line))).toBe(true)
  expect(await run($, 'off')).toBeUndefined()
  expect(w.logs.at(-1)).toMatch(/^failed: .*state store down/)
  // the footer still draws from what the host holds
  expect(await spritePiece($)).toEqual({ text: IDLE, as: 'image' })
})

test('a clock that fails never escapes a hook', async ($, on) => {
  const w = world()

  stubs(on, w)
  on('clock.now', () => ({ deny: 'clock down' }))
  on('clock.every', () => ({ deny: 'clock down' }))
  on('clock.after', () => ({ deny: 'clock down' }))

  await start($)
  expect(w.debug.some(line => /^start failed: .*clock down/.test(line))).toBe(true)
  expect(await $.turn.start({ text: 'go', turnId: 't1' })).toEqual({ turnId: 't1' })
  expect(await $.tool.call({ tool: 'Read', file_path: '/work/a.ts' } as never)).toMatchObject({ result: 'ok' })
  await done($, w.toolIds.at(-1) ?? '', 'Read', { file_path: '/work/a.ts' })
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: {} })
  await turnEnd($)
  expect(w.debug.some(line => /^clock not read: .*clock down/.test(line))).toBe(true)
  expect(await run($, '')).toBeUndefined()
  expect(w.logs.at(-3)).toBe('sprite on, narration on, animation on')
  expect(await $.session.end({ reason: 'other', sessionId: 's1', resume: { id: 's1' } })).toEqual({ sessionId: 's1' })
})

test('timers that cannot be scheduled leave the hooks and the drawing working', { plugins: [observer] }, async ($, on) => {
  const w = world()

  stubs(on, w)
  on('clock.now', () => ({ value: START }))
  on('clock.every', () => ({ deny: 'no timers' }))
  on('clock.after', () => ({ deny: 'no timers' }))

  await start($)
  await turnStart($)
  await call($, w, BASH)
  expect(views(w).at(-1)).toEqual({ frame: 'run1', sprite: STEP_A, caption: 'running', isAsleep: false })
  expect(await besideSpinner($)).toMatchObject({ alt: STEP_A, file: expect.stringMatching(PNG('run1')) })
  // the turn ends with an answer: the hop's first frame (the crouch), back in the footer, held with no timer to move it
  await turnEnd($)
  expect(await spritePiece($)).toEqual({ text: IDLE, as: 'image' })
  expect(await footerFrame($)).toBe('hop1')
})

test('the terminal draws the main spinner under the session id: that one is narrated, an agent id is not', async ($, on) => {
  const w = world()

  stubs(on, w)
  on('session.id', () => ({ value: 'sess-9' }))
  mock.clock(on, { now: START })
  await start($)
  await turnStart($)
  await call($, w, READ)

  expect(await spinnerText($, {}, 'sess-9')).toBe('Reading register.ts…')
  expect(await spinnerText($, {}, 'main')).toBe('Reading register.ts…')
  expect(await spinnerText($, {}, 'agent-7')).toBe('Sauteing…')
})

test('the session start asks for a redraw: the footer was first drawn before the session was known to be interactive', { options: { gestures: false } }, async ($, on) => {
  const w = world()

  stubs(on, w)
  mock.clock(on, { now: START })

  // drawn before session.start: the engine's own labels, no Claude yet
  const early = await footer($, ['focus'])

  expect(await early.find({ type: 'Image' })).toBeUndefined()
  expect(await early.find({ type: 'Text', text: IDLE })).toBeUndefined()
  await early.unmount()

  await start($)
  expect(w.invalidated).toContain('ui.render')
  expect((await spritePiece($))?.text).toBe(IDLE)
})

test('a headless session asks for no redraw', async ($, on) => {
  const w = world()

  stubs(on, w)
  mock.clock(on, { now: START })
  await start($, false)
  expect(w.invalidated).toEqual([])
})

const RESERVE_FILE = '/home/t/.claude/state/statusline/bus/sess-9/.reserve'
const DEFAULT_FILE = '/home/t/.claude/state/statusline/bus/.reserve-default'

/** A file on the stubbed status bus: what was written, and when (its mtime). */
type BusFile = { path: string; text: string; at?: number }

/**
 * Stubs for the status bus: HOME, the session id, and every file the plugin
 * writes, which a read or a stat then finds (each write stamped with `now()`).
 * `read` answers reads in their place (undefined: no such file).
 */
function busStubs(on: On, files: BusFile[], sessionId = () => 'sess-9', options: { now?: () => number; read?: (path: string) => string | undefined } = {}): void {
  const lastOf = (path: string): BusFile | undefined => files.filter(file => file.path === path).at(-1)

  mock.env(on, { HOME: '/home/t' })
  on('session.id', () => ({ value: sessionId() }))
  on('fs.exists', ($, e) => ({ value: files.some(file => file.path === e.path) }))
  on('fs.write', ($, e) => {
    files.push({ path: e.path, text: e.text, at: options.now?.() ?? 0 })

    return { value: undefined }
  })
  on('fs.read', ($, e) => {
    const text = options.read === undefined ? lastOf(e.path)?.text : options.read(e.path)

    return text === undefined ? { deny: 'ENOENT' } : { value: text }
  })
  on('fs.stat', ($, e) => {
    const file = lastOf(e.path)

    return file === undefined ? { deny: 'ENOENT' } : { value: { kind: 'file' as const, size: file.text.length, mtimeMs: file.at ?? 0, isLink: false } }
  })
}

function reserved(files: BusFile[], path = RESERVE_FILE): string | undefined {
  return files.filter(file => file.path === path).at(-1)?.text
}

/** How many times the plugin wrote a file (a file seeded by the test counts too). */
function writesTo(files: BusFile[], path: string): number {
  return files.filter(file => file.path === path).length
}

test('Claude reserves its cells at the right end of the status row, and releases them when switched off or the session ends', async ($, on) => {
  const w = world()
  const files: BusFile[] = []

  stubs(on, w)
  busStubs(on, files)
  mock.clock(on, { now: START })
  await start($)
  expect(reserved(files)).toBe('22\t11\t110\n')
  // and the machine-wide default, the same line, which the status line holds for the next session's start
  expect(reserved(files, DEFAULT_FILE)).toBe('22\t11\t110\n')

  // an unchanged reserve is written once
  await turnStart($)
  await done($, await call($, w, READ), 'Read', READ)
  await turnEnd($)
  expect(writesTo(files, RESERVE_FILE)).toBe(1)

  await run($, 'off')
  expect(reserved(files)).toBe('')
  await run($, 'on')
  expect(reserved(files)).toBe('22\t11\t110\n')

  await $.session.end({ reason: 'prompt_input_exit', sessionId: 'sess-9', resume: { id: 'sess-9' } })
  expect(reserved(files)).toBe('')
  // a release (off, the end) never touches the default
  expect(writesTo(files, DEFAULT_FILE)).toBe(1)
  expect(reserved(files, DEFAULT_FILE)).toBe('22\t11\t110\n')
})

// The default reserve at session start, by what the file held: written when missing or different,
// left alone when equal, written again once a day old (the status line's sweep deletes bus files
// untouched for three days).
for (const [name, seed, isWritten] of [
  ['missing', undefined, true],
  ['equal', { text: '22\t11\t110\n', at: START - 60_000 }, false],
  ['another size', { text: '18\t9\t110\n', at: START - 60_000 }, true],
  ['empty', { text: '', at: START - 60_000 }, true],
  ['equal but a day old', { text: '22\t11\t110\n', at: START - 24 * 60 * 60_000 - 1 }, true],
] as const) {
  test(`the default reserve at session start, the file ${name}: ${isWritten ? 'written' : 'left alone'}`, async ($, on) => {
    const w = world()
    const files: BusFile[] = seed === undefined ? [] : [{ path: DEFAULT_FILE, ...seed }]

    stubs(on, w)
    busStubs(on, files, () => 'sess-9', { now: () => START })
    mock.clock(on, { now: START })
    await start($)
    expect(writesTo(files, DEFAULT_FILE) - (seed === undefined ? 0 : 1)).toBe(isWritten ? 1 : 0)
    expect(reserved(files, DEFAULT_FILE)).toBe('22\t11\t110\n')
    expect(w.debug.filter(line => line.startsWith('default reserve'))).toEqual([])
  })
}

test('the default reserve follows the session when it moves (/clear): another session\'s line there is put back', async ($, on) => {
  const w = world()
  const files: BusFile[] = []
  let sessionId = 'sess-9'

  stubs(on, w)
  busStubs(on, files, () => sessionId, { now: () => START })
  mock.clock(on, { now: START })
  await start($)
  expect(writesTo(files, DEFAULT_FILE)).toBe(1)

  // a session with big off started meanwhile and wrote its own line
  files.push({ path: DEFAULT_FILE, text: '18\t9\t110\n', at: START })
  await $.session.end({ reason: 'clear', sessionId: 'sess-9', resume: { id: 'sess-9' } })
  sessionId = 'sess-10'
  await $.classic.SessionStart({ source: 'clear', session_id: 'sess-10' })
  expect(reserved(files, DEFAULT_FILE)).toBe('22\t11\t110\n')
  expect(writesTo(files, DEFAULT_FILE)).toBe(3)

  // moved again with the line in place: nothing written
  await $.classic.SessionStart({ source: 'resume', session_id: 'sess-10' })
  expect(writesTo(files, DEFAULT_FILE)).toBe(3)
})

test('big off writes its own line to the default; a release, sprite off or a headless session write none', { options: { big: false } }, async ($, on) => {
  const w = world()
  const files: BusFile[] = []

  stubs(on, w)
  busStubs(on, files, () => 'sess-9', { now: () => START })
  mock.clock(on, { now: START })
  await start($)
  expect(reserved(files, DEFAULT_FILE)).toBe('18\t9\t110\n')
  await run($, 'off')
  await $.classic.SessionStart({ source: 'clear', session_id: 'sess-9' })
  expect(writesTo(files, DEFAULT_FILE)).toBe(1)
})

test('after a /clear the reserve moves to the new session id', async ($, on) => {
  const w = world()
  const files: BusFile[] = []
  let sessionId = 'sess-9'

  stubs(on, w)
  busStubs(on, files, () => sessionId)
  mock.clock(on, { now: START })
  await start($)
  await $.session.end({ reason: 'clear', sessionId: 'sess-9', resume: { id: 'sess-9' } })
  expect(reserved(files)).toBe('')

  sessionId = 'sess-10'
  await $.classic.SessionStart({ source: 'clear', session_id: 'sess-10' })
  expect(reserved(files, RESERVE_FILE.replace('sess-9', 'sess-10'))).toBe('22\t11\t110\n')
})

test('nothing is reserved, and no default written, in a headless session', async ($, on) => {
  const w = world()
  const files: BusFile[] = []

  stubs(on, w)
  busStubs(on, files)
  mock.clock(on, { now: START })
  await start($, false)
  expect(files).toEqual([])
})

test('the sprite option off reserves nothing, and says so with an empty file of its own, so the default does not hold its cells; no default is written', { options: { sprite: false } }, async ($, on) => {
  const w = world()
  const files: BusFile[] = [{ path: DEFAULT_FILE, text: '22\t11\t110\n', at: START }]

  stubs(on, w)
  busStubs(on, files)
  mock.clock(on, { now: START })
  await start($)
  expect(files.slice(1)).toEqual([{ path: RESERVE_FILE, text: '', at: 0 }])
})

test('a write the host refuses is logged and nothing escapes', { options: { gestures: false } }, async ($, on) => {
  const w = world()

  stubs(on, w)
  mock.env(on, { HOME: '/home/t' })
  on('session.id', () => ({ value: 'sess-9' }))
  on('fs.exists', () => ({ value: false }))
  on('fs.write', () => ({ deny: 'EACCES' }))
  mock.clock(on, { now: START })
  await start($)
  expect(w.debug.some(text => text.includes('status row not reserved'))).toBe(true)
  expect((await spritePiece($))?.text).toBe(IDLE)
})

test('a narrow terminal draws Claude without the caption, inside the compact reserve', { options: { besideSpinner: false } }, async ($, on) => {
  const w = world()

  stubs(on, w)
  mock.clock(on, { now: START })
  await start($)
  await turnStart($)
  await call($, w, READ)

  const wide = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'SessionMode', requestId: 'session-mode', props: { modes: [] }, viewport: { columns: 150, rows: 40 } })

  expect(await wide.find({ type: 'Text', text: / reading / })).toBeDefined()
  await wide.unmount()

  const narrow = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'SessionMode', requestId: 'session-mode', props: { modes: [] }, viewport: { columns: 100, rows: 40 } })
  const texts = (await narrow.findAll({ type: 'Text' })).map(element => element.text)
  const pictures = await narrow.findAll({ type: 'Image' })

  expect(texts.join('')).not.toMatch(/reading/)
  expect(pictures).toHaveLength(1)
  expect(pictures[0]?.props).toMatchObject({ columns: 8, rows: 2 })
  expect([...texts.join('')].length + 8 * pictures.length).toBeLessThanOrEqual(10)
  await narrow.unmount()
})

test('gestures: a wave when the session opens, a hop when a turn ends with an answer, none after an interrupt', { plugins: [observer] }, async ($, on) => {
  const w = world()

  stubs(on, w)
  const clock = mock.clock(on, { now: START })
  await start($)

  // the wave: two seconds of the raised arm swinging under `hi`, each side held two ticks, then idle with no caption
  expect(views(w).at(-1)).toEqual({ frame: 'wave1', sprite: WAVE, caption: 'hi', isAsleep: false })
  await clock.advance(250)
  expect(views(w)).toHaveLength(1)
  await clock.advance(250)
  expect(views(w).at(-1)).toEqual({ frame: 'wave2', sprite: IDLE, caption: 'hi', isAsleep: false })
  await clock.advance(1_000)
  expect(viewsAt(w).map(v => [v.frame, v.at - START])).toEqual([
    ['wave1', 0],
    ['wave2', 500],
    ['wave1', 1_000],
    ['wave2', 1_500],
  ])
  await clock.advance(750)
  expect(views(w).at(-1)).toEqual({ frame: 'idle', sprite: IDLE, caption: '', isAsleep: false })

  // a turn that ends with an answer: a hop under `done` (crouch, air, landing, idle), gone 1.5 s later
  await turnStart($)
  await turnEnd($)
  expect(views(w).at(-1)).toEqual({ frame: 'hop1', sprite: IDLE, caption: 'done', isAsleep: false })
  await clock.advance(1750)
  expect(views(w).at(-1)).toEqual({ frame: 'idle', sprite: IDLE, caption: '', isAsleep: false })

  // an interrupted turn: no hop
  await turnStart($)
  await $.turn.complete({ turnId: 't1', answer: '', durationMs: 5, isAborted: true, reason: 'aborted' })
  expect(views(w).some(view => view.caption === 'done' && view === views(w).at(-1))).toBe(false)
  expect(views(w).at(-1)?.caption).not.toBe('done')
})

test('gestures: a flinch when the main loop\'s own call fails, at most once in 10 s, and never for an agent\'s', { plugins: [observer] }, async ($, on) => {
  const w = world()

  stubs(on, w)
  const clock = mock.clock(on, { now: START })
  await start($)
  await clock.advance(3000)
  await turnStart($)

  const first = await call($, w, BASH)

  await $.classic.PostToolUseFailure({ tool_name: 'Bash', tool_input: { command: 'false' }, tool_use_id: first, error: 'exit 1' } as never)
  expect(views(w).at(-1)).toEqual({ frame: 'flinch', sprite: FLINCH, caption: 'oops', isAsleep: false })
  // the spinner keeps its own wording through a gesture
  expect(await spinnerText($, { mode: 'thinking' })).toBe('Thinking…')

  // 1.25 s later it is thinking again
  await clock.advance(1500)
  expect(views(w).at(-1)?.caption).toBe('thinking')

  // a second failure within 10 s: no second flinch
  const second = await call($, w, BASH)

  await $.classic.PostToolUseFailure({ tool_name: 'Bash', tool_input: { command: 'false' }, tool_use_id: second, error: 'exit 1' } as never)
  expect(views(w).at(-1)?.caption).not.toBe('oops')

  // an agent's failure, after the 10 s: still none
  await clock.advance(11_000)
  const third = await call($, w, BASH)

  await $.classic.PostToolUseFailure({ tool_name: 'Bash', tool_input: { command: 'false' }, tool_use_id: third, error: 'exit 1', agent_id: 'agent-7' } as never)
  expect(views(w).at(-1)?.caption).not.toBe('oops')
})

test('gestures off: no wave, no hop, no flinch', { plugins: [observer], options: { gestures: false } }, async ($, on) => {
  const w = world()

  stubs(on, w)
  mock.clock(on, { now: START })
  await start($)
  await turnStart($)
  const id = await call($, w, BASH)

  await $.classic.PostToolUseFailure({ tool_name: 'Bash', tool_input: { command: 'false' }, tool_use_id: id, error: 'exit 1' } as never)
  await turnEnd($)
  expect(views(w).filter(view => ['hi', 'done', 'oops'].includes(view.caption))).toEqual([])
})

/** A session that moves to another id without a session.start: the reserve and the spinner must follow. */
async function moved($: Engine, on: On, source: 'fork' | 'resume'): Promise<void> {
  const w = world()
  const files: BusFile[] = []
  let sessionId = 'sess-9'

  stubs(on, w)
  busStubs(on, files, () => sessionId)
  mock.clock(on, { now: START })
  await start($)
  expect(reserved(files)).toBe('22\t11\t110\n')

  // a /branch raises no session.end first: the old id's cells must still go back
  if (source === 'resume') {
    await $.session.end({ reason: 'resume', sessionId: 'sess-9', resume: { id: 'sess-9' } })
  }

  sessionId = 'sess-10'
  await $.classic.SessionStart({ source, session_id: 'sess-10' })
  expect(reserved(files, RESERVE_FILE.replace('sess-9', 'sess-10'))).toBe('22\t11\t110\n')
  expect(reserved(files)).toBe('')

  await turnStart($)
  await call($, w, READ)
  expect(await spinnerText($, {}, 'sess-10')).toBe('Reading register.ts…')
}

test('/branch (source fork) moves the session: the reserve and the spinner follow the new id', async ($, on) => {
  await moved($, on, 'fork')
})

test('/resume moves the session: the reserve and the spinner follow the new id', async ($, on) => {
  await moved($, on, 'resume')
})

test('an ask a hook beneath already decided opens no dialog and shows nothing', { options: { gestures: false }, plugins: [observer] }, async ($, on) => {
  const w = world()

  stubs(on, w)
  w.permission = { decision: { behavior: 'allow' } }
  mock.clock(on, { now: START })
  await start($)
  await turnStart($)
  await call($, w, { tool: 'Bash', command: 'npm test' })
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'npm test' } })
  expect(doings(w).at(-1)).toEqual({ activity: 'running', word: 'Running npm' })
  expect(views(w).some(view => view.caption === 'needs you')).toBe(false)
})

test('another loop\'s tool events leave an open dialog alone; that loop\'s call ending closes it', { options: { gestures: false }, plugins: [observer] }, async ($, on) => {
  const w = world()

  stubs(on, w)
  mock.clock(on, { now: START })
  await start($)
  await turnStart($)

  const rm = await call($, w, { tool: 'Bash', command: 'rm -rf build' })

  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'rm -rf build' } })
  expect(doings(w).at(-1)?.activity).toBe('asking')

  // a background agent reads a file while the dialog is up
  const read = await call($, w, READ)

  expect(doings(w).at(-1)?.activity).toBe('asking')
  await $.classic.PostToolUse({ tool_name: 'Read', tool_input: READ, tool_response: 'ok', tool_use_id: read, agent_id: 'agent-7' } as never)
  expect(doings(w).at(-1)?.activity).toBe('asking')

  // the main loop's rm ends: the ask is over
  await done($, rm, 'Bash', { command: 'rm -rf build' })
  expect(doings(w).at(-1)?.activity).toBe('thinking')
})

test('a session that ended for good stays quiet: a late tool event starts no timer and writes nothing', { options: { gestures: false }, plugins: [observer] }, async ($, on) => {
  const w = world()

  stubs(on, w)
  const clock = mock.clock(on, { now: START })
  await start($)
  await turnStart($)

  const id = await call($, w, BASH)

  await $.session.end({ reason: 'other', sessionId: 's1', resume: { id: 's1' } })

  const before = { every: waits(w, 'every'), after: waits(w, 'after'), views: views(w).length, doings: doings(w).length }

  await done($, id, 'Bash', BASH)
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: {} })
  await turnEnd($)
  await clock.advance(5_000)
  expect({ every: waits(w, 'every'), after: waits(w, 'after'), views: views(w).length, doings: doings(w).length }).toEqual(before)
})

test('a refused /coworker off changes nothing: the next call is still narrated as itself', async ($, on) => {
  const w = world()
  let isRefusing = false

  stubs(on, w)
  on('state.set', ($, e, next) => (isRefusing && e.key === 'isOff' ? { deny: 'state store down' } : next(e)))
  mock.clock(on, { now: START })
  await start($)
  await turnStart($)
  await call($, w, { tool: 'Bash', command: 'npm test' })
  isRefusing = true
  expect(await run($, 'off')).toBeUndefined()
  expect(w.logs.at(-1)).toMatch(/^failed: .*state store down/)
  await call($, w, READ)
  expect(await spinnerText($)).toBe('Reading register.ts…')
})

test('a session open for days rewrites its reserve at a turn start, inside the status line\'s sweep window', async ($, on) => {
  const w = world()
  const files: BusFile[] = []

  stubs(on, w)
  busStubs(on, files)
  const clock = mock.clock(on, { now: START })
  await start($)
  expect(writesTo(files, RESERVE_FILE)).toBe(1)

  // the next day: an unchanged reserve is left alone at 23 h, rewritten past 24 h (an hour at a time:
  // the sleep loop asks for a frame every 3 s, more waits than one advance of the mock clock settles)
  for (let hour = 0; hour < 23; hour += 1) {
    await clock.advance(3_600_000)
  }

  await turnStart($)
  await turnEnd($)
  expect(writesTo(files, RESERVE_FILE)).toBe(1)
  await clock.advance(3_600_000)
  await clock.advance(3_600_000)
  await turnStart($)
  expect(writesTo(files, RESERVE_FILE)).toBe(2)
  expect(reserved(files)).toBe('22\t11\t110\n')
  // the default is the session start's business, not the turn's
  expect(writesTo(files, DEFAULT_FILE)).toBe(1)
})

test('background work the session reports keeps Claude busy after the main turn ends', { options: { gestures: false }, plugins: [observer] }, async ($, on) => {
  const w = world()

  stubs(on, w)
  const clock = mock.clock(on, { now: START })
  await start($)
  await turnStart($)
  await call($, w, { tool: 'Bash', command: 'make all' })
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [{ id: 'b1', type: 'shell', status: 'running', description: 'make all' }] } as never)
  await turnEnd($)

  // ten minutes later the build is still what Claude shows: not idle, not asleep
  await clock.advance(10 * 60_000 + 9_000)
  expect(doings(w).at(-1)).toEqual({ activity: 'running', word: 'Running make' })
  expect(views(w).at(-1)?.isAsleep).toBe(false)

  // the main loop stops again with nothing in the background: back to the usual rules
  await turnStart($)
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [] } as never)
  await turnEnd($)
  await clock.advance(9_000)
  expect(doings(w).at(-1)?.activity).toBe('idle')
})

test('a reload adopts /coworker off from the host: nothing drawn, reserved or scheduled', { plugins: [observer] }, async ($, on) => {
  const w = world()
  const files: BusFile[] = []

  stubs(on, w)
  busStubs(on, files)
  on('state.get', ($, e, next) => (e.key === 'isOff' ? ({ value: { value: true, version: 1 } } as never) : next(e)))
  mock.clock(on, { now: START })
  await start($)
  expect(files.filter(file => file.text !== '')).toEqual([])
  // its own file, empty: the status line holds no default's cells for it
  expect(reserved(files)).toBe('')
  expect(writesTo(files, DEFAULT_FILE)).toBe(0)
  expect(waits(w, 'every')).toBe(0)
  expect(await spritePiece($)).toBeUndefined()
})

test('a call the PreToolUse chain answered with ask still counts as in flight', { options: { gestures: false }, plugins: [observer] }, async ($, on) => {
  const w = world()

  stubs(on, w)
  on('classic.PreToolUse', () => ({ ask: 'confirm this' }) as never)
  mock.clock(on, { now: START })
  await start($)
  await turnStart($)
  await $.tool.call({ tool: 'Edit', file_path: '/work/y.ts', old_string: 'a', new_string: 'b' } as never).catch(() => undefined)
  expect(doings(w).at(-1)).toEqual({ activity: 'editing', word: 'Editing y.ts' })
})

// --- 0.2.0: beside the spinner, and the wander ---------------------------------

test('while the main turn runs Claude sits left of the main spinner\'s whole line, the footer keeps only its labels, and he comes back when it ends', { options: { gestures: false }, plugins: [observer] }, async ($, on) => {
  const w = world()

  stubs(on, w)
  const clock = mock.clock(on, { now: START })

  await start($)
  // the host already holds the footer spot: nothing is written for it
  expect(spots(w)).toEqual([])
  expect(await spritePiece($, ['focus'])).toEqual({ text: IDLE, as: 'image' })
  // a main spinner the engine draws seats him whenever it is drawn, a turn seen or not
  expect(await besideSpinner($)).toBeDefined()

  await turnStart($)
  expect(spots(w).map(spot => [spot.where, spot.x])).toEqual([['spinner', 0]])

  const ui = await spinner($)
  const drawn = (await ui.drawn()) as { type: string; props: Record<string, unknown>; children?: unknown[] }

  // the two-row scene and a space over the engine's blank row and its line (no step down), his seat a
  // scene's width (12 + 1) whatever the frame, then the engine's own line (its word narrated)
  const [claude, , line] = (drawn.children ?? []) as { type?: string; props?: Record<string, unknown>; children?: { type?: string }[] }[]

  expect(drawn.type).toBe('Box')
  expect(drawn.props.flexDirection).toBe('row')
  // his row holds him alone (the engine centers a picture in the row that holds it); the padding is the next sibling
  expect(drawn.children).toHaveLength(3)
  expect(drawn.children?.[1]).toMatchObject({ type: 'Text' })
  expect(claude?.type).toBe('Box')
  expect(claude?.props).toMatchObject({ flexDirection: 'row', flexShrink: 0 })
  expect(claude?.props).not.toHaveProperty('minWidth')
  expect(claude?.props).not.toHaveProperty('marginTop')
  expect((claude?.children ?? []).map(child => child.type)).toEqual(['Image'])
  expect(line?.type).toBe('Text')
  // the thought bubble: a scene of 12 cells by 2, its alt the braille of its solo frame (lookUp, the idle pose)
  expect(await pictureIn(ui)).toEqual({ alt: IDLE, file: expect.stringMatching(PNG('think1')), format: 'png', columns: 12, rows: 2, key: 'claude' })
  expect((await ui.findAll({ type: 'Text' })).map(t => t.text)).toEqual([' ', 'Thinking…'])

  // the footer meanwhile: the engine's labels alone, no Claude, no caption
  const labels = await footer($, ['focus'])

  expect(await labels.find({ type: 'Image' })).toBeUndefined()
  expect((await labels.findAll({ type: 'Text' })).map(t => t.text)).toEqual(['focus'])
  await labels.unmount()

  // a tool call: the word says it, and the mounted line follows Claude's frames: the book, then its right page
  await call($, w, READ)
  expect(await lineOf(ui)).toBe('Reading register.ts…')
  expect(await pictureIn(ui)).toMatchObject({ alt: FOCUS, file: expect.stringMatching(PNG('read1')), columns: 12 })
  await clock.advance(750)
  expect(await pictureIn(ui)).toMatchObject({ alt: FOCUS, file: expect.stringMatching(PNG('read2')), columns: 12 })
  expect(await lineOf(ui)).toBe('Reading register.ts…')

  // the turn ends: the engine takes its spinner down, and he is back in the footer at once
  await ui.unmount()
  await turnEnd($)
  expect(spots(w).map(spot => spot.where)).toEqual(['spinner', 'footer'])
  expect(await spritePiece($, ['focus'])).toEqual({ text: IDLE, as: 'image' })
})

test('the footer takes Claude back when the spinner stops drawing him for a while (a /goal pause), and leaves him again once it does', { options: { gestures: false }, plugins: [observer] }, async ($, on) => {
  const w = world()

  stubs(on, w)
  const clock = mock.clock(on, { now: START })

  await start($)
  await turnStart($)
  expect(spots(w).map(spot => spot.where)).toEqual(['spinner'])

  // the turn just started: the spinner gets its grace before the footer doubts it
  expect(await spritePiece($, ['focus'])).toBeUndefined()

  // the longest hold of one frame passes with no spinner drawn: still his
  await clock.advance(1_500)
  expect(await spritePiece($, ['focus'])).toBeUndefined()

  // the grace runs out with no spinner drawn: the footer has him, the spot untouched
  await clock.advance(1_001)
  expect(await spritePiece($, ['focus'])).toEqual({ text: expect.any(String), as: 'image' })
  expect(spots(w).map(spot => spot.where)).toEqual(['spinner'])

  // the spinner draws him again: the footer goes back to its labels
  const ui = await spinner($)

  expect(await pictureIn(ui)).toBeDefined()
  expect(await spritePiece($, ['focus'])).toBeUndefined()

  // and keeps him while it is mounted: still the labels later
  await clock.advance(750)
  expect(await spritePiece($, ['focus'])).toBeUndefined()
  await ui.unmount()

  // gone past the grace: the footer again
  await clock.advance(2_501)
  expect(await spritePiece($, ['focus'])).toEqual({ text: expect.any(String), as: 'image' })

  await turnEnd($)
  expect(spots(w).map(spot => spot.where)).toEqual(['spinner', 'footer'])
  expect(await spritePiece($, ['focus'])).toEqual({ text: IDLE, as: 'image' })
})

test('a main spinner drawn with no turn start seen (a /goal iteration) seats Claude, asks the footer to redraw, and the footer yields while it keeps drawing him', { options: { gestures: false }, plugins: [observer] }, async ($, on) => {
  const w = world()

  stubs(on, w)
  const clock = mock.clock(on, { now: START })

  await start($)
  await clock.advance(5_000)
  expect(await spritePiece($, ['focus'])).toEqual({ text: IDLE, as: 'image' })

  const before = w.invalidated.length
  const ui = await spinner($)

  expect(await pictureIn(ui)).toBeDefined()
  expect(w.invalidated.slice(before)).toEqual(['ui.render'])
  expect(await spritePiece($, ['focus'])).toBeUndefined()
  // nothing is written for the spot: the seat is the spinner's own doing
  expect(spots(w)).toEqual([])

  // it keeps drawing him: no second redraw asked, the footer still yields
  await clock.advance(1_000)
  expect(await pictureIn(ui)).toBeDefined()
  expect(w.invalidated.slice(before)).toEqual(['ui.render'])
  expect(await spritePiece($, ['focus'])).toBeUndefined()

  await ui.unmount()
  await clock.advance(2_501)
  expect(await spritePiece($, ['focus'])).toEqual({ text: IDLE, as: 'image' })
})

test('a subagent\'s spinner, a spinner message and another surface get no Claude; their words are as before', { options: { gestures: false }, plugins: [observer] }, async ($, on) => {
  const w = world()

  stubs(on, w)
  mock.clock(on, { now: START })
  await start($)
  await turnStart($)

  expect(await besideSpinner($)).toBeDefined()
  expect(await besideSpinner($, {}, 'agent-1')).toBeUndefined()
  expect(await spinnerText($, {}, 'agent-1')).toBe('Sauteing…')
  expect(await besideSpinner($, { message: 'Compacting conversation' })).toBeUndefined()
  expect(await spinnerText($, { message: 'Compacting conversation' })).toBe('Compacting conversation…')

  const desk = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Spinner', requestId: 'main', props: { word: 'Sauteing', message: null, suffix: '…', mode: 'thinking' } })

  expect(await desk.find({ type: 'Image' })).toBeUndefined()
  expect(await lineOf(desk)).toBe('Thinking…')
  await desk.unmount()
})

for (const key of ['besideSpinner', 'picture'] as const) {
  test(`with ${key} off Claude stays in the footer through a turn, and the spinner only gets its word`, { options: { gestures: false, [key]: false }, plugins: [observer] }, async ($, on) => {
    const w = world()

    stubs(on, w)
    mock.clock(on, { now: START })
    await start($)
    await turnStart($)
    await call($, w, READ)

    expect(await besideSpinner($)).toBeUndefined()
    expect(await spinnerText($)).toBe('Reading register.ts…')
    expect(spots(w).filter(spot => spot.where === 'spinner')).toEqual([])
    // the picture off: the orange braille; beside the spinner off: the picture, in the footer; the book's solo frame either way
    expect(await spritePiece($)).toEqual(key === 'picture' ? { text: FOCUS, as: ORANGE } : { text: FOCUS, as: 'image' })

    if (key === 'besideSpinner') {
      expect(await footerFrame($)).toBe('lookDown')
    }
  })
}

test('big off: the 0.2.0 drawing, the picture 4 cells by 1 in the footer and one row down beside the spinner, and the 18 9 110 reserve', { options: { gestures: false, big: false } }, async ($, on) => {
  const w = world()
  const files: BusFile[] = []

  stubs(on, w)
  busStubs(on, files)
  mock.clock(on, { now: START })
  await start($)
  expect(reserved(files)).toBe('18\t9\t110\n')

  const ui = await footer($, ['focus'])

  expect(await pictureIn(ui)).toEqual({ alt: IDLE, file: expect.stringMatching(PNG('idle')), format: 'png', columns: 4, rows: 1, key: 'claude' })
  expect((await ui.findAll({ type: 'Text' })).map(t => t.text)).toEqual(['focus', ' '])
  await ui.unmount()

  await turnStart($)

  const line = await spinner($)
  const drawn = (await line.drawn()) as { type: string; props: Record<string, unknown>; children?: unknown[] }
  const [claude] = (drawn.children ?? []) as { type?: string; props?: Record<string, unknown>; children?: { type?: string }[] }[]

  // the one-row picture steps down past the engine's blank row to sit on its line
  expect(claude?.props).toMatchObject({ marginTop: 1, flexShrink: 0 })
  expect((claude?.children ?? []).map(child => child.type)).toEqual(['Image', 'Text'])
  // no scene in one row: the thought bubble's solo frame, 4 by 1
  expect(await pictureIn(line)).toEqual({ alt: IDLE, file: expect.stringMatching(PNG('lookUp')), format: 'png', columns: 4, rows: 1, key: 'claude' })
  expect(claude?.props).not.toHaveProperty('minWidth')
  expect(await lineOf(line)).toBe('Thinking…')
  await line.unmount()
})

test('picture off: the braille is one row of 5 cells whatever big says, so the 18 9 110 reserve holds', { options: { gestures: false, picture: false } }, async ($, on) => {
  const w = world()
  const files: BusFile[] = []

  stubs(on, w)
  busStubs(on, files)
  mock.clock(on, { now: START })
  await start($)
  expect(reserved(files)).toBe('18\t9\t110\n')
  expect(await spritePiece($)).toEqual({ text: IDLE, as: ORANGE })
})

test('idle, Claude wanders the row: a stroll moves one cell per 250 ms tick on alternating feet and ends idle; asleep he stays put', { plugins: [observer] }, async ($, on) => {
  const w = world()

  stubs(on, w)
  const clock = mock.clock(on, { now: START })

  await start($)
  await clock.advance(5 * 60_000)

  const walk = spots(w)

  expect(walk.length).toBeGreaterThan(0)
  expect(walk.every(spot => spot.where === 'footer' && spot.x >= 0 && spot.x <= 12)).toBe(true)
  expect(walk.some(spot => spot.x > 0)).toBe(true)

  let last = { x: 0, at: START }

  for (const spot of walk) {
    const gap = spot.at - last.at

    // one cell at a time: a tick inside a stroll, or the first step of the next one after a wait of 12 s or more
    expect(Math.abs(spot.x - last.x), `x ${last.x} -> ${spot.x}`).toBe(1)
    expect(gap === 250 || gap >= 12_000, `${gap} ms`).toBe(true)
    last = spot
  }

  // in the order written: every step shows a foot, the feet alternate, and each stroll ends on the idle frame
  let sprite = IDLE
  let lastSpot: Spot | undefined
  let afterSpot: string | undefined

  for (const line of w.logs) {
    if (line.startsWith('set view ')) {
      sprite = (JSON.parse(line.slice('set view '.length)) as View).sprite

      if (afterSpot !== undefined) {
        expect([STEP_A, STEP_B, IDLE]).toContain(sprite)
        expect(sprite).not.toBe(afterSpot)
        afterSpot = undefined
      }
    } else if (line.startsWith('set spot ')) {
      const spot = JSON.parse(line.slice('set spot '.length)) as Spot

      expect([STEP_A, STEP_B]).toContain(sprite)

      if (lastSpot !== undefined && spot.at - lastSpot.at >= 12_000) {
        expect(sprite).toBe(STEP_A)
      }

      afterSpot = sprite
      lastSpot = spot
    }
  }

  // asleep after 10 idle minutes: no more moves, only the sleep loop's timer, and he is drawn where the walk left him
  await clock.advance(6 * 60_000)
  expect(views(w).at(-1)).toMatchObject({ sprite: SLEEP, caption: '', isAsleep: true })

  const asleep = { spots: spots(w).length, every: waits(w, 'every') - waits(w, 'every', 3_000), after: waits(w, 'after') }

  await clock.advance(30 * 60_000)
  expect({ spots: spots(w).length, every: waits(w, 'every') - waits(w, 'every', 3_000), after: waits(w, 'after') }).toEqual(asleep)

  const x = spots(w).at(-1)?.x ?? 0
  const grey = await footer($)
  const texts = (await grey.findAll({ type: 'Text' })).map(t => t.text)

  expect(await pictureIn(grey)).toMatchObject({ alt: SLEEP, file: expect.stringMatching(/\/sleep[123]\.png$/) })
  expect(texts).toEqual(x > 2 ? [' ', ' z', ' '.repeat(x - 2)] : [' ', ' z'])
  await grey.unmount()
})

for (const key of ['gestures', 'animate'] as const) {
  test(`with ${key} off Claude never wanders`, { options: { [key]: false }, plugins: [observer] }, async ($, on) => {
    const w = world()

    stubs(on, w)
    const clock = mock.clock(on, { now: START })

    await start($)
    await clock.advance(5 * 60_000)
    expect(spots(w)).toEqual([])
    expect(w.logs.filter(line => /^after (1[2-9]|2\d)\d{3}$|^after 30000$/.test(line))).toEqual([])
  })
}

// big: the 8-cell picture, a compact reserve of 10 and 1 cell to walk; big off (0.2.0): the 4-cell
// picture counted as its 5-cell alt, a compact reserve of 8 and 2 cells to walk
for (const big of [true, false]) {
  const [cells, compact, walk] = big ? [8, 10, 1] : [5, 8, 2]

  test(`a narrow terminal keeps the wander to ${walk} cell${walk === 1 ? '' : 's'}, inside the compact reserve of ${compact} (big ${big ? 'on' : 'off'})`, { options: { big } }, async ($, on) => {
    const w = world()

    stubs(on, w)
    const clock = mock.clock(on, { now: START })

    await start($)

    const narrow = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'SessionMode', requestId: 'session-mode', props: { modes: [] }, viewport: { columns: 100, rows: 40 } })
    let most = 0

    for (let second = 0; second < 300; second += 1) {
      await clock.advance(1_000)

      const blank = (await narrow.findAll({ type: 'Text' })).map(t => t.text).slice(1).join('')

      most = Math.max(most, blank.length)
      expect(1 + cells + blank.length).toBeLessThanOrEqual(compact)
    }

    await narrow.unmount()
    expect(most).toBe(walk)
    // every step of the walk shows: none is written past what the row can draw
    expect(spots(w).every(spot => spot.x <= walk)).toBe(true)
  })
}

// big: the picture counted as its 8 cells in 22, two cells left of the walk; big off (0.2.0): as its 5-cell alt in 18, one cell left
for (const big of [true, false]) {
  // the room after a 12-cell caption, the spare cell kept free: 1 blank with the 8-cell picture, none with the 5-cell alt
  const [cells, full, left] = big ? [8, 22, 1] : [5, 18, 0]

  test(`a caption shortens the walk: wandered left, Claude still fits the full reserve with labels and a caption, and no turn moves him (big ${big ? 'on' : 'off'})`, { plugins: [observer], options: { besideSpinner: false, big } }, async ($, on) => {
    const w = world()

    stubs(on, w)
    const clock = mock.clock(on, { now: START })

    await start($)

    for (let second = 0; second < 540 && (spots(w).at(-1)?.x ?? 0) < 3; second += 1) {
      await clock.advance(1_000)
    }

    const x = spots(w).at(-1)?.x ?? 0

    expect(x).toBeGreaterThanOrEqual(3)
    await turnStart($)

    const written = spots(w).length
    const ui = await footer($, ['focus', 'memory paused'])
    const texts = await ui.findAll({ type: 'Text' })
    const added = texts.slice(1).reduce((sum, t) => sum + [...t.text].length, 0) + cells

    expect(texts.map(t => t.text).slice(0, 2)).toEqual(['focus & memory paused', ' · thinking '])
    expect(await pictureIn(ui)).toMatchObject({ alt: IDLE })
    expect(added).toBeLessThanOrEqual(full)
    expect(texts.at(-1)?.text).toBe(left > 0 ? ' '.repeat(left) : ' · thinking ')
    await ui.unmount()

    // a running turn: no wander, and he stays where he was
    await clock.advance(60_000)
    expect(spots(w)).toHaveLength(written)
    expect(spots(w).at(-1)?.x).toBe(x)
  })
}

// --- 0.4.0: scenes, the done gesture's two forms, the team, the idle life, the sleep loop, the vitals ---

test('scenes off: beside the spinner too Claude is a solo frame, 8 by 2, in a seat of his own width', { options: { gestures: false, scenes: false }, plugins: [observer] }, async ($, on) => {
  const w = world()

  stubs(on, w)
  const clock = mock.clock(on, { now: START })

  await start($)
  await turnStart($)

  const ui = await spinner($)
  const drawn = (await ui.drawn()) as { children?: { props?: Record<string, unknown> }[] }

  // the thought bubble's solo frame (eyes up), no prop, and no padding: every frame there is 8 wide
  expect(await pictureIn(ui)).toEqual({ alt: IDLE, file: expect.stringMatching(PNG('lookUp')), format: 'png', columns: 8, rows: 2, key: 'claude' })
  expect(drawn.children?.[0]?.props).not.toHaveProperty('minWidth')
  // the state still names the scene: only the drawing gives it up
  expect(frames(w)).toEqual(['think1'])

  await call($, w, { tool: 'Bash', command: 'npm test' })
  expect(await pictureIn(ui)).toMatchObject({ alt: STEP_A, file: expect.stringMatching(PNG('stepA')), columns: 8, rows: 2 })
  await clock.advance(500)
  expect(await pictureIn(ui)).toMatchObject({ alt: STEP_B, file: expect.stringMatching(PNG('stepB')), columns: 8, rows: 2 })
  await ui.unmount()
})

test('each busy activity beside the spinner is its scene, 12 by 2; the footer meanwhile would draw its solo frame', { options: { gestures: false }, plugins: [observer] }, async ($, on) => {
  const w = world()

  stubs(on, w)
  mock.clock(on, { now: START })
  await start($)
  await turnStart($)

  // the call, the scene drawn beside the spinner and its alt (the braille of its solo frame), and the
  // frame the state names: a spinner word swaps the scene in the drawing only, never in the state
  const cases: [Record<string, unknown> & { tool: string }, string, string, string][] = [
    [READ, 'read1', FOCUS, 'read1'],
    [{ tool: 'Grep', pattern: 'x' }, 'search1', LOOK_L, 'search1'],
    [{ tool: 'Edit', file_path: '/work/a.ts', old_string: 'a', new_string: 'b' }, 'type1', ARMS_IN, 'type1'],
    [{ tool: 'Bash', command: 'make' }, 'run1', STEP_A, 'run1'],
    [{ tool: 'WebFetch', url: 'https://example.com', prompt: 'p' }, 'web1', LOOK_R, 'web1'],
    [{ tool: 'WebSearch', query: 'q' }, 'webSearch1', LOOK_R, 'web1'],
    [{ tool: 'Agent', description: 'd', prompt: 'p' }, 'team1a', HOP, 'team1a'],
    [{ tool: 'Workflow', script: 'x' }, 'team1a', HOP, 'team1a'],
    [{ tool: 'AskUserQuestion', questions: [] }, 'ask1', WAVE, 'ask1'],
    [{ tool: 'TodoWrite', todos: [] }, 'work1', IDLE, 'work1'],
    [{ tool: 'Skill', skill: 's' }, 'skill1', FOCUS, 'work1'],
    [{ tool: 'mcp__github__search_repositories', query: 'q' }, 'plug1', ARMS_IN, 'work1'],
  ]

  for (const [input, scene, alt, frame] of cases) {
    const id = await call($, w, input)

    expect(await besideSpinner($, { mode: 'tool-use' }), scene).toEqual({ alt, file: expect.stringMatching(PNG(scene)), format: 'png', columns: 12, rows: 2, key: 'claude' })
    expect(views(w).at(-1)?.frame, scene).toBe(frame)
    await done($, id, input.tool, input)
  }

  // the footer's own drawing of each scene is its solo frame (drawn there with besideSpinner off, or after the turn)
  await turnEnd($)
  expect(await footerFrame($)).toBe('idle')
})

test('besideSpinner off: the footer draws each scene\'s solo frame, 8 by 2, and never a scene', { options: { gestures: false, besideSpinner: false }, plugins: [observer] }, async ($, on) => {
  const w = world()

  stubs(on, w)
  const clock = mock.clock(on, { now: START })

  await start($)
  await turnStart($)

  const seen = new Set<string>()

  for (const input of [READ, { tool: 'Grep', pattern: 'x' }, { tool: 'WebSearch', query: 'q' }, { tool: 'Agent', description: 'd', prompt: 'p' }]) {
    await call($, w, input)

    for (let tick = 0; tick < 12; tick += 1) {
      const ui = await footer($)
      const picture = await pictureIn(ui)

      await ui.unmount()
      expect(picture, `${input.tool} ${tick}`).toMatchObject({ columns: 8, rows: 2 })
      seen.add(/\/([A-Za-z0-9]+)\.png$/.exec(String(picture?.file))?.[1] ?? '')
      await clock.advance(250)
    }
  }

  expect([...seen].sort()).toEqual(['blink', 'hop2', 'idle', 'lookDown', 'lookL', 'lookR'])
})

test('the seat beside the spinner keeps a scene\'s width when a solo frame comes between scenes (the flinch), so the line holds its place', { plugins: [observer] }, async ($, on) => {
  const w = world()

  stubs(on, w)
  const clock = mock.clock(on, { now: START })

  await start($)
  await clock.advance(3_000)
  await turnStart($)

  const first = await call($, w, BASH)

  await $.classic.PostToolUseFailure({ tool_name: 'Bash', tool_input: BASH, tool_use_id: first, error: 'exit 1' } as never)

  const ui = await spinner($)
  const drawn = (await ui.drawn()) as { children?: { props?: Record<string, unknown> }[] }

  expect(await pictureIn(ui)).toMatchObject({ alt: FLINCH, file: expect.stringMatching(PNG('flinch')), columns: 8, rows: 2 })
  // the seat stays 13 wide: the 8-cell flinch and five spaces, never a minWidth (it clipped him)
  expect(drawn.children?.[0]?.props).not.toHaveProperty('minWidth')
  expect((await ui.findAll({ type: 'Text' })).map(t => t.text)[0]).toBe(' '.repeat(5))
  await ui.unmount()
})

test('the done gesture: a hop played once after a short turn, a cheer after one of two minutes or more, each its moment long', { plugins: [observer] }, async ($, on) => {
  const w = world()

  stubs(on, w)
  const clock = mock.clock(on, { now: START })

  await start($)
  await clock.advance(3_000)

  // a short turn: crouch, air, landing, idle; the caption gone at 1.5 s
  await turnStart($)
  await clock.advance(1_000)

  let from = views(w).length

  await turnEnd($, undefined, 1_000)
  await clock.advance(1_000)
  expect(viewsAt(w).slice(from).map(v => [v.frame, v.caption])).toEqual([
    ['hop1', 'done'],
    ['hop2', 'done'],
    ['hop3', 'done'],
    ['idle', 'done'],
  ])
  expect(await footerFrame($)).toBe('idle')
  await clock.advance(500)
  expect(views(w).at(-1)).toEqual({ frame: 'idle', sprite: IDLE, caption: '', isAsleep: false })

  // a long turn (the engine says 3 minutes): arms up, confetti, landing, played once in its 2 s moment
  await turnStart($)
  from = views(w).length
  await turnEnd($, undefined, 180_000)
  await clock.advance(1_750)
  expect(viewsAt(w).slice(from).map(v => [v.frame, v.caption, v.at - (viewsAt(w)[from]?.at ?? 0)])).toEqual([
    ['cheer1', 'done', 0],
    ['cheer2', 'done', 250],
    ['cheer3', 'done', 500],
    ['cheer2', 'done', 750],
    ['cheer3', 'done', 1_000],
    ['idle', 'done', 1_250],
  ])
  await clock.advance(250)
  expect(views(w).at(-1)).toEqual({ frame: 'idle', sprite: IDLE, caption: '', isAsleep: false })

  // an interrupted long turn: neither
  await turnStart($)
  from = views(w).length
  await $.turn.complete({ turnId: 't1', answer: '', durationMs: 300_000, isAborted: true, reason: 'aborted' })
  expect(views(w).slice(from).filter(v => v.caption === 'done')).toEqual([])
})

test('delegating beside the spinner: one helper per delegating call in flight, one, two, then three, and back', { options: { gestures: false }, plugins: [observer] }, async ($, on) => {
  const w = world()

  stubs(on, w)
  const clock = mock.clock(on, { now: START })

  await start($)
  await turnStart($)

  const agent = { tool: 'Agent', description: 'd', prompt: 'p' }
  const one = await call($, w, agent)

  expect(await besideSpinner($)).toMatchObject({ file: expect.stringMatching(PNG('team1a')), alt: HOP, columns: 12 })
  await clock.advance(500)
  expect(await besideSpinner($)).toMatchObject({ file: expect.stringMatching(PNG('team1b')), alt: IDLE })

  const two = await call($, w, { tool: 'Workflow', script: 'x' })

  // a new call of the same activity keeps the loop's step: two helpers at once, then three, and no more than three
  expect(await besideSpinner($)).toMatchObject({ file: expect.stringMatching(PNG('team2b')) })
  await call($, w, agent)
  expect(await besideSpinner($)).toMatchObject({ file: expect.stringMatching(PNG('team3b')) })
  await call($, w, agent)
  expect(await besideSpinner($)).toMatchObject({ file: expect.stringMatching(PNG('team3b')) })
  await clock.advance(500)
  expect(await besideSpinner($)).toMatchObject({ file: expect.stringMatching(PNG('team3a')), alt: HOP })

  // two of the four end: two helpers again
  await done($, one, 'Agent', agent)
  await done($, two, 'Workflow', { script: 'x' })
  expect(await besideSpinner($)).toMatchObject({ file: expect.stringMatching(PNG('team2a')) })
  expect(frames(w).filter(frame => frame.startsWith('team'))).toEqual(['team1a', 'team1b', 'team2b', 'team3b', 'team3a', 'team2a'])
})

/**
 * Stubs for the vitals: the status bus as busStubs gives it, and a vitals file
 * that says `text` (a missing file when undefined); each read of it recorded
 * with its time. Any other file reads as missing (the default reserve).
 */
function vitalsStubs(on: On, clock: { now: () => number }, text: () => string | undefined): { path: string; at: number }[] {
  const reads: { path: string; at: number }[] = []

  busStubs(on, [], () => 'sess-9', {
    now: () => clock.now(),
    read: path => {
      if (path !== VITALS_FILE) {
        return undefined
      }

      reads.push({ path, at: clock.now() })

      return text()
    },
  })

  return reads
}

const VITALS_FILE = '/home/t/.claude/state/statusline/bus/sess-9/.vitals'

test('asleep: a slow loop, one frame every 3 s; frosted (sleepCold) while the vitals say the prompt cache is cold; the vitals read at most every 10 s', { options: { gestures: false }, plugins: [observer] }, async ($, on) => {
  const w = world()

  stubs(on, w)
  const clock = mock.clock(on, { now: START })
  let cache = 'warm'
  const reads = vitalsStubs(on, clock, () => `40\tcalm\tcalm\t${cache}\n`)

  await start($)
  await clock.set(START + 10 * 60_000)
  expect(views(w).at(-1)).toEqual({ frame: 'sleep1', sprite: SLEEP, caption: '', isAsleep: true })

  let from = views(w).length

  await clock.advance(9_000)
  expect(frames(w).slice(from)).toEqual(['sleep2', 'sleep3', 'sleep1'])

  // the cache goes cold: the next read (up to 10 s on) frosts him, and his loop is the cold one
  cache = 'cold'
  from = views(w).length
  await clock.advance(21_000)
  expect(frames(w).slice(from).filter(frame => frame.startsWith('sleepCold')).slice(0, 4)).toEqual(['sleepCold1', 'sleepCold2', 'sleepCold1', 'sleepCold2'])
  expect(views(w).at(-1)).toMatchObject({ sprite: SLEEP, isAsleep: true })

  const grey = await footer($)

  expect(await pictureIn(grey)).toMatchObject({ alt: SLEEP, file: expect.stringMatching(/\/sleepCold[12]\.png$/), columns: 8, rows: 2 })
  await grey.unmount()

  // warm again: back to the warm loop
  cache = 'warm'
  from = views(w).length
  await clock.advance(15_000)
  expect(frames(w).slice(-2).every(frame => /^sleep[123]$/.test(frame))).toBe(true)

  // the file named by the session, read no more than once in 10 s
  expect(reads.length).toBeGreaterThan(3)
  expect(reads.every(read => read.path === VITALS_FILE)).toBe(true)

  for (let i = 1; i < reads.length; i += 1) {
    expect((reads[i]?.at ?? 0) - (reads[i - 1]?.at ?? 0), `read ${i}`).toBeGreaterThanOrEqual(10_000)
  }

  // waking cancels the loop: no more sleep frames, no more reads while busy
  await turnStart($)

  const after = { sleeps: waits(w, 'every', 3_000), reads: reads.length }

  await clock.advance(30_000)
  expect({ sleeps: waits(w, 'every', 3_000), reads: reads.length }).toEqual(after)
})

test('a cold cache when he falls asleep frosts him from the first frame; a missing vitals file is unknown, and he sleeps warm', { options: { gestures: false }, plugins: [observer] }, async ($, on) => {
  const w = world()

  stubs(on, w)
  const clock = mock.clock(on, { now: START })
  let text: string | undefined = '\t\t\tcold\n'

  vitalsStubs(on, clock, () => text)
  await start($)
  await clock.set(START + 10 * 60_000)
  expect(views(w).at(-1)).toEqual({ frame: 'sleepCold1', sprite: SLEEP, caption: '', isAsleep: true })

  // wake, then sleep again with no file at all
  await turnStart($)
  await turnEnd($)
  text = undefined
  await clock.advance(10 * 60_000)
  expect(views(w).at(-1)).toEqual({ frame: 'sleep1', sprite: SLEEP, caption: '', isAsleep: true })
  expect(w.debug.filter(line => line.startsWith('vitals not read'))).toEqual([])
})

/** The idle moves seen over 9 idle minutes (before he sleeps): the frames of the moves the wander drew. */
async function idleMoves($: Engine, on: On, start0: number, vitals: string | undefined): Promise<Set<string>> {
  const w = world()

  stubs(on, w)
  const clock = mock.clock(on, { now: start0 })

  vitalsStubs(on, clock, () => vitals)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

  for (let minute = 0; minute < 9; minute += 1) {
    await clock.advance(60_000)
  }

  return new Set(frames(w))
}

const HOT = '85\tcalm\tcalm\twarm\n'
const CALM = '50\tcalm\twatch\twarm\n'
/** Noon on 26 October 2026 and on 2 October 2026, local time (the worker reads the date in local time). */
const OCT_26 = new Date(2026, 9, 26, 12).getTime()
const OCT_2 = new Date(2026, 9, 2, 12).getTime()

test('idle life: strolls, looks, hops, yawns and sips; no sweat, hourglass or pumpkin while nothing calls for one', { options: { seasonal: true }, plugins: [observer] }, async ($, on) => {
  const seen = await idleMoves($, on, OCT_2, CALM)

  for (const frame of ['stepA', 'lookL', 'hop2', 'idleUp', 'blink']) {
    expect(seen.has(frame), frame).toBe(true)
  }

  // the rarer moves (tests/lib.test.ts holds their shares over thousands of draws)
  expect(seen.has('yawn2') || seen.has('sip2')).toBe(true)

  expect([...seen].filter(frame => /^(sweat|clock|pumpkin)/.test(frame))).toEqual([])
})

test('idle life: a context 80% full or more makes him sweat, about one move in three', { plugins: [observer] }, async ($, on) => {
  const seen = await idleMoves($, on, OCT_2, HOT)

  expect(seen.has('sweat1') && seen.has('sweat2')).toBe(true)
  expect([...seen].filter(frame => /^(clock|pumpkin)/.test(frame))).toEqual([])
})

for (const state of ['over', 'crit'] as const) {
  test(`idle life: a usage window ${state} puts an hourglass in his hands`, { plugins: [observer] }, async ($, on) => {
    const seen = await idleMoves($, on, OCT_2, `20\tcalm\t${state}\twarm\n`)

    expect(seen.has('clock1') && seen.has('clock2')).toBe(true)
    expect([...seen].filter(frame => /^(sweat|pumpkin)/.test(frame))).toEqual([])
  })
}

test('idle life: a usage window at watch, or no vitals file, calls for nothing', { plugins: [observer] }, async ($, on) => {
  const seen = await idleMoves($, on, OCT_2, undefined)

  expect([...seen].filter(frame => /^(sweat|clock|pumpkin)/.test(frame))).toEqual([])
})

test('idle life: in the last week of October he sits by a pumpkin', { plugins: [observer] }, async ($, on) => {
  const seen = await idleMoves($, on, OCT_26, CALM)

  expect(seen.has('pumpkin1') && seen.has('pumpkin2')).toBe(true)
  expect([...seen].filter(frame => /^(sweat|clock)/.test(frame))).toEqual([])
})

test('idle life: seasonal off, no pumpkin even in late October', { options: { seasonal: false }, plugins: [observer] }, async ($, on) => {
  const seen = await idleMoves($, on, OCT_26, CALM)

  expect([...seen].filter(frame => /^pumpkin/.test(frame))).toEqual([])
  expect(seen.has('yawn2') || seen.has('sip2') || seen.has('hop2')).toBe(true)
})

test('a reload over 0.3.1\'s view (no frame name) draws the idle frame and rewrites the view with its name', { options: { gestures: false }, plugins: [observer] }, async ($, on) => {
  const w = world()

  stubs(on, w)
  on('state.get', ($, e, next) => (e.key === 'view' ? ({ value: { value: { sprite: HOP, caption: 'done', isAsleep: false }, version: 3 } } as never) : next(e)))
  mock.clock(on, { now: START })

  // drawn before the session starts: the old value, made whole
  expect(await footerFrame($)).toBe('')
  await start($)
  expect(views(w)).toEqual([{ frame: 'idle', sprite: IDLE, caption: '', isAsleep: false }])
})

// --- 0.5.0: a scene for every spinner word, the footer unchanged, the demo tour --------------------

test('beside the spinner the thought bubble follows the spinner\'s mode: a pen while Writing, the laptop while a tool call is written, the gear while Working', { options: { gestures: false }, plugins: [observer] }, async ($, on) => {
  const w = world()

  stubs(on, w)
  const clock = mock.clock(on, { now: START })

  await start($)
  await turnStart($)

  expect(await besideSpinner($, { mode: 'thinking' })).toMatchObject({ file: expect.stringMatching(PNG('think1')), alt: IDLE, columns: 12 })
  expect(await besideSpinner($, { mode: 'requesting' })).toMatchObject({ file: expect.stringMatching(PNG('think1')) })
  expect(await besideSpinner($, { mode: 'responding' })).toMatchObject({ file: expect.stringMatching(PNG('write1')), alt: FOCUS, columns: 12, rows: 2 })
  expect(await besideSpinner($, { mode: 'tool-input' })).toMatchObject({ file: expect.stringMatching(PNG('type1')), alt: ARMS_IN })
  expect(await besideSpinner($, { mode: 'tool-use' })).toMatchObject({ file: expect.stringMatching(PNG('work1')), alt: IDLE })
  expect(await spinnerText($, { mode: 'responding' })).toBe('Writing…')

  // a mounted spinner follows the loop step for step: think2 is write2, think3 write3
  const ui = await spinner($, { mode: 'responding' })

  await clock.advance(500)
  expect(await pictureIn(ui)).toMatchObject({ file: expect.stringMatching(PNG('write2')), alt: FOCUS })
  await clock.advance(500)
  expect(await pictureIn(ui)).toMatchObject({ file: expect.stringMatching(PNG('write3')), alt: BLINK })
  await ui.unmount()

  // the state names the thought bubble throughout: the swap is the spinner's drawing alone
  expect(frames(w)).toEqual(['think1', 'think2', 'think3'])
})

test('narrate off: the spinner keeps the engine\'s word, and the scene beside it still follows what is happening', { options: { gestures: false, narrate: false }, plugins: [observer] }, async ($, on) => {
  const w = world()

  stubs(on, w)
  mock.clock(on, { now: START })
  await start($)
  await turnStart($)

  const id = await call($, w, { tool: 'Skill', skill: 's' })

  expect(await spinnerText($, { mode: 'tool-use' })).toBe('Sauteing…')
  expect(await besideSpinner($, { mode: 'tool-use' })).toMatchObject({ file: expect.stringMatching(PNG('skill1')), alt: FOCUS })
  await done($, id, 'Skill', { skill: 's' })
  await call($, w, { tool: 'mcp__github__search_repositories', query: 'q' })
  expect(await besideSpinner($, { mode: 'tool-use' })).toMatchObject({ file: expect.stringMatching(PNG('plug1')), alt: ARMS_IN })
})

test('scenes off: beside the spinner the swapped scene\'s own solo frame, 8 by 2', { options: { gestures: false, scenes: false } }, async ($, on) => {
  const w = world()

  stubs(on, w)
  mock.clock(on, { now: START })
  await start($)
  await turnStart($)

  // Writing is the notepad, eyes down on it; the thought bubble's own solo frame looks up
  expect(await besideSpinner($, { mode: 'responding' })).toMatchObject({ file: expect.stringMatching(PNG('lookDown')), columns: 8, rows: 2 })
  expect(await besideSpinner($, { mode: 'thinking' })).toMatchObject({ file: expect.stringMatching(PNG('lookUp')), columns: 8 })

  const id = await call($, w, { tool: 'mcp__github__search_repositories', query: 'q' })

  expect(await besideSpinner($, { mode: 'tool-use' })).toMatchObject({ file: expect.stringMatching(PNG('armsIn')), columns: 8 })
  await done($, id, 'mcp__github__search_repositories', { query: 'q' })
})

test('the footer never swaps: it draws the solo frame of the state\'s own scene whatever the spinner says', { options: { gestures: false, besideSpinner: false } }, async ($, on) => {
  const w = world()

  stubs(on, w)
  mock.clock(on, { now: START })
  await start($)
  await turnStart($)

  // the thought bubble's solo frame (eyes up), even while the spinner would draw the notepad
  expect(await footerFrame($)).toBe('lookUp')
  expect(await spinnerText($, { mode: 'responding' })).toBe('Writing…')

  for (const [input, solo, word] of [
    [{ tool: 'Skill', skill: 's' }, 'idle', 'Loading a skill…'],
    [{ tool: 'mcp__github__search_repositories', query: 'q' }, 'idle', 'Calling github…'],
    [{ tool: 'WebSearch', query: 'q' }, 'lookR', 'Searching the web…'],
  ] as const) {
    const id = await call($, w, input)

    expect(await footerFrame($), input.tool).toBe(solo)
    expect(await spinnerText($, { mode: 'tool-use' }), input.tool).toBe(word)
    expect(await besideSpinner($, { mode: 'tool-use' }), input.tool).toBeUndefined()
    await done($, id, input.tool, input)
  }
})

const BAND = {
  plugin: PLUGIN,
  component: 'AbovePrompt',
  requestId: 'band',
  surface: 'terminal',
  viewport: { columns: 120, rows: 40 },
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

/** The band above the prompt as drawn: Claude's picture (undefined when none), every Text, and the tree. */
async function bandOf($: Engine, props: { hasSurvey?: boolean } = {}, surface: 'terminal' | 'desktop' = 'terminal') {
  const ui = await $.ui.mount({ ...BAND, surface, props: { ...BAND.props, ...props } } as never)
  const picture = await pictureIn(ui)
  const texts = (await ui.findAll({ type: 'Text' })).map(found => found.text)
  const drawn = (await ui.drawn()) as { type: string; props: Record<string, unknown>; children?: unknown[] }

  await ui.unmount()

  return { picture, texts, drawn }
}

/** When each step of the tour starts, from the tour's start, and its whole length. */
function tourTimes(): { starts: number[]; total: number } {
  const starts: number[] = []
  let at = 0

  for (const step of demoSteps()) {
    starts.push(at)
    at += step.ms
  }

  return { starts, total: at }
}

/** When the first step of an act starts, from the tour's start. */
function actStart(label: string): number {
  const act = demoActs().indexOf(label)
  const index = demoSteps().findIndex(step => step.act === act)

  return tourTimes().starts[index] ?? -1
}

test('/coworker demo plays the whole tour in the band above the prompt, each step at its time, then ends by itself; the footer\'s state and the reserve are never written', { options: { gestures: false }, plugins: [observer] }, async ($, on) => {
  const w = world()
  const files: BusFile[] = []

  stubs(on, w)
  busStubs(on, files)
  const clock = mock.clock(on, { now: START })

  await start($)

  const before = { files: files.length, spots: spots(w).length, doings: doings(w).length }
  const { starts, total } = tourTimes()

  expect(await run($, 'demo')).toBeUndefined()
  expect(w.logs.at(-1)).toBe(`demo: every animation once, ${DEMO_ACTS} acts in ${Math.round(total / 1000)}s, in the band above the prompt; /coworker demo again stops it, and so does a new turn`)
  expect(demos(w)).toEqual([{ frame: 'think1', label: 'Thinking', at: START }])
  expect((await bandOf($)).texts).toEqual([' ', ' ', 'Thinking · think1', 'beneath'])

  // the status says which act is on
  await run($, '')
  expect(w.logs.at(-1)).toBe(`demo playing: 1 of ${DEMO_ACTS}, Thinking; /coworker demo again stops it`)

  await clock.advance(total + 1_000)

  // every step once, in order, at its time; then the band is emptied
  expect(demos(w).map(step => [step.frame, step.label, step.at - START])).toEqual([
    ...demoSteps().map((step, index) => [step.frame, step.label, starts[index]]),
    ['', '', total],
  ])
  expect((await bandOf($)).texts).toEqual(['beneath'])
  expect((await bandOf($)).picture).toBeUndefined()

  // the footer went on breathing and blinking and nothing else; no spot, no doing, no file
  expect([...new Set(frames(w))].sort()).toEqual(['blink', 'blinkHalf', 'idle', 'idleUp'])
  expect({ files: files.length, spots: spots(w).length, doings: doings(w).length }).toEqual(before)

  // nothing more once it ended
  const written = demos(w).length

  await clock.advance(10_000)
  expect(demos(w)).toHaveLength(written)
  await run($, '')
  expect(w.logs.at(-1)).toBe('/coworker demo plays every animation once, about a minute, in the band above the prompt')
})

test('the band: the scene 12 by 2 in a seat a scene wide, then the spinner word and the frame, dim; solo frames 8 by 2 in the same seat; over what the mods beneath draw', { options: { gestures: false } }, async ($, on) => {
  const w = world()

  stubs(on, w)
  const clock = mock.clock(on, { now: START })

  await start($)

  // no tour: what the mods beneath draw, untouched
  expect(await bandOf($)).toMatchObject({ picture: undefined, texts: ['beneath'] })

  await run($, 'demo')

  const band = await bandOf($)
  // a two-row picture gets a two-row label column beside it: a blank over the label, as the spinner's line sits beside him
  type Node = { type?: string; props?: Record<string, unknown>; children?: Node[] }
  const [block, below] = (band.drawn.children ?? []) as Node[]
  const [seat, spacer, column] = block?.children ?? []
  const [blank, label] = column?.children ?? []

  expect(band.drawn).toMatchObject({ type: 'Box', props: { flexDirection: 'column' } })
  expect(block).toMatchObject({ type: 'Box', props: { flexDirection: 'row' } })
  expect(seat).toMatchObject({ type: 'Box', props: { flexDirection: 'row', flexShrink: 0 } })
  expect(seat?.props).not.toHaveProperty('minWidth')
  expect((seat?.children ?? []).map(child => child.type)).toEqual(['Image'])
  expect(spacer).toMatchObject({ type: 'Text' })
  expect(column).toMatchObject({ type: 'Box', props: { flexDirection: 'column' } })
  expect(blank).toMatchObject({ type: 'Text' })
  expect(label).toMatchObject({ type: 'Text', props: { dimColor: true, wrap: 'truncate' } })
  expect(below).toMatchObject({ type: 'Text' })
  expect(band.picture).toEqual({ alt: IDLE, file: expect.stringMatching(PNG('think1')), format: 'png', columns: 12, rows: 2, key: 'demo' })
  expect(band.texts).toEqual([' ', ' ', 'Thinking · think1', 'beneath'])

  // Writing: the pen on the notepad, its alt the solo frame's braille (eyes down)
  await clock.advance(actStart('Writing') + 500)
  expect(await bandOf($)).toMatchObject({ picture: { alt: FOCUS, file: expect.stringMatching(PNG('write2')), columns: 12, rows: 2 }, texts: [' ', ' ', 'Writing · write2', 'beneath'] })

  // the greeting: a solo frame, 8 by 2, in the same seat
  await clock.set(START + actStart('greeting'))

  const wave = await bandOf($)
  const waveSeat = ((wave.drawn.children?.[0] as Node)?.children ?? [])[0]

  expect(wave).toMatchObject({ picture: { alt: WAVE, file: expect.stringMatching(PNG('wave1')), columns: 8, rows: 2 }, texts: [' '.repeat(5), ' ', 'greeting · wave1', 'beneath'] })
  expect(waveSeat?.props).not.toHaveProperty('minWidth')

  // another surface, or a survey holding the band: only what lies beneath
  expect(await bandOf($, {}, 'desktop')).toMatchObject({ picture: undefined, texts: ['beneath'] })
  expect(await bandOf($, { hasSurvey: true })).toMatchObject({ picture: undefined, texts: ['beneath'] })
})

test('picture off: the band draws the braille in orange (asleep muted) and the label; big off: solo frames 4 by 1', { options: { gestures: false, picture: false } }, async ($, on) => {
  const w = world()

  stubs(on, w)
  const clock = mock.clock(on, { now: START })

  await start($)
  await run($, 'demo')

  const band = await bandOf($)
  const seat = ((band.drawn.children?.[0] as { children?: { props?: Record<string, unknown> }[] })?.children ?? [])[0]

  // no picture: the thought bubble's solo frame as braille (no scene in one row), a seat of 6
  expect(band.picture).toBeUndefined()
  expect(band.texts).toEqual([IDLE, ' ', 'Thinking · lookUp', 'beneath'])
  expect(seat?.props).not.toHaveProperty('minWidth')

  await clock.set(START + actStart('asleep'))

  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props } } as never)
  const sleeping = await ui.find({ type: 'Text', text: SLEEP })

  expect(sleeping?.props.color).toBe(MUTED)
  await ui.unmount()
})

test('big off: the band draws every frame as the one-row picture, 4 by 1, the scene\'s solo frame in its place', { options: { gestures: false, big: false } }, async ($, on) => {
  const w = world()

  stubs(on, w)
  mock.clock(on, { now: START })
  await start($)
  await run($, 'demo')
  expect(await bandOf($)).toMatchObject({ picture: { alt: IDLE, file: expect.stringMatching(PNG('lookUp')), columns: 4, rows: 1 }, texts: ['  ', 'Thinking · lookUp', 'beneath'] })
})

test('the tour stops at /coworker demo again, at /coworker off, and when a turn starts; it does not start during a turn or while off', { options: { gestures: false }, plugins: [observer] }, async ($, on) => {
  const w = world()

  stubs(on, w)
  const clock = mock.clock(on, { now: START })

  await start($)

  // /coworker demo again
  await run($, 'demo')
  await clock.advance(3_000)
  await run($, 'demo')
  expect(w.logs.at(-1)).toBe('demo stopped')
  expect(demos(w).at(-1)).toMatchObject({ frame: '', label: '' })
  expect((await bandOf($)).texts).toEqual(['beneath'])

  let written = demos(w).length

  await clock.advance(5_000)
  expect(demos(w)).toHaveLength(written)

  // /coworker off: the tour goes with Claude, and none starts while off
  await run($, 'demo')
  await clock.advance(1_000)
  await run($, 'off')
  expect(demos(w).at(-1)).toMatchObject({ frame: '', label: '' })
  await run($, 'demo')
  expect(w.logs.at(-1)).toBe('switched off for this session: /coworker on first, then /coworker demo')
  written = demos(w).length
  await clock.advance(5_000)
  expect(demos(w)).toHaveLength(written)
  await run($, 'on')

  // a turn starts: the tour ends at once, and none starts while the turn runs
  await run($, 'demo')
  await clock.advance(1_000)
  await turnStart($)
  expect(demos(w).at(-1)).toMatchObject({ frame: '', label: '' })
  expect((await bandOf($)).texts).toEqual(['beneath'])
  await run($, 'demo')
  expect(w.logs.at(-1)).toBe('the demo plays between turns and a turn is running: /coworker demo again once it ends')
  written = demos(w).length
  await clock.advance(5_000)
  expect(demos(w)).toHaveLength(written)

  // after the turn it plays again
  await turnEnd($)
  await run($, 'demo')
  expect(demos(w).at(-1)).toMatchObject({ frame: 'think1', label: 'Thinking' })
})

test('/coworker demo: typed at the prompt only; headless or with the sprite option off it plays nothing', { plugins: [observer] }, async ($, on) => {
  const w = world()

  stubs(on, w)
  mock.clock(on, { now: START })
  await start($)
  expect(await run($, 'demo', { kind: 'sdk' })).toBeUndefined()
  expect(w.logs.at(-1)).toBe('/coworker demo works only when typed at the prompt (this run came from sdk); nothing changed')
  expect(demos(w)).toEqual([])
})

test('headless: /coworker demo plays nothing, writes nothing and schedules nothing', { plugins: [observer] }, async ($, on) => {
  const w = world()

  stubs(on, w)
  const clock = mock.clock(on, { now: START })

  await start($, false)
  expect(await run($, 'demo', { kind: 'sdk' })).toBe('/coworker demo works only when typed at the prompt (this run came from sdk); nothing changed')
  expect(await run($, 'demo')).toBe('headless session, nothing is drawn here; the demo plays in an interactive terminal')
  await clock.advance(70_000)
  expect(demos(w)).toEqual([])
  expect(waits(w, 'after')).toBe(0)
  expect(waits(w, 'every')).toBe(0)
  expect((await bandOf($)).texts).toEqual(['beneath'])
})

test('the sprite option off: no Claude to show, so no tour', { options: { sprite: false }, plugins: [observer] }, async ($, on) => {
  const w = world()

  stubs(on, w)
  mock.clock(on, { now: START })
  await start($)
  await run($, 'demo')
  expect(w.logs.at(-1)).toBe('the sprite option is off, so there is no Claude to show; it is in /config')
  expect(demos(w)).toEqual([])
})

test('reduced motion: the tour shows each act\'s first frame, one step per act', { options: { gestures: false, animate: false }, plugins: [observer] }, async ($, on) => {
  const w = world()

  stubs(on, w)
  const clock = mock.clock(on, { now: START })

  await start($)
  await run($, 'demo')
  expect(w.logs.at(-1)).toMatch(/^demo: every animation by its first frame \(the animate option is off\), 30 acts in \d+s, /)
  await clock.advance(80_000)
  expect(demos(w).map(step => step.frame)).toEqual([...demoSteps(false).map(step => step.frame), ''])
  expect(demos(w)).toHaveLength(DEMO_ACTS + 1)
})

test('a reload in the middle of a tour takes its last step off the band', { options: { gestures: false }, plugins: [observer] }, async ($, on) => {
  const w = world()

  stubs(on, w)
  on('state.get', ($, e, next) => (e.key === 'demo' ? ({ value: { value: { frame: 'write2', label: 'Writing' }, version: 4 } } as never) : next(e)))
  mock.clock(on, { now: START })

  // drawn before the session starts: the step the host still holds
  expect((await bandOf($)).texts).toEqual(['beneath'])
  await start($)
  expect(demos(w)).toEqual([{ frame: '', label: '', at: START }])
})

test('a /clear, /resume or /branch ends the tour', { options: { gestures: false }, plugins: [observer] }, async ($, on) => {
  const w = world()

  stubs(on, w)
  const clock = mock.clock(on, { now: START })

  await start($)
  await run($, 'demo')
  await clock.advance(1_000)
  await $.classic.SessionStart({ source: 'fork', session_id: 'sess-2' })
  expect(demos(w).at(-1)).toMatchObject({ frame: '', label: '' })

  const written = demos(w).length

  await clock.advance(5_000)
  expect(demos(w)).toHaveLength(written)
})

test('a tour step the host refuses to keep is logged and the tour goes on; nothing escapes', { options: { gestures: false } }, async ($, on) => {
  const w = world()
  let isRefusing = false

  stubs(on, w)
  on('state.set', ($, e, next) => (isRefusing && e.key === 'demo' ? { deny: 'state store down' } : next(e)))
  const clock = mock.clock(on, { now: START })

  await start($)
  await run($, 'demo')
  isRefusing = true
  await clock.advance(5_000)
  expect(w.debug.some(line => /^demo step not drawn: .*state store down/.test(line))).toBe(true)
  isRefusing = false
  await clock.advance(1_000)
  // the next step goes through
  expect((await bandOf($)).texts.at(-2)).toMatch(/ · /)
})
