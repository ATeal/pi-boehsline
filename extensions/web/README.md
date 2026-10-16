# web

Web search and fetching. **Tools:** `web_search`, `web_fetch`. **Command:** `/web` (pick backends and test them).

- **Search** runs through a chain of backends you order (Brave, Tavily, Exa, and others), with cool-off after errors and a per-call cost label. Details, evals and setup: [`providers/README.md`](providers/README.md).
- **Fetch** escalates until a page comes back readable: plain HTTP, curl, headless Chrome, hosted services, then Safari. YouTube links return the transcript. Details: [`fetch/README.md`](fetch/README.md).

API keys come from the environment, then the secret command (`secrets.command` in `boehsline.json`, `fnox get` by default). Backend order and options live in `web.json` in the agent directory (`/web` edits it).

Headless Chrome uses `playwright-core` (a dependency of Boehsline) with your installed Chrome. `OBSCURA_BIN` points the optional Obscura tier at its binary.
