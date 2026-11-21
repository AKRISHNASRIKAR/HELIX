"""HTTP progress reporter: forwards Coordinator progress to the API (spec A2).

POST {HELIX_API_URL}/api/v1/internal/investigations/{id}/progress with the
`x-helix-internal-token` header. Best effort: a short timeout, failures are
logged and swallowed so a down API never breaks an investigation run.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

import httpx

logger = logging.getLogger(__name__)


class HttpProgressReporter:
    def __init__(
        self,
        api_url: str,
        internal_token: str,
        *,
        timeout: float = 2.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ):
        self.api_url = api_url.rstrip("/")
        self.internal_token = internal_token
        self.timeout = timeout
        self._transport = transport

    async def report(
        self,
        investigation_id: UUID,
        *,
        status: str | None = None,
        event_type: str | None = None,
        payload: dict[str, Any] | None = None,
    ) -> None:
        body: dict[str, Any] = {}
        if status:
            body["status"] = status
        if event_type:
            body["event"] = {
                "type": event_type,
                "payload": payload or {},
                "at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
            }
        if not body:
            return
        url = f"{self.api_url}/api/v1/internal/investigations/{investigation_id}/progress"
        try:
            async with httpx.AsyncClient(timeout=self.timeout, transport=self._transport) as client:
                response = await client.post(
                    url, json=body, headers={"x-helix-internal-token": self.internal_token}
                )
            if response.status_code >= 400:
                logger.warning(
                    "Progress report %s for investigation %s rejected: HTTP %s",
                    event_type or status, investigation_id, response.status_code,
                )
        except httpx.HTTPError as exc:
            logger.warning(
                "Progress report %s for investigation %s failed: %s",
                event_type or status, investigation_id, exc,
            )
