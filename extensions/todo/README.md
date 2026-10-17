# todo

A shared task list for you and any number of pi agents in a project. **Tool:** `todo`. **Command:** `/todo`.

- The list is a markdown checklist at `.pi/TODO.md` (`PI_TODO_FILE`, relative to the project, overrides). Edit it by hand any time: `[ ]` open, `[/]` claimed, `[x]` done, `[!]` blocked, `[-]` dropped, `[@name]` owner, `[blocked: why]` note.
- Agents use the `todo` tool: `list`, `add`, `claim`, `release`, `done`, `block`, `drop`, `edit`. A claim is a locked compare-and-set, so two agents can never both own a task; a task someone else owns stays locked unless the user asks for `force`.
- `/todo` shows the list. `/todo add <text>`, `claim|release|done|drop|rm <id>`, `block <id> <why>`, `edit <id> <text>`, `assign <id> <name|->`, `clear`, `hide`/`show` (the line above the editor), `path`. Your actions always win.
- One static line above the editor while tasks are open: progress, who has what, how many are blocked. No spinner, no reminders.
- Agents are `pi-<last 4 of the session id>` (`PI_TODO_AGENT` overrides); you are your OS username (`PI_TODO_USER`).
- Nothing is written until a task is added: projects without a `.pi/TODO.md` stay untouched.
