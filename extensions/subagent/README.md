# subagent

A minimal subagent tool: runs a separate `pi` process for a focused task and returns its answer. **Tool:** `subagent`.

- **Deferred:** the tool isn't declared to the model at startup, so it costs no context until the model finds it with `tool_search`.
- Each child is `pi --mode json -p --no-session` with the agent's prompt appended. One `{agent, task}`, or `{tasks: [...]}` in parallel (up to 8, 4 at a time).
- Agents: `~/.pi/agent/agents/*.md`, plus the project's `.pi/agents/*.md` when `agentScope` is `project` or `both`. Two built-ins need no setup: `scout` (read-only) and `worker`.
- Children set `PI_SUBAGENT_CHILD`, so a child can't spawn more children.
