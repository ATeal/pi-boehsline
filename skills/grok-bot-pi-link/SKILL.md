---
name: Pi link
description: >-
  Use when the user asks to talk to, list, send a prompt to, or read a reply
  from a live Pi coding-agent session in tmux on their Mac (phone→Grok→Pi,
  pi-link, agent-link, grok-bot-peer).
---
# Pi link

Drive **existing** Pi coding-agent sessions on the user's Mac so model work stays
on Pi's configured providers (OpenAI, Ollama, opencode-go, etc.) and does **not**
burn Grok API quota.

## Prerequisites

1. [pi-agent-link](https://github.com/ericboehs/pi-agent-link) installed in Pi.
2. Helpers from this repo on the Mac PATH (symlink or copy):
   - `contrib/grok-bot/pi-link`
   - `contrib/grok-bot/grok-bot-peer` (optional — only if Pi should message Grok Bot back)
3. Grok Bot local execution enabled for that Mac (`ListMachines` → Shell with its `machineId`).
4. Optional inbound wake: a Grok Bot **webhook** routine (e.g. "Pi peer inbound") plus
   `~/.local/share/grok-bot-peer/webhook.env` — see `contrib/grok-bot/README.md`.

Run every `pi-link` / `grok-bot-peer` command with Shell on the user's Mac
(`machineId` from `ListMachines`).

## Timing (important)

Pi replies are **not instant**. After `pi-link send` or `pi-link ask`, the live
session typically needs **about one to two minutes** (sometimes longer).

- Tell the user once that the message is in and you're waiting for Pi.
- Then **wait for the session's reply to land on its own** (`pi-link ask` blocks
  until then, or read the settled pane / session JSONL).
- **Do not poll** status in a chatty loop, and **do not re-announce** "still
  thinking…" / progress updates while waiting.
- Only speak again when you have the reply (or a real failure / timeout).

## Do / don't

- **Do** inject via pi-agent-link sockets (`pi-link send` / `pi-link ask`).
- **Do** prefer idle peers; refuse busy ones unless the user says `--force` /
  "inject anyway".
- **Don't** use `tmux send-keys` except as a last resort on a clearly idle
  disposable pane (Quick-select / mid-tool / editor will mis-key).
- **Don't** send model work into panes that are on a Grok/`xai` provider when the
  goal is saving Grok quota — check the pane footer / ask the user; prefer
  non-Grok peers or a dedicated phone window.
- **Don't** change Pi configs or providers without asking.

## Commands

```bash
pi-link list
pi-link send <name|pid|tmux> <message...>
pi-link ask  <name|pid|tmux> <message...>   # waits for reply
pi-link ask  <target> --timeout 180 -- <message...>
pi-link capture <tmux-target>
```

Examples:

```bash
pi-link list
pi-link ask tmux-pi-prefill 'Reply with one sentence: what branch are you on?'
pi-link send tmux-pi-prefill 'Ping — no tools, just ack.'
pi-link capture code:8.0
```

`ask` tries ask-mode socket relay first, then falls back to `tmux capture-pane`.
`send` is fire-and-forget.

## Steps when the user asks

1. `pi-link list` — show name, pid, status, tmux target, cwd.
2. Pick the target they named, or an idle disposable pane. If several match, ask once.
3. If status isn't `idle`, warn and only continue with explicit OK / `--force`.
4. For a question that needs an answer: `pi-link ask …` (expect ~1–2 minutes;
   follow Timing above). For a nudge: `pi-link send …`, then optionally
   `pi-link capture <tmux>` after it settles — still no mid-wait chatter.
5. Reply with the Pi answer (or confirmation of send).

## Background (why this path)

- Live peers register under `~/.claude/sessions` and listen on
  `/tmp/cc-socks/<pid>.sock` (pi-agent-link).
- `pi -p` / `pi --mode rpc` start **new** processes — fine for disposable jobs,
  not for attaching to an existing TUI session.
- Unix sockets cannot live inside Grok Bot's Linux VM, so **`grok-bot-peer` must
  run on the Mac** if Pi needs to reach Grok Bot as a named peer.
