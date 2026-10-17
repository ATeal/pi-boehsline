# footer

A lean status line. **Commands:** `/footer` (choose and order chips; Alt+S
saves), `/boot` (startup timing), `/bypass` (the approval guardian's bypass).
Quota chips come from [provider-usage](../provider-usage/README.md); the
OpenRouter route from [openrouter-route](../openrouter-route/README.md).

Renders the status line (dir, provider, model, git, context/cost, provider
quota chips, boot time) plus `/bypass`, `/boot` and `/footer`.

`/footer` opens a checklist of the chips in footer order, each with its live
value; the selected row's description says what it shows and what a click
does. Enter or Space cycles the row's value: `shown`/`hidden`, or for chips
with display modes, each mode then `hidden` (Directory name/full path, Git
full/branch, Context tokens/percent, Idle compaction clock/countdown, Cost and
Rate limits compact/detailed, Token rate number/with TTFT). A Git condition
row under Git can hide the branch on a clean default branch (origin/HEAD's,
else main or master) with nothing to push or pull. A Context
threshold row under Context hides that chip until the context passes 50k,
100k or 200k tokens, or 25%, 50% or 75% of the window. `j`/`k` move the
selection; `J`/`K` or Shift+↑/↓ move the chip itself (the session name and the
status row stay put). While the list is open the real footer is the preview:
the selected chip blinks underlined, the rest go faint gray, hidden chips show
struck through, and a chip with nothing to show right now stands in with an
example.

Changes apply to the current session only, and a warning under the list says
so until Alt+S saves them to `footer.json` in the agent directory, defaults
left out:

```json
{ "hidden": ["boot"], "modes": { "context": "percent" }, "order": ["git", "dir", "..."] }
```

The directory chip shows the folder's name, or `~` at home. To rename or hide
it in particular folders, add `dirNames` to `footer.json` by hand (exact
directories, `~` allowed; an empty name hides the chip; the full-path mode
ignores it). `/footer` keeps it when it saves:

```json
{ "dirNames": { "~/Code/dotfiles": ".", "~/Documents/Notes": "" } }
```

Settings that belong to a chip sit indented under it: Git condition, Context
threshold, Copilot OOO days, and a condition each for Provider, Model and
Thinking. Set those to "unless default" to hide the chip while it matches the
`defaultProvider` or `defaultModel` a new session starts on, or the thinking
level this model starts on: its `modelThinkingLevels` entry, else
`defaultThinkingLevel`, else pi's `medium` (settings.json, a project's
`.pi/settings.json` first). Switching away shows it again.

Reopening `/footer` keeps the session's unsaved changes; a new session starts
from the saved file. A saved mode is where each session starts; clicking a chip
still flips it, for that session only. Chips added later start shown, in their default mode, after
the ones the file orders. `/footer off` and `/footer on` switch the whole
footer for this session. Click zones are keyed by chip id, so hiding or moving
a chip never breaks the others' clicks.

It also watches
pi's on-disk version: when an install lands while instances are running — via
`pi update`, `npm i -g`, anything — each running footer shows a green, right-aligned
"Update installed v0.52.1 → v0.53.0 · Restart to update" line above the prompt
within ~30s, like Claude Code.

If you keep a `~/bin/pi-bundle` (a script that prebuilds pi into one file for
faster launches), the same detection runs it in a detached background process,
since an update leaves the bundle stale. Concurrent pi instances serialize on a
lock directory; output lands in `~/.pi/agent/auto-bundle.log`. Without the
script this does nothing; `PI_NO_AUTO_BUNDLE=1` opts out.

## Boot timing

Every cold start is appended to `boot-times.jsonl` with the gap back to the
previous launch and the 1-minute load average, and `/boot stats` reports the
two cohorts separately. This is not decoration: relaunching pi a few times in a
row boots ~350ms faster than a one-off launch, purely from a warm page cache
and an idle machine. Measured on one machine, same commit, minutes apart:

| launch | gap since previous | boot |
| --- | --- | --- |
| one-off | 743s | 972ms |
| relaunch | 13s | 600ms |
| relaunch | 6s | 607ms |

That spread is wider than most changes worth measuring, so an undivided p50
mostly reports how you happened to be using pi that day — and a benchmark burst
sitting next to real launches reads as a regression that was never there.
Compare cohort to cohort.
