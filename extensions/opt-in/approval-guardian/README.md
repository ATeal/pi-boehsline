# approval-guardian

*Opt-in:* `/boehsline enable approval-guardian`.

A fail-closed approval gate for tool calls: risky calls wait for a reviewer model, or for you. **Command:** `/approval-guardian`.

This folder is only a wrapper. The guardian itself is [`packages/approval-guardian`](../../../packages/approval-guardian/README.md), a git subtree of [pi-approval-guardian](https://github.com/ericboehs/pi-approval-guardian) (itself a fork of [mics8128/pi-approval-guardian](https://github.com/mics8128/pi-approval-guardian), MIT). Its README covers the rules, the reviewer and the config file.

It's opt-in because once it's on, risky calls block until reviewed; someone who just installed Boehsline shouldn't find that switched on. After enabling, run `/approval-guardian` to set it up. The [footer](../../footer/README.md)'s `/bypass` turns its bypass on or off.

The wrapper loads the package with a dynamic import, so while it's off nothing of the guardian loads at all.
