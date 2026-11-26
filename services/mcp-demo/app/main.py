"""ASGI entry point: the FastMCP streamable HTTP app (MCP endpoint at /mcp,
plus GET /health), behind an optional bearer token check.

Run with `pnpm --filter @helix/mcp-demo dev` (port MCP_DEMO_PORT, default 8006).
"""

from __future__ import annotations

import hmac
import json
from pathlib import Path

from starlette.types import ASGIApp, Receive, Scope, Send

from .config import settings
from .server import build_server

OPEN_PATHS = {"/health"}


class BearerTokenMiddleware:
    """Reject requests without `Authorization: Bearer <token>` (except OPEN_PATHS).

    Pure ASGI so the wrapped app's lifespan (which runs the MCP session
    manager) passes straight through.
    """

    def __init__(self, app: ASGIApp, token: str) -> None:
        self.app = app
        self.expected = f"Bearer {token}".encode()

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope.get("path") in OPEN_PATHS:
            await self.app(scope, receive, send)
            return
        supplied = dict(scope.get("headers") or []).get(b"authorization", b"")
        if hmac.compare_digest(supplied, self.expected):
            await self.app(scope, receive, send)
            return
        body = json.dumps({"error": "Missing or invalid bearer token."}).encode()
        await send(
            {
                "type": "http.response.start",
                "status": 401,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"www-authenticate", b"Bearer"),
                    (b"content-length", str(len(body)).encode()),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})


def create_app(fixture_path: Path | None = None, token: str | None = None) -> ASGIApp:
    """Build the ASGI app. Defaults come from MCP_DEMO_FIXTURE_PATH / MCP_DEMO_TOKEN."""
    server = build_server(fixture_path or settings.fixture_path)
    app: ASGIApp = server.streamable_http_app()
    token = token if token is not None else settings.token
    if token:
        app = BearerTokenMiddleware(app, token)
    return app


app = create_app()
