# pi-goal

Time-boxed goals for [pi](https://pi.dev). Give the agent an objective and a
budget; the harness keeps it working until the goal is **met** or the budget
**runs out**, and tells it how much budget is left after every tool call.

```text
/goal --for 30m --check "bin/rails test test/models/user_test.rb" make the user model tests pass
```

```text
$ bin/rails test test/models/user_test.rb
...
[⏱ goal: 14m left of 30m · check takes ~42s → ~20 runs left · 22/40 calls left]
```

## Why

Agents don't feel time passing. They work in turns, and a vague "you have 30
minutes" in the first prompt is forgotten by turn ten. A ticking clock injected
every minute is worse: noise that pressures the model into cutting corners.

pi-goal does three things instead:

1. **The harness decides when it's done, not the agent.** With `--check` the
   harness runs the command when the agent stops; exit 0 is the only way to
   "met". Without one, a judge call reviews the work.
2. **Budget as decisions, not a clock.** The line appended to tool results turns
   minutes into *check runs left* and *calls left*, which is what the model
   actually chooses between ("I can afford ~5 more test runs; no big refactor").
3. **Phases, not pressure.** Guidance is added only when the phase changes:
   *explore* → *converge* (≤40% left) → *wrap* (≤15%) → *over*. When the budget
   is gone the agent gets one last turn to leave things working and write a
   handoff, then it stops.

## Install

```sh
pi install git:github.com/ericboehs/pi-goal
```

Requires Node >= 22.18.

## Usage

```text
/goal [--for 30m] [--steps N] [--check "cmd"] <objective>
/goal status        budget line, phase, iteration
/goal stop          end the goal (logged as "stopped")
/goal stats         met rate and p50 time per model
```

| Option | Meaning |
|---|---|
| `--for` | Wall-clock budget: `30`, `90s`, `30m`, `1.5h`. Default `30m`. |
| `--steps` | Cap on top-level tool calls. The tighter of time and steps sets the phase. |
| `--check` | Shell command that exits 0 when the goal is met. Run by the harness. |

### Done: check or judge

**With `--check`:** a baseline run at start confirms the check fails (if it
already passes there's nothing to do) and times one run. The baseline isn't
charged to the budget. When the agent stops, the harness runs the check again:
exit 0 ends the goal; otherwise the agent is sent back with the last 40 lines
of output.

**Without:** when the agent stops, the session's current model judges the
objective against the agent's final message, `git diff` since the goal started
(so commits made during the goal count), and the contents of new untracked
files. It returns `{done, reason}`; the reason becomes the re-prompt.

### The agent can start goals too

The `start_goal` tool lets the agent time-box its own subtasks (`objective`,
`minutes`, `check`, `steps`). Same loop, same rules, one goal at a time.

### Stopping

| Event | Result |
|---|---|
| Check passes / judge says done | `met` |
| Budget used, handoff turn written | `missed` |
| Escape | `aborted` |
| `/goal stop` | `stopped` |
| Agent keeps going 3m or 10 calls past the budget | `hard-stop` (run is aborted) |
| 40 iterations | `max-iterations` |

## Stats

Every finished goal appends one line to `~/.pi/agent/goal-stats.jsonl`: objective,
model, thinking level, mode (`check`/`judge`), source (`command`/`tool`), budget,
elapsed, tool calls, iterations, judge cost and verdicts, outcome, cwd.

```text
/goal stats
Goal stats (12 goals):
github-copilot/claude-opus-5.5: 7/8 met (88%) · p50 6m, 2 iter
github-copilot/claude-haiku-4.5: 2/4 met (50%) · p50 1m, 3 iter
```

## Canvas (optional)

If a canvas extension listens for the `canvas:put` event, pi-goal posts two live
sections: `goal` (stats cards: time left, elapsed, calls left, iterations; the
outcome when it ends) and `goal-timeline` (start, failed checks, judge
verdicts, phase changes, end). Without a listener nothing happens.

The contract is one event on pi's extension bus:

```ts
pi.events.emit("canvas:put", {
  params: { kind: "stats", id: "goal", title: "🎯 …", body: "[…]" }, // canvas tool params
  ctx,                                                               // ExtensionContext
  reply: (err, result) => {},                                        // optional
});
```

A canvas extension supports it by running its own tool's `execute` for the
event:

```ts
const canvasTool = defineTool({ name: "canvas", /* … */ });
pi.registerTool(canvasTool);
pi.events?.on?.("canvas:put", (p: any) => {
  if (!p?.params || !p?.ctx) return;
  canvasTool
    .execute("canvas:put", p.params, undefined, undefined, p.ctx)
    .then((r: unknown) => p.reply?.(null, r), (e: unknown) => p.reply?.(e));
});
```

## Limits

- **Anti-cheat is prompt-only.** The agent is told not to edit the check or its
  tests. Nothing enforces it; read the diff.
- **`pi -p` can't drive `/goal`.** Print mode exits as soon as the command
  handler returns, before the queued prompt runs. Use interactive mode, RPC, or
  have the agent call `start_goal`.
- **The judge is the same model as the agent.** It's strict by prompt, but it
  shares the agent's blind spots. Prefer `--check` when a check exists.

## Development

```sh
npm test                 # lib/core.ts under node --test
npm install --no-save typescript @types/node @earendil-works/pi-coding-agent typebox
npx tsc -p .
pi -e ./extensions/goal.ts   # try it without installing
```

`lib/core.ts` holds the pure budget, parsing, and stats logic (no pi imports);
`extensions/goal.ts` wires it to pi events.

## License

MIT
