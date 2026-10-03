// Crash safety, with a witness. All mods share one worker, and a hook that
// throws is skipped without failing anything, so a test that only checks the
// chain's answer cannot see it. Here the plugin under test loads in an inner
// tier (`append`) and a sentinel plugin above it reads `next.trace` after
// every event: any mize-coworker link that did not return is recorded, and
// each test ends by asserting there is none.

import type { On } from 'claude-code'
import { expect, mock, test, tier, type Engine } from 'claude-code/testing'

tier('append')

const START = 1_000_000
const EVENTS = [
  'session.start',
  'session.end',
  'turn.start',
  'turn.complete',
  'command.run',
  'classic.SessionStart',
  'classic.PreToolUse',
  'classic.PostToolUse',
  'classic.PostToolUseFailure',
  'classic.PermissionDenied',
  'classic.PermissionRequest',
  'classic.Stop',
  'classic.SubagentStop',
  'ui.render',
] as const

// An inline plugin is lifted into a module of its own, where each hook must be a function
// literal: hence one literal per event rather than a shared function.
const sentinel = {
  name: 'sentinel',
  register(on2: On) {
    on2('session.start', async ($2, e, next) => {
      const result = await next(e)

      for (const entry of next.trace) {
        if (entry.plugin === 'mize-coworker') {
          $2.ui.log(`link session.start ${entry.outcome}`)
        }
      }

      return result
    })
    on2('session.end', async ($2, e, next) => {
      const result = await next(e)

      for (const entry of next.trace) {
        if (entry.plugin === 'mize-coworker') {
          $2.ui.log(`link session.end ${entry.outcome}`)
        }
      }

      return result
    })
    on2('turn.start', async ($2, e, next) => {
      const result = await next(e)

      for (const entry of next.trace) {
        if (entry.plugin === 'mize-coworker') {
          $2.ui.log(`link turn.start ${entry.outcome}`)
        }
      }

      return result
    })
    on2('turn.complete', async ($2, e, next) => {
      const result = await next(e)

      for (const entry of next.trace) {
        if (entry.plugin === 'mize-coworker') {
          $2.ui.log(`link turn.complete ${entry.outcome}`)
        }
      }

      return result
    })
    on2('command.run', async ($2, e, next) => {
      const result = await next(e)

      for (const entry of next.trace) {
        if (entry.plugin === 'mize-coworker') {
          $2.ui.log(`link command.run ${entry.outcome}`)
        }
      }

      return result
    })
    on2('classic.SessionStart', async ($2, e, next) => {
      const result = await next(e)

      for (const entry of next.trace) {
        if (entry.plugin === 'mize-coworker') {
          $2.ui.log(`link classic.SessionStart ${entry.outcome}`)
        }
      }

      return result
    })
    on2('classic.PreToolUse', async ($2, e, next) => {
      const result = await next(e)

      for (const entry of next.trace) {
        if (entry.plugin === 'mize-coworker') {
          $2.ui.log(`link classic.PreToolUse ${entry.outcome}`)
        }
      }

      return result
    })
    on2('classic.PostToolUse', async ($2, e, next) => {
      const result = await next(e)

      for (const entry of next.trace) {
        if (entry.plugin === 'mize-coworker') {
          $2.ui.log(`link classic.PostToolUse ${entry.outcome}`)
        }
      }

      return result
    })
    on2('classic.PostToolUseFailure', async ($2, e, next) => {
      const result = await next(e)

      for (const entry of next.trace) {
        if (entry.plugin === 'mize-coworker') {
          $2.ui.log(`link classic.PostToolUseFailure ${entry.outcome}`)
        }
      }

      return result
    })
    on2('classic.PermissionDenied', async ($2, e, next) => {
      const result = await next(e)

      for (const entry of next.trace) {
        if (entry.plugin === 'mize-coworker') {
          $2.ui.log(`link classic.PermissionDenied ${entry.outcome}`)
        }
      }

      return result
    })
    on2('classic.PermissionRequest', async ($2, e, next) => {
      const result = await next(e)

      for (const entry of next.trace) {
        if (entry.plugin === 'mize-coworker') {
          $2.ui.log(`link classic.PermissionRequest ${entry.outcome}`)
        }
      }

      return result
    })
    on2('classic.Stop', async ($2, e, next) => {
      const result = await next(e)

      for (const entry of next.trace) {
        if (entry.plugin === 'mize-coworker') {
          $2.ui.log(`link classic.Stop ${entry.outcome}`)
        }
      }

      return result
    })
    on2('classic.SubagentStop', async ($2, e, next) => {
      const result = await next(e)

      for (const entry of next.trace) {
        if (entry.plugin === 'mize-coworker') {
          $2.ui.log(`link classic.SubagentStop ${entry.outcome}`)
        }
      }

      return result
    })
    // the band above the prompt, where /coworker demo draws its tour
    on2('ui.render', { component: 'AbovePrompt' }, async ($2, e, next) => {
      const result = await next(e)

      for (const entry of next.trace) {
        if (entry.plugin === 'mize-coworker') {
          $2.ui.log(`link ui.render ${entry.outcome}`)
        }
      }

      return result
    })
  },
}

const BAND = {
  plugin: 'mize-coworker',
  component: 'AbovePrompt',
  requestId: 'band',
  surface: 'terminal',
  viewport: { columns: 120, rows: 40 },
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

/** Draws the band once, as the terminal would, and lets it go. */
async function band($: Engine): Promise<void> {
  const ui = await $.ui.mount(BAND as never)

  await ui.find({ type: 'Image' })
  await ui.unmount()
}

/** `/coworker <args>` typed at the prompt. */
async function coworker($: Engine, args: string): Promise<void> {
  await $.command.run({ command: 'coworker', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
}

type World = { links: string[]; debug: string[]; logs: string[]; toolIds: string[] }

function stubs(on: On, isUiBroken = false): World {
  const w: World = { links: [], debug: [], logs: [], toolIds: [] }

  on('session.start', () => ({ cwd: '/work' }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.log', ($, e) => {
    if (e.text.startsWith('link ')) {
      w.links.push(e.text.slice(5))
    } else {
      ;(e.to === 'debug' ? w.debug : w.logs).push(e.text)
    }

    return { value: undefined }
  })
  on('ui.invalidate', () => (isUiBroken ? { deny: 'no ui' } : { value: undefined }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', ($, e) => {
    w.toolIds.push(e.tool_use_id)

    return { result: 'ok' }
  })
  on('classic.PostToolUse', () => ({}))
  on('classic.PostToolUseFailure', () => ({}))
  on('classic.PermissionDenied', () => ({}))
  on('classic.PermissionRequest', () => ({}))
  on('classic.SessionStart', () => ({}))
  on('classic.Stop', () => ({}))
  on('classic.SubagentStop', () => ({}))
  // what the mods beneath draw in the band
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Text', props: {}, children: ['beneath'] }))

  return w
}

/** One of every event the plugin hooks, in a plausible order, the demo's band drawn on the way. */
async function drive($: Engine, w: World): Promise<void> {
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await coworker($, 'demo')
  await band($)
  // the turn ends the tour
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call({ tool: 'Read', file_path: '/work/a.ts' } as never)
  await $.classic.PostToolUse({ tool_name: 'Read', tool_input: { file_path: '/work/a.ts' }, tool_response: 'ok', tool_use_id: w.toolIds.at(-1) ?? '' })
  await $.tool.call({ tool: 'Bash', command: 'false' } as never)
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'false' } })
  await $.classic.PostToolUseFailure({ tool_name: 'Bash', tool_input: { command: 'false' }, tool_use_id: w.toolIds.at(-1) ?? '', error: 'exit 1' } as never)
  await $.classic.PermissionDenied({ tool_name: 'Edit', tool_input: {}, tool_use_id: 'x', reason: 'denied' } as never)
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [] } as never)
  await $.classic.SubagentStop({ stop_hook_active: false, agent_id: 'agent-7', background_tasks: [] } as never)
  await $.turn.complete({ turnId: 't2', answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer', agentId: 'agent-7' })
  await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer' })
  await coworker($, '')
  await coworker($, 'demo')
  await coworker($, 'off')
  await coworker($, 'on')
  await coworker($, 'demo')
  await band($)
  await coworker($, 'demo')
  await $.classic.SessionStart({ source: 'clear', session_id: 'sess-2' })
  await $.session.end({ reason: 'other', sessionId: 's1', resume: { id: 's1' } })
}

/** Every link the sentinel saw for the plugin that did not simply return. */
function failed(w: World): string[] {
  return w.links.filter(link => !/ (returned|passed)$/.test(link))
}

test('the witness works: with everything healthy every link returns, and all fourteen events were seen', { plugins: [sentinel] }, async ($, on) => {
  const w = stubs(on)

  mock.clock(on, { now: START })
  await drive($, w)
  expect(failed(w)).toEqual([])
  expect(new Set(w.links.map(link => link.split(' ')[0]))).toEqual(new Set(EVENTS))
})

test('a state store that refuses every write: no hook of the plugin is skipped', { plugins: [sentinel] }, async ($, on) => {
  const w = stubs(on)

  on('state.set', () => ({ deny: 'state store down' }))
  on('state.get', () => ({ deny: 'state store down' }))
  mock.clock(on, { now: START })
  await drive($, w)
  expect(failed(w)).toEqual([])
  expect(w.links.length).toBeGreaterThanOrEqual(EVENTS.length)
})

test('a clock that refuses everything: no hook of the plugin is skipped', { plugins: [sentinel] }, async ($, on) => {
  const w = stubs(on)

  on('clock.now', () => ({ deny: 'clock down' }))
  on('clock.every', () => ({ deny: 'clock down' }))
  on('clock.after', () => ({ deny: 'clock down' }))
  await drive($, w)
  expect(failed(w)).toEqual([])
  expect(w.links.length).toBeGreaterThanOrEqual(EVENTS.length)
})

test('a filesystem, environment and session id that refuse: no hook of the plugin is skipped', { plugins: [sentinel] }, async ($, on) => {
  const w = stubs(on, true)

  on('fs.write', () => ({ deny: 'EACCES' }))
  on('fs.exists', () => ({ deny: 'EACCES' }))
  on('fs.read', () => ({ deny: 'EACCES' }))
  on('env.get', () => ({ deny: 'no env' }))
  on('session.id', () => ({ deny: 'no session' }))
  mock.clock(on, { now: START })
  await drive($, w)
  expect(failed(w)).toEqual([])
})

test('timers firing into a broken host: nothing escapes a timer body', { plugins: [sentinel] }, async ($, on) => {
  const w = stubs(on)
  let isBroken = false

  on('state.set', ($, e, next) => (isBroken ? { deny: 'state store down' } : next(e)))
  const clock = mock.clock(on, { now: START })

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call({ tool: 'Bash', command: 'make' } as never)
  isBroken = true
  // forty ticks, the blink chain and the wake timer all run against the refusing store
  await clock.advance(10_000)
  await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer' })
  await clock.advance(11 * 60_000)
  expect(failed(w)).toEqual([])
  expect(w.debug.some(line => /state store down/.test(line))).toBe(true)
})

test('the idle life and the sleep loop against a broken host: nothing escapes the breath, the blink, the wander, the vitals read or the sleep loop', { plugins: [sentinel] }, async ($, on) => {
  const w = stubs(on)
  let isBroken = false

  on('state.set', ($, e, next) => (isBroken ? { deny: 'state store down' } : next(e)))
  on('session.id', () => ({ value: 'sess-9' }))
  on('env.get', () => ({ deny: 'no env' }))
  on('fs.read', () => ({ deny: 'EACCES' }))
  on('fs.write', () => ({ value: undefined }))
  on('fs.exists', () => ({ value: false }))
  const clock = mock.clock(on, { now: START })

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  // five idle minutes: the breath, the blink and a dozen moves, each move asking for the vitals
  await clock.advance(5 * 60_000)
  isBroken = true
  // asleep with the store refusing: the sleep loop and its vitals reads go on, and fail quietly
  await clock.advance(6 * 60_000)
  await clock.advance(60_000)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 300_000, isAborted: false, reason: 'answer' })
  await clock.advance(5_000)
  await $.session.end({ reason: 'other', sessionId: 's1', resume: { id: 's1' } })
  expect(failed(w)).toEqual([])
  expect(w.debug.some(line => /^vitals not read: .*no env/.test(line))).toBe(true)
  expect(w.debug.some(line => /state store down/.test(line))).toBe(true)
})

test('a vitals file of anything at all: the wander and the sleep loop read it as unknown and go on', { plugins: [sentinel] }, async ($, on) => {
  const w = stubs(on)
  const answers: unknown[] = [{ base64: 'AAAA' }, 'x'.repeat(200_000), '\u0000\t\t\t\t', '999\tcrit\tcrit\tcold\n', 42, null]
  let reads = 0

  on('session.id', () => ({ value: 'sess-9' }))
  mock.env(on, { HOME: '/home/t' })
  on('fs.read', () => ({ value: answers[reads++ % answers.length] }) as never)
  on('fs.write', () => ({ value: undefined }))
  on('fs.exists', () => ({ value: false }))
  const clock = mock.clock(on, { now: START })

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await clock.advance(12 * 60_000)
  expect(reads).toBeGreaterThan(answers.length)
  expect(failed(w)).toEqual([])
  expect(w.debug.filter(line => / failed: /.test(line))).toEqual([])
})

test('the demo tour against a broken host: nothing escapes its timer, the band, or the default reserve', { plugins: [sentinel] }, async ($, on) => {
  const w = stubs(on)
  let isBroken = false

  on('state.set', ($, e, next) => (isBroken ? { deny: 'state store down' } : next(e)))
  on('state.get', ($, e, next) => (isBroken ? { deny: 'state store down' } : next(e)))
  on('session.id', () => ({ value: 'sess-9' }))
  mock.env(on, { HOME: '/home/t' })
  on('fs.read', () => ({ deny: 'EACCES' }))
  on('fs.stat', () => ({ deny: 'EACCES' }))
  on('fs.exists', () => ({ value: false }))
  on('fs.write', () => ({ value: undefined }))
  const clock = mock.clock(on, { now: START })

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await coworker($, 'demo')
  await clock.advance(5_000)
  isBroken = true
  // the rest of the tour runs against a store that refuses: every step fails quietly, the band falls back
  await band($)
  await clock.advance(70_000)
  await band($)
  await coworker($, 'demo')
  isBroken = false
  await coworker($, 'demo')
  await clock.advance(3_000)
  await band($)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.session.end({ reason: 'other', sessionId: 's1', resume: { id: 's1' } })
  expect(failed(w)).toEqual([])
  expect(w.debug.some(line => /^demo step not drawn: .*state store down/.test(line))).toBe(true)
  expect(w.debug.some(line => /^demo not drawn: .*state store down/.test(line))).toBe(true)
})

test('a host that refuses the demo\'s timer: the refusal is the engine\'s to report, the first step stays until the tour is stopped, nothing escapes', { plugins: [sentinel] }, async ($, on) => {
  const w = stubs(on)

  on('clock.now', () => ({ value: START }))
  on('clock.every', () => ({ deny: 'no timers' }))
  on('clock.after', () => ({ deny: 'no timers' }))

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await coworker($, 'demo')
  await band($)
  await coworker($, '')
  expect(w.logs.at(-1)).toMatch(/^demo playing: 1 of \d+, Thinking; /)
  await coworker($, 'demo')
  expect(w.logs.at(-1)).toBe('demo stopped')
  await band($)
  expect(failed(w)).toEqual([])
})
