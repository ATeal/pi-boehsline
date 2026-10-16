# Boehsline

> The baseline for [pi](https://pi.dev). *(Say "bays-line.")*

Boehsline is Eric Boehs's pi setup, packaged so anyone can install it: more than 30 extensions in one package, plus the skills that come with agent-link. Most extensions are on by default; the ones that only make sense with particular tools or habits are opt-in.

**Status:** early. The contents are still moving in from separate repos.

## Install

```bash
pi install git:github.com/ericboehs/pi-boehsline
```

## Extensions

Core extensions load by default. To turn one off, use `pi config` or add a filter to the package entry. Opt-in extensions stay off until you run `/boehsline enable <name>`.

### Core

#### ask
A minimal AskUserQuestion. **Tool:** `ask`. It offers 2–4 options per question, lets you pick several, and can ask several questions at once.

#### aa-info
Prints a one-line [Artificial Analysis](https://artificialanalysis.ai) briefing whenever you switch models: intelligence and coding scores at your thinking level, speed, price per 1M tokens, cost per task, and the closest peers. **Needs:** `ARTIFICIAL_ANALYSIS_API_KEY`, set in the environment or available from the secret command. Without a key it does nothing.

#### auto-session-name
Names the session after the first turn, unless you already named it. **Command:** `/auto-name`.

#### bg
Runs commands in the background through a `background` flag on the built-in `bash` tool. That costs about 55 tokens of context and registers no extra tools. Logs are plain files the model reads with `read`. **Command:** `/bg`.

#### canvas
A live local web page for each session, where the agent posts tables, charts, diffs, checklists, timelines and findings next to the terminal. **Tool:** `canvas`. **Command:** `/canvas`.

#### code-lint
Runs your configured linters after the agent's `edit` and `write` calls, and feeds any errors back to the model. Each project's config lives in `~/.claude/code-lint/<project-hash>/config.json`; [`/setup-lint`](https://github.com/ericboehs/agent-plugins) writes it. The Claude Code `code-lint` plugin runs the same `lint.sh`.

#### color
Tints this session's input border, like Claude Code's `/color`. **Command:** `/color [name|#rrggbb|0-255|auto|off]`.

#### compaction and compact-progress
Cheaper compaction. On Anthropic models it resends the last request with a "summarize" turn appended, so the history is billed as a cache read. When that can't work, it writes a plain-text summary with thinking turned down. Other models use pi's default compaction. With `PI_CACHE_RETENTION=long`, an idle session with a large context is compacted 54 minutes after its last request, while the cache is still warm. compact-progress shows progress while compaction runs. **Command:** `/idle` (whether idle compaction is armed).

#### context
`/context`, like Claude Code's: what fills the context window, broken down by source. *(Bundled from pi-context.)*

#### cursor-focus
Replaces pi's fake reverse-video prompt cursor with your terminal's real cursor.

#### footer
A lean status line: model, context use, git state, provider quota chips and the boot timer. **Commands:** `/footer` (configure; Alt+S saves), `/boot` (startup timing stats), `/bypass` (turn the approval guardian's bypass on or off).

#### goal
Work toward a goal until a `--check` command exits 0 (or a same-model judge agrees), or until the time or step budget runs out. The remaining budget is shown to the model after each tool call. **Command:** `/goal [--for 30m] [--steps N] [--check "cmd"] <objective>`. **Tool:** `start_goal`. *(Bundled from pi-goal.)*

#### image-preview
Viewing images inside tmux: `chafa` thumbnails for image reads in the transcript, plus a full-size popup. **Command:** `/preview`. **Needs:** `chafa`.

#### next-steps
When the assistant ends with a numbered "Next steps:" block, `/1`, `/2` or `/3` sends that option as your prompt.

#### openrouter-route
Shows which upstream provider OpenRouter actually routed each turn to, in the footer.

#### prompt-history
Shell-style prompt history shared by every pi session on the machine, searched with Ctrl+R. pi also binds Ctrl+R; run `/boehsline defaults` to move pi's to Alt+R.

#### provider-usage
Usage and quota chips in the footer for codex, copilot, grok, cerebras, opencode-go, baseten, openrouter and ollama. **Tool:** `provider_usage`. Credentials come from the environment or the secret command; ollama and opencode-go can also read Safari's session cookies.

#### stash
Stash a half-typed message with Ctrl+S, as in Claude Code, and get it back later. **Command:** `/stash`. pi also binds Ctrl+S; run `/boehsline defaults` to move pi's to Alt+S.

#### subagent
A minimal subagent tool that runs a separate pi process for a focused task. **Tool:** `subagent`.

#### turn-timer
A toast when a run ends, plus a rolling log of where each model's time goes. **Command:** `/turn`.

#### web
Web search and fetching. Search runs through a configurable chain of backends; fetching escalates from plain HTTP to curl, then headless Chrome, then hosted services, then Safari, and returns YouTube transcripts. **Tools:** `web_search`, `web_fetch`. **Command:** `/web` (pick backends and test them). API keys come from the environment or the secret command. See [`extensions/web-providers/README.md`](extensions/web-providers/README.md).

#### scheduler
Scheduled prompts. **Commands:** `/loop` and `/once` (for this session); `/schedule` (durable, run unattended by a launchd runner). *(Bundled from pi-scheduler.)*

#### agent-link
Lets pi and Claude Code sessions on the same machine talk to each other. Address a live session with `@name`; you can list sessions, send messages, ask and wait, and reply. **Command:** `/agent-link`. *(Bundled from pi-agent-link, a fork of [alonw0/pi-claude-link](https://github.com/alonw0/pi-claude-link).)*

#### boehsline
Shows and changes what Boehsline loads, and applies its default keybindings. **Command:** `/boehsline [enable|disable <name> | config | defaults [--force]]`.

### Opt-in

#### approval-guardian
A fail-closed approval gate for tool calls, with a guardian model that reviews risky calls. Opt-in because, once on, risky calls wait for review: set it up with `/approval-guardian` after enabling. **Command:** `/approval-guardian`. *(Bundled from pi-approval-guardian, a fork of [mics8128/pi-approval-guardian](https://github.com/mics8128/pi-approval-guardian).)*

#### watch
An in-session watcher for Slack, a team bot feed, and Mac and iPhone notifications. A small model sorts each new message into needs-you, context or drop. The top items show in a widget, and a digest arrives every 15 minutes. Work text goes only to the models you allow. It can offer drafts and, with tight limits, start a turn itself (meeting prep, drafts while you're away, urgent pings). **Commands:** `/watch` (start, stop, list, waits, digest, recap, mute and more). **Tool:** `watch_items`. **Settings:** `watch`, `work` (see below). **Needs:** [`slk`](https://github.com/ericboehs/slk) for Slack; `ical` for meeting prep; `qmd` for notes lookups. Notifications need macOS, `swiftc` and Full Disk Access for your terminal: `/watch start` builds `bin/notif-watch` from [`native/notif-watch`](native/notif-watch/notif-watch.swift) the first time (about 10 seconds).

#### meeting
A live meeting copilot. It follows a meeting transcript (`~/.local/share/meeting-capture/*.jsonl`, written by a separate capture tool) and suggests questions worth asking out loud, using only your work models. **Commands:** `/meeting`, `/q<N>` (research question N with a subagent). **Settings:** `meeting`, `work`.

#### omlx
Adds whatever models your local oMLX server (an OpenAI-compatible MLX server) has loaded to `/model`. **Env:** `OMLX_BASE_URL`, `OMLX_MODEL_DIR`.

#### sc
Attaches the newest file in iCloud Drive's Downloads folder. It's meant for handing off screenshots from an iPad while you're SSH'd in. **Command:** `/sc [instructions]`.

#### tmux-attention
Highlights the tmux window number when pi finishes or is waiting on you in a background window. **Needs:** a `pane-focus-in` hook in `~/.tmux.conf` that clears the window options `@special_activity` and `@job_done`.

#### update
`/update` for a pi that mise installs from a pin: it runs your mise task that moves the pin and reinstalls. `/update check` only reports. **Settings:** `update`.

#### wiki-session-log
Runs a command with the session's JSONL file after each turn, so an outside tool can mirror sessions into notes. **Settings:** `wiki-session-log`.

## Configuration reference

Everything below goes in `~/.pi/agent/boehsline.json`, or comes from a package that supplies settings. Environment variables (`PI_WATCH_*`, `PI_MEETING_*`) still override.

```jsonc
{
  "enable": ["approval-guardian", "watch", "meeting", "tmux-attention"],

  // Secret lookups after the environment. {name} is replaced, else appended. [] = env only.
  "secrets": { "command": ["fnox", "get"], "timeoutMs": 10000 },

  // Work routing for watch and meeting. With no providers, no model reads work text.
  "work": {
    "label": "Acme Copilot",
    "providers": ["github-copilot"],
    "models": ["github-copilot/<fast model>"],
    "researchModel": "github-copilot/<strong model>",
    "sensitive": "employee IDs, customer names",     // named in the scout prompt as never to repeat
    "ghHost": "github.acme.com",                      // research hint; "" for github.com only
    "redact": [{ "pattern": "\\bEMP\\d{6}\\b", "flags": "g", "replace": "[EMP]" }]  // also passed to notif-watch
  },

  "watch": {
    "workspaces": ["acme", "home"],
    "workWorkspaces": ["acme"],
    "feed": { "cli": "team-bot-feed", "workspace": "acme", "channel": "C0123", "label": "#bot-feed" },
    "vips": ["Sam Rivera"],
    "prepSources": ["Acme (Work)"],                   // ical sources that count as work
    "snowUrl": "https://acme.service-now.com",
    "personalModels": ["opencode-go/deepseek-v4.1-flash"],
    "dailyDir": "~/Notes/daily",                      // recap goes here; "" turns it off
    "notifBin": ""                                    // "" = Boehsline's build, else PATH
  },

  "meeting": { "qmdCollections": ["notes"], "dailyDir": "~/Notes/daily", "codeDir": "~/src" },
  "update": { "dir": "~/dotfiles", "task": "update:pi" },  // no dir: the checkout that holds ~/.config/mise/config.toml
  "wiki-session-log": { "command": ["~/bin/pi-session-sync"] }
}
```

## Default keybindings

`stash` and `prompt-history` use Ctrl+S and Ctrl+R, which pi also binds, so pi warns at startup until you pick. `/boehsline defaults` shows [`defaults/keybindings.json`](defaults/keybindings.json) as a diff against your `keybindings.json` and merges it after you confirm. It only adds keys you haven't set; `--force` also replaces yours. It moves pi's shortcuts to Alt+S and Alt+R and adds a few more opinionated bindings.

## Opt-in extensions and config

Some extensions are off until you turn them on:

```
/boehsline                  list opt-in extensions and whether each is on
/boehsline enable <name>    turn one on (writes ~/.pi/agent/boehsline.json, then reloads)
/boehsline disable <name>
/boehsline config           the merged config, and where each value came from
```

Settings come from three layers, each overriding the one before:

1. Defaults written in each extension's code.
2. Other packages that supply settings. A private companion package can supply work-specific settings this way.
3. Your `~/.pi/agent/boehsline.json`. See [`defaults/boehsline.json`](defaults/boehsline.json) for a sample.

To turn off a core extension, use pi's own tools: `pi config`, or a filter on the package entry in `settings.json`.

### Supplying settings from another package

A package doesn't need to import Boehsline. Its extension adds its settings to a shared registry on `globalThis`, and the packages can load in either order:

```ts
const key = Symbol.for("boehsline.config.sources");
((globalThis as any)[key] ??= new Map()).set("my-package", { watch: { workspaces: ["acme"] } });
```

Only your own file can turn opt-in extensions on. A package can supply settings but can't enable anything.

## Bundled packages (git subtrees)

`packages/` holds the repos that used to ship on their own. Each is a git subtree with its full history, and stays verbatim so pulls apply cleanly. The root `package.json` lists their entry files.

| Folder | From | Upstream (forks) |
|---|---|---|
| `packages/context` | ericboehs/pi-context | |
| `packages/scheduler` | ericboehs/pi-scheduler | |
| `packages/agent-link` | ericboehs/pi-agent-link | alonw0/pi-claude-link |
| `packages/approval-guardian` | ericboehs/pi-approval-guardian | mics8128/pi-approval-guardian |
| `packages/goal` | ericboehs/pi-goal | |

Remotes aren't stored in git. Set them up once per clone:

```bash
git remote add --no-tags agent-link-upstream https://github.com/alonw0/pi-claude-link.git
git remote add --no-tags approval-guardian-upstream https://github.com/mics8128/pi-approval-guardian.git
```

Pull upstream changes into a subtree:

```bash
git subtree pull --prefix=packages/approval-guardian approval-guardian-upstream main
```

Change subtree code directly in this repo. If you want a change to go back upstream, `git subtree split --prefix=packages/<name>` produces a branch you can open a PR from.

See [NOTICE](NOTICE) for credits and licenses.

## Development

```bash
npm install
npm run typecheck              # links the pi you run (mise/npm -g); CI pins PI_VERSION
npm test                       # node --test (Node >= 22.18)
npm run build:notif-watch      # macOS: build bin/notif-watch (watch does this on /watch start)
pi -ne -e .                    # try the working tree without your installed extensions
```

## License

MIT. See [LICENSE](LICENSE). Code adapted from other projects keeps its original notices; see [NOTICE](NOTICE).
