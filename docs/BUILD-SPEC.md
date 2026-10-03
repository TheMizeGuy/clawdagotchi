# Mod build spec (Claude Code 2.1.287)

The conventions the mod in this repo follows: a Claude Code plugin made of function hooks (a "mod"). The rules were worked out on Claude Code 2.1.287; the coworker itself needs 2.1.288. Its design notes are in `docs/coworker.md`.

## Repo layout

```
clawdagotchi/
  .claude-plugin/marketplace.json  the marketplace (clawdagotchi): one entry per plugin
  shared/statusline-bus.ts         the status bus contract (segments, the reserve, the vitals); vendored into each plugin that uses it
  statusline/statusline.sh         the status line (the statusLine command); suites in statusline/tests/, a gallery in samples.sh
  scripts/tui-capture.py           drives a real interactive session in a pty and saves its screen (text + PNG): the check for anything a mod draws
  scripts/vendor-shared.sh         copies shared/*.ts into plugins/<p>/hooks/lib/ (--check: fail on drift)
  scripts/worktree-safety.py       fails a plugin whose validate output shows a tool.call hook that can match Bash (rule 7a)
  scripts/check-all.sh             vendor parity and the status line suites, then validate --strict, the worktree-safety check, the frame contract and plugin test for every plugin
  docs/                            the design notes (coworker.md) and this spec
  plugins/<name>/                  one plugin per mod
    .claude-plugin/plugin.json     name, version, description, author, userConfig
    hooks/hooks.json               { "description": "...", "modules": ["./register.tsx"] }
    hooks/register.tsx             the hooks module (all code that touches $ lives here)
    hooks/lib/*.ts                 pure helpers (no $); statusline-bus.ts is vendored, never edit it in place
    types/index.d.ts               the plugin's $.state values
    scripts/, assets/frames/       the coworker's frame contract (frames.json), its generator (make-frames.py) and the PNGs
    tests/*.test.ts                claude plugin test suites (the coworker's tests/test_frames.py runs under Python's unittest)
    README.md                      what it does, commands, options, limits, tested Claude Code version
```

Marketplace: each plugin is an entry in `.claude-plugin/marketplace.json` with `source: "./plugins/<name>"`, installed as `<name>@clawdagotchi`. Build and test a change in the working tree, loaded with `--plugin-dir plugins/<name>`, before it reaches an installed copy.

## Reference material

- The exact API declarations. The engine writes them into `plugins/<name>/.claude-plugin/types/` when the plugin loads with `--plugin-dir` (gitignored). Grep them for the name at hand (`'tool.call'`, `export type ToolCallResult`, `AgentInfo`, `PromptOrigin`, `AskOptions`, `PluginRegisterInput`, `UserConfig`) and read the declaration. They win over every page when they disagree.
- The official mods docs (create, events, api, interface, test, troubleshoot, reference, admin, permission modes) and the built-in plugin-authoring skill, whose long form covers userConfig, `$.state` contracts and tests.

## Hard rules from the platform (validate fails or the mod misbehaves otherwise)

1. Spell every API call in full in the hooks module: `$.store.get(...)`. Never assign, destructure or index `$`. `$` may be passed only to a function declared at top level of the SAME file; passing it to an imported function fails validation. So every function that touches `$` lives in the hooks module (`hooks/register.tsx` here); `hooks/lib/` holds pure code.
2. Event names in `on()` are string literals. Do not shadow `on` inside `register`.
3. Imports: relative files inside the plugin only, plus the bare `claude-code` (types and helpers such as `atom`) and `claude-code/testing` in tests. ES modules, top-level `import` declarations only.
4. A hook's own running time is capped at 10 s (time awaiting `next` or a `$` call does not count, except `$.clock.sleep`). Keep hot paths O(command length): no `$.process.run`, no file reads, no model calls on a tool call that matches nothing.
5. All mods share one worker. A hook that throws fails open and is logged; three untraceable crashes unload every non-built-in mod for the session. Wrap risky logic in try/catch and give guard registrations a `.catch` handler.
6. In auto mode the server classifier reviews actions as the model wrote them: a hook that REWRITES a Bash or network tool call's input gets the call denied ("a hook changed this call's input"). Never rewrite tool input. Deny with a reason that names the rule and the remedy, or observe and add `context` after `next`.
7. Never return `{ decision: 'allow' }` from `tool.check`, and do not hook `tool.check` at all unless the mod's design calls for it. Allowed calls always go through `next(e)`.
7a. **Never register a `tool.call` hook whose matcher could match Bash** (no matcher, a RegExp matcher such as `/^mcp__/` or `/^(?!Bash$)/`, or `'Bash'`). In 2.1.287 that makes every Bash call in a worktree-isolated Agent or Workflow subagent fail with "The working-directory isolation context for this agent was lost ... Refusing to run it", even for a pure pass-through hook (verified 2026-10-01 with probe mods). Safe instead: `classic.PreToolUse` (deny or allow before a call; `e` is the tool envelope, no agentId), `classic.PostToolUse` (observe, `additionalContext`, or `updatedToolOutput` / `updatedMCPToolOutput` to replace what the model sees) and `classic.PostToolUseFailure` (observe or `additionalContext` only; it cannot replace an errored result), `turn.step`, and `tool.call` with an exact tool-name string or array that excludes Bash (`{ tool: 'Workflow' }`, `{ tool: ['Read', 'WebFetch'] }`). `scripts/check-all.sh` fails a plugin whose validate output shows an unsafe `tool.call` hook.
8. Command names: letters, digits, `_`, `-`, at most 64 chars, and no collision with a built-in or another plugin's command (a collision throws in `session.start` and aborts the rest of that hook). Prefix with the plugin's own word (`/coworker` here). Check `claude --help` and the built-in command list if unsure.
9. `$.store` is one 4 MiB JSON store per plugin, shared by every session on the machine, last write wins, not atomic. Key per session where several sessions write. `$.fs.write` replaces a file non-atomically.
10. `$.model.classify` defaults to Haiku. No mod in this repo calls a model.

## House rules every mod follows

- Commands that change a mod's state for the person at the keyboard (`/coworker off`, `on`, `demo`) are slash commands whose `command.run` hook checks `e.origin.kind === 'composer'` (the person pressed Enter). Any other origin (a plugin, the SDK, the bridge, the model through a tool) is refused with a one-line reason. The model can never flip such a switch by typing a token, a file flag or an env var.
- A guard (a mod that denies tool calls) that false-denies with no hatch for the person gets removed, not tuned. Every deny names its rule id, says what to do instead, and names the hatch command.
- Guards stay cheap and deny only destructive actions. No model handholding, no nudges, no injected advice: a mod adds to the model's context only facts a loop cannot see for itself. The coworker adds nothing.
- Plain text in UI and messages, no emojis. Model classes only (`opus`, `sonnet`), never versioned model ids, in code or docs.
- Never print secrets. Never read shell profiles or `~/.claude/.credentials.json`.

## Testing and verification (acceptance for every plugin)

Give a mod a status command that answers any origin, without a model turn, with text that starts with the plugin name (the engine adds the `<plugin>: ` prefix): `/coworker` here. Against each new Claude Code release, re-run `scripts/check-all.sh`, the type check and a live session.

1. `claude plugin validate --strict plugins/<name>` passes (author is set, so no author warning).
2. `cd plugins/<name> && claude plugin test` passes, with tests that cover each rule or behavior, both the positive and the negative case (the false-deny cases matter as much as the denies).
3. Type-check: load the plugin once so the engine writes `.claude-plugin/types/` (e.g. `claude -p --plugin-dir plugins/<name> --model sonnet "/<your-status-command>"` from a scratch cwd), then `tsc -p plugins/<name> --noEmit`. Fix type errors in your code. `.claude-plugin/types/` and the generated `tsconfig.json` are build output; do not commit them.
4. Live smoke test in a real headless session: `claude -p --plugin-dir plugins/<name> --model sonnet "<prompt>"` from a scratch directory, plus one run that goes through a subagent (ask the model to use the Agent tool) where the mod's behavior should reach subagents. `$.ui.*` drawing does not run under `-p`; `$.ui.ask` rejects there, so the headless path of any dialog must be exercised too. Anything a mod draws needs an interactive session as well: `scripts/tui-capture.py`, and a real terminal for pictures.
   NEVER run a genuinely destructive command as a test, even one you expect the mod to deny: use harmless stand-ins (a codesign of a nonexistent path, a scratch git repo with a local bare remote). A `pkill -f <pattern>` stand-in is NOT harmless: the pattern also sits in the argv of the `claude -p` process whose prompt carries it (and of any sibling smoke run), so a guard that fails open kills those sessions. Test kill rules in `claude plugin test`, or have the prompt build the pattern at run time so it never appears literally in any process's argv.
5. Record in the plugin's README the Claude Code version it was tested on and what was checked live.

## Working in this repo

- Edit shared helpers in `shared/`, then run `scripts/vendor-shared.sh`; never edit a vendored copy in `hooks/lib/`. A change to the bus format changes the status line and its suite (`statusline/tests/test-statusline.sh`) with it.
- `scripts/check-all.sh` passes before a change lands.
