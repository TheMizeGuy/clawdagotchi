// Claude's frames: the 132 picture frames by name (scripts/frames.json,
// mirrored here), the twelve braille poses that stand in for them where no
// picture can be drawn, the frame loop of each activity, the scene each
// spinner word and mode puts beside the spinner, the blink, and the view and
// row pieces the render hooks draw. Pure: no `$`.

import type { CoworkerActivity, CoworkerView } from '../../types'
import { WORDS } from './activity'
import { clampX, WANDER_RANGE } from './wander'

/**
 * One of the twelve braille poses: 10x4 pixels, five braille cells. Each
 * picture frame names the pose that stands in for it: the picture's `alt`
 * where the terminal has no graphics, and the drawing itself with the
 * `picture` option off.
 */
export type Pose = 'idle' | 'blink' | 'lookL' | 'lookR' | 'focus' | 'armsIn' | 'stepA' | 'stepB' | 'hop' | 'wave' | 'flinch' | 'sleep'

/**
 * The poses as pixel rows, top to bottom, `#` on and `.` off: the Claude Code
 * mascot (wide body, two wide-set eyes, arm nubs at the sides, four small legs).
 * Edit a row here and BRAILLE follows.
 */
export const PIXELS: Readonly<Record<Pose, readonly string[]>> = {
  idle: ['.########.', '.#.####.#.', '##########', '.#.#..#.#.'],
  blink: ['.########.', '.########.', '##########', '.#.#..#.#.'],
  lookL: ['.########.', '.#.###.##.', '##########', '.#.#..#.#.'],
  lookR: ['.########.', '.##.###.#.', '##########', '.#.#..#.#.'],
  focus: ['.########.', '.##.##.##.', '##########', '.#.#..#.#.'],
  armsIn: ['.########.', '.#.####.#.', '.########.', '.#.#..#.#.'],
  stepA: ['.########.', '.#.####.#.', '##########', '#.#....#.#'],
  stepB: ['.########.', '.#.####.#.', '##########', '..##..##..'],
  hop: ['.#.####.#.', '##########', '.#.#..#.#.', '..........'],
  // the right arm lifted off the side, up beside the head
  wave: ['.#########', '.#.####.#.', '#########.', '.#.#..#.#.'],
  // eyes shut, arms pulled in
  flinch: ['.########.', '.########.', '.########.', '.#.#..#.#.'],
  sleep: ['..........', '.########.', '##########', '.#.#..#.#.'],
}

/** Braille dot bits of a cell's left pixel column, rows top to bottom. */
const LEFT_BITS = [0x01, 0x02, 0x04, 0x40] as const
/** Braille dot bits of a cell's right pixel column, rows top to bottom. */
const RIGHT_BITS = [0x08, 0x10, 0x20, 0x80] as const
const BRAILLE_BASE = 0x2800

/**
 * Pixel rows (`#` on, anything else off) as braille: two pixel columns and
 * four rows per cell. Rows past the fourth are ignored; a short row or an odd
 * width reads as off pixels.
 */
export function braille(rows: readonly string[]): string {
  const width = rows.slice(0, 4).reduce((most, row) => Math.max(most, row.length), 0)
  let out = ''

  for (let column = 0; column < width; column += 2) {
    let bits = 0

    for (let row = 0; row < 4; row += 1) {
      const line = rows[row] ?? ''

      if (line[column] === '#') {
        bits |= LEFT_BITS[row] ?? 0
      }

      if (line[column + 1] === '#') {
        bits |= RIGHT_BITS[row] ?? 0
      }
    }

    out += String.fromCharCode(BRAILLE_BASE + bits)
  }

  return out
}

function composeAll(): Readonly<Record<Pose, string>> {
  const out = {} as Record<Pose, string>

  for (const name of Object.keys(PIXELS) as Pose[]) {
    out[name] = braille(PIXELS[name])
  }

  return out
}

/** Every pose as its braille string, composed once at load. */
export const BRAILLE: Readonly<Record<Pose, string>> = composeAll()

// The frame table: scripts/frames.json, mirrored. tests/test_frames.py reads
// both and holds them equal, kind by kind, entry for entry and in order, and
// checks that each frame's PNG exists at the size its kind gives. Keep one
// entry per line.

/**
 * The solo frames: Claude alone, 8 cells by 2 rows (4 by 1 with `big` off),
 * drawn anywhere. Each names the braille pose that stands in for it. From
 * tally0 on (0.6.0) they are the skits of a Claude minding background agents,
 * and the peek at a background shell (term1, term2).
 */
export const SOLO_FRAMES = {
  idle: 'idle',
  idleUp: 'idle',
  blink: 'blink',
  lookL: 'lookL',
  lookR: 'lookR',
  lookUp: 'idle',
  lookDown: 'focus',
  armsIn: 'armsIn',
  stepA: 'stepA',
  stepB: 'stepB',
  hop1: 'idle',
  hop2: 'hop',
  hop3: 'idle',
  wave1: 'wave',
  wave2: 'idle',
  flinch: 'flinch',
  cheer1: 'hop',
  cheer2: 'wave',
  cheer3: 'hop',
  yawn1: 'blink',
  yawn2: 'blink',
  sip1: 'armsIn',
  sip2: 'blink',
  sweat1: 'lookL',
  sweat2: 'lookL',
  clock1: 'focus',
  clock2: 'focus',
  pumpkin1: 'idle',
  pumpkin2: 'blink',
  sleep1: 'sleep',
  sleep2: 'sleep',
  sleep3: 'sleep',
  sleepCold1: 'sleep',
  sleepCold2: 'sleep',
  blinkHalf: 'blink',
  tally0: 'idle',
  tally1: 'wave',
  tally2: 'wave',
  tally3: 'wave',
  tally4: 'wave',
  tally5: 'wave',
  tally6: 'wave',
  tally7: 'wave',
  tally8: 'wave',
  tally9: 'wave',
  tallyMany: 'wave',
  radar1: 'lookR',
  radar2: 'lookR',
  radar3: 'lookR',
  radar4: 'blink',
  radio1: 'idle',
  radio2: 'lookL',
  radio3: 'blink',
  report1: 'lookR',
  report2: 'lookR',
  report3: 'focus',
  report4: 'blink',
  launch1: 'lookR',
  launch2: 'lookR',
  launch3: 'idle',
  perch1: 'idle',
  perch2: 'blink',
  conduct1: 'wave',
  conduct2: 'idle',
  conduct3: 'wave',
  juggle1: 'idle',
  juggle2: 'wave',
  juggle3: 'idle',
  gum1: 'idle',
  gum2: 'idle',
  gum3: 'flinch',
  popcorn1: 'lookL',
  popcorn2: 'blink',
  plane1: 'lookR',
  plane2: 'wave',
  plane3: 'lookR',
  plane4: 'lookL',
  plane5: 'flinch',
  zen1: 'blink',
  zen2: 'blink',
  plant1: 'lookR',
  plant2: 'lookR',
  plant3: 'lookR',
  plant4: 'blink',
  water1: 'lookR',
  water2: 'lookR',
  water3: 'lookR',
  water4: 'lookR',
  lantern1: 'idle',
  lantern2: 'blink',
  lunch1: 'idle',
  lunch2: 'blink',
  term1: 'lookR',
  term2: 'lookR',
} as const satisfies Record<string, Pose>

export type SoloFrame = keyof typeof SOLO_FRAMES

/**
 * The scene frames: Claude at the left exactly as in his solo frame, a prop
 * at the right, 12 cells by 2 rows, drawn only beside the spinner. Each names
 * the solo frame it is built on, which is what is drawn in its place wherever
 * a scene cannot be (the footer, `scenes` off), the team scenes excepted:
 * footerOf.
 */
export const SCENE_FRAMES = {
  think1: 'lookUp',
  think2: 'lookUp',
  think3: 'idle',
  read1: 'lookDown',
  read2: 'lookDown',
  read3: 'blink',
  search1: 'lookL',
  search2: 'idle',
  search3: 'lookR',
  type1: 'armsIn',
  type2: 'idle',
  type3: 'armsIn',
  run1: 'stepA',
  run2: 'stepB',
  run3: 'stepA',
  web1: 'lookR',
  web2: 'lookR',
  web3: 'idle',
  team1a: 'hop2',
  team1b: 'idle',
  team2a: 'hop2',
  team2b: 'idle',
  team3a: 'hop2',
  team3b: 'idle',
  ask1: 'wave1',
  ask2: 'wave2',
  work1: 'idle',
  work2: 'blink',
  write1: 'lookDown',
  write2: 'lookDown',
  write3: 'blink',
  webSearch1: 'lookR',
  webSearch2: 'lookR',
  webSearch3: 'idle',
  skill1: 'lookDown',
  skill2: 'idle',
  plug1: 'armsIn',
  plug2: 'idle',
} as const satisfies Record<string, SoloFrame>

export type SceneFrame = keyof typeof SCENE_FRAMES

/** One picture frame by name: assets/frames/<name>.png (scripts/make-frames.py draws them). */
export type FrameName = SoloFrame | SceneFrame

/** Every frame name: the solo frames, then the scenes, each kind in the order of scripts/frames.json. */
export const FRAME_NAMES: readonly FrameName[] = [...(Object.keys(SOLO_FRAMES) as SoloFrame[]), ...(Object.keys(SCENE_FRAMES) as SceneFrame[])]

const SOLO_SET: ReadonlySet<string> = new Set(Object.keys(SOLO_FRAMES))
const SCENE_SET: ReadonlySet<string> = new Set(Object.keys(SCENE_FRAMES))

/** True for a name the table holds (a value read back from $.state may be anything). */
export function isFrameName(value: unknown): value is FrameName {
  return typeof value === 'string' && (SOLO_SET.has(value) || SCENE_SET.has(value))
}

/** True for a scene frame (12 cells wide, beside the spinner only). */
export function isScene(frame: FrameName): frame is SceneFrame {
  return SCENE_SET.has(frame)
}

/** The solo frame a frame shows where a scene cannot be drawn: itself for a solo frame. */
export function soloOf(frame: FrameName): SoloFrame {
  return isScene(frame) ? SCENE_FRAMES[frame] : frame
}

/**
 * The stand-ins where a scene's own solo frame would not do without its
 * prop: the team scenes are built on the hop (Claude bobbing with his
 * helpers), and with no helpers beside him (on the status row, or beside the
 * spinner with `scenes` off) that loop was a hop every half second for as
 * long as the work ran. There he looks toward where the helpers would be
 * instead.
 */
const FOOTER_FRAMES: ReadonlyMap<FrameName, SoloFrame> = new Map<FrameName, SoloFrame>([
  ['team1a', 'lookR'],
  ['team2a', 'lookR'],
  ['team3a', 'lookR'],
])

/** The solo frame drawn for a frame wherever a scene cannot be (the footer, `scenes` off): its stand-in (FOOTER_FRAMES), else the frame's own solo frame. */
export function footerOf(frame: FrameName): SoloFrame {
  return FOOTER_FRAMES.get(frame) ?? soloOf(frame)
}

/** The braille pose that stands in for a frame. */
export function poseOf(frame: FrameName): Pose {
  return SOLO_FRAMES[soloOf(frame)]
}

/** The braille string that stands in for a frame: 5 cells, one row. */
export function brailleOf(frame: FrameName): string {
  return BRAILLE[poseOf(frame)]
}

/** The absolute path of a frame's PNG under the plugin's directory. */
export function frameFile(root: string, frame: FrameName): string {
  return `${root.replace(/\/+$/, '')}/assets/frames/${frame}.png`
}

/** `a` twice, `b` once: a loop written the way its timing reads. */
function times(frame: FrameName, count: number): FrameName[] {
  return Array.from({ length: count }, () => frame)
}

/**
 * The frame loop of each activity, one step per 250 ms tick. Delegating, done
 * and asleep have more than one form (TEAM_LOOPS, CHEER_LOOP, COLD_LOOP); the
 * forms below are the defaults. Beside the spinner a spinner word or mode
 * can put another scene in a step's place (sceneFor), step for step. Idle and
 * supervising (at ease) are breathing (idle and idleUp every 2 s, BREATH_MS)
 * and the blink (BLINK), not a tick loop; what he does between breaths is the
 * wander's (./wander). Done plays once and holds its last frame (ONCE); every
 * other loop repeats.
 */
export const LOOPS: Readonly<Record<CoworkerActivity, readonly FrameName[]>> = {
  thinking: [...times('think1', 2), ...times('think2', 2), ...times('think3', 4)],
  reading: [...times('read1', 3), ...times('read2', 3), ...times('read1', 2), ...times('read2', 2), ...times('read3', 2)],
  searching: [...times('search1', 2), ...times('search2', 2), ...times('search3', 2), ...times('search2', 2)],
  editing: ['type1', 'type2', 'type1', 'type2', 'type3', 'type2'],
  running: [...times('run1', 2), ...times('run2', 2), ...times('run3', 2)],
  browsing: [...times('web1', 2), ...times('web2', 2), ...times('web3', 2)],
  delegating: [...times('team1a', 2), ...times('team1b', 2)],
  asking: [...times('ask1', 2), ...times('ask2', 2)],
  working: [...times('work1', 2), ...times('work2', 2)],
  // the wave held two ticks a side: the arm swings at the pace of a real wave, four swings in the 2 s greeting
  greeting: [...times('wave1', 2), ...times('wave2', 2), ...times('wave1', 2), ...times('wave2', 2)],
  done: ['hop1', 'hop2', 'hop3', 'idle'],
  oops: ['flinch'],
  supervising: ['idle', 'idleUp'],
  idle: ['idle', 'idleUp'],
  asleep: ['sleep1', 'sleep2', 'sleep3'],
}

/** Delegating by how many delegating calls are in flight (1 to 3): that many small helpers bobbing. */
export const TEAM_LOOPS: Readonly<Record<1 | 2 | 3, readonly FrameName[]>> = {
  1: [...times('team1a', 2), ...times('team1b', 2)],
  2: [...times('team2a', 2), ...times('team2b', 2)],
  3: [...times('team3a', 2), ...times('team3b', 2)],
}

/** Done after a long turn (LONG_TURN_MS): a cheer with confetti, played once. */
export const CHEER_LOOP: readonly FrameName[] = ['cheer1', 'cheer2', 'cheer3', 'cheer2', 'cheer3', 'idle']

/** Asleep once the prompt cache has gone cold: frost and a turning snowflake. */
export const COLD_LOOP: readonly FrameName[] = ['sleepCold1', 'sleepCold2']

/** Each frame of the families a spinner word or mode swaps, by its step in the family (think1 is 0, think3 is 2). */
const THINK_AT: ReadonlyMap<FrameName, number> = new Map<FrameName, number>([
  ['think1', 0],
  ['think2', 1],
  ['think3', 2],
])
const WEB_AT: ReadonlyMap<FrameName, number> = new Map<FrameName, number>([
  ['web1', 0],
  ['web2', 1],
  ['web3', 2],
])
const WORK_AT: ReadonlyMap<FrameName, number> = new Map<FrameName, number>([
  ['work1', 0],
  ['work2', 1],
])

/**
 * Beside the spinner, the thought bubble gives way to what the spinner's mode
 * says the model is doing, step for step (think1, think2, think3): writing its
 * answer (`responding`, the word `Writing`: a pen on a notepad), writing a tool
 * call's input (`tool-input`: the laptop), waiting on a tool (`tool-use`, the
 * word `Working`: the gear, whose two frames make work1, work2, work1). Any
 * other mode (`thinking`, `requesting`) keeps the bubble.
 */
export const THINK_BY_MODE: ReadonlyMap<string, readonly [SceneFrame, SceneFrame, SceneFrame]> = new Map<string, readonly [SceneFrame, SceneFrame, SceneFrame]>([
  ['responding', ['write1', 'write2', 'write3']],
  ['tool-input', ['type1', 'type2', 'type3']],
  ['tool-use', ['work1', 'work2', 'work1']],
])

/** `Searching the web`: the magnifying glass over the turning globe, step for step with web1-3 (a page fetched keeps the globe alone). */
export const WEB_SEARCH_LOOP: readonly [SceneFrame, SceneFrame, SceneFrame] = ['webSearch1', 'webSearch2', 'webSearch3']
/** `Loading a skill`: a scroll unrolling, step for step with work1-2. */
export const SKILL_LOOP: readonly [SceneFrame, SceneFrame] = ['skill1', 'skill2']
/** `Calling <server>` (an MCP tool): a plug going into its socket, step for step with work1-2. */
export const PLUG_LOOP: readonly [SceneFrame, SceneFrame] = ['plug1', 'plug2']

/**
 * The scene beside the spinner for a busy loop's frame, the spinner's word and
 * its mode, so every spinner word has its own: the thought bubble by the mode
 * (THINK_BY_MODE), the globe under a magnifying glass for `Searching the web`,
 * and in the gear's place a scroll for `Loading a skill` and a plug for
 * `Calling <server>`. Every other frame, and any word or mode it does not know,
 * stays as it is. The footer draws solo frames and never asks.
 */
export function sceneFor(frame: FrameName, word: string, mode: string): FrameName {
  const think = THINK_AT.get(frame)

  if (think !== undefined) {
    return THINK_BY_MODE.get(mode)?.[think] ?? frame
  }

  const said = typeof word === 'string' ? word : ''
  const web = WEB_AT.get(frame)

  if (web !== undefined) {
    return said === WORDS.webSearch ? (WEB_SEARCH_LOOP[web] ?? frame) : frame
  }

  const work = WORK_AT.get(frame)

  if (work !== undefined) {
    if (said.startsWith(WORDS.skill)) {
      return SKILL_LOOP[work] ?? frame
    }

    if (said.startsWith(WORDS.calling)) {
      return PLUG_LOOP[work] ?? frame
    }
  }

  return frame
}

/** The activities whose loop plays once and holds its last frame. */
const ONCE: ReadonlySet<CoworkerActivity> = new Set<CoworkerActivity>(['done'])

/** The dim word left of the sprite; empty for none. */
export const CAPTIONS: Readonly<Record<CoworkerActivity, string>> = {
  thinking: 'thinking',
  reading: 'reading',
  searching: 'searching',
  editing: 'editing',
  running: 'running',
  browsing: 'browsing',
  delegating: 'delegating',
  asking: 'needs you',
  working: 'working',
  greeting: 'hi',
  done: 'done',
  oops: 'oops',
  // supervising says how many agents are at work (agentsCaption), set by the frame's context
  supervising: '',
  idle: '',
  asleep: '',
}

/** The caption while he minds background agents: how many are at work, `9+` past nine. At most 9 cells. */
export function agentsCaption(count: number): string {
  const whole = Number.isFinite(count) ? Math.max(1, Math.floor(count)) : 1

  return whole === 1 ? '1 agent' : `${whole > 9 ? '9+' : whole} agents`
}

/** One animation step. */
export const TICK_MS = 250
/**
 * How long the footer leaves Claude to the main loop's spinner after that site last drew him
 * (a turn start counts). The spinner site redraws him only when his frame changes, so this
 * must outlast the longest hold of one frame in any busy loop and the longest moment (`oops`):
 * shorter, and he flickered into the footer for a tick at every long hold (0.3.1). When the
 * engine shows no spinner although the turn has not ended (between a /goal's iterations), the
 * footer takes him back after this.
 */
export const SPINNER_FRESH_MS = 2_500
/** From one idle blink to the next: how long the eyes stay open. */
export const BLINK_EVERY_MS = 6_000
/**
 * The idle blink, every BLINK_EVERY_MS: half shut, shut, half shut, each held
 * this long (400 ms in all), then open again. The half-shut lids are what
 * make it read as a blink and not a flicker.
 */
export const BLINK: readonly { frame: 'blinkHalf' | 'blink'; ms: number }[] = [
  { frame: 'blinkHalf', ms: 100 },
  { frame: 'blink', ms: 200 },
  { frame: 'blinkHalf', ms: 100 },
]
/** Idle, Claude breathes: idle and idleUp take turns this often. */
export const BREATH_MS = 2_000
/** Asleep, one frame of the sleep loop this often. */
export const SLEEP_FRAME_MS = 3_000
/** Claude's orange, the colored braille's and the pictures' (scripts/make-frames.py). */
export const CLAUDE_COLOR = '#d97757'
/** Asleep: the sleep frame and its `z`, muted. */
export const ASLEEP_COLOR = '#7d5a50'
/**
 * The two sizes of the drawing: `big` is the picture in a box of 8 cells by 2
 * rows (the `big` option, on by default), which spans the status row and the
 * engine's short permission-mode row under it without adding a row; `small`
 * is 0.2.0's one row: the picture in 4 cells by 1 (`big` off), or the 5-cell
 * braille (`picture` off).
 */
export type Size = 'big' | 'small'

/** The size drawn: the two-row box only for the picture with `big` on. */
export function sizeOf(isPicture: boolean, isBig: boolean): Size {
  return isPicture && isBig ? 'big' : 'small'
}

/** A solo frame's box per size, in terminal cells. */
export const PICTURE: Readonly<Record<Size, { columns: number; rows: number }>> = {
  big: { columns: 8, rows: 2 },
  small: { columns: 4, rows: 1 },
}

/** A scene frame's box: drawn only beside the spinner, only with `big` on. */
export const SCENE_BOX = { columns: 12, rows: 2 } as const

/** The box a frame is drawn in: a scene 12x2 with `big` on; otherwise the size's solo box. */
export function boxOf(frame: FrameName, size: Size): { columns: number; rows: number } {
  return size === 'big' && isScene(frame) ? SCENE_BOX : PICTURE[size]
}

/**
 * The frame drawn beside the spinner: the scene itself where scenes may be
 * drawn (the `scenes` option, and `big`: a scene needs two rows), else the
 * solo frame that stands in for it (footerOf: never the team scenes' bare hop).
 */
export function spinnerFrame(frame: FrameName, isScenes: boolean, size: Size): FrameName {
  return isScenes && size === 'big' ? frame : footerOf(frame)
}

/**
 * The footer site shares its row with the status line, right-aligned; when the
 * two do not fit, the engine wraps the site onto a row of its own and the
 * prompt jumps. So the mod reserves its cells on the status bus
 * (./statusline-bus) and the status line script keeps them free: FULL for the
 * widest drawing, COMPACT for Claude alone, which is what is drawn in a
 * terminal narrower than COMPACT_BELOW columns. `big`: a space, Claude's 8
 * cells, 12 cells to wander in and one spare (which also holds a space, a
 * 10-cell caption, a space and Claude); compact a space, Claude, 1 cell to
 * wander in and one spare. `small` (0.2.0): a space, Claude's 4 cells, 12 to
 * wander in, one spare; compact a space, Claude, 3 cells to wander in or ` z`,
 * one spare. The spare is never drawn on: the engine wrapped the site onto a
 * row of its own when the drawing filled every reserved cell (102 columns,
 * 2026-10-02). The footer draws solo frames only, so a scene never widens it.
 */
export const RESERVE = {
  big: { full: 22, compact: 11, compactBelow: 110 },
  small: { full: 18, compact: 9, compactBelow: 110 },
} as const

/**
 * True while Claude is at ease: idle, or minding background agents with the
 * main loop at rest. At ease he breathes, blinks and makes his moves (the
 * wander); no tick loop runs.
 */
export function isAtEase(activity: CoworkerActivity): boolean {
  return activity === 'idle' || activity === 'supervising'
}

/** True for the activities that animate on the tick (all but the at-ease ones and asleep). */
export function isBusy(activity: CoworkerActivity): boolean {
  return !isAtEase(activity) && activity !== 'asleep'
}

/**
 * What else picks a frame: reduced motion (`isAnimated` false holds each
 * loop's first frame), the at-ease blink (`isBlinking` shut, `isBlinkHalf`
 * half shut) and breath, how many delegating calls are in flight, whether a
 * finished turn was long enough for a cheer, whether the prompt cache has
 * gone cold, and how many agents he minds (the supervising caption).
 */
export type FrameContext = {
  agents?: number
  isAnimated?: boolean
  isBlinking?: boolean
  isBlinkHalf?: boolean
  isBreathIn?: boolean
  team?: 1 | 2 | 3
  isCheer?: boolean
  isCold?: boolean
}

/** The loop an activity plays in a context: the team's size, the cheer, the cold sleep. */
export function loopOf(activity: CoworkerActivity, context: FrameContext = {}): readonly FrameName[] {
  if (activity === 'delegating') {
    return TEAM_LOOPS[context.team ?? 1]
  }

  if (activity === 'done' && context.isCheer === true) {
    return CHEER_LOOP
  }

  if (activity === 'asleep' && context.isCold === true) {
    return COLD_LOOP
  }

  return LOOPS[activity]
}

/** The frame of an activity at a step of its loop (at ease: the blink, shut or half shut, else the breath). */
export function frameAt(activity: CoworkerActivity, step: number, context: FrameContext = {}): FrameName {
  const isAnimated = context.isAnimated !== false

  if (isAtEase(activity)) {
    if (!isAnimated) {
      return 'idle'
    }

    return context.isBlinking === true ? 'blink' : context.isBlinkHalf === true ? 'blinkHalf' : context.isBreathIn === true ? 'idleUp' : 'idle'
  }

  const loop = loopOf(activity, context)
  const whole = Number.isFinite(step) ? Math.max(0, Math.floor(step)) : 0
  const index = !isAnimated || loop.length === 0 ? 0 : ONCE.has(activity) ? Math.min(whole, loop.length - 1) : whole % loop.length

  return loop[index] ?? 'idle'
}

/** A view whose frame is known to be one of the table's (the $.state contract says only `string`). */
export type FrameView = CoworkerView & { frame: FrameName }

/** A view of one frame: its name, the braille that stands in for it, the caption, asleep or not. */
export function viewOfFrame(frame: FrameName, caption = '', isAsleep = false): FrameView {
  return { frame, sprite: brailleOf(frame), caption, isAsleep }
}

/** The caption of an activity in a context: the activity's own, or while supervising how many agents he minds. */
export function captionOf(activity: CoworkerActivity, context: FrameContext = {}): string {
  return activity === 'supervising' ? agentsCaption(context.agents ?? 1) : CAPTIONS[activity]
}

/** What the render hooks draw for an activity at a step of its loop. */
export function viewOf(activity: CoworkerActivity, step: number, context: FrameContext = {}): FrameView {
  return viewOfFrame(frameAt(activity, step, context), captionOf(activity, context), activity === 'asleep')
}

/**
 * A Claude at ease in the middle of a move (a stroll, a yawn, a skit): that
 * frame, with the caption his activity has (none idle; the agents' count
 * while supervising, so it does not come and go with every move).
 */
export function movingView(frame: FrameName, caption = ''): FrameView {
  return viewOfFrame(frame, caption)
}

/**
 * A view as read back from $.state, made whole: a value an older version
 * wrote (0.3.1 kept no frame name) or anything malformed draws as the idle
 * frame, or the first sleep frame while asleep, never as a missing picture.
 */
export function normalView(value: unknown): FrameView {
  const record = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  const isAsleep = record.isAsleep === true
  const frame = isFrameName(record.frame) ? record.frame : isAsleep ? 'sleep1' : 'idle'
  const caption = typeof record.caption === 'string' ? record.caption : ''

  return viewOfFrame(frame, caption, isAsleep)
}

/** A view's identity: equal keys draw the same thing. */
export function viewKey(view: CoworkerView): string {
  return `${view.isAsleep ? 'z' : '-'}|${view.caption}|${String(view.frame)}`
}

/**
 * One piece of the footer drawing, left to right: `dim` text (the engine's
 * labels, the caption), Claude (`claude`, or `sleeping` while asleep; drawn
 * as the picture, or as the colored braille `text`), the muted ` z` while
 * asleep (`asleep`), and the blank cells to his right (`blank`).
 */
export type Piece = { text: string; tone: 'dim' | 'claude' | 'sleeping' | 'asleep' | 'blank' }

/**
 * How the footer is drawn: a narrow terminal, Claude's place on the row, the
 * picture or the braille, and the size (`size`, default `small`: 0.2.0's).
 */
export type FooterOptions = { isCompact?: boolean; x?: number; isPicture?: boolean; size?: Size }

/** True for the piece that is Claude himself. */
export function isClaude(piece: Piece): boolean {
  return piece.tone === 'claude' || piece.tone === 'sleeping'
}

/**
 * The cells a piece takes: any text its characters; Claude's picture its
 * box's columns where the terminal draws it, but its braille `alt` (5 cells)
 * where it cannot, so the larger of the two is counted.
 */
export function pieceCells(piece: Piece, isPicture = false, size: Size = 'small'): number {
  const cells = [...piece.text].length

  return isPicture && isClaude(piece) ? Math.max(PICTURE[size].columns, cells) : cells
}

/**
 * The footer row as pieces: the engine's own mode labels (dim, joined by
 * ` & `), then the caption (dim), Claude, and `x` blank cells to his right
 * (the muted ` z` while asleep takes the first two). It always opens with a
 * space, so it never runs into a footer item drawn before it. Everything
 * after the labels fits the size's reserve: `isCompact` (a narrow terminal)
 * leaves the caption out and walks the size's compact range at most (3
 * cells; 1 for `big`), a caption shortens the walk, the ` · ` before a
 * caption becomes a space where it would not fit, and the ` z` becomes `z`
 * where only one cell is left (`big` in a narrow terminal). Claude's text is
 * the braille of the view's frame (the footer's solo frame for a scene).
 */
export function footerPieces(modes: readonly string[], view: CoworkerView, options: FooterOptions = {}): Piece[] {
  const labels = modes.join(' & ')
  const claude: Piece = { text: view.sprite, tone: view.isAsleep ? 'sleeping' : 'claude' }
  const { lead, room, range } = footerLayout(modes, view, options)
  const x = clampX(options.x ?? 0, range)
  const pieces: Piece[] = []

  if (labels !== '') {
    pieces.push({ text: labels, tone: 'dim' })
  }

  pieces.push({ text: lead, tone: 'dim' }, claude)

  const z = !view.isAsleep ? '' : room >= 2 ? ' z' : room === 1 ? 'z' : ''

  if (z !== '') {
    pieces.push({ text: z, tone: 'asleep' })
  }

  const blanks = x - [...z].length

  if (blanks > 0) {
    pieces.push({ text: ' '.repeat(blanks), tone: 'blank' })
  }

  return pieces
}

/**
 * The footer row's measures for a view: the lead before Claude (a space, or
 * the caption between its separators), the blank cells left right of him
 * with the spare kept free (`room`), and how far he may stand from the right
 * end there (`range`: the size's wander range, short of the room).
 */
function footerLayout(modes: readonly string[], view: CoworkerView, options: FooterOptions): { lead: string; room: number; range: number } {
  const isCompact = options.isCompact === true
  const size = options.size ?? 'small'
  const labels = modes.join(' & ')
  const reserve = isCompact ? RESERVE[size].compact : RESERVE[size].full
  const claudeCells = pieceCells({ text: view.sprite, tone: 'claude' }, options.isPicture === true, size)
  const caption = isCompact ? '' : view.caption
  let lead = caption === '' ? ' ' : `${labels === '' ? ' ' : ' · '}${caption} `

  if ([...lead].length + claudeCells > reserve) {
    lead = ` ${caption} `
  }

  // the spare stays free (see RESERVE)
  const room = reserve - 1 - [...lead].length - claudeCells

  return { lead, room, range: Math.max(0, Math.min(isCompact ? WANDER_RANGE[size].compact : WANDER_RANGE[size].full, room)) }
}

/**
 * How far Claude may walk on the footer row as it is drawn for a view: with
 * no caption wanderRoom's answer, with one (`3 agents` while he minds them)
 * only what it leaves, so a stroll never steps where the row cannot show it.
 */
export function footerRange(modes: readonly string[], view: CoworkerView, options: FooterOptions = {}): number {
  return footerLayout(modes, view, options).range
}

/**
 * How far an idle Claude may walk on this row: the size's wander range, short
 * of what the reserve leaves right of his drawing with its spare kept free.
 * `big`: 0 to 12 at full width and 0 to 1 in a narrow terminal. `small`, with
 * the picture counted as its 5-cell alt: 0 to 11 and 0 to 2.
 */
export function wanderRoom(isCompact: boolean, isPicture: boolean, size: Size = 'small'): number {
  const cells = pieceCells({ text: BRAILLE.idle, tone: 'claude' }, isPicture, size)
  const range = isCompact ? WANDER_RANGE[size].compact : WANDER_RANGE[size].full

  return Math.max(0, Math.min(range, (isCompact ? RESERVE[size].compact : RESERVE[size].full) - 2 - cells))
}

/** The cells the drawing adds after the engine's labels. */
export function addedCells(pieces: readonly Piece[], modes: readonly string[], isPicture = false, size: Size = 'small'): number {
  const labels = modes.join(' & ')
  const all = pieces.reduce((sum, piece) => sum + pieceCells(piece, isPicture, size), 0)

  return all - [...labels].length
}
