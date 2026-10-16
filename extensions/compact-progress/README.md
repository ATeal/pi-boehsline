# compact-progress

A progress bar with a self-correcting ETA under pi's "Compacting context…" row, then how long it took:

```text
[compaction] Compacted from 101,377 tokens (ctrl+r to expand)
  ████████████████░░░░░░░░░░░░  ~42s left · 70.5k tokens
  ████████████████████████████  +8s over estimate · 70.5k tokens
  ✓ Summarized from 101,377 tokens in 52s · est. 44s
  ✓ Rolled over from 101,377 tokens · no summarizer
```

- Compaction is one model call with no real percent-complete signal, so the ETA comes from a throughput rate **learned from your past compactions**, per model, in `~/.pi/agent/compaction-rates.json`. An unseen model borrows the median of the others.
- When the estimate runs out, the bar completes and counts up ("+8s over estimate") instead of faking progress; the learned rate absorbs the overrun.
- On a 429 or 5xx the bar freezes and says "rate limited". Backoff time is left out of the ETA, and that run doesn't teach the estimator.
- `/tree` rows read `[Summarized: Nk tokens]` or `[Rolled over: Nk tokens]` instead of `[compaction: …]`, matching the completion line.

It loads before [compaction](../compaction/README.md) (alphabetical order), which matters: pi awaits `session_before_compact` handlers one at a time, and compaction spends the whole summary inside its handler.
