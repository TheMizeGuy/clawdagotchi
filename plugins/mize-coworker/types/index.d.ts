// The $.state contract of mize-coworker: the values the host keeps for the
// session (they survive a hot reload of the module; /clear resets them).

/**
 * What Claude is shown doing: a tool family while a tool call is in flight or
 * just ended, `thinking` while the main loop's turn runs between tools,
 * `idle` when nothing happened for 8 s, `asleep` after 10 idle minutes; and
 * three short gestures: `greeting` (a wave when the session opens), `done` (a
 * hop when the main turn ends with an answer, a cheer after a long one) and
 * `oops` (a flinch when one of the main loop's own tool calls fails).
 */
export type CoworkerActivity =
  | 'thinking'
  | 'reading'
  | 'searching'
  | 'editing'
  | 'running'
  | 'browsing'
  | 'delegating'
  | 'asking'
  | 'working'
  | 'greeting'
  | 'done'
  | 'oops'
  | 'idle'
  | 'asleep'

/** The activity and the spinner word for it, as the Spinner hook reads them. */
export type CoworkerDoing = {
  activity: CoworkerActivity
  /**
   * The narration for a tool activity (`Reading register.ts`, `Running npm`,
   * `Asking you`); empty for `thinking`, `idle` and `asleep`, which the
   * spinner words from its own mode.
   */
  word: string
}

/** What the SessionMode hook (and, while a turn runs, the Spinner hook) draws: one frame of Claude and its caption. */
export type CoworkerView = {
  /**
   * The picture frame by name, one of the 73 in scripts/frames.json: its PNG
   * is assets/frames/<frame>.png. A scene frame (12 cells wide, a prop beside
   * Claude) is drawn only beside the spinner, where the spinner's word or mode
   * may put another scene in its place; the footer draws the solo frame the
   * table names for it.
   */
  frame: string
  /**
   * The braille that stands in for the frame (one of twelve poses, five
   * cells): the colored text with the `picture` option off, and the picture's
   * `alt` with it on. Several frames share a pose, so it names no frame.
   */
  sprite: string
  /** The dim word to the sprite's left (`reading`, `needs you`); empty for none. */
  caption: string
  /** True while asleep: the sprite and a trailing `z` are drawn muted. */
  isAsleep: boolean
}

/**
 * The step of the `/coworker demo` tour on screen, drawn in the band above the
 * prompt (`AbovePrompt`): the frame and what it shows. An empty `frame` is no
 * tour, and the band draws nothing.
 */
export type CoworkerDemo = {
  /**
   * The frame by name, one of scripts/frames.json, as the tour gives it; the
   * band draws it as the spinner would (a scene's solo frame where scenes are
   * not drawn). Empty while no tour runs.
   */
  frame: string
  /** What it shows: the spinner word (`Writing`, `Reading register.tsx`) or the move's name (`yawn`). */
  label: string
}

/**
 * Where Claude is drawn: in the footer (`SessionMode`), or beside the main
 * loop's spinner while its turn runs; and where on the footer's row.
 */
export type CoworkerSpot = {
  where: 'footer' | 'spinner'
  /**
   * Blank cells to Claude's right on the footer's row. He is right-aligned,
   * so a larger x puts him further left: 0 to 12, drawn clamped to what the
   * terminal's width and a caption leave room for.
   */
  x: number
}

declare module 'claude-code' {
  interface PluginState {
    'mize-coworker': {
      /** Read by the Spinner hook; written only when the activity or its word changes. */
      doing: CoworkerDoing
      /** Read by the SessionMode hook; written only when the frame or caption changes. */
      view: CoworkerView
      /** Read by both render hooks; written only when the place or x changes. */
      spot: CoworkerSpot
      /** The session-only switch `/coworker off` sets; both features pass through while true. */
      isOff: boolean
      /** Read by the AbovePrompt hook; written by `/coworker demo`'s one timer, only when the step changes. */
      demo: CoworkerDemo
    }
  }
}
