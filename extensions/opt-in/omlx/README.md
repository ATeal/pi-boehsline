# omlx

*Opt-in:* `/boehsline enable omlx`.

Adds every model your local oMLX (an OpenAI-compatible MLX server) server has loaded to `/model`.

- On startup and `/reload`, it asks the server's `/v1/models` what's loaded. Models without a context length (utility models) are skipped.
- Each model's `config.json` under the model folder fills in the real context window, vision support and whether it reasons; otherwise the server's numbers and the model's name decide.
- Reasoning models get Qwen-style thinking control (`enable_thinking`), mapped to pi's thinking on and off.
- A server that hasn't answered in 750 ms is skipped, so a hung server can't hold up startup; `/reload` tries again.

| Variable | Default |
|---|---|
| `OMLX_BASE_URL` | `http://localhost:8000/v1` |
| `OMLX_MODEL_DIR` | `~/.omlx/models` |
