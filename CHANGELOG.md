# Changelog

## 0.2.1 — 2026-10-16

### Fixed

- scheduler: a task whose pi failed before reading its prompt was reported as "could not send the prompt" (the broken pipe) instead of pi's own error, depending on which landed first. pi's exit code and stderr now win; the broken-pipe error still catches a pi that exits 0 without its prompt. This also made two scheduler tests flaky in CI; a new test reproduces the race deterministically.

## 0.2.0 — 2026-10-16

### Breaking

- **Each extension is a folder.** `extensions/<name>.ts` moved to `extensions/<name>/index.ts`, and opt-ins to `extensions/opt-in/<name>/index.ts`. `web-providers/` and `web-fetch-resilient/` are now `web/providers/` and `web/fetch/`. pi lists extensions by folder name (`canvas`, not `canvas.ts`), so a settings filter like `-extensions/foo.ts` needs updating.
- **approval-guardian is opt-in.** It was on by default, a fail-closed gate nobody had set up. Turn it on with `/boehsline enable approval-guardian`.
- **start_goal, provider_usage and agent-link are deferred tools.** They aren't declared to the model until `tool_search` finds them (agent-link switches itself on for an `@name` or a message from another session). `/goal`, the footer chips and `@name` work as before.
- Only agent-link's `pi-agent-link` skill ships; `grok-bot-pi-link` drove a personal phone bridge.

### Added

- **`/boehsline` menu**, like `/footer`: toggle opt-in extensions (saved, with one reload, when it closes), apply the default keybindings, see which bundled packages loaded with their versions, and show the merged config. The subcommands still work, and without a UI it prints text.
- **`/boehsline defaults`** shows Boehsline's keybindings ([`defaults/keybindings.json`](defaults/keybindings.json)) as a diff against yours and merges them after you confirm. It moves pi's own Ctrl+S and Ctrl+R actions to Alt, so stash and prompt-history stop colliding with them. A startup hint names the conflict until it's resolved.
- **A README beside every extension**, with the detailed docs that used to live in dotfiles (VA specifics replaced by settings). The root README is an index of them, and `test/readmes.test.mjs` keeps it that way.
- **Benchmarks:** [`docs/benchmarks.md`](docs/benchmarks.md) and `scripts/bench.mjs` measure startup time and starting context against stock pi, overall or one extension at a time (`--each`).
- `canvas:put` event so other extensions can post canvas sections.
- footer and provider-usage: Copilot's allowance per workday (↓%/d) and a days-off row in `/footer`.

### Changed

- **Smaller starting context: +2,779 tokens over stock pi, down from +4,597.**
  - canvas: ~1,200 fewer tokens. Each kind was described twice (in the tool and in the "lightest kind" guideline); one line per kind now carries both, and `kind` is a plain string enum. No kind, field or rule dropped.
  - start_goal, provider_usage and agent-link deferred (~610 tokens). `lib/tool-search.ts` keeps `tool_search` on for any extension with a deferred tool.
- **Faster startup: +100ms over stock pi, down from +144ms.** `session_start` work across all extensions went from 83ms to 7ms:
  - agent-link binds its socket and probes peers in the background instead of before the prompt shows (~60ms with a dozen sessions open).
  - bg prunes old logs asynchronously, after boot.
  - tmux-attention stamps its pane a second after boot.
- `npm test` and CI also run the goal and scheduler package tests (190 more), plus new smoke tests for code-lint, image-preview, omlx, sc and update. 881 tests.

### Fixed

- `/boehsline enable` and `/boehsline defaults` write through a symlinked `boehsline.json` or `keybindings.json` instead of replacing the link.
- `boehsline.json` is found in `PI_CODING_AGENT_DIR`.
- bg's `bash` returns `structuredContent` for codemode scripts.
- bg's tests no longer leave temp directories behind.

## 0.1.0 — 2026-10-16

First release: Eric's pi extensions in one package. Core extensions (canvas, footer, compaction, web, bg, ask, next-steps and more), opt-ins gated by `boehsline.json` (watch, meeting, omlx, sc, tmux-attention, update, wiki-session-log), layered config with package-supplied settings, and pi-context, pi-scheduler, pi-agent-link, pi-approval-guardian and pi-goal bundled as git subtrees.
