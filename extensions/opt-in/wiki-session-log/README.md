# wiki-session-log

*Opt-in:* `/boehsline enable wiki-session-log`.

After each turn (and at shutdown), runs a command with this session's JSONL file, so an outside tool can mirror pi sessions into a wiki or notes folder. Like Claude Code's Stop hook: the extension knows nothing about the output, and the command reads the JSONL and writes what it wants.

```jsonc
// ~/.pi/agent/boehsline.json
{ "wiki-session-log": { "command": ["~/bin/pi-session-sync"] } }
```

- The session file is appended as the last argument. A leading `~` in the first argument expands.
- No command, no effect.
- Overlapping runs collapse into one trailing run, and a missing or failing command never takes pi down.

Prefer an absolute path to a bare name: pi may start from a GUI or a login shell without your bin folder on `PATH`, and a command that's silently not found looks just like one that works.
