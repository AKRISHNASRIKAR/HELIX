"""Thin async HTTP client for services/analytics-engine (spec section C).

Every number the Analytics Agent reports comes back through this client
(ADR-005). Errors are normalized into AnalyticsEngineError with a readable
message so the agent can put it straight into AgentTask.error.
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass, field
from typing import Any

import httpx

DEFAULT_ANALYTICS_ENGINE_URL = "http://localhost:8002"


class AnalyticsEngineError(Exception):
    """A failed engine call (unreachable, timeout, non-2xx, or malformed body)."""

    def __init__(self, endpoint: str, message: str, status_code: int | None = None):
        super().__init__(message)
        self.endpoint = endpoint
        self.status_code = status_code


@dataclass
class ToolCall:
    """One engine call, recorded in task.result.toolCalls for auditability."""

    endpoint: str
    request: dict[str, Any]
    ms: int
    ok: bool
    status_code: int | None = None
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "endpoint": self.endpoint,
            "request": self.request,
            "ms": self.ms,
            "ok": self.ok,
            "statusCode": self.status_code,
            "error": self.error,
        }


@dataclass
class ToolCallLog:
    calls: list[ToolCall] = field(default_factory=list)

    def to_list(self) -> list[dict[str, Any]]:
        return [call.to_dict() for call in self.calls]


def summarize_request(body: dict[str, Any]) -> dict[str, Any]:
    """The request minus any inline rows, so tool-call logs stay small."""
    summary = {key: value for key, value in body.items() if key != "dataset"}
    dataset = body.get("dataset") or {}
    summary["dataset"] = {key: value for key, value in dataset.items() if key != "rows"}
    if "rows" in dataset:
        summary["dataset"]["rowCount"] = len(dataset["rows"])
    return summary


def _detail(response: httpx.Response) -> str:
    try:
        body = response.json()
    except ValueError:
        return response.text[:300] or response.reason_phrase
    if isinstance(body, dict) and "detail" in body:
        detail = body["detail"]
        return detail if isinstance(detail, str) else str(detail)[:300]
    return str(body)[:300]


class AnalyticsEngineClient:
    """POSTs JSON to the engine. Pass `client` (or `transport`) to inject a mock."""

    def __init__(
        self,
        base_url: str | None = None,
        *,
        timeout: float = 30.0,
        transport: httpx.AsyncBaseTransport | None = None,
        client: httpx.AsyncClient | None = None,
    ):
        self.base_url = (
            base_url or os.environ.get("ANALYTICS_ENGINE_URL") or DEFAULT_ANALYTICS_ENGINE_URL
        ).rstrip("/")
        self.timeout = timeout
        self._transport = transport
        self._client = client

    async def post(
        self, endpoint: str, body: dict[str, Any], log: ToolCallLog | None = None
    ) -> dict[str, Any]:
        started = time.perf_counter()
        call = ToolCall(endpoint=endpoint, request=summarize_request(body), ms=0, ok=False)
        if log is not None:
            log.calls.append(call)
        try:
            response = await self._send(endpoint, body)
            call.status_code = response.status_code
            if response.status_code >= 400:
                raise AnalyticsEngineError(
                    endpoint,
                    f"Analytics engine rejected POST {endpoint} "
                    f"(HTTP {response.status_code}): {_detail(response)}",
                    response.status_code,
                )
            try:
                data = response.json()
            except ValueError as exc:
                raise AnalyticsEngineError(
                    endpoint, f"Analytics engine returned invalid JSON for POST {endpoint}."
                ) from exc
            if not isinstance(data, dict):
                raise AnalyticsEngineError(
                    endpoint, f"Analytics engine returned an unexpected body for POST {endpoint}."
                )
            call.ok = True
            return data
        except httpx.TimeoutException as exc:
            call.error = f"Analytics engine timed out after {self.timeout:g}s on POST {endpoint}."
            raise AnalyticsEngineError(endpoint, call.error) from exc
        except httpx.HTTPError as exc:
            call.error = (
                f"Analytics engine is unreachable at {self.base_url} (POST {endpoint}): "
                f"{type(exc).__name__}: {exc}".rstrip(": ")
            )
            raise AnalyticsEngineError(endpoint, call.error) from exc
        except AnalyticsEngineError as exc:
            call.error = str(exc)
            raise
        finally:
            call.ms = round((time.perf_counter() - started) * 1000)

    async def _send(self, endpoint: str, body: dict[str, Any]) -> httpx.Response:
        if self._client is not None:
            return await self._client.post(f"{self.base_url}{endpoint}", json=body)
        # A short-lived client per call keeps this safe to share across event
        # loops (TestClient, uvicorn reloads) at the cost of no pooling.
        async with httpx.AsyncClient(
            base_url=self.base_url, timeout=self.timeout, transport=self._transport
        ) as client:
            return await client.post(endpoint, json=body)

    async def kpis(self, body: dict[str, Any], log: ToolCallLog | None = None) -> dict[str, Any]:
        return await self.post("/kpis", body, log)

    async def detect_anomalies(
        self, body: dict[str, Any], log: ToolCallLog | None = None
    ) -> dict[str, Any]:
        return await self.post("/anomalies/detect", body, log)

    async def forecast(
        self, body: dict[str, Any], log: ToolCallLog | None = None
    ) -> dict[str, Any]:
        return await self.post("/forecast", body, log)
