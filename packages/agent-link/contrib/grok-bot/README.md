# grok-bot-peer

Standalone Claude / pi-agent-link peer daemon so **Grok Bot** shows up in
`pi-link list` (and Claude `/list-agents`) on the Mac where Pi runs and can receive Pi → Grok
messages.

## Install

From a clone of [pi-agent-link](https://github.com/ericboehs/pi-agent-link):

```bash
ln -sf "$PWD/contrib/grok-bot/pi-link" ~/bin/pi-link
ln -sf "$PWD/contrib/grok-bot/grok-bot-peer" ~/bin/grok-bot-peer
# ensure ~/bin is on PATH
```

Grok Bot skill (copy into a bot's workflows, or import via bot template):
`skills/grok-bot-pi-link/SKILL.md`

Unix sockets cannot live inside Grok Bot's Linux VM, so this daemon **must run on the Mac where Pi runs**.

## Quick start

```bash
grok-bot-peer start --background   # or: grok-bot-peer start  (foreground)
grok-bot-peer status
pi-link list                       # should include name=grok-bot
grok-bot-peer inbox
grok-bot-peer stop
```

## Wake Grok Bot (webhook — not polling)

Routine: **Pi peer inbound** (`pi-peer-inbound`).

1. Open Grok Bot → conversation details → Routines → **Pi peer inbound**.
2. Copy **POST to** (URL) and **key** (sender key). Never paste the key in chat.
3. Write `~/.local/share/grok-bot-peer/webhook.env` (mode `600`):

   ```bash
   cp ~/.local/share/grok-bot-peer/webhook.env.example \
      ~/.local/share/grok-bot-peer/webhook.env
   chmod 600 ~/.local/share/grok-bot-peer/webhook.env
   # edit: set GROK_BOT_WEBHOOK_URL and GROK_BOT_WEBHOOK_KEY
   ```

   Or `webhook.json`:

   ```json
   {
     "GROK_BOT_WEBHOOK_URL": "https://…",
     "GROK_BOT_WEBHOOK_KEY": "crsr_…"
   }
   ```

4. Restart the peer: `grok-bot-peer stop && grok-bot-peer start --background`

On every inbound peer message (after `inbox.jsonl` append), the daemon POSTs:

```json
{
  "source": "grok-bot-peer",
  "msg_id": "…",
  "from": "uds:/tmp/cc-socks/….sock",
  "from_name": "…",
  "mode": "ask",
  "body": "…",
  "received_at": "2026-09-27T11:38:00-05:00"
}
```

**Headers sent** (docs say `Authorization: Bearer <key>`; extras for compatibility):

- `Content-Type: application/json`
- `Authorization: Bearer <GROK_BOT_WEBHOOK_KEY>`
- `X-Automation-Key: <key>`
- `X-Webhook-Key: <key>`

If the gateway only accepts one of these, trim in a follow-up after the first
test (check `webhook.log` and the routine Run history). A **200** means the run
started, not that Grok finished.

Webhook POSTs are **fire-and-forget** (8s timeout, background thread) so a slow
or down webhook never stalls the UDS accept loop. Failures go to
`~/.local/share/grok-bot-peer/webhook.log` (never logs the key).

If `webhook.env` / `webhook.json` is missing, messages still land in
`inbox.jsonl`; startup logs a one-line hint. **No polling routine.**

## Data layout

| Path | Purpose |
|------|---------|
| `inbox.jsonl` | Append-only inbound (+ outbound reply audit) |
| `pending/<msg_id>.json` | Unanswered `ask`s |
| `webhook.env` / `webhook.json` | Optional wake credentials (chmod 600; never commit) |
| `webhook.log` | Wake attempt results (no secrets) |
| `daemon.pid` / `daemon.log` | Background lifecycle |
| `~/.claude/sessions/<pid>.json` | Mesh registry (`name=grok-bot`) |
| `/tmp/cc-socks/<pid>.sock` | Live messaging socket (`0600`) |

## Ask behavior

- Plain `send` → inbox + webhook wake; delivery receipt.
- `ask` → also `pending/<msg_id>.json`, status `thinking`. Sender **blocks until**:

  ```bash
  grok-bot-peer reply <msg_id> Your answer here
  ```

  or their ask timeout (~120s). Daemon does not invent answers.

## Optional LaunchAgent

Sketch: `~/Library/LaunchAgents/com.ericboehs.grok-bot-peer.plist`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.ericboehs.grok-bot-peer</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Users/ericboehs/bin/grok-bot-peer</string>
    <string>start</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key>
  <string>/Users/ericboehs/.local/share/grok-bot-peer/daemon.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/ericboehs/.local/share/grok-bot-peer/daemon.log</string>
</dict>
</plist>
```

`launchctl load ~/Library/LaunchAgents/com.ericboehs.grok-bot-peer.plist`
