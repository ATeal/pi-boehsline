# Benchmarks: what Boehsline costs

How much Boehsline adds to pi's startup time and to the context every
conversation starts with. Rerun with:

```sh
node scripts/bench.mjs              # stock vs Boehsline vs all opt-ins on
node scripts/bench.mjs --each       # stock pi + one extension at a time
```

Measured 2026-10-16 on pi 1.3.0, node v26.10.0, darwin-arm64 (Apple silicon),
model `github-copilot/claude-opus-5.5`, median of 9 boots after one warm-up.

## Summary

| config | wall ms | pi startup ms | tools | system ~tok | tools ~tok | total ~tok |
|---|---|---|---|---|---|---|
| stock pi | 448 | 109 | 4 | 1,528 | 801 | **2,329** |
| + Boehsline (defaults) | 589 (+140) | 253 (+144) | 12 | 2,555 | 4,371 | **6,926** (+4597) |
| + Boehsline, all opt-ins on | 606 (+158) | 270 (+161) | 14 | 2,555 | 4,866 | **7,421** (+5092) |

- **Boot:** Boehsline adds about 144ms to pi's startup (31% of a 448ms launch). Turning on every opt-in adds another ~17ms.
- **Context:** every conversation starts about 4,597 tokens larger (2,329 → 6,926). It's part of every request's prefix: written to the provider's cache once per session, then read from it at a fraction of the price.
- **Canvas is most of it:** its tool schema (~2,000 tokens) plus its usage guidelines in the system prompt (~850) are about 61% of what Boehsline adds.

## Where the tokens go

Tool schemas with Boehsline's defaults (characters ÷ 3.6):

| tool | ~tokens | from |
|---|---|---|
| `canvas` | 2,002 | Boehsline |
| `edit` | 328 | pi |
| `ask` | 321 | Boehsline |
| `web_search` | 275 | Boehsline |
| `start_goal` | 248 | Boehsline |
| `bash` | 233 | pi (+82 from bg's `background` flag) |
| `agent-link` | 230 | Boehsline |
| `tool_search` | 193 | Boehsline |
| `read` | 190 | pi |
| `web_fetch` | 141 | Boehsline |
| `write` | 119 | pi |
| `provider_usage` | 92 | Boehsline |

`tool_search` is pi's: it appears once any tool is *deferred* (subagent is), and a deferred tool then costs nothing until the model looks it up. The system prompt grows by ~1,000 tokens: canvas's guidelines (~850), plus one-line descriptions of the new tools and the `pi-agent-link` skill entry.

## Each extension on its own

Stock pi plus that one extension, opt-ins enabled, median of 5. Loading *any* TypeScript extension costs a floor of about 8–10ms (the transpiler warming up), so judge the startup column against that; single-digit differences are noise.

| extension | +startup ms | +~tokens | tools |
|---|---|---|---|
| canvas | 15 | 2,825 | `canvas` |
| opt-in/watch | 29 | 495 | `watch_items`, `watch_lookup` |
| web | 13 | 416 | `web_search`, `web_fetch` |
| ask | 10 | 322 | `ask` |
| packages/agent-link | 42 | 268 | `agent-link` |
| packages/goal | 14 | 248 | `start_goal` |
| subagent | 10 | 201 | `tool_search` |
| provider-usage | 12 | 92 | `provider_usage` |
| bg | 23 | 82 |  |
| opt-in/approval-guardian | 37 | 0 |  |
| footer | 36 | 0 |  |
| prompt-history | 24 | 0 |  |
| auto-session-name | 23 | 0 |  |
| compaction | 23 | 0 |  |
| opt-in/omlx | 21 | 0 |  |
| opt-in/tmux-attention | 20 | 0 |  |
| packages/scheduler | 16 | 0 |  |
| openrouter-route | 12 | 0 |  |
| opt-in/meeting | 12 | 0 |  |
| boehsline | 11 | 0 |  |
| stash | 11 | 0 |  |
| turn-timer | 11 | 0 |  |
| packages/context | 11 | 0 |  |
| opt-in/wiki-session-log | 10 | 0 |  |
| aa-info | 9 | 0 |  |
| color | 9 | 0 |  |
| compact-progress | 9 | 0 |  |
| cursor-focus | 9 | 0 |  |
| image-preview | 9 | 0 |  |
| opt-in/sc | 9 | 0 |  |
| opt-in/update | 9 | 0 |  |
| code-lint | 8 | 0 |  |
| next-steps | 7 | 0 |  |

## Method

- Each config gets its own empty agent directory (your `auth.json` and `models.json` linked in, nothing else) and runs from an empty working directory, so no `AGENTS.md`, skills or other packages are counted.
- **Boot:** `PI_STARTUP_BENCHMARK=1 PI_TIMING=1` makes pi build the full interactive UI, print its startup phases and per-extension import times, and stop. pi waits for the terminal to answer capability queries, so each boot runs in a detached tmux session. *pi startup ms* is pi's own total; *wall ms* also includes starting node and loading pi itself.
- **Context:** a probe extension captures the first provider request at `before_provider_request` and exits before it's sent, so nothing is spent. Tokens are characters ÷ 3.6, close to Claude's tokenizer; treat them as estimates and compare rows, not absolute numbers.
- pi's benchmark mode doesn't call `process.exit`, and several extensions keep timers or watchers alive, so the clock stops when the timings print and the process is then killed.
