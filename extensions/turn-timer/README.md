# turn-timer

A toast when a run ends, and a rolling log of how each model spends your time. **Command:** `/turn stats`.

The headline is **steps per task**, not seconds per step: a model that thinks for 30 seconds and finishes in 3 steps beats one at 8 seconds a step over 21 steps.

- A run is from the agent starting to settling, so compaction retries stay one toast.
- Steps count toward the model (and thinking level) of each turn, so a mid-run `/model` switch splits the count. Mixed runs show the split and stay out of the medians.
- Thinking tokens are split out of output (estimated from text, marked `~`, when the provider doesn't report them).
- While an [`ask`](../ask/README.md) question is open, the spinner shows "Waiting on user…", timed from when the question appeared.
- Approval-guardian blocks are counted from their rejection text, without importing the guardian.

Each run is appended to `turn-stats.jsonl` in the agent directory. `/turn stats` shows 14-day medians of steps and time per model and thinking level, like `/boot stats` for startup.
