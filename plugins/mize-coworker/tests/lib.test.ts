// The pure parts: the frame table and the braille poses, the loops and the
// frame each activity shows (scenes beside the spinner, the scene each
// spinner word and mode puts there, solo frames in the footer), the blink,
// tool -> activity, the safe spinner object (no Bash argument ever), the
// activity model (the cheer, the team), the narration, the /coworker text,
// the demo tour, the reserve sums and the default reserve, the wander and its
// gated moves, and the vitals.

import { describe, expect, test } from 'claude-code/testing'

import {
  activityOf,
  DECAY_MS,
  DEMO_HINT,
  FORGET_MS,
  formatDuration,
  hostOf,
  MAX_CALLS,
  mcpServerOf,
  narration,
  newModel,
  nextChangeIn,
  parseCommand,
  permissionAsked,
  programOf,
  shown,
  SLEEP_MS,
  statusText,
  toolEnded,
  toolStarted,
  toolWord,
  turnEnded,
  turnStarted,
  USAGE,
  WORDS,
  type SpinnerMode,
} from '../hooks/lib/activity'
import { agentEnded, backgroundSeen, basename, greeted, isCheering, LONG_TURN_MS, MOMENT_MS, OOPS_EVERY_MS, teamSize, toolFailed } from '../hooks/lib/activity'
import { ACT_MS, DEMO_ACTS, demoActs, demoSteps, DEMO_WORDS } from '../hooks/lib/demo'
import {
  addedCells,
  ASLEEP_COLOR,
  BLINK,
  BLINK_EVERY_MS,
  boxOf,
  braille,
  BRAILLE,
  brailleOf,
  BREATH_MS,
  CAPTIONS,
  CHEER_LOOP,
  CLAUDE_COLOR,
  COLD_LOOP,
  footerPieces,
  frameAt,
  frameFile,
  FRAME_NAMES,
  isFrameName,
  isScene,
  LOOPS,
  movingView,
  normalView,
  PICTURE,
  PIXELS,
  PLUG_LOOP,
  poseOf,
  RESERVE,
  SCENE_BOX,
  SCENE_FRAMES,
  sceneFor,
  sizeOf,
  SKILL_LOOP,
  SLEEP_FRAME_MS,
  SOLO_FRAMES,
  soloOf,
  spinnerFrame,
  TEAM_LOOPS,
  THINK_BY_MODE,
  viewKey,
  viewOf,
  viewOfFrame,
  wanderRoom,
  WEB_SEARCH_LOOP,
  type FrameContext,
  type FrameName,
  type Pose,
  type Size,
  SPINNER_FRESH_MS,
  TICK_MS,
} from '../hooks/lib/sprite'

/** The longest run of one frame in a loop that repeats (`isOnce`: played once, so no wrap), in ticks. */
function longestHold(loop: readonly FrameName[], isOnce = false): number {
  const seq = isOnce ? [...loop] : [...loop, ...loop]
  let longest = 1
  let run = 1

  for (let i = 1; i < seq.length; i += 1) {
    run = seq[i] === seq[i - 1] ? run + 1 : 1
    longest = Math.max(longest, Math.min(run, loop.length))
  }

  return longest
}

test('no busy loop holds one frame, and no moment lasts, long enough for the footer to doubt the spinner', () => {
  // the spinner site redraws Claude only when his frame changes: a hold longer than the grace
  // would flicker him into the footer for a tick (0.3.1 did, at thinking's six idle ticks)
  const margin = 500

  for (const activity of Object.keys(LOOPS) as (keyof typeof LOOPS)[]) {
    if (activity === 'idle' || activity === 'asleep') {
      continue
    }

    const longest = longestHold(LOOPS[activity])

    expect({ activity, holdMs: longest * TICK_MS }).toEqual({ activity, holdMs: expect.any(Number) })
    expect(longest * TICK_MS).toBeLessThanOrEqual(SPINNER_FRESH_MS - margin)
  }

  for (const ms of Object.values(MOMENT_MS)) {
    expect(ms).toBeLessThanOrEqual(SPINNER_FRESH_MS - margin)
  }

  // the scenes a word or mode swaps in hold no longer either (the gear's work1, work2, work1 for
  // the thought bubble's eight ticks: work1 held six ticks across the wrap)
  for (const [word, mode] of [
    ['Writing', 'responding'],
    ['Thinking', 'tool-input'],
    ['Working', 'tool-use'],
  ] as const) {
    const swapped = LOOPS.thinking.map(frame => sceneFor(frame, word, mode))

    expect(longestHold(swapped) * TICK_MS, mode).toBeLessThanOrEqual(SPINNER_FRESH_MS - margin)
  }

  // and every idle move keeps its holds under the same bound (no move runs beside the spinner, but a
  // hold that long would read as a stall)
  for (const kind of ['stroll', 'look', 'hop', 'yawn', 'sip', 'sweat', 'clock', 'pumpkin'] as MoveKind[]) {
    const frames = moveSteps(kind, 0, 12).map(step => step.frame)

    expect(longestHold(frames, true) * TICK_MS, kind).toBeLessThanOrEqual(SPINNER_FRESH_MS - margin)
  }
})
import { parseVitals, RESERVE_DEFAULT_FILE, reserveDefaultPath, reserveLine, reservePath, VITALS_FILE, vitalsPath } from '../hooks/lib/statusline-bus'
import {
  chooseMove,
  clampX,
  DROWSY_MS,
  GATED_SHARE,
  gatedMoves,
  isPumpkinTime,
  moveSteps,
  nextFloat,
  nextInt,
  nextWait,
  seeded,
  STILL,
  SWEAT_AT,
  WANDER_EVERY_MS,
  WANDER_RANGE,
  type GatedMove,
  type MoveKind,
} from '../hooks/lib/wander'
import type { CoworkerActivity } from '../types'

const ACTIVITIES: readonly CoworkerActivity[] = [
  'thinking',
  'reading',
  'searching',
  'editing',
  'running',
  'browsing',
  'delegating',
  'asking',
  'working',
  'greeting',
  'done',
  'oops',
  'idle',
  'asleep',
]

/** Every context a frame can be picked in: the team's three sizes, the cheer, the cold sleep, the blink (shut and half) and breath, reduced motion. */
const CONTEXTS: readonly FrameContext[] = [
  {},
  { team: 2 },
  { team: 3 },
  { isCheer: true },
  { isCold: true },
  { isBlinking: true },
  { isBlinkHalf: true },
  { isBreathIn: true },
  { isAnimated: false },
]

const MODES: readonly SpinnerMode[] = ['requesting', 'responding', 'thinking', 'tool-input', 'tool-use']

describe('sprite', () => {
  test('every braille pose composes to the pinned string', () => {
    const expected: Record<Pose, string> = {
      idle: '⢼⢽⠿⡯⡧',
      blink: '⢼⢿⠿⡿⡧',
      lookL: '⢼⢽⠿⡽⡧',
      lookR: '⢼⢯⠿⡯⡧',
      focus: '⢼⢯⠿⡽⡧',
      armsIn: '⢸⢽⠿⡯⡇',
      stepA: '⡼⡽⠿⢯⢧',
      stepB: '⠼⣽⠿⣯⠧',
      hop: '⠺⠺⠛⠗⠗',
      wave: '⢼⢽⠿⡯⡏',
      flinch: '⢸⢿⠿⡿⡇',
      sleep: '⢴⢶⠶⡶⡦',
    }

    expect(Object.keys(BRAILLE)).toEqual(Object.keys(expected))

    for (const name of Object.keys(expected) as Pose[]) {
      expect(BRAILLE[name], name).toBe(expected[name])
      expect(braille(PIXELS[name]), name).toBe(expected[name])
      expect([...BRAILLE[name]], name).toHaveLength(5)
    }

    // the twelve fallback drawings stay distinct
    expect(new Set(Object.values(BRAILLE)).size).toBe(12)
  })

  test('the braille bits: left column 1 2 4 40, right column 8 10 20 80, two pixel columns per cell', () => {
    const one = (rows: string[]): number => (braille(rows).codePointAt(0) ?? 0) - 0x2800

    expect(one(['#.', '..', '..', '..'])).toBe(0x01)
    expect(one(['..', '#.', '..', '..'])).toBe(0x02)
    expect(one(['..', '..', '#.', '..'])).toBe(0x04)
    expect(one(['..', '..', '..', '#.'])).toBe(0x40)
    expect(one(['.#', '..', '..', '..'])).toBe(0x08)
    expect(one(['..', '.#', '..', '..'])).toBe(0x10)
    expect(one(['..', '..', '.#', '..'])).toBe(0x20)
    expect(one(['..', '..', '..', '.#'])).toBe(0x80)
    expect(braille(['####', '####', '####', '####'])).toBe('⣿⣿')
    // a short row or an odd width reads as off pixels
    expect(braille(['###', '#'])).toBe('⠋⠁')
    expect(braille([])).toBe('')
  })

  test('the frame table: 73 frames by name, 35 solo and 38 scenes, each scene naming a solo frame and each solo frame a pose', () => {
    // tests/test_frames.py holds this table equal to scripts/frames.json and checks every PNG
    expect(FRAME_NAMES).toHaveLength(73)
    expect(new Set(FRAME_NAMES).size).toBe(73)
    expect(Object.keys(SOLO_FRAMES)).toHaveLength(35)
    expect(Object.keys(SCENE_FRAMES)).toHaveLength(38)
    expect(FRAME_NAMES.slice(0, 3)).toEqual(['idle', 'idleUp', 'blink'])
    expect(FRAME_NAMES.at(-1)).toBe('plug2')
    // 0.5.0's frames: the half-shut blink, the notepad, the globe under a magnifying glass, the scroll, the plug
    expect(Object.keys(SOLO_FRAMES).at(-1)).toBe('blinkHalf')
    expect(Object.keys(SCENE_FRAMES).slice(28)).toEqual(['write1', 'write2', 'write3', 'webSearch1', 'webSearch2', 'webSearch3', 'skill1', 'skill2', 'plug1', 'plug2'])
    expect([poseOf('blinkHalf'), soloOf('write1'), soloOf('webSearch1'), soloOf('skill1'), soloOf('plug1')]).toEqual(['blink', 'lookDown', 'lookR', 'lookDown', 'armsIn'])

    for (const name of FRAME_NAMES) {
      expect(isFrameName(name), name).toBe(true)
      expect(Object.keys(PIXELS), name).toContain(poseOf(name))
      expect(brailleOf(name), name).toBe(BRAILLE[poseOf(name)])
      expect(isScene(soloOf(name)), name).toBe(false)
      expect(soloOf(name) === name, name).toBe(!isScene(name))
    }

    // a scene stands in by its solo frame, and that one by its pose
    expect([soloOf('think1'), poseOf('think1'), brailleOf('read1')]).toEqual(['lookUp', 'idle', BRAILLE.focus])
    expect([soloOf('team2a'), poseOf('team2a'), soloOf('ask2'), poseOf('ask1')]).toEqual(['hop2', 'hop', 'wave2', 'wave'])
    // the 0.3.1 names that are poses but no longer pictures, and anything else, are not frames
    for (const value of ['hop', 'wave', 'focus', 'sleep', '', 'toString', undefined, 3, null]) {
      expect(isFrameName(value), String(value)).toBe(false)
    }

    expect(frameFile('/p/mize-coworker', 'stepA')).toBe('/p/mize-coworker/assets/frames/stepA.png')
    expect(frameFile('/p/mize-coworker/', 'think2')).toBe('/p/mize-coworker/assets/frames/think2.png')
  })

  test('every frame is drawn by something: a loop, a scene a spinner word or mode swaps in, a move, the breath, the blink, or as a scene\'s solo frame', () => {
    const kinds: MoveKind[] = ['stroll', 'look', 'hop', 'yawn', 'sip', 'sweat', 'clock', 'pumpkin']
    const loops = [...Object.values(LOOPS), ...Object.values(TEAM_LOOPS)]
    const words = Object.values(DEMO_WORDS)
    const used = new Set<string>([
      ...loops.flat(),
      ...loops.flatMap(loop => MODES.flatMap(mode => words.flatMap(word => loop.map(frame => sceneFor(frame, word, mode))))),
      ...CHEER_LOOP,
      ...COLD_LOOP,
      ...kinds.flatMap(kind => moveSteps(kind, 0, 2).map(step => step.frame)),
      ...BLINK.map(phase => phase.frame),
      ...Object.values(SCENE_FRAMES),
    ])

    expect(FRAME_NAMES.filter(name => !used.has(name))).toEqual([])
    expect([...used].filter(name => !isFrameName(name))).toEqual([])
  })

  test('the frame loops of each activity, one step per tick, and their captions', () => {
    expect(LOOPS).toEqual({
      thinking: ['think1', 'think1', 'think2', 'think2', 'think3', 'think3', 'think3', 'think3'],
      reading: ['read1', 'read1', 'read1', 'read2', 'read2', 'read2', 'read1', 'read1', 'read2', 'read2', 'read3', 'read3'],
      searching: ['search1', 'search1', 'search2', 'search2', 'search3', 'search3', 'search2', 'search2'],
      editing: ['type1', 'type2', 'type1', 'type2', 'type3', 'type2'],
      running: ['run1', 'run1', 'run2', 'run2', 'run3', 'run3'],
      browsing: ['web1', 'web1', 'web2', 'web2', 'web3', 'web3'],
      delegating: ['team1a', 'team1a', 'team1b', 'team1b'],
      asking: ['ask1', 'ask1', 'ask2', 'ask2'],
      working: ['work1', 'work1', 'work2', 'work2'],
      greeting: ['wave1', 'wave1', 'wave2', 'wave2', 'wave1', 'wave1', 'wave2', 'wave2'],
      done: ['hop1', 'hop2', 'hop3', 'idle'],
      oops: ['flinch'],
      idle: ['idle', 'idleUp'],
      asleep: ['sleep1', 'sleep2', 'sleep3'],
    })
    expect(TEAM_LOOPS).toEqual({
      1: ['team1a', 'team1a', 'team1b', 'team1b'],
      2: ['team2a', 'team2a', 'team2b', 'team2b'],
      3: ['team3a', 'team3a', 'team3b', 'team3b'],
    })
    expect(CHEER_LOOP).toEqual(['cheer1', 'cheer2', 'cheer3', 'cheer2', 'cheer3', 'idle'])
    expect(COLD_LOOP).toEqual(['sleepCold1', 'sleepCold2'])
    expect([BREATH_MS, SLEEP_FRAME_MS]).toEqual([2_000, 3_000])
    expect(CAPTIONS.asking).toBe('needs you')
    expect(CAPTIONS.idle).toBe('')
    expect(CAPTIONS.asleep).toBe('')

    // the step counter in register.tsx wraps at 480: a multiple of every loop's length
    for (const loop of [...Object.values(LOOPS), ...Object.values(TEAM_LOOPS), CHEER_LOOP, COLD_LOOP]) {
      expect(480 % loop.length, loop.join(',')).toBe(0)
    }

    // the busy loops beside the spinner are scenes, one prop each; the gestures and the footer's own are solo frames
    for (const activity of ['thinking', 'reading', 'searching', 'editing', 'running', 'browsing', 'delegating', 'asking', 'working'] as const) {
      expect(LOOPS[activity].every(frame => isScene(frame)), activity).toBe(true)
    }

    for (const activity of ['greeting', 'done', 'oops', 'idle', 'asleep'] as const) {
      expect(LOOPS[activity].some(frame => isScene(frame)), activity).toBe(false)
    }
  })

  test('each activity\'s loop step by step, and the solo frame the footer shows for each step', () => {
    const at = (activity: CoworkerActivity, steps: number, context: FrameContext = {}): FrameName[] =>
      Array.from({ length: steps }, (_, step) => frameAt(activity, step, context))
    const footer = (frames: FrameName[]): string[] => frames.map(frame => soloOf(frame))

    expect(at('thinking', 9)).toEqual(['think1', 'think1', 'think2', 'think2', 'think3', 'think3', 'think3', 'think3', 'think1'])
    expect(footer(at('thinking', 8))).toEqual(['lookUp', 'lookUp', 'lookUp', 'lookUp', 'idle', 'idle', 'idle', 'idle'])
    expect(footer(at('reading', 12))).toEqual(['lookDown', 'lookDown', 'lookDown', 'lookDown', 'lookDown', 'lookDown', 'lookDown', 'lookDown', 'lookDown', 'lookDown', 'blink', 'blink'])
    expect(footer(at('searching', 8))).toEqual(['lookL', 'lookL', 'idle', 'idle', 'lookR', 'lookR', 'idle', 'idle'])
    expect(at('editing', 7)).toEqual(['type1', 'type2', 'type1', 'type2', 'type3', 'type2', 'type1'])
    expect(footer(at('editing', 6))).toEqual(['armsIn', 'idle', 'armsIn', 'idle', 'armsIn', 'idle'])
    expect(footer(at('running', 6))).toEqual(['stepA', 'stepA', 'stepB', 'stepB', 'stepA', 'stepA'])
    expect(footer(at('browsing', 6))).toEqual(['lookR', 'lookR', 'lookR', 'lookR', 'idle', 'idle'])
    expect(footer(at('asking', 4))).toEqual(['wave1', 'wave1', 'wave2', 'wave2'])
    expect(footer(at('working', 4))).toEqual(['idle', 'idle', 'blink', 'blink'])
    expect(footer(at('delegating', 4, { team: 3 }))).toEqual(['hop2', 'hop2', 'idle', 'idle'])
    // the wave: each side held two ticks, four swings in the 2 s greeting, then the loop again
    expect(at('greeting', 9)).toEqual(['wave1', 'wave1', 'wave2', 'wave2', 'wave1', 'wave1', 'wave2', 'wave2', 'wave1'])
    expect(LOOPS.greeting.length * TICK_MS).toBe(MOMENT_MS.greeting)
    expect(at('oops', 3)).toEqual(['flinch', 'flinch', 'flinch'])

    // reduced motion holds each loop's first frame
    for (const activity of ACTIVITIES) {
      expect(frameAt(activity, 5, { isAnimated: false }), activity).toBe(activity === 'idle' ? 'idle' : LOOPS[activity][0])
    }
  })

  test('delegating draws one helper per delegating call in flight, one to three', () => {
    expect([1, 2, 3].map(team => frameAt('delegating', 0, { team: team as 1 | 2 | 3 }))).toEqual(['team1a', 'team2a', 'team3a'])
    expect([1, 2, 3].map(team => frameAt('delegating', 2, { team: team as 1 | 2 | 3 }))).toEqual(['team1b', 'team2b', 'team3b'])
    expect(frameAt('delegating', 0)).toBe('team1a')
  })

  test('done: a hop played once after a short turn, a cheer after a long one, each holding its last frame', () => {
    expect(Array.from({ length: 7 }, (_, step) => frameAt('done', step))).toEqual(['hop1', 'hop2', 'hop3', 'idle', 'idle', 'idle', 'idle'])
    expect(Array.from({ length: 8 }, (_, step) => frameAt('done', step, { isCheer: true }))).toEqual([
      'cheer1',
      'cheer2',
      'cheer3',
      'cheer2',
      'cheer3',
      'idle',
      'idle',
      'idle',
    ])
    // each moment is long enough to play its form once: four and six steps of 250 ms
    expect(MOMENT_MS.done).toBeGreaterThanOrEqual(LOOPS.done.length * 250)
    expect(MOMENT_MS.cheer).toBeGreaterThanOrEqual(CHEER_LOOP.length * 250)
  })

  test('idle breathes and blinks; asleep loops warm or frosted', () => {
    expect(frameAt('idle', 9)).toBe('idle')
    expect(frameAt('idle', 9, { isBreathIn: true })).toBe('idleUp')
    expect(frameAt('idle', 9, { isBreathIn: true, isBlinking: true })).toBe('blink')
    expect(frameAt('idle', 9, { isBreathIn: true, isBlinking: true, isAnimated: false })).toBe('idle')
    // the blink's half-shut phases show over the breath too, and the shut eyes over the half
    expect(frameAt('idle', 9, { isBlinkHalf: true })).toBe('blinkHalf')
    expect(frameAt('idle', 9, { isBreathIn: true, isBlinkHalf: true })).toBe('blinkHalf')
    expect(frameAt('idle', 9, { isBlinking: true, isBlinkHalf: true })).toBe('blink')
    expect(frameAt('idle', 9, { isBlinkHalf: true, isAnimated: false })).toBe('idle')
    // a busy loop ignores the idle blink
    expect(frameAt('reading', 0, { isBlinkHalf: true, isBlinking: true })).toBe('read1')
    expect(Array.from({ length: 4 }, (_, step) => frameAt('asleep', step))).toEqual(['sleep1', 'sleep2', 'sleep3', 'sleep1'])
    expect(Array.from({ length: 3 }, (_, step) => frameAt('asleep', step, { isCold: true }))).toEqual(['sleepCold1', 'sleepCold2', 'sleepCold1'])
    expect(frameAt('asleep', 4, { isCold: true, isAnimated: false })).toBe('sleepCold1')
  })

  test('the blink: open 6 s, then half shut 100 ms, shut 200 ms, half shut 100 ms', () => {
    expect(BLINK_EVERY_MS).toBe(6_000)
    expect(BLINK).toEqual([
      { frame: 'blinkHalf', ms: 100 },
      { frame: 'blink', ms: 200 },
      { frame: 'blinkHalf', ms: 100 },
    ])
    expect(BLINK.reduce((sum, phase) => sum + phase.ms, 0)).toBe(400)
    // the half-shut lids stand in as the blink pose where no picture can be drawn
    expect(brailleOf('blinkHalf')).toBe(BRAILLE.blink)
    expect(viewOf('idle', 0, { isBlinkHalf: true })).toEqual({ frame: 'blinkHalf', sprite: BRAILLE.blink, caption: '', isAsleep: false })
  })

  test('viewOf: the frame by name, the braille that stands in for it, the caption; asleep muted', () => {
    expect(viewOf('running', 0)).toEqual({ frame: 'run1', sprite: BRAILLE.stepA, caption: 'running', isAsleep: false })
    expect(viewOf('running', 2)).toEqual({ frame: 'run2', sprite: BRAILLE.stepB, caption: 'running', isAsleep: false })
    expect(viewOf('reading', 0).sprite).toBe(BRAILLE.focus)
    expect(viewOf('asking', 0)).toEqual({ frame: 'ask1', sprite: BRAILLE.wave, caption: 'needs you', isAsleep: false })
    expect(viewOf('idle', 3, { isBlinking: true })).toEqual({ frame: 'blink', sprite: BRAILLE.blink, caption: '', isAsleep: false })
    expect(viewOf('asleep', 1)).toEqual({ frame: 'sleep2', sprite: BRAILLE.sleep, caption: '', isAsleep: true })
    expect(movingView('yawn2')).toEqual({ frame: 'yawn2', sprite: BRAILLE.blink, caption: '', isAsleep: false })
    expect(viewOfFrame('think3', 'thinking')).toEqual({ frame: 'think3', sprite: BRAILLE.idle, caption: 'thinking', isAsleep: false })
    // the key names the frame: two frames with one pose are two views, one frame twice is one
    expect(viewKey(viewOf('thinking', 0))).toBe(viewKey(viewOf('thinking', 1)))
    expect(viewKey(viewOf('thinking', 0))).not.toBe(viewKey(viewOf('thinking', 4)))
    expect(viewOf('thinking', 0).sprite).toBe(viewOf('thinking', 4).sprite)
    expect(viewKey(viewOf('idle', 0))).not.toBe(viewKey(viewOf('idle', 0, { isBreathIn: true })))
  })

  test('a view read back from $.state is made whole: 0.3.1\'s (no frame name) or anything malformed draws idle, or the first sleep frame asleep', () => {
    expect(normalView({ sprite: BRAILLE.hop, caption: 'done', isAsleep: false })).toEqual({ frame: 'idle', sprite: BRAILLE.idle, caption: 'done', isAsleep: false })
    expect(normalView({ sprite: BRAILLE.sleep, caption: '', isAsleep: true })).toEqual({ frame: 'sleep1', sprite: BRAILLE.sleep, caption: '', isAsleep: true })
    expect(normalView({ frame: 'read2', sprite: 'stale', caption: 'reading', isAsleep: false })).toEqual(viewOfFrame('read2', 'reading'))
    expect(normalView({ frame: 'nope', caption: 7 })).toEqual(viewOfFrame('idle'))

    for (const value of [undefined, null, 'idle', 42, []]) {
      expect(normalView(value), String(value)).toEqual(viewOfFrame('idle'))
    }
  })

  test('the boxes: a solo frame 8 by 2 (4 by 1 with big off), a scene 12 by 2 beside the spinner only, and scenes off draws the solo frame there', () => {
    expect(PICTURE).toEqual({ big: { columns: 8, rows: 2 }, small: { columns: 4, rows: 1 } })
    expect(SCENE_BOX).toEqual({ columns: 12, rows: 2 })
    expect(boxOf('think1', 'big')).toEqual({ columns: 12, rows: 2 })
    expect(boxOf('lookUp', 'big')).toEqual({ columns: 8, rows: 2 })
    expect(boxOf('think1', 'small')).toEqual({ columns: 4, rows: 1 })
    // beside the spinner: the scene with scenes on and big on; else its solo frame
    expect(spinnerFrame('think1', true, 'big')).toBe('think1')
    expect(spinnerFrame('think1', false, 'big')).toBe('lookUp')
    expect(spinnerFrame('think1', true, 'small')).toBe('lookUp')
    expect(spinnerFrame('flinch', true, 'big')).toBe('flinch')
    // every busy loop, scenes off: only solo frames, 8 by 2
    for (const activity of ACTIVITIES) {
      for (let step = 0; step < 12; step += 1) {
        const frame = spinnerFrame(frameAt(activity, step), false, 'big')

        expect(isScene(frame), `${activity} ${step}`).toBe(false)
        expect(boxOf(frame, 'big'), `${activity} ${step}`).toEqual({ columns: 8, rows: 2 })
      }
    }
  })

  test('every spinner word gets its scene: the thought bubble by the mode, the globe under a glass for a web search, a scroll for a skill, a plug for an MCP call', () => {
    const thinking = (word: string, mode: string): FrameName[] => LOOPS.thinking.map(frame => sceneFor(frame, word, mode))

    // the thought bubble by the spinner's mode: Writing a pen on a notepad, a tool call's input the laptop, Working the gear
    expect(thinking('Writing', 'responding')).toEqual(['write1', 'write1', 'write2', 'write2', 'write3', 'write3', 'write3', 'write3'])
    expect(thinking('Thinking', 'tool-input')).toEqual(['type1', 'type1', 'type2', 'type2', 'type3', 'type3', 'type3', 'type3'])
    expect(thinking('Working', 'tool-use')).toEqual(['work1', 'work1', 'work2', 'work2', 'work1', 'work1', 'work1', 'work1'])
    expect(thinking('Thinking', 'thinking')).toEqual([...LOOPS.thinking])
    expect(thinking('Thinking', 'requesting')).toEqual([...LOOPS.thinking])
    expect([...THINK_BY_MODE.keys()]).toEqual(['responding', 'tool-input', 'tool-use'])

    // the mode decides the bubble, whatever the word says
    expect(sceneFor('think2', 'Reading a.ts', 'responding')).toBe('write2')
    // a mode it does not know, or none, keeps the bubble
    for (const mode of ['', 'toString', '__proto__', 'constructor', 'compacting']) {
      expect(sceneFor('think1', 'Writing', mode), mode).toBe('think1')
    }

    // a web search is the globe under a magnifying glass; a page fetched keeps the globe alone
    expect(LOOPS.browsing.map(frame => sceneFor(frame, WORDS.webSearch, 'tool-use'))).toEqual(['webSearch1', 'webSearch1', 'webSearch2', 'webSearch2', 'webSearch3', 'webSearch3'])
    expect(LOOPS.browsing.map(frame => sceneFor(frame, 'Browsing example.com', 'tool-use'))).toEqual([...LOOPS.browsing])
    expect(sceneFor('web1', 'Browsing', 'tool-use')).toBe('web1')
    expect(sceneFor('web2', 'Searching the web for x', 'tool-use')).toBe('web2')

    // in the gear's place: a scroll for a skill, a plug for a call to an MCP server; any other tool the gear
    expect(LOOPS.working.map(frame => sceneFor(frame, WORDS.skill, 'tool-use'))).toEqual(['skill1', 'skill1', 'skill2', 'skill2'])
    expect(LOOPS.working.map(frame => sceneFor(frame, 'Calling github', 'tool-use'))).toEqual(['plug1', 'plug1', 'plug2', 'plug2'])
    expect(LOOPS.working.map(frame => sceneFor(frame, 'Working', 'tool-use'))).toEqual([...LOOPS.working])
    expect(sceneFor('work2', 'Calling', 'tool-use')).toBe('work2')
    expect(sceneFor('work1', 'Callingx', 'tool-use')).toBe('work1')
    expect([SKILL_LOOP, PLUG_LOOP, WEB_SEARCH_LOOP]).toEqual([['skill1', 'skill2'], ['plug1', 'plug2'], ['webSearch1', 'webSearch2', 'webSearch3']])

    // the words the scenes key on are the narration's own
    expect(toolWord('WebSearch', { query: 'q' })).toBe(WORDS.webSearch)
    expect(toolWord('Skill', { skill: 's' })).toBe(WORDS.skill)
    expect(toolWord('mcp__github__search_repositories', {}).startsWith(WORDS.calling)).toBe(true)

    // every other family keeps its own scene under every word and every mode, and so does a solo frame
    const words = ['Reading a.ts', 'Editing a.ts', 'Running npm', 'Searching', 'Browsing example.com', 'Delegating', 'Orchestrating agents', 'Asking you', 'Working', 'Thinking', 'Writing', '', 'Calling x', WORDS.skill, WORDS.webSearch]
    const kept: FrameName[] = [...LOOPS.reading, ...LOOPS.searching, ...LOOPS.editing, ...LOOPS.running, ...LOOPS.asking, ...Object.values(TEAM_LOOPS).flat(), 'flinch', 'idle', 'hop1', 'sleep1', 'lookUp', 'blinkHalf']

    for (const frame of kept) {
      for (const word of words) {
        for (const mode of MODES) {
          expect(sceneFor(frame, word, mode), `${frame} ${word} ${mode}`).toBe(frame)
        }
      }
    }

    // a word that is not a string (a malformed state value) is no word
    expect(sceneFor('work1', undefined as unknown as string, 'tool-use')).toBe('work1')

    // every swapped scene stands in by a solo frame and a pose of its own, so the footer, which never
    // swaps, and the braille alt both stay whole; scenes off, the swapped scene's solo frame
    for (const frame of [...THINK_BY_MODE.values()].flat()) {
      expect(isScene(frame), frame).toBe(true)
    }

    expect(spinnerFrame(sceneFor('think1', 'Writing', 'responding'), false, 'big')).toBe('lookDown')
    expect(spinnerFrame(sceneFor('work1', WORDS.skill, 'tool-use'), true, 'small')).toBe('lookDown')
    expect(brailleOf(sceneFor('think1', 'Writing', 'responding'))).toBe(BRAILLE.focus)
    expect(soloOf('think1')).toBe('lookUp')
  })

  test('the footer keeps the labels, adds caption and Claude, then the cells he wandered', () => {
    const view = viewOf('reading', 0)

    expect(footerPieces(['focus', 'memory paused'], view)).toEqual([
      { text: 'focus & memory paused', tone: 'dim' },
      { text: ' · reading ', tone: 'dim' },
      { text: BRAILLE.focus, tone: 'claude' },
    ])
    expect(footerPieces([], view)).toEqual([
      { text: ' reading ', tone: 'dim' },
      { text: BRAILLE.focus, tone: 'claude' },
    ])
    expect(footerPieces([], viewOf('idle', 0))).toEqual([
      { text: ' ', tone: 'dim' },
      { text: BRAILLE.idle, tone: 'claude' },
    ])
    // asleep: the muted z right of him, in the first two of his blank cells
    expect(footerPieces(['focus'], viewOf('asleep', 0))).toEqual([
      { text: 'focus', tone: 'dim' },
      { text: ' ', tone: 'dim' },
      { text: BRAILLE.sleep, tone: 'sleeping' },
      { text: ' z', tone: 'asleep' },
    ])
    expect(footerPieces([], viewOf('asleep', 0), { x: 5, isPicture: true }).slice(1)).toEqual([
      { text: BRAILLE.sleep, tone: 'sleeping' },
      { text: ' z', tone: 'asleep' },
      { text: '   ', tone: 'blank' },
    ])
    // idle at x = 7: seven blank cells to his right
    expect(footerPieces([], viewOf('idle', 0), { x: 7, isPicture: true })).toEqual([
      { text: ' ', tone: 'dim' },
      { text: BRAILLE.idle, tone: 'claude' },
      { text: ' '.repeat(7), tone: 'blank' },
    ])
  })

  test('Claude is orange, asleep muted, and the picture 8 cells by 2 rows (big) or 4 by 1 (small)', () => {
    expect(CLAUDE_COLOR).toBe('#d97757')
    expect(ASLEEP_COLOR).toBe('#7d5a50')
    // the two-row box only for the picture with big on; the braille is one row whatever big says
    expect([sizeOf(true, true), sizeOf(true, false), sizeOf(false, true), sizeOf(false, false)]).toEqual(['big', 'small', 'small', 'small'])
    // the big picture is wider than its 5-cell alt and counts as its 8 cells
    expect(addedCells(footerPieces([], viewOf('idle', 0), { isPicture: true, size: 'big' }), [], true, 'big')).toBe(9)
    // the small picture counts as its 5-cell alt, which a terminal without kitty graphics draws in its place
    expect(addedCells(footerPieces([], viewOf('idle', 0), { isPicture: true }), [], true)).toBe(6)
    expect(addedCells(footerPieces([], viewOf('idle', 0)), [])).toBe(6)
  })
})

describe('tool -> activity', () => {
  test('each row of the table', () => {
    const rows: [string, CoworkerActivity][] = [
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
      ['mcp__github__search_repositories', 'working'],
      ['Skill', 'working'],
      ['TodoWrite', 'working'],
      ['toString', 'working'],
      ['', 'working'],
    ]

    for (const [tool, activity] of rows) {
      expect(activityOf(tool), tool).toBe(activity)
    }
  })
})

describe('spinner words', () => {
  test('file tools name the basename only', () => {
    expect(toolWord('Read', { file_path: '/Users/t/.claude/statusline.sh' })).toBe('Reading statusline.sh')
    expect(toolWord('Edit', { file_path: '/work/hooks/register.ts', old_string: 'a', new_string: 'b' })).toBe('Editing register.ts')
    expect(toolWord('Write', { file_path: 'notes.md', content: 'x' })).toBe('Editing notes.md')
    expect(toolWord('NotebookEdit', { notebook_path: '/n/analysis.ipynb', new_source: '' })).toBe('Editing analysis.ipynb')
    expect(toolWord('NotebookRead', { notebook_path: '/n/analysis.ipynb' })).toBe('Reading analysis.ipynb')
    expect(toolWord('Read', {})).toBe('Reading')
    expect(toolWord('Read', { file_path: '/a/b/' })).toBe('Reading b')
    // control characters never reach the row
    expect(toolWord('Read', { file_path: '/a/evil\nname\u001b[31m.ts' })).toBe('Reading evilname[31m.ts')
    // at most 40 characters
    const long = toolWord('Read', { file_path: `/a/${'x'.repeat(80)}.ts` })

    expect([...long]).toHaveLength(40)
    expect(long.endsWith('…')).toBe(true)
  })

  test('Bash names the program, never an argument or a secret', () => {
    const cases: [string, string][] = [
      ['TOKEN=abc curl -H "Authorization: x" https://h', 'Running curl'],
      ['cd /x && npm test', 'Running npm'],
      ['"/path with space/bin" arg', 'Running bin'],
      ['', 'Running'],
      ['   ', 'Running'],
      ['FOO=1', 'Running'],
      ['A="x y" B=2 /usr/local/bin/python3 script.py --token s3cr3t', 'Running python3'],
      ['cd "/a b" ; cd c && git push origin main', 'Running git'],
      ['$(cat ~/.secret) --flag', 'Running'],
      ['`whoami`', 'Running'],
      ['sk-ant-api03-0123456789abcdefghijklmnop do', 'Running'],
      ['echo "hello world" | tee out.txt', 'Running echo'],
      ["'/opt/my tool/run.sh' --pw=hunter2", 'Running run.sh'],
      ['(cd sub && make)', 'Running make'],
      ['git\\ status', 'Running'],
    ]

    for (const [command, word] of cases) {
      const said = toolWord('Bash', { command })

      expect(said, command).toBe(word)

      for (const secret of ['abc', 'Authorization', 'https', 'arg', 's3cr3t', 'hunter2', 'script.py', 'secret', 'origin', 'test']) {
        expect(said.includes(secret), `${command} -> ${said}`).toBe(false)
      }
    }

    expect(toolWord('Bash', { command: 42 })).toBe('Running')
    expect(toolWord('Bash', undefined)).toBe('Running')
    expect(programOf('env')).toBe('env')
  })

  test('the other tools', () => {
    expect(toolWord('Grep', { pattern: 'password' })).toBe('Searching')
    expect(toolWord('Glob', { pattern: '**/*.ts' })).toBe('Searching')
    expect(toolWord('ToolSearch', { query: 'x' })).toBe('Searching')
    expect(toolWord('WebFetch', { url: 'https://user:pw@Docs.Example.com:8443/path?q=token', prompt: 'p' })).toBe('Browsing docs.example.com')
    expect(toolWord('WebFetch', { url: 'not a url', prompt: 'p' })).toBe('Browsing')
    expect(toolWord('WebFetch', { url: 'http://[::1]:80/', prompt: 'p' })).toBe('Browsing')
    expect(toolWord('WebSearch', { query: 'my secret query' })).toBe('Searching the web')
    expect(toolWord('Agent', { description: 'd', prompt: 'p' })).toBe('Delegating')
    expect(toolWord('Task', {})).toBe('Delegating')
    expect(toolWord('SendMessage', {})).toBe('Delegating')
    expect(toolWord('Workflow', { script: 'x' })).toBe('Orchestrating agents')
    expect(toolWord('mcp__github__search_repositories', { query: 'q' })).toBe('Calling github')
    expect(toolWord('mcp__plugin_serena_serena__find_symbol', {})).toBe('Calling plugin_serena_serena')
    expect(toolWord('mcp__bad server__x', {})).toBe('Working')
    expect(toolWord('Skill', { skill: 'x' })).toBe('Loading a skill')
    expect(toolWord('AskUserQuestion', { questions: [] })).toBe('Asking you')
    expect(toolWord('BashOutput', {})).toBe('Running')
    expect(toolWord('Monitor', {})).toBe('Running')
    expect(toolWord('TodoWrite', { todos: [] })).toBe('Working')
    expect(hostOf('ftp://files.example.org/x')).toBe('files.example.org')
    expect(hostOf(`https://${'a'.repeat(41)}.com/`)).toBeUndefined()
    expect(mcpServerOf('Read')).toBeUndefined()
  })

  test('narration: the tool word, else the spinner mode', () => {
    expect(narration({ activity: 'reading', word: 'Reading a.ts' }, 'tool-use')).toBe('Reading a.ts')
    expect(narration({ activity: 'asking', word: 'Asking you' }, 'thinking')).toBe('Asking you')
    expect(narration({ activity: 'thinking', word: '' }, 'thinking')).toBe('Thinking')
    expect(narration({ activity: 'thinking', word: '' }, 'responding')).toBe('Writing')
    expect(narration({ activity: 'thinking', word: '' }, 'requesting')).toBe('Thinking')
    expect(narration({ activity: 'thinking', word: '' }, 'tool-input')).toBe('Thinking')
    expect(narration({ activity: 'thinking', word: '' }, 'tool-use')).toBe('Working')
    expect(narration({ activity: 'idle', word: '' }, 'responding')).toBe('Writing')
    expect(narration({ activity: 'working', word: '' }, 'tool-use')).toBe('Working')
  })
})

describe('the activity model', () => {
  test('the most recently started call in flight wins, then thinking while the turn runs', () => {
    const m = newModel(1_000)

    expect(shown(m, 1_000)).toEqual({ activity: 'idle', word: '' })
    turnStarted(m)
    expect(shown(m, 1_100)).toEqual({ activity: 'thinking', word: '' })
    toolStarted(m, 'r1', 'Read', { file_path: '/a/one.ts' }, 1_200)
    toolStarted(m, 'b1', 'Bash', { command: 'npm test' }, 1_300)
    expect(shown(m, 1_400)).toEqual({ activity: 'running', word: 'Running npm' })
    toolEnded(m, 'b1', 'Bash', { command: 'npm test' }, 1_500)
    expect(shown(m, 1_500)).toEqual({ activity: 'reading', word: 'Reading one.ts' })
    toolEnded(m, 'r1', 'Read', { file_path: '/a/one.ts' }, 1_600)
    expect(shown(m, 1_600)).toEqual({ activity: 'thinking', word: '' })
  })

  test('the main turn\'s own last call does not linger once the turn is over: idle at once, asleep after 10 minutes', () => {
    const m = newModel(0)

    turnStarted(m)
    toolStarted(m, 'e1', 'Edit', { file_path: '/a/x.ts' }, 1_000)
    toolEnded(m, 'e1', 'Edit', { file_path: '/a/x.ts' }, 2_000)
    turnEnded(m, 3_000)
    expect(shown(m, 3_000)).toEqual({ activity: 'idle', word: '' })
    expect(nextChangeIn(m, 3_000)).toBe(SLEEP_MS)
    expect(shown(m, 3_000 + SLEEP_MS - 1).activity).toBe('idle')
    expect(shown(m, 3_000 + SLEEP_MS).activity).toBe('asleep')
    expect(nextChangeIn(m, 3_000 + SLEEP_MS)).toBeUndefined()
  })

  test('a tool event after the main turn ended (an agent in the background) shows for 8 s, then idle', () => {
    const m = newModel(0)

    turnStarted(m)
    turnEnded(m, 1_000)
    toolStarted(m, 'e1', 'Edit', { file_path: '/a/x.ts' }, 2_000)
    toolEnded(m, 'e1', 'Edit', { file_path: '/a/x.ts' }, 3_000, 'agent-7')
    expect(shown(m, 3_500)).toEqual({ activity: 'editing', word: 'Editing x.ts' })
    expect(nextChangeIn(m, 3_500)).toBe(3_000 + DECAY_MS - 3_500)
    expect(shown(m, 3_000 + DECAY_MS - 1)).toEqual({ activity: 'editing', word: 'Editing x.ts' })
    expect(shown(m, 3_000 + DECAY_MS)).toEqual({ activity: 'idle', word: '' })
    expect(nextChangeIn(m, 3_000 + DECAY_MS)).toBe(SLEEP_MS)
    expect(shown(m, 3_000 + DECAY_MS + SLEEP_MS).activity).toBe('asleep')
  })

  test('a background agent\'s tool event after the turn wakes it and decays again', () => {
    const m = newModel(0)

    expect(shown(m, SLEEP_MS).activity).toBe('asleep')
    toolStarted(m, 'g1', 'Grep', { pattern: 'x' }, SLEEP_MS + 10)
    expect(shown(m, SLEEP_MS + 20)).toEqual({ activity: 'searching', word: 'Searching' })
    toolEnded(m, 'g1', 'Grep', { pattern: 'x' }, SLEEP_MS + 30)
    expect(shown(m, SLEEP_MS + 30 + DECAY_MS - 1).activity).toBe('searching')
    expect(shown(m, SLEEP_MS + 30 + DECAY_MS).activity).toBe('idle')
  })

  test('nothing to wait for while the turn runs; the turn end drops calls left in flight', () => {
    const m = newModel(0)

    turnStarted(m)
    expect(nextChangeIn(m, 10)).toBeUndefined()
    toolStarted(m, 'b1', 'Bash', { command: 'sleep 99' }, 20)
    expect(nextChangeIn(m, 30)).toBe(20 + FORGET_MS - 30)
    turnEnded(m, 40)
    expect(m.calls.size).toBe(0)
    expect(shown(m, 50)).toEqual({ activity: 'idle', word: '' })
  })

  test('a permission ask needs you until the next tool or turn event', () => {
    const m = newModel(0)

    turnStarted(m)
    toolStarted(m, 'b1', 'Bash', { command: 'rm -rf build' }, 10)
    permissionAsked(m, 20, '', 'Bash')
    expect(shown(m, 30)).toEqual({ activity: 'asking', word: 'Asking you' })
    toolEnded(m, 'b1', 'Bash', { command: 'rm -rf build' }, 40)
    expect(shown(m, 50)).toEqual({ activity: 'thinking', word: '' })
    permissionAsked(m, 60, '', 'Bash')
    turnEnded(m, 70)
    // the turn's end closes the ask, and the turn's own call does not linger
    expect(shown(m, 70).activity).toBe('idle')
    permissionAsked(m, 80, '', 'Bash')
    expect(shown(m, 80 + FORGET_MS - 1).activity).toBe('asking')
    expect(shown(m, 80 + FORGET_MS).activity).not.toBe('asking')
  })

  test('calls in flight are capped at 200, oldest dropped, and forgotten after 30 minutes', () => {
    const m = newModel(0)

    for (let i = 0; i < MAX_CALLS + 5; i += 1) {
      toolStarted(m, `c${i}`, 'Read', { file_path: `/f${i}.ts` }, 100 + i)
    }

    expect(m.calls.size).toBe(MAX_CALLS)
    expect(m.calls.has('c0')).toBe(false)
    expect(m.calls.has(`c${MAX_CALLS + 4}`)).toBe(true)
    expect(shown(m, 1_000)).toEqual({ activity: 'reading', word: `Reading f${MAX_CALLS + 4}.ts` })
    expect(shown(m, 100 + FORGET_MS + 7).activity).toBe('reading')
    expect(m.calls.size).toBe(MAX_CALLS - 3)
    expect(shown(m, 100 + MAX_CALLS + 4 + FORGET_MS).activity).toBe('asleep')
    expect(m.calls.size).toBe(0)
  })

  test('an end with no start (another loop, or a reload) still counts as a tool event', () => {
    const m = newModel(0)

    toolEnded(m, 'x9', 'WebFetch', { url: 'https://example.com/a' }, 500)
    expect(shown(m, 600)).toEqual({ activity: 'browsing', word: 'Browsing example.com' })
  })
})

describe('/coworker text', () => {
  test('status lines: the switches, what Claude is doing, and the demo', () => {
    const options = { sprite: true, narrate: true, animate: true }

    expect(statusText({ isInteractive: true, isOff: false, options, doing: { activity: 'reading', word: 'Reading a.ts' }, forMs: 130_000 })).toBe(
      'sprite on, narration on, animation on\nClaude is reading (busy for 2m 10s)\n/coworker demo plays every animation once, about a minute, in the band above the prompt',
    )
    expect(statusText({ isInteractive: true, isOff: true, options: { ...options, animate: false }, doing: { activity: 'asleep', word: '' }, forMs: 45_000 })).toBe(
      `switched off for this session (/coworker on brings it back); options: sprite on, narration on, animation off\nClaude is asleep (idle for 45s)\n${DEMO_HINT}`,
    )
    // while the tour plays: the act under way
    expect(statusText({ isInteractive: true, isOff: false, options, doing: { activity: 'idle', word: '' }, forMs: 3_000, demo: { act: 2, of: 30, label: 'Writing' } })).toBe(
      'sprite on, narration on, animation on\nClaude is idle (idle for 3s)\ndemo playing: 2 of 30, Writing; /coworker demo again stops it',
    )
    expect(statusText({ isInteractive: false, isOff: false, options, doing: { activity: 'idle', word: '' }, forMs: 0 })).toBe(
      'headless session, nothing is drawn here; in an interactive terminal: sprite on, narration on, animation on',
    )
  })

  test('arguments and durations', () => {
    expect(parseCommand('')).toBe('status')
    expect(parseCommand('  status ')).toBe('status')
    expect(parseCommand('OFF')).toBe('off')
    expect(parseCommand('on')).toBe('on')
    expect(parseCommand(' Demo ')).toBe('demo')
    expect(parseCommand('demo now')).toBe('unknown')
    expect(parseCommand('frob')).toBe('unknown')
    expect(USAGE).toMatch(/^usage: \/coworker \[on \| off \| demo\]/)
    expect(formatDuration(-5)).toBe('0s')
    expect(formatDuration(59_999)).toBe('59s')
    expect(formatDuration(61_000)).toBe('1m 1s')
    expect(formatDuration(3_900_000)).toBe('1h 5m')
  })
})

test('the reserve sums: big 22 = 1 + 8 + 12 + 1 and 11 = 1 + 8 + 1 + 1, small 18 = 1 + 4 + 12 + 1 and 9 = 1 + 4 + 3 + 1, each full one holding a 10-cell caption; every activity, every x, the picture and the braille alt', () => {
  const longest = Math.max(...ACTIVITIES.map(activity => [...CAPTIONS[activity]].length))

  expect(1 + PICTURE.big.columns + WANDER_RANGE.big.full + 1).toBe(RESERVE.big.full)
  expect(1 + PICTURE.big.columns + WANDER_RANGE.big.compact + 1).toBe(RESERVE.big.compact)
  expect(1 + PICTURE.small.columns + WANDER_RANGE.small.full + 1).toBe(RESERVE.small.full)
  expect(1 + PICTURE.small.columns + WANDER_RANGE.small.compact + 1).toBe(RESERVE.small.compact)
  expect(RESERVE.big.compactBelow).toBe(110)
  expect(RESERVE.small.compactBelow).toBe(110)

  for (const size of ['big', 'small'] as Size[]) {
    expect(1 + longest + 1 + PICTURE[size].columns, size).toBeLessThanOrEqual(RESERVE[size].full)
  }

  // every frame's braille (the alt, and the picture-off drawing) is 5 cells on one row
  for (const name of FRAME_NAMES) {
    expect([...brailleOf(name)], name).toHaveLength(5)
  }

  for (const size of ['big', 'small'] as Size[]) {
    for (const activity of ACTIVITIES) {
      // every frame any context shows for the activity (the footer draws a scene's solo frame, with the same braille)
      const views = CONTEXTS.flatMap(context => Array.from({ length: 12 }, (_, step) => viewOf(activity, step, context)))
      const distinct = [...new Map(views.map(view => [viewKey(view), view])).values()]

      for (const view of distinct) {
        const step = view.frame

        for (let x = 0; x <= 14; x += 1) {
          for (const modes of [[], ['focus'], ['focus', 'memory paused']]) {
            for (const isPicture of [true, false]) {
              const label = `${size} ${activity} ${step} x ${x} ${modes.join(',')} ${isPicture ? 'picture' : 'braille'}`
              const full = footerPieces(modes, view, { x, isPicture, size })
              const compact = footerPieces(modes, view, { x, isPicture, size, isCompact: true })

              expect(addedCells(full, modes, isPicture, size), `${label} full`).toBeLessThanOrEqual(RESERVE[size].full)
              expect(addedCells(compact, modes, isPicture, size), `${label} compact`).toBeLessThanOrEqual(RESERVE[size].compact)
              // the 5-cell alt in the picture's place: never wider than what was counted
              expect(addedCells(full, modes, false, size), `${label} full alt`).toBeLessThanOrEqual(addedCells(full, modes, isPicture, size))
            }
          }
        }
      }
    }
  }

  // big: idle at the far left of his walk, 1 + 8 + 12 with the spare cell free; a narrow terminal, 1 cell to walk
  expect(addedCells(footerPieces([], viewOf('idle', 0), { x: 12, isPicture: true, size: 'big' }), [], true, 'big')).toBe(21)
  expect(footerPieces([], viewOf('idle', 0), { x: 99, isPicture: true, size: 'big', isCompact: true })).toEqual([
    { text: ' ', tone: 'dim' },
    { text: BRAILLE.idle, tone: 'claude' },
    { text: ' ', tone: 'blank' },
  ])
  // big asleep in a narrow terminal: one cell left, so the z goes without its space
  expect(footerPieces([], viewOf('asleep', 0), { x: 99, isPicture: true, size: 'big', isCompact: true })).toEqual([
    { text: ' ', tone: 'dim' },
    { text: BRAILLE.sleep, tone: 'sleeping' },
    { text: 'z', tone: 'asleep' },
  ])
  expect(footerPieces([], viewOf('asleep', 0), { x: 5, isPicture: true, size: 'big' }).slice(2)).toEqual([
    { text: ' z', tone: 'asleep' },
    { text: '   ', tone: 'blank' },
  ])
  // big: the longest caption with labels keeps its ` · `, and the walk gives way
  expect(footerPieces(['focus'], viewOf('delegating', 0), { x: 12, isPicture: true, size: 'big' })).toEqual([
    { text: 'focus', tone: 'dim' },
    { text: ' · delegating ', tone: 'dim' },
    { text: BRAILLE.hop, tone: 'claude' },
  ])
  expect([wanderRoom(false, true, 'big'), wanderRoom(true, true, 'big')]).toEqual([12, 1])

  // small (0.2.0, the default): idle at the far left of his walk: 1 + the 5-cell alt + 11, the spare cell kept free
  expect(addedCells(footerPieces([], viewOf('idle', 0), { x: 12, isPicture: true }), [], true)).toBe(17)
  // a narrow terminal: the walk stops where even the alt still fits
  expect(addedCells(footerPieces([], viewOf('idle', 0), { x: 99, isPicture: true, isCompact: true }), [], true)).toBe(8)
  expect(footerPieces([], viewOf('idle', 0), { x: 99, isPicture: true, isCompact: true }).at(-1)).toEqual({ text: '  ', tone: 'blank' })
  // how far the wander goes: 11 cells at full width, 2 in a narrow terminal (the alt is 5 cells, and the spare stays free)
  expect([wanderRoom(false, true), wanderRoom(true, true), wanderRoom(false, false), wanderRoom(true, false)]).toEqual([11, 2, 11, 2])
  // a narrow terminal: Claude alone, no caption
  expect(footerPieces([], viewOf('reading', 0), { isCompact: true })).toEqual([
    { text: ' ', tone: 'dim' },
    { text: BRAILLE.focus, tone: 'claude' },
  ])
  // the longest caption with labels: the walk gives way, and the ` · ` becomes a space
  expect(footerPieces(['focus'], viewOf('asking', 0), { x: 12, isPicture: true })).toEqual([
    { text: 'focus', tone: 'dim' },
    { text: ' · needs you ', tone: 'dim' },
    { text: BRAILLE.wave, tone: 'claude' },
  ])
  expect(footerPieces(['focus'], viewOf('delegating', 0), { x: 12, isPicture: true }).slice(1)).toEqual([
    { text: ' delegating ', tone: 'dim' },
    { text: BRAILLE.hop, tone: 'claude' },
  ])
})

describe('wander', () => {
  test('the generator is seeded: one seed, one sequence; another seed, another', () => {
    const a = seeded(1_000_000)
    const b = seeded(1_000_000)
    const c = seeded(1_000_001)
    const one = Array.from({ length: 8 }, () => nextFloat(a))

    expect(Array.from({ length: 8 }, () => nextFloat(b))).toEqual(one)
    expect(Array.from({ length: 8 }, () => nextFloat(c))).not.toEqual(one)

    for (const value of one) {
      expect(value >= 0 && value < 1).toBe(true)
    }

    // any number seeds it
    for (const seed of [NaN, -5, Infinity, 2 ** 40 + 3]) {
      const draw = nextFloat(seeded(seed))

      expect(draw >= 0 && draw < 1, String(seed)).toBe(true)
    }
  })

  test('draws stay in their ranges: whole numbers, both ends reachable; the wait 12 to 30 s', () => {
    const rng = seeded(42)
    const seen = new Set<number>()

    for (let i = 0; i < 400; i += 1) {
      const n = nextInt(rng, 0, 3)

      expect(Number.isInteger(n) && n >= 0 && n <= 3).toBe(true)
      seen.add(n)

      const wait = nextWait(rng)

      expect(wait >= WANDER_EVERY_MS.min && wait <= WANDER_EVERY_MS.max, String(wait)).toBe(true)
    }

    expect([...seen].sort()).toEqual([0, 1, 2, 3])
    expect(WANDER_EVERY_MS).toEqual({ min: 12_000, max: 30_000 })
  })

  test('a stroll moves one cell per step on alternating feet and ends idle; every other move stays put and plays its frames', () => {
    expect(moveSteps('stroll', 2, 5)).toEqual([
      { frame: 'stepA', x: 3 },
      { frame: 'stepB', x: 4 },
      { frame: 'stepA', x: 5 },
      { frame: 'idle', x: 5 },
    ])
    expect(moveSteps('stroll', 3, 1)).toEqual([
      { frame: 'stepA', x: 2 },
      { frame: 'stepB', x: 1 },
      { frame: 'idle', x: 1 },
    ])
    expect(moveSteps('stroll', 4, 4)).toEqual([])
    expect(moveSteps('look', 6).map(step => step.frame)).toEqual(['lookL', 'lookL', 'idle', 'lookR', 'lookR', 'idle'])
    expect(moveSteps('look', 6).every(step => step.x === 6)).toBe(true)
    expect(moveSteps('hop', 0)).toEqual([
      { frame: 'hop1', x: 0 },
      { frame: 'hop2', x: 0 },
      { frame: 'hop3', x: 0 },
      { frame: 'idle', x: 0 },
    ])

    const frames = (kind: MoveKind): string[] => moveSteps(kind, 4).map(step => step.frame)

    // the yawn and the sip ease in and out around a held middle; the pumpkin's glow flickers unevenly
    expect(frames('yawn')).toEqual(['yawn1', 'yawn1', 'yawn2', 'yawn2', 'yawn2', 'yawn2', 'yawn1', 'yawn1'])
    expect(frames('sip')).toEqual(['sip1', 'sip1', 'sip2', 'sip2', 'sip2', 'sip2', 'sip1', 'sip1'])
    expect(frames('sweat')).toEqual(['sweat1', 'sweat2', 'sweat1', 'sweat2'])
    expect(frames('clock')).toEqual(['clock1', 'clock1', 'clock2', 'clock2'])
    expect(frames('pumpkin')).toEqual(['pumpkin1', 'pumpkin1', 'pumpkin1', 'pumpkin2', 'pumpkin2', 'pumpkin1', 'pumpkin1', 'pumpkin1', 'pumpkin2', 'pumpkin2'])
    expect(Object.keys(STILL)).toEqual(['look', 'hop', 'yawn', 'sip', 'sweat', 'clock', 'pumpkin'])

    for (const kind of ['yawn', 'sip', 'sweat', 'clock', 'pumpkin'] as const) {
      expect(moveSteps(kind, 4, 9).every(step => step.x === 4), kind).toBe(true)
    }
  })

  test('the next move: all five everyday kinds turn up, a stroll always goes somewhere else inside the range, a stroll, look or hop ends idle', () => {
    const rng = seeded(7)
    const kinds = new Set<string>()

    for (let i = 0; i < 300; i += 1) {
      const range = [WANDER_RANGE.big.full, WANDER_RANGE.small.compact, WANDER_RANGE.big.compact][i % 3] ?? 0
      const x = i % 16
      const move = chooseMove(rng, x, range)
      const from = Math.min(x, range)

      kinds.add(move.kind)

      if (move.kind === 'stroll' || move.kind === 'look' || move.kind === 'hop') {
        expect(move.steps.at(-1)?.frame).toBe('idle')
      }

      for (const step of move.steps) {
        expect(step.x >= 0 && step.x <= range, `${move.kind} ${step.x} of ${range}`).toBe(true)
      }

      if (move.kind === 'stroll') {
        expect(move.steps.at(-1)?.x).not.toBe(from)
        // one cell per step from where he stood
        expect(Math.abs((move.steps[0]?.x ?? from) - from)).toBe(1)
      } else {
        expect(move.steps.every(step => step.x === from)).toBe(true)
      }
    }

    expect([...kinds].sort()).toEqual(['hop', 'look', 'sip', 'stroll', 'yawn'])
    // with no room to walk, never a stroll
    for (let i = 0; i < 50; i += 1) {
      expect(chooseMove(rng, 3, 0).kind).not.toBe('stroll')
    }
  })

  /** How often each kind turns up in `count` moves from one seed. */
  const tally = (count: number, context: Parameters<typeof chooseMove>[3], seed = 11): Record<string, number> => {
    const rng = seeded(seed)
    const seen: Record<string, number> = {}

    for (let i = 0; i < count; i += 1) {
      const kind = chooseMove(rng, i % 13, WANDER_RANGE.big.full, context).kind

      seen[kind] = (seen[kind] ?? 0) + 1
    }

    return seen
  }

  test('the everyday mix: strolls and looks most, then hops; yawns and sips rarer than either; drowsy, more yawns', () => {
    const awake = tally(4_000, {})
    const drowsy = tally(4_000, { isDrowsy: true })
    const share = (seen: Record<string, number>, kind: string): number => (seen[kind] ?? 0) / 4_000

    for (const seen of [awake, drowsy]) {
      for (const rare of ['yawn', 'sip']) {
        expect(share(seen, rare), rare).toBeGreaterThan(0.03)
        expect(share(seen, rare), rare).toBeLessThan(share(seen, 'stroll'))
        expect(share(seen, rare), rare).toBeLessThan(share(seen, 'look'))
      }

      // no gated move ever turns up when none applies
      expect(['sweat', 'clock', 'pumpkin'].map(kind => seen[kind] ?? 0)).toEqual([0, 0, 0])
    }

    expect(share(drowsy, 'yawn')).toBeGreaterThan(share(awake, 'yawn') * 1.8)
    expect(DROWSY_MS).toBe(6 * 60_000)
  })

  test('a gated move that applies is about one move in three; several share that third; none applies, none turns up', () => {
    const one = tally(3_000, { gated: ['sweat'] })
    const three = tally(3_000, { gated: ['sweat', 'clock', 'pumpkin'] })
    const gatedShare = (seen: Record<string, number>): number => ((seen.sweat ?? 0) + (seen.clock ?? 0) + (seen.pumpkin ?? 0)) / 3_000

    expect(GATED_SHARE).toBe(1 / 3)
    expect(gatedShare(one)).toBeGreaterThan(0.29)
    expect(gatedShare(one)).toBeLessThan(0.38)
    expect([one.clock ?? 0, one.pumpkin ?? 0]).toEqual([0, 0])
    expect(gatedShare(three)).toBeGreaterThan(0.29)
    expect(gatedShare(three)).toBeLessThan(0.38)

    for (const kind of ['sweat', 'clock', 'pumpkin']) {
      expect(three[kind] ?? 0, kind).toBeGreaterThan(200)
    }

    // the everyday moves go on around them
    expect(one.stroll ?? 0).toBeGreaterThan(600)
    // one seed, one sequence of moves
    expect(tally(200, { gated: ['clock'] }, 5)).toEqual(tally(200, { gated: ['clock'] }, 5))
  })

  test('the gates: sweat from 80% of context, clock while a usage window is over or crit, pumpkin from 24 to 31 October with seasonal on', () => {
    const OCT = 9

    expect(SWEAT_AT).toBe(80)
    expect(gatedMoves({}, 0, 1, true)).toEqual([])
    expect(gatedMoves({ context: 79.9 }, 0, 1, true)).toEqual([])
    expect(gatedMoves({ context: 80 }, 0, 1, true)).toEqual(['sweat'])
    expect(gatedMoves({ context: 100 }, 0, 1, true)).toEqual(['sweat'])
    expect(gatedMoves({ context: NaN }, 0, 1, true)).toEqual([])

    for (const state of ['calm', 'watch', '', undefined]) {
      expect(gatedMoves({ fiveHour: state, sevenDay: state }, 0, 1, true), String(state)).toEqual([])
    }

    for (const state of ['over', 'crit']) {
      expect(gatedMoves({ fiveHour: state }, 0, 1, true), state).toEqual(['clock'])
      expect(gatedMoves({ sevenDay: state }, 0, 1, true), state).toEqual(['clock'])
    }

    expect([23, 24, 31].map(day => isPumpkinTime(OCT, day))).toEqual([false, true, true])
    expect([isPumpkinTime(OCT + 1, 1), isPumpkinTime(OCT - 1, 30), isPumpkinTime(OCT, 32)]).toEqual([false, false, false])
    expect(gatedMoves({}, OCT, 26, true)).toEqual(['pumpkin'])
    expect(gatedMoves({}, OCT, 26, false)).toEqual([])
    expect(gatedMoves({ context: 91, fiveHour: 'calm', sevenDay: 'crit' }, OCT, 31, true)).toEqual(['sweat', 'clock', 'pumpkin'])

    const all: GatedMove[] = gatedMoves({ context: 91, sevenDay: 'over' }, OCT, 24, true)

    expect(all).toHaveLength(3)
  })

  test('the clamp: whole cells from 0 to the smallest limit', () => {
    expect(clampX(7, 12, 13)).toBe(7)
    expect(clampX(12, 3)).toBe(3)
    expect(clampX(5, 12, 0)).toBe(0)
    expect(clampX(-4, 12)).toBe(0)
    expect(clampX(2.9, 12)).toBe(2)
    expect(clampX(NaN, 12)).toBe(0)
    expect(clampX(9, 12, -3)).toBe(0)
    expect(clampX(9, 12, NaN)).toBe(9)
  })
})

test('the vitals file: four tab-separated fields, each unknown unless it is one the contract names; never a throw', () => {
  expect(VITALS_FILE).toBe('.vitals')
  expect(vitalsPath('/home/t', 'sess-9')).toBe('/home/t/.claude/state/statusline/bus/sess-9/.vitals')
  expect(vitalsPath('/home/t', '../x')).toBeUndefined()
  expect(vitalsPath(undefined, 'sess-9')).toBeUndefined()
  expect(vitalsPath('', 'sess-9')).toBeUndefined()

  expect(parseVitals('84\tover\tcalm\tcold\n')).toEqual({ context: 84, fiveHour: 'over', sevenDay: 'calm', cache: 'cold' })
  expect(parseVitals('12.5\twatch\tcrit\twarm')).toEqual({ context: 12.5, fiveHour: 'watch', sevenDay: 'crit', cache: 'warm' })
  expect(parseVitals('0\tcalm\tcalm\twarm\r\n')).toEqual({ context: 0, fiveHour: 'calm', sevenDay: 'calm', cache: 'warm' })
  expect(parseVitals('100\t\t\t\n')).toEqual({ context: 100 })
  // empty fields are unknown
  expect(parseVitals('\t\t\t\n')).toEqual({})
  expect(parseVitals('\tcrit\t\tcold')).toEqual({ fiveHour: 'crit', cache: 'cold' })
  // each field on its own: one it does not know is unknown, the rest still read
  expect(parseVitals('101\tover\tCALM\tfrozen')).toEqual({ fiveHour: 'over' })
  expect(parseVitals('-3\thot\tcalm\tcold')).toEqual({ sevenDay: 'calm', cache: 'cold' })
  expect(parseVitals('8e1\tcalm\tcalm\twarm').context).toBeUndefined()
  expect(parseVitals(' 84\tcalm\tcalm\twarm').context).toBeUndefined()
  expect(parseVitals('84%\tcalm\tcalm\twarm').context).toBeUndefined()
  expect(parseVitals('Infinity\tcalm\tcalm\twarm').context).toBeUndefined()
  // a line without exactly four fields: nothing is trusted
  expect(parseVitals('84\tover\tcalm')).toEqual({})
  expect(parseVitals('84\tover\tcalm\tcold\textra')).toEqual({})
  expect(parseVitals('84 over calm cold')).toEqual({})
  // only the first line counts
  expect(parseVitals('\n84\tover\tcalm\tcold\n')).toEqual({})
  expect(parseVitals('84\tover\tcalm\tcold\n0\tcalm\tcalm\twarm\n')).toEqual({ context: 84, fiveHour: 'over', sevenDay: 'calm', cache: 'cold' })

  // total: anything at all reads as unknown
  for (const value of ['', undefined, null, 42, {}, [], { base64: 'AAAA' }, 'x'.repeat(100_000), '\u0000\t\u0000\t\u0000\t\u0000']) {
    expect(() => parseVitals(value)).not.toThrow()
  }

  expect(parseVitals(undefined)).toEqual({})
  expect(parseVitals({ base64: 'AAAA' })).toEqual({})
})

test('the reserve file: three numbers, capped, empty to release; the machine-wide default beside the session folders', () => {
  expect(reservePath('/home/t', 'sess-9')).toBe('/home/t/.claude/state/statusline/bus/sess-9/.reserve')
  expect(reservePath('/home/t', '../x')).toBeUndefined()
  expect(reservePath(undefined, 'sess-9')).toBeUndefined()
  expect(RESERVE_DEFAULT_FILE).toBe('.reserve-default')
  expect(reserveDefaultPath('/home/t')).toBe('/home/t/.claude/state/statusline/bus/.reserve-default')
  expect(reserveDefaultPath(undefined)).toBeUndefined()
  expect(reserveDefaultPath('')).toBeUndefined()
  expect(reserveLine(RESERVE.big)).toBe('22\t11\t110\n')
  expect(reserveLine(RESERVE.small)).toBe('18\t9\t110\n')
  expect(reserveLine(undefined)).toBe('')
  expect(reserveLine({ full: 900, compact: -3, compactBelow: 110.9 })).toBe('40\t0\t110\n')
  expect(reserveLine({ full: NaN, compact: 8, compactBelow: NaN })).toBe('0\t8\t0\n')
})

describe('the done gesture and the team', () => {
  test('a turn of two minutes or more ends in a cheer, a shorter one in a hop: the engine\'s duration, else the turn\'s own start', () => {
    const m = newModel(0)

    expect(LONG_TURN_MS).toBe(120_000)
    turnStarted(m, 1_000)
    turnEnded(m, 5_000, true, 4_000)
    expect(shown(m, 5_100).activity).toBe('done')
    expect(isCheering(m)).toBe(false)
    expect(nextChangeIn(m, 5_000)).toBe(MOMENT_MS.done)

    turnStarted(m, 10_000)
    turnEnded(m, 200_000, true, 190_000)
    expect(shown(m, 200_100).activity).toBe('done')
    expect(isCheering(m)).toBe(true)
    expect(nextChangeIn(m, 200_000)).toBe(MOMENT_MS.cheer)
    expect(shown(m, 200_000 + MOMENT_MS.cheer).activity).toBe('idle')
    expect(isCheering(m)).toBe(false)

    // no duration from the engine: measured from the turn's start
    turnStarted(m, 300_000)
    turnEnded(m, 300_000 + LONG_TURN_MS, true, NaN)
    expect(isCheering(m)).toBe(true)
    turnStarted(m, 500_000)
    turnEnded(m, 500_000 + LONG_TURN_MS - 1, true, -1)
    expect(isCheering(m)).toBe(false)
    // a turn whose start was never seen (a reload in mid-turn) hops
    const n = newModel(0)

    n.isTurnRunning = true
    turnEnded(n, 900_000, true)
    expect(shown(n, 900_001).activity).toBe('done')
    expect(isCheering(n)).toBe(false)
    // no answer, no gesture of either kind
    turnStarted(n, 0)
    turnEnded(n, 1_000_000, false, 1_000_000)
    expect(isCheering(n)).toBe(false)
    expect(shown(n, 1_000_001).activity).not.toBe('done')
  })

  test('the team: one helper per delegating call in flight, one to three', () => {
    const m = newModel(0)

    turnStarted(m, 0)
    expect(teamSize(m)).toBe(1)
    toolStarted(m, 'a1', 'Agent', { description: 'd', prompt: 'p' }, 10)
    expect([shown(m, 11).activity, teamSize(m)]).toEqual(['delegating', 1])
    toolStarted(m, 'r1', 'Read', { file_path: '/a.ts' }, 12)
    toolStarted(m, 'w1', 'Workflow', { script: 'x' }, 13)
    expect([shown(m, 14).activity, teamSize(m)]).toEqual(['delegating', 2])
    toolStarted(m, 't1', 'Task', {}, 15)
    toolStarted(m, 's1', 'SendMessage', {}, 16)
    expect(teamSize(m)).toBe(3)
    toolEnded(m, 't1', 'Task', {}, 17)
    toolEnded(m, 's1', 'SendMessage', {}, 18)
    toolEnded(m, 'w1', 'Workflow', {}, 19)
    expect(teamSize(m)).toBe(1)
  })
})

describe('review fixes', () => {
  test('an ask belongs to a loop and a tool: only that loop\'s call ending, or its turn, clears it', () => {
    const m = newModel(0)

    turnStarted(m)
    toolStarted(m, 'b1', 'Bash', { command: 'rm -rf build' }, 10)
    permissionAsked(m, 20, '', 'Bash')
    // another loop's Read starts and ends while the dialog is up: still asking
    toolStarted(m, 'r1', 'Read', { file_path: '/a.ts' }, 30)
    expect(shown(m, 35).activity).toBe('asking')
    toolEnded(m, 'r1', 'Read', { file_path: '/a.ts' }, 40, 'agent-7')
    expect(shown(m, 45).activity).toBe('asking')
    // an agent's own Bash ending does not clear the main loop's ask either
    toolEnded(m, 'zz', 'Bash', { command: 'ls' }, 50, 'agent-7')
    expect(shown(m, 55).activity).toBe('asking')
    // the main loop's Bash ends: the ask is over
    toolEnded(m, 'b1', 'Bash', { command: 'rm -rf build' }, 60, '')
    expect(shown(m, 65).activity).not.toBe('asking')

    // an agent's ask goes when that agent's run ends
    permissionAsked(m, 70, 'agent-7', 'Write')
    expect(shown(m, 75).activity).toBe('asking')
    agentEnded(m, 'agent-9')
    expect(shown(m, 76).activity).toBe('asking')
    agentEnded(m, 'agent-7')
    expect(shown(m, 77).activity).not.toBe('asking')
  })

  test('background work keeps the calls in flight past the main turn and keeps Claude from idling or sleeping', () => {
    const m = newModel(0)

    turnStarted(m)
    toolStarted(m, 'mk', 'Bash', { command: 'make all' }, 100)
    backgroundSeen(m, 1, 200)
    turnEnded(m, 300)
    // the build is still in flight ten minutes on
    expect(shown(m, 300 + SLEEP_MS)).toEqual({ activity: 'running', word: 'Running make' })
    toolEnded(m, 'mk', 'Bash', { command: 'make all' }, 400, 'agent-7')
    // nothing in flight, but the session still has background work: delegating, never idle or asleep
    expect(shown(m, 400 + DECAY_MS + 1).activity).toBe('delegating')
    expect(shown(m, 400 + SLEEP_MS).activity).toBe('delegating')
    expect(nextChangeIn(m, 400 + DECAY_MS + 1)).toBe(FORGET_MS - DECAY_MS - 1)
    // nothing heard for 30 minutes: the report is stale
    expect(shown(m, 400 + FORGET_MS).activity).not.toBe('delegating')

    // with no background work the turn's end drops the calls, as before
    const n = newModel(0)

    turnStarted(n)
    toolStarted(n, 'x', 'Bash', { command: 'make all' }, 100)
    backgroundSeen(n, 0, 200)
    turnEnded(n, 300)
    expect(shown(n, 300 + DECAY_MS + 1).activity).toBe('idle')
  })

  test('the Bash word never carries an argument, whatever the shell syntax around the program', () => {
    const leaks: [string, string | undefined][] = [
      ['H=`printf hunter2pw | sha256sum` curl https://x', undefined],
      ['CREDS=(ghp_abc123 user) git push', undefined],
      ['ARGS=(hunter2pw --verbose) ; tool', undefined],
      ['2>/tmp/run/hunter2pw.log make', undefined],
      ['A"="b s3cr3t', undefined],
      ['PORT=$((BASE+1)) node server.js', undefined],
      ['X=$(cat /etc/passwd) hunter2pw', undefined],
      ['<<<"hunter2pw" cat', undefined],
      ['TOKEN=abc curl -H "Authorization: x" https://h', 'curl'],
      ['cd /x && npm test', 'npm'],
      ['FOO=bar\\ baz make', 'make'],
      ['"/path with space/bin" arg', 'bin'],
      ['', undefined],
    ]

    for (const [command, want] of leaks) {
      expect(programOf(command), command).toBe(want)
      expect(toolWord('Bash', { command }), command).not.toMatch(/hunter2pw|ghp_abc123|s3cr3t/)
    }
  })

  test('the host comes from the URL parser: nothing from the path, the userinfo or after a backslash', () => {
    expect(hostOf('https://docs.example.com/a/b?c=d')).toBe('docs.example.com')
    expect(hostOf('https://user:hunter2pw@example.com:8443/x')).toBe('example.com')
    expect(hostOf('https://example.com\\@evil.example/hunter2pw')).not.toMatch(/hunter2pw/)
    expect(hostOf('not a url')).toBeUndefined()
    expect(hostOf('https://')).toBeUndefined()
  })

  test('basename is linear on a long run of slashes', () => {
    expect(basename('/a/b/register.ts')).toBe('register.ts')
    expect(basename('/a/b/dir///')).toBe('dir')
    expect(basename('plain')).toBe('plain')
    expect(basename('///')).toBe('')

    const started = Date.now()

    expect(basename(`${'/'.repeat(200_000)}a`)).toBe('a')
    expect(basename(`a${'/'.repeat(200_000)}`)).toBe('a')
    expect(Date.now() - started).toBeLessThan(500)
  })

  test('format and bidi characters never reach the word', () => {
    for (const mark of ['‎', '‏', '؜', '​', '⁠', '﻿', '­', '‮', '\u001b']) {
      const word = toolWord('Read', { file_path: `/a/b/${mark}evil${mark}.ts` })

      expect(word, `U+${mark.codePointAt(0)?.toString(16)}`).toBe('Reading evil.ts')
    }
  })

  test('a gesture shows over thinking and idle, never over an ask or a call in flight', () => {
    const m = newModel(0)

    greeted(m, 0)
    expect(shown(m, 10).activity).toBe('greeting')
    expect(nextChangeIn(m, 10)).toBe(MOMENT_MS.greeting - 10)
    expect(shown(m, MOMENT_MS.greeting).activity).toBe('idle')

    turnStarted(m)
    toolFailed(m, 5_000)
    expect(shown(m, 5_100).activity).toBe('oops')
    toolStarted(m, 'r', 'Read', { file_path: '/a.ts' }, 5_200)
    expect(shown(m, 5_300).activity).toBe('reading')
    toolEnded(m, 'r', 'Read', { file_path: '/a.ts' }, 5_400)
    // within OOPS_EVERY_MS: no second flinch
    toolFailed(m, 5_500 + MOMENT_MS.oops)
    expect(shown(m, 5_600 + MOMENT_MS.oops).activity).toBe('thinking')
    toolFailed(m, 5_000 + OOPS_EVERY_MS)
    expect(shown(m, 5_001 + OOPS_EVERY_MS).activity).toBe('oops')

    turnEnded(m, 30_000, true)
    expect(shown(m, 30_100).activity).toBe('done')
    turnStarted(m)
    expect(shown(m, 30_200).activity).toBe('thinking')
    turnEnded(m, 31_000, false)
    expect(shown(m, 31_100).activity).not.toBe('done')
  })
})

describe('the demo tour', () => {
  /** One act's steps as [frame, ms] pairs, in order. */
  const actSteps = (act: number, isAnimated = true): [string, number][] => demoSteps(isAnimated).filter(step => step.act === act).map(step => [step.frame, step.ms])
  const actOf = (label: string): number => demoActs().indexOf(label)

  test('the acts in order: every busy scene family as the spinner shows it, then the gestures, the idle life and both sleeps', () => {
    expect(demoActs()).toEqual([
      'Thinking',
      'Writing',
      'Reading register.tsx',
      'Searching',
      'Searching the web',
      'Browsing example.com',
      'Editing register.tsx',
      'Running npm',
      'Delegating',
      'Delegating',
      'Orchestrating agents',
      'Asking you',
      'Working',
      'Loading a skill',
      'Calling github',
      'greeting',
      'done',
      'cheer',
      'oops',
      'idle',
      'stroll',
      'look',
      'hop',
      'yawn',
      'sip',
      'sweat',
      'clock',
      'pumpkin',
      'asleep',
      'asleep, cache cold',
    ])
    expect(DEMO_ACTS).toBe(30)
    // the words are the narration's own for a sample call (or the spinner's mode with none)
    expect(DEMO_WORDS).toEqual({
      thinking: 'Thinking',
      writing: 'Writing',
      reading: 'Reading register.tsx',
      searching: 'Searching',
      webSearch: 'Searching the web',
      browsing: 'Browsing example.com',
      editing: 'Editing register.tsx',
      running: 'Running npm',
      delegating: 'Delegating',
      orchestrating: 'Orchestrating agents',
      asking: 'Asking you',
      working: 'Working',
      skill: 'Loading a skill',
      calling: 'Calling github',
    })
  })

  test('about a minute in all, each act about 2 s, every loop played whole', () => {
    const steps = demoSteps()
    const total = steps.reduce((sum, step) => sum + step.ms, 0)

    expect(ACT_MS).toBe(2_000)
    expect(total).toBeGreaterThanOrEqual(60_000)
    expect(total).toBeLessThanOrEqual(75_000)

    for (let act = 0; act < DEMO_ACTS; act += 1) {
      const ms = actSteps(act).reduce((sum, [, length]) => sum + length, 0)

      expect(ms, demoActs()[act]).toBeGreaterThanOrEqual(1_250)
      expect(ms, demoActs()[act]).toBeLessThanOrEqual(3_000)
    }

    // a frame held over several ticks is one step: two steps in a row of one act always differ
    for (let i = 1; i < steps.length; i += 1) {
      const [a, b] = [steps[i - 1], steps[i]]

      if (a !== undefined && b !== undefined && a.act === b.act) {
        expect(`${a.frame}|${a.label}`, `step ${i}`).not.toBe(`${b.frame}|${b.label}`)
      }
    }

    // the acts come in order, each once
    expect([...new Set(steps.map(step => step.act))]).toEqual(Array.from({ length: DEMO_ACTS }, (_, act) => act))
  })

  test('every scene shows, the swapped ones included, and every solo frame but the three that only stand in for a scene in the footer', () => {
    const shown = new Set(demoSteps().map(step => step.frame))

    expect(Object.keys(SCENE_FRAMES).filter(frame => !shown.has(frame as FrameName))).toEqual([])
    expect(Object.keys(SOLO_FRAMES).filter(frame => !shown.has(frame as FrameName))).toEqual(['lookUp', 'lookDown', 'armsIn'])
  })

  test('the busy acts are the spinner\'s scenes: the bubble, the pen, the globe under a glass, the team of one, two and three, the scroll, the plug', () => {
    expect(actSteps(actOf('Thinking'))).toEqual([
      ['think1', 500],
      ['think2', 500],
      ['think3', 1_000],
    ])
    expect(actSteps(actOf('Writing'))).toEqual([
      ['write1', 500],
      ['write2', 500],
      ['write3', 1_000],
    ])
    // a six-tick loop played twice: 3 s
    expect(actSteps(actOf('Searching the web'))).toEqual([
      ['webSearch1', 500],
      ['webSearch2', 500],
      ['webSearch3', 500],
      ['webSearch1', 500],
      ['webSearch2', 500],
      ['webSearch3', 500],
    ])
    expect(actSteps(actOf('Browsing example.com')).map(([frame]) => frame)).toEqual(['web1', 'web2', 'web3', 'web1', 'web2', 'web3'])
    expect(actSteps(8).map(([frame]) => frame)).toEqual(['team1a', 'team1b', 'team1a', 'team1b'])
    expect(actSteps(9).map(([frame]) => frame)).toEqual(['team2a', 'team2b', 'team2a', 'team2b'])
    expect(actSteps(actOf('Orchestrating agents')).map(([frame]) => frame)).toEqual(['team3a', 'team3b', 'team3a', 'team3b'])
    expect(actSteps(actOf('Working')).map(([frame]) => frame)).toEqual(['work1', 'work2', 'work1', 'work2'])
    expect(actSteps(actOf('Loading a skill'))).toEqual([
      ['skill1', 500],
      ['skill2', 500],
      ['skill1', 500],
      ['skill2', 500],
    ])
    expect(actSteps(actOf('Calling github')).map(([frame]) => frame)).toEqual(['plug1', 'plug2', 'plug1', 'plug2'])
    // the book's twelve-tick loop once: 3 s
    expect(actSteps(actOf('Reading register.tsx')).reduce((sum, [, ms]) => sum + ms, 0)).toBe(3_000)
  })

  test('the gestures for their moments, idle\'s breath and blink, the moves as the wander plays them, the sleeps sped up', () => {
    expect(actSteps(actOf('greeting'))).toEqual([
      ['wave1', 500],
      ['wave2', 500],
      ['wave1', 500],
      ['wave2', 500],
    ])
    // the hop once, then its last frame to the end of its 1.5 s moment; the cheer the same in 2 s
    expect(actSteps(actOf('done'))).toEqual([
      ['hop1', 250],
      ['hop2', 250],
      ['hop3', 250],
      ['idle', 750],
    ])
    expect(actSteps(actOf('cheer'))).toEqual([
      ['cheer1', 250],
      ['cheer2', 250],
      ['cheer3', 250],
      ['cheer2', 250],
      ['cheer3', 250],
      ['idle', 750],
    ])
    expect(actSteps(actOf('oops'))).toEqual([['flinch', 1_250]])
    // the breath sped up, then a blink at its own pace
    expect(demoSteps().filter(step => step.act === actOf('idle')).map(step => [step.label, step.frame, step.ms])).toEqual([
      ['breath', 'idle', 500],
      ['breath', 'idleUp', 500],
      ['breath', 'idle', 300],
      ['blink', 'blinkHalf', 100],
      ['blink', 'blink', 200],
      ['blink', 'blinkHalf', 100],
      ['blink', 'idle', 300],
    ])
    // a stroll as its walk: alternating feet, then the stop
    expect(actSteps(actOf('stroll')).map(([frame]) => frame)).toEqual(['stepA', 'stepB', 'stepA', 'stepB', 'stepA', 'stepB', 'stepA', 'idle'])
    expect(actSteps(actOf('yawn'))).toEqual([
      ['yawn1', 500],
      ['yawn2', 1_000],
      ['yawn1', 500],
    ])
    expect(actSteps(actOf('sip'))).toEqual([
      ['sip1', 500],
      ['sip2', 1_000],
      ['sip1', 500],
    ])
    expect(actSteps(actOf('pumpkin'))).toEqual([
      ['pumpkin1', 750],
      ['pumpkin2', 500],
      ['pumpkin1', 750],
      ['pumpkin2', 500],
    ])

    for (const kind of ['look', 'hop', 'sweat', 'clock'] as const) {
      const frames = actSteps(actOf(kind)).flatMap(([frame, ms]) => Array.from({ length: ms / TICK_MS }, () => frame))

      // the move whole, as often as it takes to fill 2 s
      expect(frames, kind).toEqual([...STILL[kind], ...STILL[kind]].slice(0, Math.ceil(8 / STILL[kind].length) * STILL[kind].length))
    }

    // asleep a frame lasts 3 s; the tour shows a whole pass in about 2 s
    expect(actSteps(actOf('asleep'))).toEqual([
      ['sleep1', 750],
      ['sleep2', 750],
      ['sleep3', 750],
    ])
    expect(actSteps(actOf('asleep, cache cold'))).toEqual([
      ['sleepCold1', 1_000],
      ['sleepCold2', 1_000],
    ])
    expect(SLEEP_FRAME_MS).toBeGreaterThan(1_000)
  })

  test('reduced motion: each act its first frame alone, held for the act', () => {
    const still = demoSteps(false)
    const moving = demoSteps()

    expect(still).toHaveLength(DEMO_ACTS)
    expect(still.map(step => step.act)).toEqual(Array.from({ length: DEMO_ACTS }, (_, act) => act))
    expect(still.reduce((sum, step) => sum + step.ms, 0)).toBe(moving.reduce((sum, step) => sum + step.ms, 0))

    for (const step of still) {
      const first = moving.find(each => each.act === step.act)

      expect([step.frame, step.label], String(step.act)).toEqual([first?.frame, first?.label])
    }
  })

  test('every step names a frame of the table and a label the band can show', () => {
    for (const step of [...demoSteps(), ...demoSteps(false)]) {
      expect(isFrameName(step.frame), step.frame).toBe(true)
      expect(step.label.length > 0 && step.label.length <= 24, step.label).toBe(true)
      expect(step.ms > 0 && Number.isInteger(step.ms), `${step.frame} ${step.ms}`).toBe(true)
    }
  })
})
