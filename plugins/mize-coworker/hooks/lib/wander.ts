// Claude's life at ease on the status row: a small seeded generator, the
// choice of the next move while idle (a stroll, a look, a hop, a yawn, a sip,
// and the moves the session's vitals, its background shells or the date call
// for), the choice of the next skit while he minds background agents (a
// tally of them, a radar, a headset, juggling, a paper plane, a plant that
// grows with the wait, ...), the steps of a move, and the clamp that keeps
// him inside the cells the mod reserves. Pure: no `$`, no Math.random, so a
// test that seeds the generator sees the same walk every time.

import type { FrameName } from './sprite'

/**
 * How far Claude may wander left of the right end, in blank cells to his
 * right: at full width, and in a terminal narrower than the reserve's
 * compactBelow; for the two-row picture (`big`, 8 cells wide) and for the
 * one-row drawing (`small`: 0.2.0's 4-cell picture, or the braille).
 */
export const WANDER_RANGE = { big: { full: 12, compact: 1 }, small: { full: 12, compact: 3 } } as const
/** From the end of one idle move to the start of the next. */
export const WANDER_EVERY_MS = { min: 12_000, max: 30_000 } as const
/**
 * From the end of one skit to the start of the next while he minds background
 * agents: livelier than idle, and still more standing than performing.
 */
export const SKIT_EVERY_MS = { min: 4_000, max: 10_000 } as const
/** How soon a skit that answers something plays (the send-off as the agents start, a finished agent's report). */
export const SKIT_SOON_MS = 750

/** The generator's state (mulberry32): one 32-bit word, advanced by every draw. */
export type Rng = { state: number }

/** A generator seeded from a number (the session start time); any number gives a valid seed. */
export function seeded(seed: number): Rng {
  const whole = Number.isFinite(seed) ? Math.floor(Math.abs(seed)) : 0

  return { state: (whole % 0x1_0000_0000) >>> 0 }
}

/** The next draw in [0, 1). */
export function nextFloat(rng: Rng): number {
  rng.state = (rng.state + 0x6d2b79f5) >>> 0

  let t = rng.state

  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)

  return ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000
}

/** A whole number from `min` to `max`, both included. */
export function nextInt(rng: Rng, min: number, max: number): number {
  const low = Math.ceil(Math.min(min, max))
  const high = Math.floor(Math.max(min, max))

  return low + Math.floor(nextFloat(rng) * (high - low + 1))
}

/** How long Claude stays put before his next move: 12 to 30 s idle, 4 to 10 s while he minds agents. */
export function nextWait(rng: Rng, isSupervising = false): number {
  const every = isSupervising ? SKIT_EVERY_MS : WANDER_EVERY_MS

  return nextInt(rng, every.min, every.max)
}

/**
 * What a Claude at ease does next: walk to another spot, look around, hop,
 * yawn, sip a coffee; one of the moves the session or the date calls for
 * (GatedMove); or, while he minds background agents, a skit (SkitKind).
 */
export type MoveKind = 'stroll' | 'look' | 'hop' | 'yawn' | 'sip' | GatedMove | SkitKind
/**
 * The moves that happen only when something holds: `sweat` when the context
 * window is 80% full or more, `clock` when a usage window is over its pace or
 * near its end, `pumpkin` in the last week of October (the `seasonal`
 * option), `peek` (a glance at a small terminal) while a shell runs in the
 * background.
 */
export type GatedMove = 'sweat' | 'clock' | 'pumpkin' | 'peek'
/**
 * The skits, played while the main loop rests and agents or workflows work in
 * the background: `tally` (a score paddle with how many are at work), `radar`
 * (he watches them on a scope), `radio` (a headset: mission control),
 * `report` (a helper brings a finished agent's page; played when one
 * finishes), `launch` (a rocket lifts off; played as the agents start),
 * `perch` (a helper checks in from the top of his head), `conduct` (a baton
 * and notes, while a workflow runs), `juggle`, `gum` (a bubble that pops),
 * `popcorn` (he watches the show), `plane` (a paper plane that comes back),
 * `zen` (he meditates), `garden` (a potted plant that grows with the wait),
 * `lantern` (the night shift) and `lunch` (a sandwich at noon).
 */
export type SkitKind =
  | 'tally'
  | 'radar'
  | 'radio'
  | 'report'
  | 'launch'
  | 'perch'
  | 'conduct'
  | 'juggle'
  | 'gum'
  | 'popcorn'
  | 'plane'
  | 'zen'
  | 'garden'
  | 'lantern'
  | 'lunch'
/** One tick of a move: the frame shown and where. */
export type Step = { frame: FrameName; x: number }
export type Move = { kind: MoveKind; steps: Step[] }

/** `frame` held for `ticks` ticks: a move written the way its timing reads. */
function hold(frame: FrameName, ticks: number): FrameName[] {
  return Array.from({ length: ticks }, () => frame)
}

/** `frames` in order, the whole run `times` times. */
function repeat(frames: readonly FrameName[], times: number): FrameName[] {
  return Array.from({ length: times }, () => frames).flat()
}

/** The moves whose frames depend on something: the tally's digit, the plant's stage. */
export type VariedMove = 'tally' | 'garden'

/**
 * The frames of each move that stays put, one per tick; the breath follows
 * the last. The yawn and the sip ease in and out (two ticks each way) around
 * a held middle (four ticks), and the pumpkin's glow flickers unevenly. The
 * skits run 2.5 to 6 s; the tally and the garden are in stillFrames.
 */
export const STILL: Readonly<Record<Exclude<MoveKind, 'stroll' | VariedMove>, readonly FrameName[]>> = {
  look: ['lookL', 'lookL', 'idle', 'lookR', 'lookR', 'idle'],
  hop: ['hop1', 'hop2', 'hop3', 'idle'],
  yawn: [...hold('yawn1', 2), ...hold('yawn2', 4), ...hold('yawn1', 2)],
  sip: [...hold('sip1', 2), ...hold('sip2', 4), ...hold('sip1', 2)],
  sweat: ['sweat1', 'sweat2', 'sweat1', 'sweat2'],
  clock: ['clock1', 'clock1', 'clock2', 'clock2'],
  pumpkin: [...hold('pumpkin1', 3), ...hold('pumpkin2', 2), ...hold('pumpkin1', 3), ...hold('pumpkin2', 2)],
  // a glance at the terminal: the cursor, then a line of output more (once: the line does not go away again)
  peek: [...hold('term1', 4), ...hold('term2', 6)],
  // the sweep goes twice round the scope
  radar: repeat([...hold('radar1', 2), ...hold('radar2', 2), ...hold('radar3', 2), ...hold('radar4', 2)], 2),
  radio: [...hold('radio1', 4), ...hold('radio2', 2), ...hold('radio1', 2), ...hold('radio2', 2), ...hold('radio3', 4)],
  report: [...hold('report1', 2), ...hold('report2', 2), ...hold('report3', 4), ...hold('report4', 4)],
  launch: [...hold('launch1', 4), ...hold('launch2', 2), ...hold('launch3', 4)],
  perch: [...hold('perch1', 3), ...hold('perch2', 2), ...hold('perch1', 2), ...hold('perch2', 2), ...hold('perch1', 3)],
  conduct: repeat([...hold('conduct1', 2), ...hold('conduct2', 2), ...hold('conduct3', 2), ...hold('conduct2', 2)], 2),
  juggle: repeat(['juggle1', 'juggle2', 'juggle3'], 6),
  gum: [...hold('gum1', 3), ...hold('gum2', 5), ...hold('gum3', 3)],
  popcorn: repeat([...hold('popcorn1', 3), ...hold('popcorn2', 2)], 3),
  plane: [...hold('plane1', 3), ...hold('plane2', 2), ...hold('plane3', 4), ...hold('plane4', 2), ...hold('plane5', 4)],
  // a slow bob
  zen: repeat([...hold('zen1', 4), ...hold('zen2', 4)], 3),
  lantern: repeat([...hold('lantern1', 3), ...hold('lantern2', 2)], 2),
  // the sandwich, then the bite (once: a bitten sandwich does not grow back)
  lunch: [...hold('lunch1', 4), ...hold('lunch2', 6)],
}

/** The tally's faces by how many agents are at work: 1 to 9, and `9+`. */
const TALLY: readonly FrameName[] = ['tally1', 'tally2', 'tally3', 'tally4', 'tally5', 'tally6', 'tally7', 'tally8', 'tally9']
/** The plant by its stage, 1 to 4: watered, then admired. */
const GARDEN: readonly { water: FrameName; plant: FrameName }[] = [
  { water: 'water1', plant: 'plant1' },
  { water: 'water2', plant: 'plant2' },
  { water: 'water3', plant: 'plant3' },
  { water: 'water4', plant: 'plant4' },
]
/** How long the agents have been at work when the plant reaches its second, third and fourth stage. */
export const GARDEN_STAGE_MS: readonly [number, number, number] = [2 * 60_000, 6 * 60_000, 15 * 60_000]

/** What a varied move is played with: how many agents are at work (the tally), how long they have been (the plant). */
export type MoveDetail = { count?: number; forMs?: number }

/** The paddle's face for a count: its digit from 1 to 9, `9+` beyond; anything less than 1 reads as 1. */
export function tallyFrame(count: number | undefined): FrameName {
  const whole = count !== undefined && Number.isFinite(count) ? Math.max(1, Math.floor(count)) : 1

  return TALLY[whole - 1] ?? 'tallyMany'
}

/** The plant's stage, 1 to 4, after the agents have been at work for `forMs` (GARDEN_STAGE_MS). */
export function gardenStage(forMs: number | undefined): 1 | 2 | 3 | 4 {
  const ms = forMs !== undefined && Number.isFinite(forMs) ? forMs : 0

  return ms >= GARDEN_STAGE_MS[2] ? 4 : ms >= GARDEN_STAGE_MS[1] ? 3 : ms >= GARDEN_STAGE_MS[0] ? 2 : 1
}

/**
 * The frames of a move that stays put, one per tick: STILL's, or for the
 * tally the paddle lifted, shown (its face the count's) and lowered, and for
 * the garden the plant at its stage, watered and then admired.
 */
export function stillFrames(kind: Exclude<MoveKind, 'stroll'>, detail: MoveDetail = {}): readonly FrameName[] {
  if (kind === 'tally') {
    return [...hold('tally0', 2), ...hold(tallyFrame(detail.count), 8), ...hold('tally0', 2)]
  }

  if (kind === 'garden') {
    const stage = GARDEN[gardenStage(detail.forMs) - 1] ?? { water: 'water1', plant: 'plant1' }

    return [...hold(stage.water, 4), ...hold(stage.plant, 6)]
  }

  return STILL[kind]
}

/** When a gated move applies, about this share of moves is one. */
export const GATED_SHARE = 1 / 3
/** Idle this long (of the 10 minutes before he sleeps) and he grows drowsy: more yawns. */
export const DROWSY_MS = 6 * 60_000
/**
 * The everyday mix, as upper bounds of one draw in [0, 1): stroll, look, hop,
 * yawn, then sip. Drowsy, the yawn takes a larger share. Yawns and sips stay
 * rarer than strolls and looks either way.
 */
export const MIX = {
  awake: { stroll: 0.45, look: 0.75, hop: 0.87, yawn: 0.935 },
  drowsy: { stroll: 0.4, look: 0.68, hop: 0.76, yawn: 0.92 },
} as const

/**
 * The ticks of a move from `x`: a stroll to `to` one cell per tick on
 * alternating feet then idle; any other move stays at `x` and plays its
 * frames (stillFrames, with `detail` for the tally and the garden). A stroll
 * to where he already is has no steps.
 */
export function moveSteps(kind: MoveKind, x: number, to = x, detail: MoveDetail = {}): Step[] {
  if (kind !== 'stroll') {
    return stillFrames(kind, detail).map(frame => ({ frame, x }))
  }

  const steps: Step[] = []
  const way = Math.sign(to - x)

  for (let moved = 1; moved <= Math.abs(to - x); moved += 1) {
    steps.push({ frame: moved % 2 === 1 ? 'stepA' : 'stepB', x: x + way * moved })
  }

  if (steps.length > 0) {
    steps.push({ frame: 'idle', x: to })
  }

  return steps
}

/** What else shapes the next move: the gated moves that apply now, and whether he is drowsy. */
export type MoveContext = { gated?: readonly GatedMove[]; isDrowsy?: boolean }

/**
 * The next move of a Claude at `x` who may stand anywhere from 0 to `range`.
 * When a gated move applies, about one move in three (GATED_SHARE) is one of
 * them, picked evenly; otherwise the everyday mix (MIX): a stroll to another
 * spot, a look around, a hop, a yawn or a sip. With no room to walk, never a
 * stroll (its share goes to the look).
 */
export function chooseMove(rng: Rng, x: number, range: number, context: MoveContext = {}): Move {
  const top = Math.max(0, Math.floor(range))
  const from = clampX(x, top)
  const gated = context.gated ?? []

  if (gated.length > 0 && nextFloat(rng) < GATED_SHARE) {
    const kind = gated[nextInt(rng, 0, gated.length - 1)] ?? 'look'

    return { kind, steps: moveSteps(kind, from) }
  }

  const mix = context.isDrowsy === true ? MIX.drowsy : MIX.awake
  const roll = nextFloat(rng)

  if (roll < mix.stroll && top > 0) {
    const pick = nextInt(rng, 0, top - 1)
    const to = pick >= from ? pick + 1 : pick

    return { kind: 'stroll', steps: moveSteps('stroll', from, to) }
  }

  const kind: MoveKind = roll < mix.look ? 'look' : roll < mix.hop ? 'hop' : roll < mix.yawn ? 'yawn' : 'sip'

  return { kind, steps: moveSteps(kind, from) }
}

/**
 * What shapes the next skit: how many agents are at work and for how long,
 * whether a workflow is among them, the local hour, whether the time-bound
 * skits are on (the `seasonal` option), the gated moves that apply now, and
 * the move last played (never the same twice running).
 */
export type SkitContext = {
  count: number
  forMs: number
  isWorkflow: boolean
  hour: number
  isSeasonal: boolean
  gated?: readonly GatedMove[]
  last?: MoveKind
}

/** The hours of the night shift, when the lantern comes out: from 22:00 to 05:59, local time. */
export function isNightShift(hour: number): boolean {
  return hour >= 22 || hour < 6
}

/** The lunch hour, when the sandwich comes out: 12:00 to 12:59, local time. */
export function isLunchHour(hour: number): boolean {
  return hour === 12
}

/** The agents have been at work this long when he starts checking the hourglass. */
export const LONG_WAIT_MS = 5 * 60_000

/**
 * The mix while he minds agents: each kind and its weight in this context, 0
 * where it does not apply. The conductor needs a workflow, the lantern the
 * night, the sandwich the lunch hour, the hourglass a long wait (or a usage
 * window that runs hot), the stroll room to walk. No hop: a hop every few
 * seconds is what this replaced. The report and the launch are not drawn
 * from the mix; they answer events.
 */
export function skitWeights(context: SkitContext, hasRoom: boolean): [MoveKind, number][] {
  const gated = context.gated ?? []
  const isTimed = context.isSeasonal

  return [
    ['tally', 3],
    ['radar', 3],
    ['radio', 3],
    ['juggle', 3],
    ['popcorn', 3],
    ['garden', 3],
    ['conduct', context.isWorkflow ? 4 : 0],
    ['perch', 2],
    ['gum', 2],
    ['plane', 2],
    ['zen', 2],
    ['look', 3],
    ['stroll', hasRoom ? 2 : 0],
    ['sip', 2],
    ['yawn', 1],
    ['clock', gated.includes('clock') || context.forMs >= LONG_WAIT_MS ? 2 : 0],
    ['sweat', gated.includes('sweat') ? 3 : 0],
    ['pumpkin', gated.includes('pumpkin') ? 3 : 0],
    ['peek', gated.includes('peek') ? 2 : 0],
    ['lantern', isTimed && isNightShift(context.hour) ? 4 : 0],
    ['lunch', isTimed && isLunchHour(context.hour) ? 4 : 0],
  ]
}

/**
 * The next skit of a Claude at `x`, minding agents, who may stand anywhere
 * from 0 to `range`: one draw over the mix (skitWeights), the kind last
 * played left out so no skit plays twice running; a stroll goes to another
 * spot as chooseMove's does.
 */
export function chooseSkit(rng: Rng, x: number, range: number, context: SkitContext): Move {
  const top = Math.max(0, Math.floor(range))
  const from = clampX(x, top)
  const mix = skitWeights(context, top > 0).filter(([kind, weight]) => weight > 0 && kind !== context.last)
  const total = mix.reduce((sum, [, weight]) => sum + weight, 0)
  let roll = nextFloat(rng) * total
  let kind: MoveKind = 'look'

  for (const [candidate, weight] of mix) {
    kind = candidate

    if (roll < weight) {
      break
    }

    roll -= weight
  }

  if (kind === 'stroll') {
    const pick = nextInt(rng, 0, top - 1)
    const to = pick >= from ? pick + 1 : pick

    return { kind, steps: moveSteps('stroll', from, to) }
  }

  return { kind, steps: moveSteps(kind, from, from, { count: context.count, forMs: context.forMs }) }
}

/** The vitals a gated move reads: the context share and the two usage windows' states. */
export type MoveVitals = { context?: number; fiveHour?: string; sevenDay?: string }

/** The context share at which Claude starts to sweat. */
export const SWEAT_AT = 80

/** True from 24 to 31 October: `month` 0-based as a Date gives it, both read in local time. */
export function isPumpkinTime(month: number, day: number): boolean {
  return month === 9 && day >= 24 && day <= 31
}

/**
 * The gated moves that apply: `sweat` at SWEAT_AT% of context or more,
 * `clock` while the 5h or 7d window is `over` or `crit`, `pumpkin` in the last
 * week of October when `isSeasonal`, `peek` while `shells` shells or monitors
 * run in the background. Unknown vitals apply nothing.
 */
export function gatedMoves(vitals: MoveVitals, month: number, day: number, isSeasonal: boolean, shells = 0): GatedMove[] {
  const moves: GatedMove[] = []
  const isPressed = (state: string | undefined): boolean => state === 'over' || state === 'crit'

  if (vitals.context !== undefined && Number.isFinite(vitals.context) && vitals.context >= SWEAT_AT) {
    moves.push('sweat')
  }

  if (isPressed(vitals.fiveHour) || isPressed(vitals.sevenDay)) {
    moves.push('clock')
  }

  if (isSeasonal && isPumpkinTime(month, day)) {
    moves.push('pumpkin')
  }

  if (shells > 0) {
    moves.push('peek')
  }

  return moves
}

/**
 * Where Claude is drawn: `x` as a whole number from 0 to the smallest of the
 * limits given (the wander range, the room a caption leaves).
 */
export function clampX(x: number, ...limits: number[]): number {
  const most = Math.max(0, Math.min(Infinity, ...limits.filter(limit => Number.isFinite(limit)).map(limit => Math.floor(limit))))

  return Number.isFinite(x) ? Math.min(most, Math.max(0, Math.floor(x))) : 0
}
