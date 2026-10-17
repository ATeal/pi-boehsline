# aa-info

A one-line [Artificial Analysis](https://artificialanalysis.ai) briefing whenever you switch models. **Needs:** `ARTIFICIAL_ANALYSIS_API_KEY` (environment or the secret command); without a key it does nothing.

Prints one dim status line into the chat whenever a
model is selected (startup, `/model`, Ctrl+P) and lets it scroll away with the
conversation:

```text
Claude Opus 5 — int 62.5 · cod 77 · 53t/s · $10/1M · $1.80/task (AA)
Grok 4.6 — int 60 · cod 75.9 · 60t/s · $3/1M · $0.78/task@med (AA)
```

It lands in place of pi's own `Switched to …` line, because pi overwrites its
last status line rather than appending; models only cycled past stay quiet.

`int`, `cod`, `t/s`, and `$/1M` use AA's row for pi's current thinking level,
falling back to AA's bare/max row only when that effort has no row. `$/1M` is
the sticker rate (every model has one); `$/task` is what one Intelligence Index
task cost AA to run, which folds in how many tokens the model burns thinking.
AA only measures one or two effort levels per model for the task-cost endpoint,
so a trailing `@med` marks a task cost measured at a different effort than the
session runs — it swings ~4x across the ladder. Latency is omitted on purpose:
AA's own site and API disagree about it by more than 2x for the same variant.

Data comes from one free Artificial Analysis endpoint, `language/models/free`,
fetched once a week (every page: it serves 200 models a page) and cached in
`~/.pi/agent/cache/aa-models.json`. A refresh costs one request per page, four
today, against the free tier's 100 per fixed 24-hour window. The free shape has
no blended rate, so `$/1M` is AA's 3:1 blend, (3·input + output) / 4. The
endpoint declares its Intelligence Index version (`intelligence_index_version`,
major.minor); the cache keeps it and the briefing shows it as `(AA v4.3)`,
falling back to plain `(AA)` for caches written before versions were kept. The
API serves current scores only, so
a past index can't be pinned — when the site and the briefing disagree, the tag
says which index the briefing's numbers belong to. Speeds are AA's free-tier
snapshot, whose prompt preset isn't declared (it looks like the API's default
10k-input `long` preset, and `prompt_type` is rejected). The fetch is
fire-and-forget — neither startup nor the model switch waits on it — and a
model the API does not know (local oMLX weights) shows nothing. A failed
refresh is recorded in the cache (`retryAt`) and holds off every pi sharing it
for an hour, or longer if a 429's `Retry-After` says so; briefings keep coming
from the stale snapshot meanwhile, and with no snapshot yet, show nothing. The key resolves from `$ARTIFICIAL_ANALYSIS_API_KEY`, then the secret command
(`secrets.command` in `boehsline.json`, `fnox get` by default), like the web providers; nothing touches the LLM context.
