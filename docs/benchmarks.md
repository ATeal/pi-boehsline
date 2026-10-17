# Benchmarks: what Boehsline costs

How much Boehsline adds to pi's startup time and to the context every
conversation starts with. Rerun with:

```sh
node scripts/bench.mjs              # stock vs Boehsline vs all opt-ins on
node scripts/bench.mjs --each       # stock pi + one extension at a time
```

Measured 2026-10-17 on pi 1.3.0, node v26.10.0, darwin-arm64 (Apple silicon),
model `github-copilot/claude-opus-5.5`, median of 9 boots after one warm-up.

## Summary

| config | wall ms | pi startup ms | tools | system ~tok | tools ~tok | total ~tok |
|---|---|---|---|---|---|---|
| stock pi | 440 | 105 | 4 | 1,528 | 801 | **2,329** |
| + Boehsline (defaults) | 548 (+107) | 205 (+100) | 9 | 2,116 | 2,992 | **5,108** (+2779) |
| + Boehsline, all opt-ins on | 553 (+113) | 222 (+117) | 11 | 2,116 | 3,486 | **5,603** (+3274) |

- **Boot:** Boehsline adds about 100ms to pi's startup (24% of a 440ms launch). Every opt-in on adds another ~17ms.
- **Context:** every conversation starts about 2,779 tokens larger (2,329 → 5,108). It's part of every request's prefix: written to the provider's cache once per session, then read from it at a fraction of the price.
- **Canvas is the largest part:** its tool schema plus its guidelines are ~1,615 tokens, about 58% of what Boehsline adds.

## What changed

The first measurement (same machine, same day) found some easy wins:

| | before | after |
|---|---|---|
| pi startup over stock | +144ms | +100ms |
| starting context over stock | +4,597 tokens | +2,779 tokens |
| canvas schema + guidelines | ~2,800 tokens | ~1,615 tokens |
| `session_start` handlers, all extensions | 83ms | 7ms |

- **canvas** described every kind twice, once in the tool (what it is, its body format) and once in the "lightest kind" guideline (when to use it). One line per kind now carries both, the guidelines are tighter, and `kind` is a plain string enum instead of 22 `{const, type}` objects. No kind, field or rule was dropped.
- **agent-link** awaited its socket and a probe of every live peer (for a free name) in `session_start`: ~60ms with a dozen sessions open. It now starts in the background; anything that touches its peer record waits for it.
- **bg** pruned old logs (an `lstat` per file, thousands of them) during `session_start`; now async, 5 seconds after boot.
- **tmux-attention** spawned `tmux` while pi booted to stamp the pane; now a second later.
- **start_goal, provider_usage and agent-link** are deferred: not declared to the model until `tool_search` finds them (~610 tokens). Every extension with a deferred tool turns `tool_search` on (`lib/tool-search.ts`), so they stay reachable without subagent. agent-link also switches its tool on the moment it's needed: an `@name` in the prompt (from `before_agent_start`, in time for that turn) or a message from another session.

## Where the tokens go

Tool schemas with Boehsline's defaults (characters ÷ 3.6):

| tool | ~tokens | from |
|---|---|---|
| `canvas` | 1,192 | Boehsline |
| `edit` | 328 | pi |
| `ask` | 321 | Boehsline |
| `web_search` | 275 | Boehsline |
| `bash` | 233 | pi (+82 from bg's `background` flag) |
| `tool_search` | 193 | Boehsline |
| `read` | 190 | pi |
| `web_fetch` | 141 | Boehsline |
| `write` | 119 | pi |

`tool_search` is pi's: it's turned on for the *deferred* tools (subagent, start_goal, provider_usage, agent-link), and a deferred tool then costs nothing until the model looks it up. The system prompt grows by ~588 tokens: canvas's guidelines, one-line descriptions of the new tools, and the `pi-agent-link` skill entry.

## Each extension on its own

Stock pi plus that one extension, opt-ins enabled, median of 5. Single-digit differences are noise at this run count. An extension with a deferred tool shows `tool_search` here; with all of Boehsline it's shared.

| extension | +startup ms | +~tokens | tools |
|---|---|---|---|
| canvas | 13 | 1,615 | `canvas` |
| opt-in/watch | 12 | 495 | `watch_items`, `watch_lookup` |
| web | 8 | 416 | `web_search`, `web_fetch` |
| ask | 32 | 322 | `ask` |
| packages/agent-link | 34 | 201 | `tool_search` |
| packages/goal | 34 | 201 | `tool_search` |
| provider-usage | 12 | 201 | `tool_search` |
| subagent | 5 | 201 | `tool_search` |
| bg | 5 | 82 |  |
| packages/scheduler | 52 | 0 |  |
| footer | 48 | 0 |  |
| opt-in/omlx | 18 | 0 |  |
| prompt-history | 15 | 0 |  |
| opt-in/approval-guardian | 15 | 0 |  |
| code-lint | 12 | 0 |  |
| opt-in/tmux-attention | 12 | 0 |  |
| compact-progress | 11 | 0 |  |
| opt-in/meeting | 11 | 0 |  |
| aa-info | 10 | 0 |  |
| cursor-focus | 9 | 0 |  |
| opt-in/update | 9 | 0 |  |
| image-preview | 7 | 0 |  |
| opt-in/wiki-session-log | 7 | 0 |  |
| boehsline | 6 | 0 |  |
| next-steps | 6 | 0 |  |
| stash | 6 | 0 |  |
| turn-timer | 6 | 0 |  |
| packages/context | 6 | 0 |  |
| auto-session-name | 5 | 0 |  |
| opt-in/sc | 5 | 0 |  |
| color | 4 | 0 |  |
| compaction | 4 | 0 |  |
| openrouter-route | 4 | 0 |  |

What's left at startup is mostly deliberate: omlx asks your local oMLX server what's loaded before pi resolves models (a refused port is instant; a hung server is capped at 750ms), and approval-guardian and watch are large modules (both opt-in).

## Method

- Each config gets its own empty agent directory (your `auth.json` and `models.json` linked in, nothing else) and runs from an empty working directory, so no `AGENTS.md`, skills or other packages are counted.
- **Boot:** `PI_STARTUP_BENCHMARK=1 PI_TIMING=1` makes pi build the full interactive UI, print its startup phases and per-extension import times, and stop. pi waits for the terminal to answer capability queries, so each boot runs in a detached tmux session. *pi startup ms* is pi's own total; *wall ms* also includes starting node and loading pi itself.
- **Context:** a probe extension captures the first provider request at `before_provider_request` and exits before it's sent, so nothing is spent. Tokens are characters ÷ 3.6, close to Claude's tokenizer; treat them as estimates and compare rows, not absolute numbers.
- pi's benchmark mode doesn't call `process.exit`, and several extensions keep timers or watchers alive, so the clock stops when the timings print and the process is then killed.
- To find *which* startup work is slow, wrap each extension so a proxied `pi.on` times its handlers; pi only reports import times per extension, and `session_start` handlers run inside `interactiveMode.init`.
