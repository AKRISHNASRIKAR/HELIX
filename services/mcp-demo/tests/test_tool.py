"""The list_deployments tool, over the SDK's in-memory transport and over real
streamable HTTP (uvicorn in a thread on the test port 18006)."""

import json
import threading
import time
from pathlib import Path

import httpx
import pytest
import uvicorn
from app.config import settings
from app.main import create_app
from app.server import build_server, filter_deployments, load_deployments
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from mcp.shared.memory import create_connected_server_and_client_session

FIXTURE = settings.fixture_path
PORT = 18006
TOKEN = "demo-token"


@pytest.fixture(scope="module")
def http_server():
    server = uvicorn.Server(
        uvicorn.Config(
            create_app(token=TOKEN), host="127.0.0.1", port=PORT, log_level="warning", ws="none"
        )
    )
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.monotonic() + 10
    while not server.started:
        if time.monotonic() > deadline or not thread.is_alive():
            raise RuntimeError("mcp-demo test server did not start")
        time.sleep(0.05)
    yield f"http://127.0.0.1:{PORT}"
    server.should_exit = True
    thread.join(timeout=10)


def test_filter_window_and_service():
    rows = load_deployments(FIXTURE)
    assert len(filter_deployments(rows)) == len(rows)
    checkout = filter_deployments(
        rows, since="2026-10-08", until="2026-10-09", service="WEB-checkout"
    )
    assert [(r["version"], r["status"]) for r in checkout] == [
        ("v2.14.0", "rolled_back"),
        ("v2.14.1", "success"),
    ]
    # `until` as a bare date is the whole day; datetimes are exact and inclusive.
    assert [r["version"] for r in filter_deployments(rows, until="2026-07-22")] == ["v4.4.1"]
    exact = filter_deployments(rows, since="2026-10-08T08:40:00Z", until="2026-10-08T08:40:00Z")
    assert [r["id"] for r in exact] == ["dep_0038"]
    assert filter_deployments(rows, service="nope") == []


def test_bad_inputs_are_readable(tmp_path: Path):
    with pytest.raises(ValueError, match="Invalid timestamp"):
        filter_deployments([], since="last tuesday")
    with pytest.raises(ValueError, match="not found"):
        load_deployments(tmp_path / "missing.json")
    bad = tmp_path / "bad.json"
    bad.write_text('{"not": "a list"}')
    with pytest.raises(ValueError, match="JSON array"):
        load_deployments(bad)


@pytest.mark.asyncio
async def test_tool_over_memory_transport():
    async with create_connected_server_and_client_session(build_server(FIXTURE)) as session:
        tools = (await session.list_tools()).tools
        [tool] = tools
        assert tool.name == "list_deployments"
        assert not tool.inputSchema.get("required")
        result = await session.call_tool("list_deployments", {"service": "web-checkout",
                                                              "since": "2026-10-08"})
        assert not result.isError
        rows = result.structuredContent["result"]
        assert rows[0]["deployed_at"] == "2026-10-08T08:40:00Z"
        assert json.loads(result.content[0].text) == rows[0]

        failed = await session.call_tool("list_deployments", {"since": "soon"})
        assert failed.isError
        assert "Invalid timestamp" in failed.content[0].text


@pytest.mark.asyncio
async def test_streamable_http_with_token(http_server):
    headers = {"Authorization": f"Bearer {TOKEN}"}
    async with (
        httpx.AsyncClient(headers=headers, timeout=10) as client,
        streamable_http_client(f"{http_server}/mcp", http_client=client) as (read, write, _),
        ClientSession(read, write) as session,
    ):
        await session.initialize()
        result = await session.call_tool("list_deployments", {})
    assert len(result.structuredContent["result"]) == len(load_deployments(FIXTURE))


def test_token_required_and_health_open(http_server):
    body = {"jsonrpc": "2.0", "id": 1, "method": "tools/list"}
    unauthorized = httpx.post(f"{http_server}/mcp", json=body)
    assert unauthorized.status_code == 401
    wrong = httpx.post(f"{http_server}/mcp", json=body, headers={"Authorization": "Bearer no"})
    assert wrong.status_code == 401
    assert httpx.get(f"{http_server}/health").json() == {"status": "ok", "service": "mcp-demo"}
