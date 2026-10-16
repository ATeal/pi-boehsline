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
| stock pi | 445 | 108 | 4 | 1,528 | 801 | **2,329** |
| + Boehsline (defaults) | 535 (+89) | 203 (+95) | 12 | 2,154 | 3,562 | **5,716** (+3387) |
| + Boehsline, all opt-ins on | 554 (+109) | 221 (+113) | 14 | 2,154 | 4,056 | **6,211** (+3882) |

- **Boot:** Boehsline adds about 95ms to pi's startup (20% of a 445ms launch). Every opt-in on adds another ~18ms.
- **Context:** every conversation starts about 3,387 tokens larger (2,329 → 5,716). It's part of every request's prefix: written to the provider's cache once per session, then read from it at a fraction of the price.
- **Canvas is the largest part:** its tool schema plus its guidelines are ~1,615 tokens, about 48% of what Boehsline adds.

## What changed

The first measurement (same machine, same day) found two easy wins:

| | before | after |
|---|---|---|
| pi startup over stock | +144ms | +95ms |
| starting context over stock | +4,597 tokens | +3,387 tokens |
| canvas schema + guidelines | ~2,800 tokens | ~1,615 tokens |
| `session_start` handlers, all extensions | 83ms | 7ms |

- **canvas** described every kind twice, once in the tool (what it is, its body format) and once in the "lightest kind" guideline (when to use it). One line per kind now carries both, the guidelines are tighter, and `kind` is a plain string enum instead of 22 `{const, type}` objects. No kind, field or rule was dropped.
- **agent-link** awaited its socket and a probe of every live peer (for a free name) in `session_start`: ~60ms with a dozen sessions open. It now starts in the background; anything that touches its peer record waits for it.
- **bg** pruned old logs (an `lstat` per file, thousands of them) during `session_start`; now async, 5 seconds after boot.
- **tmux-attention** spawned `tmux` while pi booted to stamp the pane; now a second later.

## Where the tokens go

Tool schemas with Boehsline's defaults (characters ÷ 3.6):

| tool | ~tokens | from |
|---|---|---|
| `canvas` | 1,192 | Boehsline |
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

`tool_search` is pi's: it appears once any tool is *deferred* (subagent is), and a deferred tool then costs nothing until the model looks it up. The system prompt grows by ~626 tokens: canvas's guidelines, one-line descriptions of the new tools, and the `pi-agent-link` skill entry.

## Each extension on its own

Stock pi plus that one extension, opt-ins enabled, median of 5. Single-digit differences are noise at this run count.

| extension | +startup ms | +~tokens | tools |
|---|---|---|---|
| canvas | 13 | 1,615 | `canvas` |
| opt-in/watch | 7 | 495 | `watch_items`, `watch_lookup` |
| web | 2 | 416 | `web_search`, `web_fetch` |
| ask | 4 | 322 | `ask` |
| packages/agent-link | 6 | 268 | `agent-link` |
| packages/goal | 0 | 248 | `start_goal` |
| subagent | 1 | 201 | `tool_search` |
| provider-usage | 5 | 92 | `provider_usage` |
| bg | 3 | 82 |  |
| footer | 36 | 0 |  |
| prompt-history | 15 | 0 |  |
| code-lint | 10 | 0 |  |
| cursor-focus | 9 | 0 |  |
| opt-in/omlx | 9 | 0 |  |
| auto-session-name | 8 | 0 |  |
| compact-progress | 8 | 0 |  |
| opt-in/approval-guardian | 8 | 0 |  |
| boehsline | 7 | 0 |  |
| color | 7 | 0 |  |
| compaction | 6 | 0 |  |
| image-preview | 5 | 0 |  |
| stash | 5 | 0 |  |
| aa-info | 4 | 0 |  |
| next-steps | 3 | 0 |  |
| opt-in/meeting | 2 | 0 |  |
| opt-in/update | 2 | 0 |  |
| opt-in/wiki-session-log | 2 | 0 |  |
| openrouter-route | 1 | 0 |  |
| packages/scheduler | 1 | 0 |  |
| turn-timer | -1 | 0 |  |
| opt-in/tmux-attention | -1 | 0 |  |
| opt-in/sc | -2 | 0 |  |
| packages/context | -3 | 0 |  |

What's left at startup is mostly deliberate: omlx asks your local oMLX server what's loaded before pi resolves models (a refused port is instant; a hung server is capped at 750ms), and approval-guardian and watch are large modules (both opt-in).

## Method

- Each config gets its own empty agent directory (your `auth.json` and `models.json` linked in, nothing else) and runs from an empty working directory, so no `AGENTS.md`, skills or other packages are counted.
- **Boot:** `PI_STARTUP_BENCHMARK=1 PI_TIMING=1` makes pi build the full interactive UI, print its startup phases and per-extension import times, and stop. pi waits for the terminal to answer capability queries, so each boot runs in a detached tmux session. *pi startup ms* is pi's own total; *wall ms* also includes starting node and loading pi itself.
- **Context:** a probe extension captures the first provider request at `before_provider_request` and exits before it's sent, so nothing is spent. Tokens are characters ÷ 3.6, close to Claude's tokenizer; treat them as estimates and compare rows, not absolute numbers.
- pi's benchmark mode doesn't call `process.exit`, and several extensions keep timers or watchers alive, so the clock stops when the timings print and the process is then killed.
- To find *which* startup work is slow, wrap each extension so a proxied `pi.on` times its handlers; pi only reports import times per extension, and `session_start` handlers run inside `interactiveMode.init`.
