import httpx
import pytest
from app import resolve
from app.main import app
from fastapi.testclient import TestClient

client = TestClient(app)


def test_body_without_connection_or_data_source_is_422_with_string_detail():
    response = client.post("/preview", json={"table": "x"})
    assert response.status_code == 422
    assert isinstance(response.json()["detail"], str)
    assert "dataSourceId" in response.json()["detail"]


def test_preview_limit_above_max_is_422():
    connection = {"type": "CSV", "config": {}, "filePath": "/tmp/x.csv"}
    response = client.post(
        "/preview", json={"connection": connection, "table": "x", "limit": 501}
    )
    assert response.status_code == 422


def test_validation_errors_do_not_echo_input_values():
    connection = {"type": "POSTGRES", "config": {}, "credentials": {"password": "hunter2-xyz"}}
    response = client.post("/connect", json={"connection": connection})
    assert response.status_code == 422
    assert "hunter2-xyz" not in response.text


@pytest.fixture
def fake_api(monkeypatch):
    """Route the resolver's httpx client through an in-process MockTransport."""
    calls = []
    real = httpx.AsyncClient

    def install(handler):
        def wrapped(request: httpx.Request) -> httpx.Response:
            calls.append(request)
            return handler(request)

        def factory(*args, **kwargs):
            kwargs["transport"] = httpx.MockTransport(wrapped)
            return real(*args, **kwargs)

        monkeypatch.setattr(resolve.httpx, "AsyncClient", factory)
        return calls

    return install


def test_data_source_id_is_resolved_through_internal_api(fake_api, tmp_path):
    path = tmp_path / "sales.csv"
    path.write_text("day,amount\n2026-01-01,10.5\n")

    def handler(request):
        return httpx.Response(
            200,
            json={
                "id": "ds1",
                "organizationId": "org1",
                "type": "CSV",
                "config": {"fileId": "f", "originalName": "sales.csv"},
                "credentials": None,
                "filePath": str(path),
            },
        )

    calls = fake_api(handler)
    body = client.post("/connect", json={"dataSourceId": "ds1", "organizationId": "org1"}).json()
    assert body["ok"] is True
    assert body["schemas"][0]["tableName"] == "sales"
    [request] = calls
    assert request.url.path == "/api/v1/internal/data-sources/ds1/connection"
    assert request.url.params["organizationId"] == "org1"
    assert request.headers["x-helix-internal-token"] == "dev-internal-token"


def test_resolution_failures_are_readable(fake_api):
    fake_api(lambda request: httpx.Response(404, json={"message": "nope"}))
    body = client.post("/connect", json={"dataSourceId": "ds1", "organizationId": "o"}).json()
    assert body == {"ok": False, "error": "Data source not found for this organization."}

    def boom(request):
        raise httpx.ConnectError("refused")

    fake_api(boom)
    response = client.post(
        "/extract", json={"dataSourceId": "ds1", "organizationId": "o", "table": "t"}
    )
    assert response.status_code == 422
    assert "Could not reach the HELIX API" in response.json()["detail"]
