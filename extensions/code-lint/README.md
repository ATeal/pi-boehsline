# code-lint

Runs your project's linters after the agent's `edit` and `write` calls, and appends any errors to the tool result so the model fixes them in the same turn.

- [`lint.sh`](lint.sh) does the work; it's the same script the Claude Code `code-lint` plugin runs, so both agents lint alike.
- Each project's config lives in `~/.claude/code-lint/<project-hash>/config.json`, written by [`/setup-lint`](https://github.com/ericboehs/agent-plugins). No config: nothing runs.
- Reads, failed writes and calls without a path are left alone. A clean lint adds nothing.

**Needs:** `jq`. Each linter runs under `timeout` (or `gtimeout`) when one is installed.
