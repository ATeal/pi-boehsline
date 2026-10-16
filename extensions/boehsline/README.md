# boehsline

Shows and changes what Boehsline loads. **Command:** `/boehsline`.

`/boehsline` alone opens a menu:

- **Opt-in extensions**, each on or off. Toggles are saved together, with one reload, when you close the menu (Esc). Toggling a row back to where it started isn't a change.
- **Default keybindings**: how many of Boehsline's are missing from your `keybindings.json`. Enter shows the diff and merges after you confirm.
- **Bundled packages**: which of the `packages/` subtrees loaded this session, with versions and the commands each registered.
- **Merged config**: the merged settings, and where each layer comes from.

Subcommands do the same without the menu:

```text
/boehsline enable <name>        turn an opt-in on (writes boehsline.json, reloads)
/boehsline disable <name>       turn it off
/boehsline config               merged config, then each source, then your file
/boehsline defaults [--force]   merge defaults/keybindings.json into keybindings.json
```

`defaults` only adds keys you haven't set; `--force` also replaces yours. Both writes go through a symlink rather than replacing it, so a dotfiles-managed file stays linked.

While Boehsline's Ctrl+S ([stash](../stash/README.md)) or Ctrl+R ([prompt-history](../prompt-history/README.md)) still collide with pi's own bindings, a one-line hint at startup says so.

Core extensions are turned off with pi's own tools (`pi config`, or a filter on the package entry in `settings.json`), not here. See the root [README](../../README.md#opt-in-extensions-and-config) for the config file and how other packages supply settings.
