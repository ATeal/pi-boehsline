# update

*Opt-in:* `/boehsline enable update`.

`/update` for a pi that mise installs from a pin, which `pi update` refuses to touch. **Command:** `/update [check]`.

The work is a mise task you own (default `update:pi`): move the pin to the latest release, install it, then update packages. `/update` finds the project that holds the pin and runs that task; `/update check` reports the available version and changes nothing.

It also replaces pi's startup "Update Available" banner, whose only advice is `pi update`, with one that names `/update`. The check runs at most every 6 hours, shared across sessions through `update-check.json` in the agent directory.

```jsonc
// ~/.pi/agent/boehsline.json
{ "update": { "dir": "~/dotfiles", "task": "update:pi" } }
```

With no `dir`, the project is the git checkout that `~/.config/mise/config.toml` lives in (or links into). The task must print the JSON result line the extension parses, and change nothing when `PI_UPDATE_CHECK=1`. `PI_OFFLINE` turns the startup check off.
