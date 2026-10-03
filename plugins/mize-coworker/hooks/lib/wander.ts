// Claude's idle life on the status row: a small seeded generator, the choice
// of the next move (a stroll, a look, a hop, a yawn, a sip, and the moves the
// session's vitals or the date call for), the steps of a move, and the clamp
// that keeps him inside the cells the mod reserves. Pure: no `$`, no
// Math.random, so a test that seeds the generator sees the same walk every time.

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

/** How long Claude stays put before his next move: 12 to 30 s. */
export function nextWait(rng: Rng): number {
  return nextInt(rng, WANDER_EVERY_MS.min, WANDER_EVERY_MS.max)
}

/**
 * What an idle Claude does next: walk to another spot, look around, hop, yawn,
 * sip a coffee; or one of the moves the session or the date calls for
 * (GatedMove).
 */
export type MoveKind = 'stroll' | 'look' | 'hop' | 'yawn' | 'sip' | GatedMove
/**
 * The moves that happen only when something holds: `sweat` when the context
 * window is 80% full or more, `clock` when a usage window is over its pace or
 * near its end, `pumpkin` in the last week of October (the `seasonal` option).
 */
export type GatedMove = 'sweat' | 'clock' | 'pumpkin'
/** One tick of a move: the frame shown and where. */
export type Step = { frame: FrameName; x: number }
export type Move = { kind: MoveKind; steps: Step[] }

/** `frame` held for `ticks` ticks: a move written the way its timing reads. */
function hold(frame: FrameName, ticks: number): FrameName[] {
  return Array.from({ length: ticks }, () => frame)
}

/**
 * The frames of each move that stays put, one per tick; the idle breath
 * follows the last. The yawn and the sip ease in and out (two ticks each way)
 * around a held middle (four ticks), and the pumpkin's glow flickers unevenly.
 */
export const STILL: Readonly<Record<Exclude<MoveKind, 'stroll'>, readonly FrameName[]>> = {
  look: ['lookL', 'lookL', 'idle', 'lookR', 'lookR', 'idle'],
  hop: ['hop1', 'hop2', 'hop3', 'idle'],
  yawn: [...hold('yawn1', 2), ...hold('yawn2', 4), ...hold('yawn1', 2)],
  sip: [...hold('sip1', 2), ...hold('sip2', 4), ...hold('sip1', 2)],
  sweat: ['sweat1', 'sweat2', 'sweat1', 'sweat2'],
  clock: ['clock1', 'clock1', 'clock2', 'clock2'],
  pumpkin: [...hold('pumpkin1', 3), ...hold('pumpkin2', 2), ...hold('pumpkin1', 3), ...hold('pumpkin2', 2)],
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
 * frames (STILL). A stroll to where he already is has no steps.
 */
export function moveSteps(kind: MoveKind, x: number, to = x): Step[] {
  if (kind !== 'stroll') {
    return STILL[kind].map(frame => ({ frame, x }))
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
 * week of October when `isSeasonal`. Unknown vitals apply nothing.
 */
export function gatedMoves(vitals: MoveVitals, month: number, day: number, isSeasonal: boolean): GatedMove[] {
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
