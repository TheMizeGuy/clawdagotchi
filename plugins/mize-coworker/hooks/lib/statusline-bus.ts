// The status line bus: how a mod hands the status line one short segment for
// its session. Pure: no imports, no `$`.
//
// Canonical copy: shared/statusline-bus.ts. Each publishing mod
// carries a vendored copy at hooks/lib/statusline-bus.ts (scripts/vendor-shared.sh
// writes them and scripts/check-all.sh fails on drift). Edit this file, never a
// vendored copy.
//
// ~/.claude/statusline.sh (the statusLine command) reads every file in
// ~/.claude/state/statusline/bus/<sessionId>/ on each run and appends what it
// finds to the line. One file per publisher, named after it, written whole:
//
//   <level>\t<text>\n            or            <level>\t<text>\t<until>\n
//
// `level` is info, warn or fail (the script colors the segment by it) and
// `text` is plain, at most BUS_TEXT_MAX characters, with no control
// characters (a character outside ASCII is budgeted two cells by the script).
// `until`, when given, is an epoch in seconds after which the script stops
// showing the segment: a publisher that may stop without clearing (a session
// killed, the plugin unloaded) writes it and rewrites the file before it runs
// out (BUS_TTL_S, BUS_KEEP_S). An empty file shows nothing: `$.fs` cannot
// delete, so a publisher clears its segment by writing ''. The script reads the bus in
// bash, so the format is a contract: change it only together with the script
// and the suite that pins it (statusline/tests/test-statusline.sh).
//
// The script runs on the engine's status line triggers and its refresh timer,
// so a segment reaches the line up to one refresh interval after it is
// written. Publish state, not events: a count, a lockout, a queue length.
//
// The row has a second tenant. The engine draws its `SessionMode` site (the
// mode labels, and whatever a mod draws there) right-aligned on the SAME row
// as the status line, and when the two do not fit the site wraps onto a row of
// its own, which moves the prompt. So a mod that draws there says how many
// cells it needs, in <sessionId>/.reserve (RESERVE_FILE), written whole:
//
//   <full>\t<compact>\t<compactBelow>\n
//
// The script keeps `full` cells free at the row's right end, or `compact` in a
// terminal narrower than `compactBelow` columns, where the mod must draw its
// compact form. An empty file reserves nothing. One mod per session reserves.
//
// The engine draws a session's first status line before the mod has reserved
// anything, so the site wrapped onto a row of its own for up to one refresh at
// every session start. The reserving mod therefore also keeps a machine-wide
// default beside the session folders, bus/.reserve-default
// (RESERVE_DEFAULT_FILE), in the same format: the line it writes to its own
// .reserve at session start. The script holds those cells for a session that
// has no .reserve of its own yet; once the session's file exists (empty when
// released) it rules. A release never writes the default, so one session's
// `off` does not reach the next session's start.
//
// The bus also runs the other way. On each run the script writes what it
// measured about the session to <sessionId>/.vitals (VITALS_FILE), one line,
// written whole:
//
//   <context>\t<5h>\t<7d>\t<cache>\n
//
// `context` is the share of the context window in use, a whole or decimal
// number from 0 to 100, or empty when unknown; `5h` and `7d` are the state of
// the two usage windows, `calm`, `watch`, `over` or `crit`, or empty; `cache`
// is the prompt cache, `warm` or `cold`, or empty. A mod reads it to react to
// the session (mize-coworker's Claude sweats near a full context and sleeps
// cold once the cache has gone cold). parseVitals is total: a field it does
// not know reads as unknown, and a line without exactly four fields reads as
// all unknown, so a reader never trusts a writer it does not understand.

export const BUS_DIR = '.claude/state/statusline/bus'
export const BUS_TEXT_MAX = 32
/** How long a segment written with `until` stays valid, in seconds. */
export const BUS_TTL_S = 180
/** A publisher rewrites its segment once less than this many seconds of it remain. */
export const BUS_KEEP_S = 120

/** How the status line colors a segment: quiet, attention, or failure. */
export type BusLevel = 'info' | 'warn' | 'fail'

/** One segment: what the line shows, how loud, and (epoch seconds) until when. */
export type BusSegment = { level: BusLevel; text: string; until?: number }

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

/**
 * The file one publisher writes for one session, or undefined when the home
 * directory, the session id or the publisher's name cannot name a file.
 */
export function busPath(home: string | undefined, sessionId: string, publisher: string): string | undefined {
  if (home === undefined || home === '' || !SAFE_NAME.test(sessionId) || !SAFE_NAME.test(publisher)) {
    return undefined
  }

  return `${home}/${BUS_DIR}/${sessionId}/${publisher}`
}

/** The text as the line may show it: one line, no control characters, at most BUS_TEXT_MAX characters. */
export function busText(text: string): string {
  // eslint-disable-next-line no-control-regex
  return Array.from(text.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').trim())
    .slice(0, BUS_TEXT_MAX)
    .join('')
}

/** The cells a mod drawing at the right end of the status row needs kept free. */
export type BusReserve = {
  /** Cells for its widest drawing. */
  full: number
  /** Cells for its compact drawing, used below `compactBelow` columns. */
  compact: number
  /** The terminal width under which the mod draws compact. */
  compactBelow: number
}

export const RESERVE_FILE = '.reserve'
/** No reservation is honored past this many cells. */
export const RESERVE_MAX = 40

/** The session's reserve file, or undefined when the home directory or the session id cannot name one. */
export function reservePath(home: string | undefined, sessionId: string): string | undefined {
  if (home === undefined || home === '' || !SAFE_NAME.test(sessionId)) {
    return undefined
  }

  return `${home}/${BUS_DIR}/${sessionId}/${RESERVE_FILE}`
}

/** The machine-wide default reserve, beside the session folders: what the status line holds for a session with no .reserve yet. */
export const RESERVE_DEFAULT_FILE = '.reserve-default'

/** The machine-wide default reserve file (~/.claude/state/statusline/bus/.reserve-default), or undefined when the home directory cannot name one. */
export function reserveDefaultPath(home: string | undefined): string | undefined {
  if (home === undefined || home === '') {
    return undefined
  }

  return `${home}/${BUS_DIR}/${RESERVE_DEFAULT_FILE}`
}

/** The reserve file's whole content, or '' to reserve nothing. */
export function reserveLine(reserve: BusReserve | undefined): string {
  if (reserve === undefined) {
    return ''
  }

  const cells = (value: number): number => (Number.isFinite(value) ? Math.min(RESERVE_MAX, Math.max(0, Math.floor(value))) : 0)
  const below = Number.isFinite(reserve.compactBelow) ? Math.max(0, Math.floor(reserve.compactBelow)) : 0

  return `${cells(reserve.full)}\t${cells(reserve.compact)}\t${below}\n`
}

export const VITALS_FILE = '.vitals'

/** A usage window's state as the status line rates it: quiet, worth a look, over its pace, or near its end. */
export type VitalsWindow = 'calm' | 'watch' | 'over' | 'crit'

/** The prompt cache: still warm, or gone cold (the next turn pays to write it again). */
export type VitalsCache = 'warm' | 'cold'

/** What the status line measured about the session; a field it did not know is absent. */
export type Vitals = {
  /** The share of the context window in use, 0 to 100. */
  context?: number
  /** The 5-hour usage window. */
  fiveHour?: VitalsWindow
  /** The 7-day usage window. */
  sevenDay?: VitalsWindow
  cache?: VitalsCache
}

const WINDOWS: readonly string[] = ['calm', 'watch', 'over', 'crit']
const CACHES: readonly string[] = ['warm', 'cold']
const PERCENT = /^\d{1,3}(?:\.\d{1,6})?$/
/** How much of the file parseVitals reads: the line is a few dozen characters. */
const VITALS_SCAN = 256

/** The session's vitals file, or undefined when the home directory or the session id cannot name one. */
export function vitalsPath(home: string | undefined, sessionId: string): string | undefined {
  if (home === undefined || home === '' || !SAFE_NAME.test(sessionId)) {
    return undefined
  }

  return `${home}/${BUS_DIR}/${sessionId}/${VITALS_FILE}`
}

/**
 * The vitals in a file's text. Total: never throws, whatever it is given. Only
 * the first line counts; a line without exactly four tab-separated fields
 * reads as all unknown, and within a good line each field that is not one of
 * its known values (a percent above 100, a state it does not name) is unknown.
 */
export function parseVitals(text: unknown): Vitals {
  if (typeof text !== 'string') {
    return {}
  }

  const line = (text.slice(0, VITALS_SCAN).split('\n')[0] ?? '').replace(/\r$/, '')
  const fields = line.split('\t')

  if (fields.length !== 4) {
    return {}
  }

  const [context = '', fiveHour = '', sevenDay = '', cache = ''] = fields
  const vitals: Vitals = {}
  const percent = PERCENT.test(context) ? Number(context) : NaN

  if (Number.isFinite(percent) && percent <= 100) {
    vitals.context = percent
  }

  if (WINDOWS.includes(fiveHour)) {
    vitals.fiveHour = fiveHour as VitalsWindow
  }

  if (WINDOWS.includes(sevenDay)) {
    vitals.sevenDay = sevenDay as VitalsWindow
  }

  if (CACHES.includes(cache)) {
    vitals.cache = cache as VitalsCache
  }

  return vitals
}

/** The file's whole content for a segment, or '' to show nothing. */
export function busLine(segment: BusSegment | undefined): string {
  if (segment === undefined) {
    return ''
  }

  const text = busText(segment.text)

  if (text === '') {
    return ''
  }

  const until = segment.until !== undefined && Number.isFinite(segment.until) && segment.until > 0 ? `\t${Math.floor(segment.until)}` : ''

  return `${segment.level}\t${text}${until}\n`
}
