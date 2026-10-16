# openrouter-route

Names the upstream provider OpenRouter routed each turn to, in the [footer](../footer/README.md)'s model chip.

The model chip names the upstream provider OpenRouter picked: `or novita/oxa`,
`or z/oxa`, `or modal/oxa`. OpenRouter reports the decision in
`openrouter_metadata`, opted into per request with `X-OpenRouter-Metadata:
enabled`, and delivers it in the response *body* — the last SSE chunk before
`[DONE]`. pi hands extensions only status and headers
(`after_provider_response`), so this extension wraps
`globalThis.fetch` instead: pi-ai builds its OpenAI client per request and
resolves fetch through the SDK's `getDefaultFetch()`, which reads the current
global. The wrapper adds the header, streams the body through a pass-through
transform that watches for the metadata line, and stashes the selected provider
for the footer. Non-OpenRouter requests, error responses and empty bodies are
handed back untouched.

The documented alternative costs an API call per turn: pi records OpenRouter's
generation id on the assistant message as `responseId`, and
`GET /api/v1/generation?id=` reports `provider_name`. Cache hits never carry
routing data either way, so the chip keeps the last known route for the model.
