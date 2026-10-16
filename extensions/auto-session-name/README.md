# auto-session-name

Names a fresh session after its first turn, unless you already named it. **Command:** `/auto-name` (regenerate now).

- `--name` and `/name` always win, and a resumed session is never renamed automatically.
- Names that look like agent-link's derived peer ids (`pi-myrepo`, `pi-myrepo-2`) count as unnamed, so they still get a real title.
- One cheap call to a fast model, trying a short list in order until one answers; a 402 or quota error just moves to the next.

| Variable | Effect |
|---|---|
| `PI_AUTO_NAME=0` | turns it off |
| `PI_AUTO_NAME_MODEL=provider/id[,provider/id…]` | the models to try, in order |
