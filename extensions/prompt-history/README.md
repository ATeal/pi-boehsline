# prompt-history

Shell-style prompt history shared by every pi on the machine. **Keys:** Up walks history; Ctrl+R searches it.

pi's own history lives in memory and is gone when pi exits. This works like bash's `HISTFILE`: every prompt is appended to one file, and each new editor starts from its tail, so Up reaches prompts typed in other panes, other repos and yesterday's sessions.

```text
${PI_CODING_AGENT_DIR:-~/.pi/agent}/prompt-history.jsonl
{"t":1764259200000,"cwd":"/Users/x/Code/foo","s":"01JD…","text":"fix the flaky test"}
```

- **Nearest first:** Up walks this session's prompts, then this project's, then the machine's.
- **Live:** the first Up of a browse picks up prompts appended since boot (a `stat`, and a read only if the file grew), so another pane's prompts show up here.
- **Fast:** reading the last 256 KB of one file takes about 1 ms and doesn't grow with your session logs; mining session files instead costs hundreds of milliseconds at startup.
- **Ctrl+R** opens a list that matches literally, like bash's reverse-i-search but showing several hits at once.

pi also binds Ctrl+R (rename session). Run `/boehsline defaults` to move pi's to Alt+R.
