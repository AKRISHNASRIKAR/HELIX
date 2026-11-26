"""Client for the API's internal history endpoint (build spec 9.4).

GET {HELIX_API_URL}/api/v1/internal/organizations/{orgId}/context with the
`x-helix-internal-token` header returns recent Metric, Anomaly and Finding rows
of the organization. The assembler treats any failure as "no history".
"""

from __future__ import annotations

from typing import Any, Protocol
from uuid import UUID

import httpx


class HistoryError(Exception):
    """The history endpoint could not be reached or returned something unusable."""


class HistorySource(Protocol):
    async def fetch(
        self,
        organization_id: UUID,
        *,
        data_source_ids: list[UUID],
        since_days: int,
        exclude_investigation_id: UUID | None,
    ) -> dict[str, list[dict[str, Any]]]: ...


class HttpHistoryClient:
    def __init__(
        self,
        api_url: str,
        internal_token: str,
        *,
        timeout: float = 3.0,
        limit: int = 50,
        transport: httpx.AsyncBaseTransport | None = None,
    ):
        self.api_url = api_url.rstrip("/")
        self.internal_token = internal_token
        self.timeout = timeout
        self.limit = limit
        self._transport = transport

    async def fetch(
        self,
        organization_id: UUID,
        *,
        data_source_ids: list[UUID],
        since_days: int,
        exclude_investigation_id: UUID | None,
    ) -> dict[str, list[dict[str, Any]]]:
        params: dict[str, Any] = {"sinceDays": since_days, "limit": self.limit}
        if data_source_ids:
            params["dataSourceIds"] = ",".join(str(i) for i in data_source_ids)
        if exclude_investigation_id:
            params["excludeInvestigationId"] = str(exclude_investigation_id)
        url = f"{self.api_url}/api/v1/internal/organizations/{organization_id}/context"
        try:
            async with httpx.AsyncClient(timeout=self.timeout, transport=self._transport) as client:
                response = await client.get(
                    url, params=params, headers={"x-helix-internal-token": self.internal_token}
                )
        except httpx.HTTPError as exc:
            raise HistoryError(f"history endpoint unreachable: {exc}") from exc
        if response.status_code >= 400:
            raise HistoryError(f"history endpoint returned HTTP {response.status_code}")
        try:
            body = response.json()
        except ValueError as exc:
            raise HistoryError("history endpoint returned invalid JSON") from exc
        if not isinstance(body, dict):
            raise HistoryError("history endpoint returned a non-object body")
        return {
            key: [row for row in body.get(key) or [] if isinstance(row, dict)]
            for key in ("metrics", "anomalies", "findings")
        }
