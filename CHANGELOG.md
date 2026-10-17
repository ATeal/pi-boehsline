# Changelog

## Unreleased

- **CI checks the context budget.** `node scripts/bench.mjs --check docs/benchmarks.md` measures starting context offline (a stand-in model, nothing sent) and the `context-budget` job fails if it's more than 10% over the documented number. `scripts/bench.mjs` gains `--offline`, `--context-only`, `--check` and `PI_BIN`.
- One `lib/tool-search.ts` helper for every extension with a deferred tool (agent-link and goal had their own copies), and `test/deferred-tools.test.mjs` checks every deferred tool in the manifest stays reachable with subagent turned off.
- aa-info: reads every page of Artificial Analysis's free `language/models/free` endpoint and nothing else. The legacy `/api/v2/data/llms/models` it read quality, speed and rates from retires on 2026-11-04. The old code read only page 1 of the cost endpoint, so $/task now covers every model AA has priced, not just the first 200 rows. `$/1M` is computed as AA's 3:1 blend; Kimi models count as Moonshot for the peer line.
- aa-info: a failed refresh backs off instead of retrying on every model switch. It's recorded in the cache as `retryAt`, so every pi sharing the cache holds off for an hour (or a 429's `Retry-After`, if longer), and briefings keep coming from the stale snapshot rather than going blank.
- footer: `~` for the home directory, and an optional `dirNames` map in `footer.json` that renames the directory chip per folder (`""` hides it). Rows in `/footer` that configure a chip are indented under it, and the list shows up to 22 rows.
- footer: a "Provider/Model/Thinking condition" under each of those chips; "unless default" hides the chip while it matches settings.json's `defaultProvider`, `defaultModel`, or the level the model starts on (its `modelThinkingLevels` entry, else `defaultThinkingLevel`).
- agent-link removes its `~/.claude/sessions/<pid>.json` on a hard exit too, not only on `session_shutdown`. Print-mode runs that `process.exit` (such as `scripts/bench.mjs`) leaked one file each, and a later process reusing the pid showed it as its session name; the footer now also ignores a registry file older than its process.
- footer: a `mini` mode for the Rate limits chip, just `↑` speed up or `↓` slow down from the worst window's pace on a green or yellow/orange/red ladder, hidden on pace. Clicking cycles compact → detailed → mini. A "Usage condition" row hides the chip by pace in any mode (`unless on pace`, `when > 10 ahead`, `when > 20 ahead`); a limit always shows. `/footer` supports several setting rows per chip.
- footer: the git chip lost its dirty marker (and "unless clean default" stopped working) in repos where `git status` took over 1s, such as dotfiles with 4 submodules: the timeout blanked the state. A timeout or failed spawn now keeps the last state, the limit is 3s, and status runs with `--ignore-submodules=dirty` (1.6s → 0.5s in dotfiles).
- footer: a "Usage pace" row under Rate limits. `on` adds each window's pace after its % (`↓8` ahead, `↑12` behind, nothing within ±5) in compact and detailed, and points to mini (`↓8`).
- provider-usage: Copilot's per-workday allowance reads `4.3%/d`, without the `↓` that now means "slow down" in the footer.

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
