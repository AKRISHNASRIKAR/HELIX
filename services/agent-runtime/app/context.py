"""HTTP client for services/context-engine (build spec 6.1).

HttpContextProvider implements the Coordinator's ContextProvider protocol
(`async def assemble(request) -> AssembledContext`). It raises on any failure;
the Coordinator then hand-assembles a fallback context (source="fallback") so
an investigation never stops because the context engine is down.
"""

from __future__ import annotations

import httpx
from helix_contracts import AssembledContext, ContextAssembleRequest
from pydantic import ValidationError


class ContextEngineError(Exception):
    """The context engine was unreachable or returned an unusable response."""


class HttpContextProvider:
    def __init__(
        self,
        base_url: str,
        timeout: float = 10.0,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
    ):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self._transport = transport

    async def assemble(self, request: ContextAssembleRequest) -> AssembledContext:
        url = f"{self.base_url}/context/assemble"
        body = request.model_dump(mode="json", by_alias=True)
        try:
            async with httpx.AsyncClient(timeout=self.timeout, transport=self._transport) as client:
                response = await client.post(url, json=body)
        except httpx.HTTPError as exc:
            raise ContextEngineError(f"context engine unreachable: {exc}") from exc
        if response.status_code >= 400:
            raise ContextEngineError(
                f"context engine returned HTTP {response.status_code}: {response.text[:200]}"
            )
        try:
            return AssembledContext.model_validate(response.json())
        except (ValueError, ValidationError) as exc:
            raise ContextEngineError(f"context engine returned an invalid context: {exc}") from exc
