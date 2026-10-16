# compaction

Cheaper compaction, and Claude Code's idle compaction. **Command:** `/idle`. Its progress bar is [compact-progress](../compact-progress/README.md).

Handles every compaction in one
`session_before_compact` handler. pi runs every handler and keeps the last
result, so two handlers would both pay for a summary. It tries three things
in order:

1. **Cache replay** (`replay.ts`), as Claude Code does. pi's own summarizer
   flattens the conversation to text under a separate system prompt, so each
   compaction pays full input price for the whole history. This instead
   resends the session's last Anthropic request (captured from
   `before_provider_request`, with the same system prompt, tools and messages)
   through `onPayload`. It adds one user turn: a transcript of the turns since
   that request, then the summarize instruction. The prefix is unchanged, so
   the history is billed as a cache read, 1/20th of the input price on Opus
   5.5. On Copilot it read 14,046 of 14,506 tokens from cache, with 0 written.
   It is skipped when the cache has gone cold, the model changed, a user
   message or context edit came after that request, the compaction is
   overflow recovery, or the window has less than 32K tokens left for the
   summary.
2. **Thoughtless summary** (`thoughtless.ts`): the flattened text with
   thinking turned down and a 64K output ceiling. See the comment at its top
   for why pi's default wedges on Opus at xhigh.
3. **pi's default**, for models that don't use the Anthropic API.

It also does Claude Code's idle compaction. With `PI_CACHE_RETENTION=long`
(the 1-hour cache), a session left idle with its context at 200K tokens or
more (half the window, for windows under 400K) is compacted 54 minutes after its last request, while the
cache is still warm. Otherwise the next message, an hour later, would rewrite
the whole context at cache-write price. Any input, a new turn or a model
switch cancels the timer. While the timer is armed, the footer shows the
time it will fire, dim, after the context chip (`41.2k/200k ⏲ 10:54p`).
`/idle` says whether the timer is armed or which condition keeps it off
(environment, model API, context size, no request since start or `/reload`),
with the context, threshold and cache expiry behind it.

| Variable | Effect |
|---|---|
| `PI_IDLE_COMPACT=0` | turns idle compaction off |
| `PI_IDLE_COMPACT_MIN_TOKENS` | context size that arms the timer (default 200000) |
| `PI_IDLE_COMPACT_MIN_PERCENT` | share of the window that arms it when smaller (default 50) |
| `PI_IDLE_COMPACT_DELAY_MS` | replaces the 54-minute wait (for testing) |
| `PI_COMPACTION_DEBUG=<file>` | logs why each replay ran or was skipped |

## Why long cache retention matters

A day-long trace of Copilot Claude requests (October 2026) found 30% of
spend going to cache misses. Most came from sessions without
`PI_CACHE_RETENTION=long`: their 5-minute caches expired, and Copilot's
Vertex backend also evicted them early. With an identical prefix seconds
apart, mid-session requests missed 10% of the time on 5-minute retention
against 1% on 1-hour. The rest came from a system prompt that changed
(a `/reload` after editing extensions, or a mode that adds or removes part
of the prompt), changing the thinking effort mid-session (only system and
tools stay cached), and idling for more than an hour.
