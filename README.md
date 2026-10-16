# Boehsline

> The baseline for [pi](https://pi.dev). *(Say "bays-line.")*

Boehsline is Eric Boehs's pi setup, packaged so anyone can install it: extensions, skills, prompts, a theme, and opinionated defaults, all in one package.

**Status:** early. The contents are moving in from separate repos and dotfiles.

## Install

```bash
pi install git:github.com/ericboehs/pi-boehsline
```

## Opt-in extensions and config

Some extensions are off until you turn them on:

```
/boehsline                  list opt-in extensions and whether each is on
/boehsline enable <name>    turn one on (writes ~/.pi/agent/boehsline.json, then reloads)
/boehsline disable <name>
/boehsline config           the merged config, and where each value came from
```

Settings come from three layers, each overriding the one before:

1. Defaults written in each extension's code.
2. Other packages that supply settings. A private companion package can supply work-specific settings this way.
3. Your `~/.pi/agent/boehsline.json`. See [`defaults/boehsline.json`](defaults/boehsline.json) for a sample.

To turn off a core extension, use pi's own tools: `pi config`, or a filter on the package entry in `settings.json`.

### Supplying settings from another package

A package doesn't need to import Boehsline. Its extension adds its settings to a shared registry on `globalThis`, and the packages can load in either order:

```ts
const key = Symbol.for("boehsline.config.sources");
((globalThis as any)[key] ??= new Map()).set("my-package", { watch: { workspaces: ["acme"] } });
```

Only your own file can turn opt-in extensions on. A package can supply settings but can't enable anything.

## Bundled packages (git subtrees)

`packages/` holds the repos that used to ship on their own. Each is a git subtree with its full history, and stays verbatim so pulls apply cleanly. The root `package.json` lists their entry files.

| Folder | From | Upstream (forks) |
|---|---|---|
| `packages/context` | ericboehs/pi-context | |
| `packages/scheduler` | ericboehs/pi-scheduler | |
| `packages/agent-link` | ericboehs/pi-agent-link | alonw0/pi-claude-link |
| `packages/approval-guardian` | ericboehs/pi-approval-guardian | mics8128/pi-approval-guardian |
| `packages/goal` | ericboehs/pi-goal | |

Remotes aren't stored in git. Set them up once per clone:

```bash
git remote add agent-link-upstream https://github.com/alonw0/pi-claude-link.git
git remote add approval-guardian-upstream https://github.com/mics8128/pi-approval-guardian.git
```

Pull upstream changes into a subtree:

```bash
git subtree pull --prefix=packages/approval-guardian approval-guardian-upstream main
```

Change subtree code directly in this repo. If you want a change to go back upstream, `git subtree split --prefix=packages/<name>` produces a branch you can open a PR from.

See [NOTICE](NOTICE) for credits and licenses.

## Development

```bash
npm install
npm run typecheck              # links the pi you run (mise/npm -g); CI pins PI_VERSION
npm test                       # node --test (Node >= 22.18)
pi -ne -e .                    # try the working tree without your installed extensions
scripts/sync-dotfiles.sh       # pull new dotfiles commits for moved extensions (until the switch)
```

## License

MIT. See [LICENSE](LICENSE). Code adapted from other projects keeps its original notices; see `NOTICE` (coming soon).
