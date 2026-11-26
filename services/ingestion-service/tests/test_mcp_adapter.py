"""McpAdapter against the real demo server (services/mcp-demo): its ASGI app is
loaded in-process and served by uvicorn in a thread on an ephemeral port."""

import importlib
import importlib.util
import socket
import sys
import threading
import time
from pathlib import Path

import pytest
import uvicorn
from app.adapters.mcp import McpAdapter, rows_from_result
from app.errors import AdapterError
from app.main import app
from app.models import ConnectionSpec
from fastapi.testclient import TestClient
from mcp.types import CallToolResult, TextContent

client = TestClient(app)
MCP_DEMO = Path(__file__).resolve().parents[2] / "mcp-demo"
TOKEN = "test-mcp-token"


def _load_demo_app():
    """Import services/mcp-demo/app as `mcp_demo_app` (this service also has `app`)."""
    if "mcp_demo_app.main" not in sys.modules:
        spec = importlib.util.spec_from_file_location(
            "mcp_demo_app", MCP_DEMO / "app" / "__init__.py",
            submodule_search_locations=[str(MCP_DEMO / "app")],
        )
        module = importlib.util.module_from_spec(spec)
        sys.modules["mcp_demo_app"] = module
        spec.loader.exec_module(module)
    return importlib.import_module("mcp_demo_app.main")


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


@pytest.fixture(scope="module")
def server_url():
    demo = _load_demo_app()
    port = _free_port()
    server = uvicorn.Server(
        uvicorn.Config(
            demo.create_app(token=TOKEN), host="127.0.0.1", port=port, log_level="warning",
            ws="none",
        )
    )
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.monotonic() + 10
    while not server.started:
        if time.monotonic() > deadline or not thread.is_alive():
            raise RuntimeError("mcp-demo server did not start")
        time.sleep(0.05)
    yield f"http://127.0.0.1:{port}/mcp"
    server.should_exit = True
    thread.join(timeout=10)


def _connection(url: str, token: str | None = TOKEN, **config) -> dict:
    return {
        "type": "MCP",
        "config": {"serverUrl": url, "transport": "streamable_http", **config},
        "credentials": {"token": token} if token else None,
    }


def test_connect_discovers_deployments_table(server_url):
    body = client.post("/connect", json={"connection": _connection(server_url)}).json()
    assert body["ok"] is True, body
    [table] = body["schemas"]
    assert table["tableName"] == "deployments"
    assert table["rowCountEstimate"] == 40
    semantic = {c["name"]: c["semanticType"] for c in table["columns"]}
    assert semantic == {
        "id": "identifier",
        "service": "categorical",
        "version": "identifier",
        "environment": "categorical",
        "deployed_at": "datetime",
        "author": "categorical",
        "description": "text",
        "status": "categorical",
        "commit_sha": "identifier",
    }
    types = {c["name"]: c["type"] for c in table["columns"]}
    assert types["deployed_at"] == "timestamp"


def test_preview_extract_profile(server_url):
    connection = _connection(server_url)
    preview = client.post(
        "/preview", json={"connection": connection, "table": "deployments", "limit": 3}
    ).json()
    assert len(preview["rows"]) == 3
    assert preview["columns"][0] == "id"

    extract = client.post(
        "/extract",
        json={"connection": connection, "table": "deployments",
              "columns": ["service", "version", "deployed_at", "status"]},
    ).json()
    trigger = [r for r in extract["rows"] if r["version"] == "v2.14.0"]
    assert trigger == [{"service": "web-checkout", "version": "v2.14.0",
                        "deployed_at": "2026-10-08T08:40:00Z", "status": "rolled_back"}]

    profile = client.post(
        "/profile", json={"connection": connection, "table": "deployments"}
    ).json()
    assert profile["rowCount"] == 40
    assert {c["name"]: c["distinctCount"] for c in profile["columns"]}["service"] == 6


def test_unknown_table_and_column_are_422(server_url):
    connection = _connection(server_url)
    missing = client.post("/preview", json={"connection": connection, "table": "commits"})
    assert missing.status_code == 422
    assert "Available tables: deployments" in missing.json()["detail"]
    bad_col = client.post(
        "/extract", json={"connection": connection, "table": "deployments", "columns": ["nope"]}
    )
    assert bad_col.status_code == 422
    assert "nope" in bad_col.json()["detail"]


def test_wrong_or_missing_token_is_readable_and_secret_free(server_url):
    wrong = client.post(
        "/connect", json={"connection": _connection(server_url, token="hunter2-wrong")}
    ).json()
    assert wrong["ok"] is False
    assert "rejected the credentials (HTTP 401)" in wrong["error"]
    assert "hunter2-wrong" not in wrong["error"]
    missing = client.post("/connect", json={"connection": _connection(server_url, token=None)})
    assert "HTTP 401" in missing.json()["error"]


def test_unreachable_server():
    url = f"http://127.0.0.1:{_free_port()}/mcp?key=s3cret"
    body = client.post("/connect", json={"connection": _connection(url)}).json()
    assert body == {"ok": False, "error": f"Could not connect to the MCP server at "
                    f"{url.split('?')[0]}."}


def test_prefix_filter_hides_tools(server_url):
    body = client.post(
        "/connect", json={"connection": _connection(server_url, toolPrefixes=["get_"])}
    ).json()
    assert body == {"ok": True, "schemas": []}


@pytest.mark.parametrize(
    ("config", "message"),
    [
        ({}, "needs a `serverUrl`"),
        ({"serverUrl": "ftp://x/mcp"}, "must be an http"),
        ({"serverUrl": "http://x/mcp", "transport": "sse"}, "Unsupported MCP transport"),
        ({"serverUrl": "http://x/mcp", "toolPrefixes": "list_"}, "toolPrefixes"),
    ],
)
def test_config_errors(config, message):
    with pytest.raises(AdapterError, match=message):
        McpAdapter(ConnectionSpec(type="MCP", config=config))


def _result(content=None, structured=None, is_error=False) -> CallToolResult:
    return CallToolResult(
        content=[TextContent(type="text", text=t) for t in (content or [])],
        structuredContent=structured,
        isError=is_error,
    )


def test_rows_from_result_shapes():
    rows = [{"a": 1}, {"a": 2}]
    assert rows_from_result("t", _result(structured={"result": rows})) == rows
    assert rows_from_result("t", _result(structured={"items": rows})) == rows
    assert rows_from_result("t", _result(structured={"a": 1})) == [{"a": 1}]
    assert rows_from_result("t", _result(content=['[{"a": 1}, {"a": 2}]'])) == rows
    assert rows_from_result("t", _result(content=['{"a": 1}', '{"a": 2}'])) == rows
    assert rows_from_result("t", _result(content=['{"data": [{"a": 1}]}'])) == [{"a": 1}]
    assert rows_from_result("t", _result()) == []
    with pytest.raises(AdapterError, match="not JSON"):
        rows_from_result("t", _result(content=["hello"]))
    with pytest.raises(AdapterError, match="list of objects"):
        rows_from_result("t", _result(content=["[1, 2]"]))
    with pytest.raises(AdapterError, match="returned an error: boom"):
        rows_from_result("t", _result(content=["boom"], is_error=True))


def test_nested_values_are_json_strings():
    from app.adapters.rows import normalize_rows

    df = normalize_rows([{"a": {"y": 1, "x": 2}, "b": [1, 2]}, {"c": None}])
    assert list(df.columns) == ["a", "b", "c"]
    assert df.loc[0, "a"] == '{"x": 2, "y": 1}'
    assert df.loc[0, "b"] == "[1, 2]"


def test_non_mcp_endpoint_is_readable(server_url):
    url = server_url.replace("/mcp", "/health")
    body = client.post("/connect", json={"connection": _connection(url)}).json()
    assert body["ok"] is False
    assert "returned HTTP 405" in body["error"]
