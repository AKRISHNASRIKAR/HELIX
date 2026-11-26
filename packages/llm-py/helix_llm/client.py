"""LLM clients for HELIX agents.

Every LLM use in HELIX is optional: callers ask for a JSON object that matches
a JSON schema, validate it themselves, and fall back to their rule-based path
on any LlmError. Nothing here is required for an investigation to complete.

- LlmClient: the protocol callers depend on.
- AnthropicLlm: the Claude Messages API with structured outputs
  (output_config.format = json_schema), so the first text block is valid JSON.
- FakeLlm: canned responses (or errors) for tests; never touches the network.
- llm_from_env(): AnthropicLlm when configured, else None.
"""

from __future__ import annotations

import json
import os
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable

DEFAULT_MODEL = "claude-opus-5-5"
DEFAULT_EFFORT = "medium"

#: Models that accept server-side refusal fallbacks in the "default" form
#: (beta server-side-fallback-2026-07-01). Other models get a plain request.
_FALLBACK_MODELS = {"claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"}
_FALLBACK_BETA = "server-side-fallback-2026-07-01"


class LlmError(Exception):
    """Any failure to get a usable JSON object from the model."""


@runtime_checkable
class LlmClient(Protocol):
    model: str

    async def complete_json(
        self, *, system: str, user: str, schema: dict, max_tokens: int = 4000
    ) -> dict: ...


class AnthropicLlm:
    """Claude via the official `anthropic` SDK (AsyncAnthropic).

    complete_json() sends one Messages API request constrained by
    `output_config.format = {type: json_schema, schema}` and parses the first
    text block. It does not send `thinking` (Claude Opus 5.5 always thinks
    adaptively and rejects disabling it); depth is set through
    `output_config.effort`. A `refusal` or `max_tokens` stop reason, an API
    error, or unparsable output all raise LlmError.

    On models that support it the request opts into server-side refusal
    fallbacks (`fallbacks="default"`, beta server-side-fallback-2026-07-01) so a
    safety-classifier decline is retried on Anthropic's recommended model
    inside the same call. Pass `fallbacks=False` to turn that off.
    """

    def __init__(
        self,
        *,
        model: str = DEFAULT_MODEL,
        api_key: str | None = None,
        effort: str = DEFAULT_EFFORT,
        fallbacks: bool = True,
        timeout: float = 60.0,
        max_retries: int = 2,
        client: Any | None = None,
    ):
        self.model = model
        self.effort = effort
        self.fallbacks = fallbacks and model in _FALLBACK_MODELS
        if client is None:
            import anthropic

            client = anthropic.AsyncAnthropic(
                api_key=api_key, timeout=timeout, max_retries=max_retries
            )
        self._client = client

    async def complete_json(
        self, *, system: str, user: str, schema: dict, max_tokens: int = 4000
    ) -> dict:
        import anthropic

        params: dict[str, Any] = {
            "model": self.model,
            "max_tokens": max_tokens,
            "system": system,
            "messages": [{"role": "user", "content": user}],
            "output_config": {
                "format": {"type": "json_schema", "schema": schema},
                "effort": self.effort,
            },
        }
        try:
            if self.fallbacks:
                response = await self._client.beta.messages.create(
                    **params, betas=[_FALLBACK_BETA], fallbacks="default"
                )
            else:
                response = await self._client.messages.create(**params)
        except anthropic.RateLimitError as exc:
            raise LlmError(f"rate limited: {exc.message}") from exc
        except anthropic.APIStatusError as exc:
            raise LlmError(f"API error {exc.status_code}: {exc.message}") from exc
        except anthropic.APIConnectionError as exc:
            raise LlmError(f"connection error: {exc}") from exc
        except anthropic.AnthropicError as exc:
            raise LlmError(f"SDK error: {exc}") from exc

        return _parse_response(response)


def _parse_response(response: Any) -> dict:
    stop = getattr(response, "stop_reason", None)
    if stop == "refusal":
        details = getattr(response, "stop_details", None)
        category = getattr(details, "category", None) if details is not None else None
        raise LlmError(f"model refused the request (category: {category or 'unknown'})")
    if stop == "max_tokens":
        raise LlmError("model output hit max_tokens before the JSON was complete")
    text = next(
        (block.text for block in response.content or [] if getattr(block, "type", None) == "text"),
        None,
    )
    if text is None:
        raise LlmError(f"no text block in the response (stop_reason: {stop})")
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise LlmError(f"response is not valid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise LlmError("response JSON is not an object")
    return data


Responder = Callable[[str, str, dict], "dict | Exception"]


@dataclass
class FakeLlm:
    """Test double. `responses` are returned (or raised, if an Exception) in
    order; when exhausted the last one repeats. A callable `responder(system,
    user, schema)` takes precedence. Every call is recorded in `calls`."""

    responses: list[dict | Exception] = field(default_factory=list)
    responder: Responder | None = None
    model: str = "fake-llm"
    calls: list[dict[str, Any]] = field(default_factory=list)

    async def complete_json(
        self, *, system: str, user: str, schema: dict, max_tokens: int = 4000
    ) -> dict:
        self.calls.append(
            {"system": system, "user": user, "schema": schema, "maxTokens": max_tokens}
        )
        if self.responder is not None:
            out = self.responder(system, user, schema)
        elif self.responses:
            index = min(len(self.calls) - 1, len(self.responses) - 1)
            out = self.responses[index]
        else:
            out = LlmError("FakeLlm has no canned response")
        if isinstance(out, Exception):
            raise out
        return json.loads(json.dumps(out))  # a fresh copy, like a real parse


def llm_from_env(env: dict[str, str] | None = None) -> LlmClient | None:
    """AnthropicLlm when HELIX_LLM != "off" and ANTHROPIC_API_KEY is set, else None.

    HELIX_LLM_MODEL picks the model (default claude-opus-5-5).
    """
    env = dict(os.environ) if env is None else env
    mode = (env.get("HELIX_LLM") or "auto").strip().lower()
    key = (env.get("ANTHROPIC_API_KEY") or "").strip()
    if mode == "off" or not key:
        return None
    model = (env.get("HELIX_LLM_MODEL") or "").strip() or DEFAULT_MODEL
    return AnthropicLlm(model=model, api_key=key)
