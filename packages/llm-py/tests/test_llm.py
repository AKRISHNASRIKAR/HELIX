"""helix_llm tests. Nothing here touches the network: AnthropicLlm runs against a
mocked HTTP transport (httpx2.MockTransport, the SDK's own HTTP library)."""

import json

import anthropic
import httpx2
import pytest
from helix_llm import AnthropicLlm, FakeLlm, LlmClient, LlmError, llm_from_env

SCHEMA = {
    "type": "object",
    "properties": {"summary": {"type": "string"}},
    "required": ["summary"],
    "additionalProperties": False,
}


def message(text: str | None, *, stop_reason: str = "end_turn", stop_details=None) -> dict:
    content = [{"type": "text", "text": text}] if text is not None else []
    return {
        "id": "msg_test",
        "type": "message",
        "role": "assistant",
        "model": "claude-opus-5-5",
        "content": content,
        "stop_reason": stop_reason,
        "stop_sequence": None,
        "stop_details": stop_details,
        "usage": {"input_tokens": 10, "output_tokens": 5},
    }


def llm_with(handler, **kwargs) -> tuple[AnthropicLlm, list[httpx2.Request]]:
    seen: list[httpx2.Request] = []

    def record(request: httpx2.Request) -> httpx2.Response:
        seen.append(request)
        return handler(request)

    client = anthropic.AsyncAnthropic(
        api_key="test-key",
        max_retries=0,
        http_client=anthropic.DefaultAsyncHttpxClient(transport=httpx2.MockTransport(record)),
    )
    return AnthropicLlm(client=client, **kwargs), seen


async def test_structured_output_request_shape_and_parse():
    llm, seen = llm_with(lambda r: httpx2.Response(200, json=message('{"summary": "ok"}')))
    out = await llm.complete_json(system="sys", user="hello", schema=SCHEMA, max_tokens=123)
    assert out == {"summary": "ok"}

    body = json.loads(seen[0].content)
    assert body["model"] == "claude-opus-5-5"
    assert body["max_tokens"] == 123
    assert body["system"] == "sys"
    assert body["messages"] == [{"role": "user", "content": "hello"}]
    assert body["output_config"] == {
        "format": {"type": "json_schema", "schema": SCHEMA},
        "effort": "medium",
    }
    assert "thinking" not in body
    assert body["fallbacks"] == "default"
    assert "server-side-fallback-2026-07-01" in seen[0].headers.get("anthropic-beta", "")


async def test_fallbacks_off_uses_plain_messages_endpoint():
    llm, seen = llm_with(
        lambda r: httpx2.Response(200, json=message('{"summary": "ok"}')), fallbacks=False
    )
    await llm.complete_json(system="s", user="u", schema=SCHEMA)
    body = json.loads(seen[0].content)
    assert "fallbacks" not in body
    assert "anthropic-beta" not in seen[0].headers


async def test_unsupported_model_skips_fallbacks():
    llm, seen = llm_with(
        lambda r: httpx2.Response(200, json=message('{"summary": "ok"}')),
        model="claude-haiku-4-5",
    )
    await llm.complete_json(system="s", user="u", schema=SCHEMA)
    assert "fallbacks" not in json.loads(seen[0].content)


@pytest.mark.parametrize(
    ("payload", "match"),
    [
        (message(None, stop_reason="refusal",
                 stop_details={"type": "refusal", "category": "cyber", "explanation": None}),
         "refused"),
        (message('{"summ', stop_reason="max_tokens"), "max_tokens"),
        (message("not json"), "not valid JSON"),
        (message("[1, 2]"), "not an object"),
        (message(None), "no text block"),
    ],
)
async def test_bad_responses_raise_llm_error(payload, match):
    llm, _ = llm_with(lambda r: httpx2.Response(200, json=payload))
    with pytest.raises(LlmError, match=match):
        await llm.complete_json(system="s", user="u", schema=SCHEMA)


async def test_api_errors_become_llm_errors():
    error = {"type": "error", "error": {"type": "overloaded_error", "message": "busy"}}
    llm, _ = llm_with(lambda r: httpx2.Response(529, json=error))
    with pytest.raises(LlmError, match="529"):
        await llm.complete_json(system="s", user="u", schema=SCHEMA)


async def test_connection_errors_become_llm_errors():
    def boom(request):
        raise httpx2.ConnectError("refused", request=request)

    llm, _ = llm_with(boom)
    with pytest.raises(LlmError, match="connection"):
        await llm.complete_json(system="s", user="u", schema=SCHEMA)


async def test_fake_llm_replays_and_records():
    fake = FakeLlm(responses=[{"a": 1}, LlmError("nope")])
    assert isinstance(fake, LlmClient)
    assert await fake.complete_json(system="s", user="u", schema={}) == {"a": 1}
    with pytest.raises(LlmError):
        await fake.complete_json(system="s", user="u2", schema={})
    with pytest.raises(LlmError):  # last response repeats
        await fake.complete_json(system="s", user="u3", schema={})
    assert [c["user"] for c in fake.calls] == ["u", "u2", "u3"]

    echo = FakeLlm(responder=lambda system, user, schema: {"echo": user})
    assert await echo.complete_json(system="s", user="hi", schema={}) == {"echo": "hi"}
    with pytest.raises(LlmError):
        await FakeLlm().complete_json(system="s", user="u", schema={})


def test_llm_from_env():
    assert llm_from_env({}) is None
    assert llm_from_env({"ANTHROPIC_API_KEY": "k", "HELIX_LLM": "off"}) is None
    assert llm_from_env({"ANTHROPIC_API_KEY": "  "}) is None
    llm = llm_from_env({"ANTHROPIC_API_KEY": "k"})
    assert isinstance(llm, AnthropicLlm) and llm.model == "claude-opus-5-5"
    llm = llm_from_env({"ANTHROPIC_API_KEY": "k", "HELIX_LLM": "auto",
                        "HELIX_LLM_MODEL": "claude-sonnet-5-5"})
    assert llm.model == "claude-sonnet-5-5"
