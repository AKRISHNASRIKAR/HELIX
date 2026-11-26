"""GithubAdapter over httpx.MockTransport (no network)."""

import httpx
import pytest
from app.adapters.github import GithubAdapter
from app.errors import AdapterError
from app.main import app
from app.models import ConnectionSpec
from fastapi.testclient import TestClient

client = TestClient(app)
API = "https://api.github.com"
REPO = "/repos/acme/shop"

DEPLOYMENTS = [
    {"id": 2, "ref": "v2.14.1", "sha": "bbb", "environment": "production", "task": "deploy",
     "description": "Revert payment form changes", "created_at": "2026-10-09T06:15:00Z",
     "creator": {"login": "carla"}},
    {"id": 1, "ref": "v2.14.0", "sha": "aaa", "environment": "production", "task": "deploy",
     "description": "New payment form", "created_at": "2026-10-08T08:40:00Z",
     "creator": {"login": "carla"}},
]
STATUSES = {1: [{"state": "failure"}], 2: [{"state": "success"}]}
RELEASES = [
    {"id": 10, "tag_name": "v2.14.1", "name": "Hotfix", "draft": False, "prerelease": False,
     "published_at": "2026-10-09T06:20:00Z", "created_at": "2026-10-09T06:10:00Z",
     "author": {"login": "carla"}, "body": "Revert payment form\n\nDetails...",
     "target_commitish": "main"},
    {"id": 9, "tag_name": "v2.15.0-rc1", "name": None, "draft": False, "prerelease": True,
     "published_at": None, "created_at": "2026-10-12T10:00:00Z", "author": None, "body": "",
     "target_commitish": "main"},
]


def _commit(i: int) -> dict:
    return {
        "sha": f"{i:040x}",
        "author": {"login": "dev"} if i % 2 else None,
        "commit": {"author": {"name": "Dev Name", "date": f"2026-10-01T00:{i % 60:02d}:00Z"},
                   "message": f"Commit {i}\n\nbody"},
    }


COMMITS = [_commit(i) for i in range(350)]


def _handler(seen: list[httpx.Request] | None = None, status: int | None = None):
    def handle(request: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(request)
        if status is not None:
            headers = {"x-ratelimit-remaining": "0"} if status == 429 else {}
            return httpx.Response(status, json={"message": "nope"}, headers=headers)
        path = request.url.path
        if path == REPO:
            return httpx.Response(200, json={"full_name": "acme/shop"})
        if path == f"{REPO}/deployments":
            return httpx.Response(200, json=DEPLOYMENTS)
        if path.startswith(f"{REPO}/deployments/") and path.endswith("/statuses"):
            return httpx.Response(200, json=STATUSES.get(int(path.split("/")[-2]), []))
        if path == f"{REPO}/releases":
            return httpx.Response(200, json=RELEASES)
        if path == f"{REPO}/commits":
            page = int(request.url.params.get("page", "1"))
            items = COMMITS[(page - 1) * 100 : page * 100]
            headers = {}
            if page * 100 < len(COMMITS):
                headers["link"] = f'<{API}{REPO}/commits?per_page=100&page={page + 1}>; rel="next"'
            return httpx.Response(200, json=items, headers=headers)
        return httpx.Response(404, json={"message": "Not Found"})

    return handle


@pytest.fixture
def github(monkeypatch):
    def install(**kwargs):
        monkeypatch.setattr(GithubAdapter, "transport", httpx.MockTransport(_handler(**kwargs)))

    install()
    return install


def _connection(token: str | None = "ghp_secret_token", **config) -> dict:
    return {
        "type": "GITHUB",
        "config": {"owner": "acme", "repo": "shop", **config},
        "credentials": {"token": token} if token else None,
    }


def test_connect_discovers_three_tables(github):
    seen: list[httpx.Request] = []
    github(seen=seen)
    body = client.post("/connect", json={"connection": _connection()}).json()
    assert body["ok"] is True, body
    tables = {t["tableName"]: t for t in body["schemas"]}
    assert list(tables) == ["deployments", "releases", "commits"]
    deploy_cols = {c["name"]: c["semanticType"] for c in tables["deployments"]["columns"]}
    assert list(deploy_cols) == ["id", "service", "version", "environment", "task", "deployed_at",
                                 "author", "description", "status", "commit_sha"]
    assert deploy_cols["deployed_at"] == "datetime"
    assert tables["commits"]["rowCountEstimate"] == 300
    commit_cols = {c["name"]: c["semanticType"] for c in tables["commits"]["columns"]}
    assert commit_cols["committed_at"] == "datetime"
    assert commit_cols["sha"] == "identifier"
    assert all(r.headers["authorization"] == "Bearer ghp_secret_token" for r in seen)
    assert all(r.headers["accept"] == "application/vnd.github+json" for r in seen)


def test_deployments_rows_are_normalized(github):
    rows = client.post(
        "/extract", json={"connection": _connection(), "table": "deployments"}
    ).json()["rows"]
    assert rows[1] == {
        "id": "1", "service": "shop", "version": "v2.14.0", "environment": "production",
        "task": "deploy", "deployed_at": "2026-10-08T08:40:00Z", "author": "carla",
        "description": "New payment form", "status": "failed", "commit_sha": "aaa",
    }
    assert rows[0]["status"] == "success"


def test_releases_and_commits(github):
    releases = client.post(
        "/preview", json={"connection": _connection(), "table": "releases"}
    ).json()["rows"]
    assert releases[0]["description"] == "Revert payment form"
    assert releases[0]["deployed_at"] == "2026-10-09T06:20:00Z"
    assert releases[1]["status"] == "prerelease"
    assert releases[1]["deployed_at"] == "2026-10-12T10:00:00Z"
    commits = client.post(
        "/extract",
        json={"connection": _connection(), "table": "commits", "columns": ["author", "message"]},
    ).json()["rows"]
    assert len(commits) == 300
    assert commits[0] == {"author": "Dev Name", "message": "Commit 0"}
    assert commits[1]["author"] == "dev"


def test_empty_repo_keeps_columns(monkeypatch):
    def handle(request: httpx.Request) -> httpx.Response:
        if request.url.path == REPO:
            return httpx.Response(200, json={"full_name": "acme/shop"})
        return httpx.Response(200, json=[])

    monkeypatch.setattr(GithubAdapter, "transport", httpx.MockTransport(handle))
    body = client.post("/connect", json={"connection": _connection(token=None)}).json()
    deployments = body["schemas"][0]
    assert deployments["rowCountEstimate"] == 0
    assert len(deployments["columns"]) == 10


@pytest.mark.parametrize(
    ("status", "message"),
    [
        (401, "rejected the token (HTTP 401)"),
        (403, "denied access (HTTP 403)"),
        (404, "acme/shop was not found"),
        (429, "rate limit exceeded"),
        (500, "GitHub returned HTTP 500"),
    ],
)
def test_http_errors_are_readable_and_secret_free(github, status, message):
    github(status=status)
    body = client.post("/connect", json={"connection": _connection()}).json()
    assert body["ok"] is False
    assert message in body["error"]
    assert "ghp_secret_token" not in body["error"]


def test_network_errors(monkeypatch):
    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    def slow(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow", request=request)

    monkeypatch.setattr(GithubAdapter, "transport", httpx.MockTransport(refuse))
    body = client.post("/connect", json={"connection": _connection()}).json()
    assert body["error"] == "Could not reach the GitHub API at api.github.com."
    monkeypatch.setattr(GithubAdapter, "transport", httpx.MockTransport(slow))
    body = client.post("/connect", json={"connection": _connection()}).json()
    assert "did not respond" in body["error"]


def test_unknown_table_is_422(github):
    response = client.post("/preview", json={"connection": _connection(), "table": "issues"})
    assert response.status_code == 422
    assert "Available tables: commits, deployments, releases" in response.json()["detail"]


@pytest.mark.parametrize(
    ("config", "message"),
    [
        ({"owner": "", "repo": "shop"}, "needs `owner` and `repo`"),
        ({"owner": "acme/../x", "repo": "shop"}, "may only contain"),
        ({"owner": "acme", "repo": "shop", "apiUrl": "file:///etc"}, "must be an http"),
    ],
)
def test_config_errors(config, message):
    with pytest.raises(AdapterError, match=message):
        GithubAdapter(ConnectionSpec(type="GITHUB", config=config))


def test_enterprise_api_url(monkeypatch):
    seen: list[httpx.Request] = []
    monkeypatch.setattr(GithubAdapter, "transport", httpx.MockTransport(_handler(seen=seen)))
    body = client.post(
        "/connect", json={"connection": _connection(apiUrl="https://ghe.example.com/api/v3")}
    ).json()
    # The mock only knows api.github.com paths, so the prefixed path 404s.
    assert body["ok"] is False
    assert seen[0].url.host == "ghe.example.com"
    assert seen[0].url.path == "/api/v3/repos/acme/shop"
