# Changelog

## 0.1.0

- `/goal [--for] [--steps] [--check] <objective>`, `/goal status|stop|stats`.
- `start_goal` tool so the agent can time-box its own subtasks.
- Harness-run check with untimed baseline; judge (current model) over the final
  message, diff since goal start, and new untracked files when there's no check.
- Remaining budget (time, check runs, calls) appended to every top-level tool
  result; phase guidance on explore → converge → wrap → over.
- Handoff turn when the budget is used; hard stop past grace; Escape aborts.
- Live canvas sections via the `canvas:put` event; stats in
  `~/.pi/agent/goal-stats.jsonl`.
