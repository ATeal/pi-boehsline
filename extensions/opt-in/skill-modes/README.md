# skill-modes

*Opt-in:* `/boehsline enable skill-modes`.

Sticky skill modes, the way Cursor runs them. A skill with `mode: true` in its frontmatter stays on once you invoke it with `/skill:<name>`. While it's on, every run gets one short system prompt section with the skill's `reminder:` line and where its SKILL.md lives. The model reapplies the skill to new tasks without reloading the whole body, and rereads SKILL.md after compaction when the reminder applies.

```
/mode             list active modes
/mode off         leave every mode
/mode off <name>  leave one mode
```

A skill opts in through frontmatter:

```yaml
---
name: poteto-mode
mode: true
reminder: Apply poteto-mode's review checklist before calling a task done.
icon: crown     # footer badge: crown, star, bolt, flame, sparkles (else ◆)
color: yellow   # yellow/orange, red, green, blue/cyan/purple
---
```

Modes are saved in the session, so they survive `/resume`, `/tree`, `/fork`, `/reload` and compaction. The footer shows a badge per active mode. The prompt section stays the same while a mode is on, so it doesn't break the prompt cache, and it's absent when no mode is on. A `/skill:` sent mid-stream takes effect on the next run. SKILL.md files are never edited.

Built for pstack's `/poteto-mode`, but any skill with `mode: true` works, including ones pstack's `/automate-me` writes.
