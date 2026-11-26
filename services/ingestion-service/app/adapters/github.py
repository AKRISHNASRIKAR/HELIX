"""GithubAdapter: one repository's deployments, releases and commits as tables.

Config `{owner, repo, apiUrl?}` (`apiUrl` defaults to https://api.github.com,
set it for GitHub Enterprise), credentials `{token?}` (a fine-grained or
classic token with read access; without one the public, rate-limited API is
used). Sync httpx with a timeout; the REST API is paginated via `Link`.

Tables and columns (names match the MCP demo deployments feed where they
mean the same thing, so the Product Agent can read either source):

- `deployments`: id, service (repo name), version (ref), environment, task,
  deployed_at, author, description, status (latest deployment status:
  success | failed | inactive | pending | ..., `unknown` if none), commit_sha.
  Up to 100 most recent deployments (one status request each).
- `releases`: id, service, version (tag), name, deployed_at (published_at,
  else created_at), author, description, status (published | draft |
  prerelease), target.
- `commits`: sha, author, committed_at, message (first line). Up to 300.
"""

from __future__ import annotations

import re
from typing import Any

import httpx

from ..config import settings
from ..errors import AdapterError
from .rows import RowSourceAdapter

DEFAULT_API_URL = "https://api.github.com"
NAME = re.compile(r"^[A-Za-z0-9_.-]{1,100}$")
PAGE_SIZE = 100
MAX_DEPLOYMENTS = 100
MAX_RELEASES = 300
MAX_COMMITS = 300
COLUMNS = {
    "deployments": ["id", "service", "version", "environment", "task", "deployed_at", "author",
                    "description", "status", "commit_sha"],
    "releases": ["id", "service", "version", "name", "deployed_at", "author", "description",
                 "status", "target"],
    "commits": ["sha", "author", "committed_at", "message"],
}
STATE = {"failure": "failed", "error": "failed", "in_progress": "pending", "queued": "pending"}


def _first_line(text: Any) -> str | None:
    if not text:
        return None
    return str(text).strip().splitlines()[0][:500] if str(text).strip() else None


def _login(user: Any) -> str | None:
    return user.get("login") if isinstance(user, dict) else None


class GithubAdapter(RowSourceAdapter):
    type = "GITHUB"
    #: Tests swap in an `httpx.MockTransport`; production uses the default.
    transport: httpx.BaseTransport | None = None

    def __init__(self, spec) -> None:
        super().__init__(spec)
        config = spec.config or {}
        self.owner = str(config.get("owner") or "").strip()
        self.repo = str(config.get("repo") or "").strip()
        if not self.owner or not self.repo:
            raise AdapterError("GitHub connection needs `owner` and `repo`.")
        if not NAME.match(self.owner) or not NAME.match(self.repo):
            raise AdapterError("GitHub `owner` and `repo` may only contain letters, digits, - _ .")
        api_url = str(config.get("apiUrl") or DEFAULT_API_URL).rstrip("/")
        try:
            parsed = httpx.URL(api_url)
        except (httpx.InvalidURL, TypeError):
            raise AdapterError("The GitHub `apiUrl` is not a valid URL.") from None
        if parsed.scheme not in ("http", "https") or not parsed.host:
            raise AdapterError("The GitHub `apiUrl` must be an http(s) URL.")
        self.api_url = api_url
        self.api_host = parsed.host
        token = (spec.credentials or {}).get("token")
        self.headers = {
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "helix-ingestion-service",
        }
        if token:
            self.headers["Authorization"] = f"Bearer {token}"
        self._client: httpx.Client | None = None

    # -- HTTP ------------------------------------------------------------------

    @property
    def client(self) -> httpx.Client:
        if self._client is None:
            self._client = httpx.Client(
                base_url=self.api_url,
                headers=self.headers,
                timeout=settings.github_timeout_seconds,
                transport=self.transport,
            )
        return self._client

    @property
    def repo_path(self) -> str:
        return f"/repos/{self.owner}/{self.repo}"

    def _get(self, url: str, params: dict[str, Any] | None = None) -> httpx.Response:
        try:
            response = self.client.get(url, params=params)
        except httpx.TimeoutException:
            raise AdapterError(
                f"GitHub did not respond within {settings.github_timeout_seconds:g}s."
            ) from None
        except httpx.ConnectError:
            raise AdapterError(f"Could not reach the GitHub API at {self.api_host}.") from None
        except httpx.HTTPError as exc:
            raise AdapterError(f"HTTP error talking to GitHub ({type(exc).__name__}).") from None
        if response.status_code >= 400:
            raise self._status_error(response)
        return response

    def _status_error(self, response: httpx.Response) -> AdapterError:
        code = response.status_code
        if code == 429 or response.headers.get("x-ratelimit-remaining") == "0":
            return AdapterError("GitHub API rate limit exceeded. Try again later or add a token.")
        if code == 401:
            return AdapterError("GitHub rejected the token (HTTP 401). Check the credentials.")
        if code == 403:
            return AdapterError(
                "GitHub denied access (HTTP 403). The token may lack read access to this "
                "repository."
            )
        if code == 404:
            return AdapterError(
                f"Repository {self.owner}/{self.repo} was not found, or the token cannot see it."
            )
        return AdapterError(f"GitHub returned HTTP {code}.")

    def _json(self, response: httpx.Response) -> Any:
        try:
            return response.json()
        except ValueError:
            raise AdapterError("GitHub returned a response that is not JSON.") from None

    def _paginate(self, path: str, cap: int, params: dict[str, Any] | None = None) -> list[dict]:
        """GET a list endpoint, following `Link: rel="next"` until `cap` items."""
        items: list[dict] = []
        url: str | None = path
        query: dict[str, Any] | None = {"per_page": PAGE_SIZE, **(params or {})}
        while url and len(items) < cap:
            response = self._get(url, params=query)
            page = self._json(response)
            if not isinstance(page, list):
                raise AdapterError("GitHub returned an unexpected response shape.")
            items.extend(item for item in page if isinstance(item, dict))
            url = response.links.get("next", {}).get("url")
            query = None  # the next URL already carries the query string
            if not page:
                break
        return items[:cap]

    # -- tables ------------------------------------------------------------------

    def _deployments(self) -> list[dict[str, Any]]:
        rows = []
        for item in self._paginate(f"{self.repo_path}/deployments", MAX_DEPLOYMENTS):
            statuses = self._json(
                self._get(f"{self.repo_path}/deployments/{item.get('id')}/statuses",
                          params={"per_page": 1})
            )
            latest = statuses[0] if isinstance(statuses, list) and statuses else None
            state = str(latest.get("state")) if isinstance(latest, dict) else "unknown"
            rows.append(
                {
                    "id": str(item.get("id")),
                    "service": self.repo,
                    "version": item.get("ref"),
                    "environment": item.get("environment"),
                    "task": item.get("task"),
                    "deployed_at": item.get("created_at"),
                    "author": _login(item.get("creator")),
                    "description": item.get("description"),
                    "status": STATE.get(state, state),
                    "commit_sha": item.get("sha"),
                }
            )
        return rows

    def _releases(self) -> list[dict[str, Any]]:
        rows = []
        for item in self._paginate(f"{self.repo_path}/releases", MAX_RELEASES):
            status = (
                "draft" if item.get("draft") else "prerelease" if item.get("prerelease")
                else "published"
            )
            rows.append(
                {
                    "id": str(item.get("id")),
                    "service": self.repo,
                    "version": item.get("tag_name"),
                    "name": item.get("name"),
                    "deployed_at": item.get("published_at") or item.get("created_at"),
                    "author": _login(item.get("author")),
                    "description": _first_line(item.get("body")),
                    "status": status,
                    "target": item.get("target_commitish"),
                }
            )
        return rows

    def _commits(self) -> list[dict[str, Any]]:
        rows = []
        for item in self._paginate(f"{self.repo_path}/commits", MAX_COMMITS):
            commit = item.get("commit") if isinstance(item.get("commit"), dict) else {}
            git_author = commit.get("author") if isinstance(commit.get("author"), dict) else {}
            rows.append(
                {
                    "sha": item.get("sha"),
                    "author": _login(item.get("author")) or git_author.get("name"),
                    "committed_at": git_author.get("date"),
                    "message": _first_line(commit.get("message")),
                }
            )
        return rows

    # -- DataSourceAdapter ---------------------------------------------------

    def _connect_sync(self) -> None:
        repo = self._json(self._get(self.repo_path))
        if not isinstance(repo, dict) or "full_name" not in repo:
            raise AdapterError("GitHub returned an unexpected response for the repository.")

    def _disconnect_sync(self) -> None:
        if self._client is not None:
            self._client.close()
            self._client = None

    def _table_names_sync(self) -> list[str]:
        return list(COLUMNS)

    def _known_columns(self, table: str) -> list[str] | None:
        return COLUMNS.get(table)

    def _fetch_rows_sync(self, table: str) -> list[dict[str, Any]]:
        fetch = {"deployments": self._deployments, "releases": self._releases,
                 "commits": self._commits}[table]
        return fetch()[: settings.api_source_max_rows]
