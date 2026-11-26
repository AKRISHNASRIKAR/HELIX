"""The demo MCP server: one FastMCP instance with a `list_deployments` tool
over the deployments fixture (tests/fixtures/deployments.json).

It stands in for a real deploy tracker so the Product Agent can line a
metric anomaly up against deploys through an MCP connection (build spec,
section 7). The tool takes no required arguments, which is what makes the
ingestion service's McpAdapter expose it as a `deployments` table.
"""

from __future__ import annotations

import json
from datetime import UTC, date, datetime, time, timedelta
from pathlib import Path
from typing import Any

from mcp.server.fastmcp import FastMCP
from starlette.requests import Request
from starlette.responses import JSONResponse

INSTRUCTIONS = (
    "HELIX demo deploy tracker. `list_deployments` returns production deploys "
    "(service, version, deployed_at, status, description, author, commit_sha), "
    "oldest first, optionally filtered by time window and service."
)


def load_deployments(path: Path) -> list[dict[str, Any]]:
    """Read the fixture. Raises ValueError with a readable message on a bad file."""
    try:
        rows = json.loads(path.read_text())
    except FileNotFoundError:
        raise ValueError(f"Deployments file not found: {path}") from None
    except json.JSONDecodeError as exc:
        raise ValueError(f"Deployments file is not valid JSON: {exc.msg}") from None
    if not isinstance(rows, list) or not all(isinstance(r, dict) for r in rows):
        raise ValueError("Deployments file must be a JSON array of objects.")
    return rows


def parse_bound(value: str, *, end: bool) -> datetime:
    """Parse an ISO date or datetime. A bare date as `until` covers that whole day."""
    text = value.strip()
    try:
        if len(text) == 10:
            day = date.fromisoformat(text)
            moment = datetime.combine(day, time.min, tzinfo=UTC)
            return moment + timedelta(days=1) - timedelta(microseconds=1) if end else moment
        moment = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        raise ValueError(
            f"Invalid timestamp {value!r}: use ISO 8601, e.g. 2026-10-08 or 2026-10-08T08:40:00Z"
        ) from None
    return moment if moment.tzinfo else moment.replace(tzinfo=UTC)


def filter_deployments(
    rows: list[dict[str, Any]],
    since: str | None = None,
    until: str | None = None,
    service: str | None = None,
) -> list[dict[str, Any]]:
    """Rows with `since <= deployed_at <= until` (both inclusive) and a matching
    service (case-insensitive), sorted by deployed_at."""
    lower = parse_bound(since, end=False) if since else None
    upper = parse_bound(until, end=True) if until else None
    wanted = service.strip().lower() if service else None
    out = []
    for row in rows:
        at = parse_bound(str(row.get("deployed_at", "")), end=False)
        if lower and at < lower:
            continue
        if upper and at > upper:
            continue
        if wanted and str(row.get("service", "")).lower() != wanted:
            continue
        out.append(row)
    return sorted(out, key=lambda r: str(r.get("deployed_at", "")))


def build_server(fixture_path: Path) -> FastMCP:
    """A fresh FastMCP instance (one per ASGI app: its session manager runs once)."""
    mcp = FastMCP(
        "helix-mcp-demo",
        instructions=INSTRUCTIONS,
        stateless_http=True,
        json_response=True,
    )

    @mcp.tool()
    def list_deployments(
        since: str | None = None,
        until: str | None = None,
        service: str | None = None,
    ) -> list[dict[str, Any]]:
        """List production deployments, oldest first.

        Args:
            since: Inclusive lower bound, ISO date or datetime (UTC if no offset).
            until: Inclusive upper bound; a bare date covers that whole day.
            service: Only this service (e.g. web-checkout), case-insensitive.
        """
        return filter_deployments(load_deployments(fixture_path), since, until, service)

    @mcp.custom_route("/health", methods=["GET"])
    async def health(_: Request) -> JSONResponse:
        return JSONResponse({"status": "ok", "service": "mcp-demo"})

    return mcp
