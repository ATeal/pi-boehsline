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

## Development

```bash
npm test             # node --test (Node >= 22.18)
npm run typecheck    # needs: npm install --no-save typescript@5 @types/node @earendil-works/pi-coding-agent @earendil-works/pi-tui typebox
pi -e .              # try the working tree in a session
```

## License

MIT. See [LICENSE](LICENSE). Code adapted from other projects keeps its original notices; see `NOTICE` (coming soon).
