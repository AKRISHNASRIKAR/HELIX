import json
from datetime import UTC, datetime
from uuid import uuid4

import httpx
import pytest
from app.config import Settings
from app.context import ContextEngineError, HttpContextProvider
from helix_contracts import AssembledContext, ContextAssembleRequest


def _request():
    return ContextAssembleRequest.model_validate({
        "investigation": {
            "id": str(uuid4()),
            "organizationId": str(uuid4()),
            "projectId": str(uuid4()),
            "question": "Why did revenue drop?",
        },
        "agentTaskId": str(uuid4()),
        "agentType": "FINANCE",
        "step": {"order": 1, "objective": "refunds"},
        "requirements": {"tableKeywords": ["order"]},
    })


def _context_for(body: dict) -> dict:
    inv = body["investigation"]
    return AssembledContext(
        context_id=uuid4(),
        assembled_at=datetime.now(UTC),
        agent_type=body["agentType"],
        agent_task_id=body["agentTaskId"],
        question=inv["question"],
        investigation_id=inv["id"],
        organization_id=inv["organizationId"],
        project_id=inv["projectId"],
        trigger_type="USER_QUESTION",
        step=body["step"],
        token_count=123,
    ).model_dump(mode="json", by_alias=True)


@pytest.mark.asyncio
async def test_assemble_posts_request_and_parses_context():
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=_context_for(json.loads(request.content)))

    provider = HttpContextProvider("http://ctx.test/", 5, transport=httpx.MockTransport(handler))
    request = _request()
    context = await provider.assemble(request)

    assert str(seen[0].url) == "http://ctx.test/context/assemble"
    sent = json.loads(seen[0].content)
    assert sent["agentTaskId"] == str(request.agent_task_id)
    assert sent["requirements"]["tableKeywords"] == ["order"]
    assert isinstance(context, AssembledContext)
    assert context.agent_task_id == request.agent_task_id
    assert context.token_count == 123 and context.source == "context-engine"


@pytest.mark.asyncio
@pytest.mark.parametrize("response", [
    "down",
    httpx.Response(500, text="boom"),
    httpx.Response(200, text="not json"),
    httpx.Response(200, json={"contextId": "nope"}),
])
async def test_assemble_raises_context_engine_error(response):
    def handler(request: httpx.Request) -> httpx.Response:
        if response == "down":
            raise httpx.ConnectError("refused", request=request)
        return response

    provider = HttpContextProvider("http://ctx.test", transport=httpx.MockTransport(handler))
    with pytest.raises(ContextEngineError):
        await provider.assemble(_request())


def test_settings_new_shared_names(monkeypatch):
    monkeypatch.setenv("CONTEXT_ENGINE_URL", "http://ctx:8003")
    monkeypatch.setenv("A2A_GATEWAY_URL", "http://gw:8005")
    monkeypatch.setenv("HELIX_A2A_MODE", "inprocess")
    monkeypatch.setenv("REDIS_URL", "redis://r:6379")
    s = Settings()
    assert (s.context_engine_url, s.a2a_gateway_url, s.a2a_mode, s.redis_url) == (
        "http://ctx:8003", "http://gw:8005", "inprocess", "redis://r:6379",
    )
    assert Settings(HELIX_A2A_MODE="gateway", CONTEXT_ENGINE_URL="").context_engine_url == ""
