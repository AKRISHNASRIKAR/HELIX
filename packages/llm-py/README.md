# helix-llm (`helix_llm`)

Optional LLM client for HELIX agents. Every LLM use is optional: callers ask
for a JSON object matching a JSON schema, validate it, and fall back to their
rule-based path on any `LlmError`.

```python
from helix_llm import AnthropicLlm, FakeLlm, LlmClient, LlmError, llm_from_env

llm = llm_from_env()          # None when HELIX_LLM=off or ANTHROPIC_API_KEY is unset
data = await llm.complete_json(system="...", user="...", schema={...}, max_tokens=4000)
```

- `LlmClient` (Protocol): `model: str`, `async complete_json(*, system, user, schema, max_tokens=4000) -> dict`.
- `AnthropicLlm(*, model="claude-opus-5-5", api_key=None, effort="medium", fallbacks=True, timeout=60.0, max_retries=2, client=None)`:
  the official `anthropic` SDK (`AsyncAnthropic`). One Messages API request with
  structured outputs (`output_config={"format": {"type": "json_schema", "schema": ...}, "effort": ...}`),
  no `thinking` parameter (Claude Opus 5.5 always thinks adaptively). The first
  text block is parsed with `json.loads`. `stop_reason` `refusal` or
  `max_tokens`, API/connection errors and unparsable output raise `LlmError`.
  On models that support it the request opts into server-side refusal
  fallbacks (`fallbacks="default"`, beta `server-side-fallback-2026-07-01`,
  sent through `client.beta.messages.create`); `fallbacks=False` turns it off.
- `FakeLlm(responses=[...], responder=None, model="fake-llm")`: canned responses
  (an `Exception` item is raised), or a `responder(system, user, schema)` callable;
  records `calls`. For tests.
- `llm_from_env(env=None)`: reads `HELIX_LLM` (`auto` | `off`), `ANTHROPIC_API_KEY`,
  `HELIX_LLM_MODEL` (default `claude-opus-5-5`).

Uses `anthropic` 2.x (built on `httpx2`, not `httpx`). Tests never hit the
network: `AnthropicLlm` runs against `httpx2.MockTransport`.

## Development

```bash
pnpm --filter @helix/llm-py test   # or: bash ../../scripts/python-run.sh test
```
