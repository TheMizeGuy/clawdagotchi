// The `/coworker demo` tour: everything Claude does, once each, as the spinner
// and the footer would show it, step by step for the band above the prompt.
// Pure: no `$`.
//
// An act lasts about ACT_MS. A busy loop is shown as the spinner shows it (its
// scene, with the scene a spinner word or mode puts in its place: sceneFor),
// played whole as often as it takes to fill the act; a gesture plays for its
// moment (MOMENT_MS); an idle move as the wander plays it; the skits he
// plays while he minds background agents, each once (the tally for three
// agents, the plant through its four stages); the breath and the blink
// together; the sleep loops sped up to one pass in about ACT_MS (asleep, a
// frame lasts 3 s). The words are the narration's own for a sample call, so
// the tour says what the spinner would say. The whole tour runs about two
// minutes.

import { MOMENT_MS, narration, toolWord } from './activity'
import { BLINK, CHEER_LOOP, COLD_LOOP, LOOPS, sceneFor, TEAM_LOOPS, TICK_MS, type FrameName } from './sprite'
import { GARDEN_STAGE_MS, moveSteps, type MoveDetail, type MoveKind } from './wander'

/** One step of the tour: the frame, what it shows (a spinner word or a move's name), its act (0-based), how long it shows. */
export type DemoStep = { frame: FrameName; label: string; act: number; ms: number }

/** About this long per act. */
export const ACT_MS = 2_000

/** One act: its name, and its frames, each with how long it shows and, where it differs from the act's, its own label. */
type Act = { label: string; steps: { frame: FrameName; ms: number; label?: string }[] }

/** The spinner words of the tour: the narration of a sample call, or of the spinner's mode with no call. */
export const DEMO_WORDS = {
  thinking: narration({ activity: 'thinking', word: '' }, 'thinking'),
  writing: narration({ activity: 'thinking', word: '' }, 'responding'),
  reading: toolWord('Read', { file_path: '/work/hooks/register.tsx' }),
  searching: toolWord('Grep', { pattern: 'demo' }),
  webSearch: toolWord('WebSearch', { query: 'demo' }),
  browsing: toolWord('WebFetch', { url: 'https://example.com/', prompt: 'demo' }),
  editing: toolWord('Edit', { file_path: '/work/hooks/register.tsx' }),
  running: toolWord('Bash', { command: 'npm test' }),
  delegating: toolWord('Agent', { description: 'demo', prompt: 'demo' }),
  orchestrating: toolWord('Workflow', {}),
  asking: toolWord('AskUserQuestion', {}),
  working: toolWord('TodoWrite', {}),
  skill: toolWord('Skill', { skill: 'demo' }),
  calling: toolWord('mcp__github__search_repositories', {}),
} as const

/** A busy loop as the spinner shows it under a word and a mode: each step the scene sceneFor puts there. */
function shownAs(loop: readonly FrameName[], word: string, mode: string): FrameName[] {
  return loop.map(frame => sceneFor(frame, word, mode))
}

/** A loop played whole, as many times as it takes to fill ACT_MS, each frame `tickMs` long. */
function looped(label: string, loop: readonly FrameName[], tickMs = TICK_MS): Act {
  const passes = Math.max(1, Math.ceil(ACT_MS / Math.max(1, loop.length * tickMs)))
  const steps: Act['steps'] = []

  for (let pass = 0; pass < passes; pass += 1) {
    for (const frame of loop) {
      steps.push({ frame, ms: tickMs })
    }
  }

  return { label, steps }
}

/** A busy activity's act: its loop as the spinner shows it under the word (a tool is running: mode `tool-use`). */
function busy(word: string, loop: readonly FrameName[], mode = 'tool-use'): Act {
  return looped(word, shownAs(loop, word, mode))
}

/** A gesture: its frames once, one per tick, the last held until its moment ends. */
function gesture(label: string, frames: readonly FrameName[], ms: number): Act {
  const ticks = Math.max(frames.length, Math.round(ms / TICK_MS))

  return { label, steps: Array.from({ length: ticks }, (_, tick) => ({ frame: frames[Math.min(tick, frames.length - 1)] ?? 'idle', ms: TICK_MS })) }
}

/** An idle move as the wander plays it (a stroll as its walk, seven cells and the stop), whole, as often as it takes to fill ACT_MS. */
function move(kind: MoveKind, detail: MoveDetail = {}): Act {
  const steps = kind === 'stroll' ? moveSteps('stroll', 0, 7) : moveSteps(kind, 0, 0, detail)

  return looped(kind, steps.map(step => step.frame))
}

/** The garden through its four stages: each watered and admired, two ticks apiece, as the plant grows over a long wait. */
function garden(): Act {
  const frames = [0, ...GARDEN_STAGE_MS].flatMap(forMs => {
    const steps = moveSteps('garden', 0, 0, { forMs }).map(step => step.frame)

    return [...new Set(steps)].flatMap(frame => [frame, frame])
  })

  return { label: 'garden', steps: frames.map(frame => ({ frame, ms: TICK_MS })) }
}

/** Idle on the status row: a breath (idle and idleUp, sped up from 2 s a side) and a blink as it runs (BLINK). */
function idle(): Act {
  return {
    label: 'idle',
    steps: [
      { frame: 'idle', ms: 500, label: 'breath' },
      { frame: 'idleUp', ms: 500, label: 'breath' },
      { frame: 'idle', ms: 300, label: 'breath' },
      ...BLINK.map(phase => ({ frame: phase.frame, ms: phase.ms, label: 'blink' })),
      { frame: 'idle', ms: 300, label: 'blink' },
    ],
  }
}

/** A sleep loop sped up so one pass takes about ACT_MS: each frame a whole number of ticks. */
function asleep(label: string, loop: readonly FrameName[]): Act {
  const ticks = Math.max(1, Math.round(ACT_MS / TICK_MS / Math.max(1, loop.length)))

  return looped(label, loop, ticks * TICK_MS)
}

const MOVES: readonly MoveKind[] = ['stroll', 'look', 'hop', 'yawn', 'sip', 'sweat', 'clock', 'pumpkin', 'peek']
/** The skits he plays while he minds background agents, in the tour's order (the garden has its own act). */
const SKITS: readonly MoveKind[] = ['launch', 'tally', 'radar', 'radio', 'report', 'perch', 'conduct', 'juggle', 'gum', 'popcorn', 'plane', 'zen']
const TIMED_SKITS: readonly MoveKind[] = ['lantern', 'lunch']
/** The tour's tally shows three agents at work. */
const DEMO_AGENTS = 3

/**
 * The acts in order: every busy scene family as the spinner shows it (the
 * word- and mode-swapped ones included, and the team of one, two and three
 * helpers), then the greeting, the done hop, the cheer and the flinch, then
 * idle (the breath and the blink) and every idle move, then the skits of a
 * Claude minding background agents (the send-off first, the plant through
 * its stages, the night shift and the lunch last), then the warm and the cold
 * sleep.
 */
const ACTS: readonly Act[] = [
  busy(DEMO_WORDS.thinking, LOOPS.thinking, 'thinking'),
  busy(DEMO_WORDS.writing, LOOPS.thinking, 'responding'),
  busy(DEMO_WORDS.reading, LOOPS.reading),
  busy(DEMO_WORDS.searching, LOOPS.searching),
  busy(DEMO_WORDS.webSearch, LOOPS.browsing),
  busy(DEMO_WORDS.browsing, LOOPS.browsing),
  busy(DEMO_WORDS.editing, LOOPS.editing),
  busy(DEMO_WORDS.running, LOOPS.running),
  busy(DEMO_WORDS.delegating, TEAM_LOOPS[1]),
  busy(DEMO_WORDS.delegating, TEAM_LOOPS[2]),
  busy(DEMO_WORDS.orchestrating, TEAM_LOOPS[3]),
  busy(DEMO_WORDS.asking, LOOPS.asking),
  busy(DEMO_WORDS.working, LOOPS.working),
  busy(DEMO_WORDS.skill, LOOPS.working),
  busy(DEMO_WORDS.calling, LOOPS.working),
  looped('greeting', LOOPS.greeting),
  gesture('done', LOOPS.done, MOMENT_MS.done),
  gesture('cheer', CHEER_LOOP, MOMENT_MS.cheer),
  gesture('oops', LOOPS.oops, MOMENT_MS.oops),
  idle(),
  ...MOVES.map(kind => move(kind)),
  ...SKITS.map(kind => move(kind, { count: DEMO_AGENTS })),
  garden(),
  ...TIMED_SKITS.map(kind => move(kind)),
  asleep('asleep', LOOPS.asleep),
  asleep('asleep, cache cold', COLD_LOOP),
]

/** How many acts the tour has. */
export const DEMO_ACTS: number = ACTS.length

/** Each act's name, in order. */
export function demoActs(): string[] {
  return ACTS.map(act => act.label)
}

/**
 * The tour as steps: every act's frames in order, a frame held over several
 * ticks as one step (so a step is a change on screen). With `isAnimated` false
 * (reduced motion), each act is its first frame alone, held for the act.
 */
export function demoSteps(isAnimated = true): DemoStep[] {
  const steps: DemoStep[] = []

  ACTS.forEach((act, index) => {
    if (!isAnimated) {
      const first = act.steps[0]

      steps.push({ frame: first?.frame ?? 'idle', label: first?.label ?? act.label, act: index, ms: act.steps.reduce((sum, step) => sum + step.ms, 0) })

      return
    }

    for (const step of act.steps) {
      const label = step.label ?? act.label
      const last = steps.at(-1)

      if (last !== undefined && last.act === index && last.frame === step.frame && last.label === label) {
        last.ms += step.ms
      } else {
        steps.push({ frame: step.frame, label, act: index, ms: step.ms })
      }
    }
  })

  return steps
}
