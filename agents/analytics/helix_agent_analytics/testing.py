"""An in-memory fake of services/analytics-engine (spec section C) for tests.

Shipped inside the package (not tests/) so agent-runtime's tests can reuse
it. Responses mirror the evaluation dataset scenario (tests/fixtures): a
revenue drop on 2026-10-08 plus a smaller spike, so the canned output has one
clear root cause.
"""

from __future__ import annotations

import json
from datetime import date, timedelta
from typing import Any

import httpx

COMPUTED_AT = "2026-10-15T00:00:00Z"


def _day(offset_from_end: int) -> str:
    return (date(2026, 10, 14) - timedelta(days=offset_from_end)).isoformat() + "T00:00:00Z"


def kpi_response(body: dict[str, Any]) -> dict[str, Any]:
    spec = body["kpis"][0]
    return {
        "metrics": [
            {
                "name": spec["name"],
                "unit": spec.get("unit"),
                "value": 1_204_331.25,
                "baseline": 1_398_120.5,
                "changePercent": -13.86,
                "series": [{"timestamp": _day(i), "value": 172_000.0} for i in range(6, -1, -1)],
                "computationMethod": "7-day window sum vs previous 7 days (pandas)",
                "computedAt": COMPUTED_AT,
                "pValue": 0.012,
                "window": {
                    "currentStart": _day(6),
                    "currentEnd": _day(0),
                    "previousStart": _day(13),
                    "previousEnd": _day(7),
                },
            }
        ]
    }


def anomaly_response(body: dict[str, Any]) -> dict[str, Any]:
    return {
        "metric": {
            "name": body.get("metricName") or "metric",
            "unit": None,
            "value": 181_442.1,
            "baseline": 190_004.0,
            "changePercent": -4.5,
            "series": [{"timestamp": _day(i), "value": 190_000.0} for i in range(29, -1, -1)],
            "computationMethod": "daily sum, STL (period 7) residual robust z-score",
            "computedAt": COMPUTED_AT,
        },
        "methodUsed": "seasonal",
        "anomalies": [
            {
                "timestamp": _day(25),
                "value": 240_100.0,
                "expectedValue": 188_000.0,
                "deviationScore": 3.4,
                "severity": "MEDIUM",
                "direction": "spike",
                "detectionMethod": "seasonal",
                "description": "Spike in daily value on 2026-09-19",
            },
            {
                "timestamp": _day(6),
                "value": 112_480.4,
                "expectedValue": 191_300.0,
                "deviationScore": -7.2,
                "severity": "CRITICAL",
                "direction": "drop",
                "detectionMethod": "seasonal",
                "description": "Drop in daily value on 2026-10-08",
            },
            {
                "timestamp": _day(40),
                "value": 150_000.0,
                "expectedValue": 180_000.0,
                "deviationScore": -3.1,
                "severity": "MEDIUM",
                "direction": "drop",
                "detectionMethod": "seasonal",
                "description": "Drop in daily value on 2026-09-04",
            },
            {
                "timestamp": _day(50),
                "value": 210_000.0,
                "expectedValue": 185_000.0,
                "deviationScore": 3.05,
                "severity": "MEDIUM",
                "direction": "spike",
                "detectionMethod": "seasonal",
                "description": "Spike in daily value on 2026-08-25",
            },
        ],
        "computationMethod": "STL decomposition (period 7) + robust z-score of residuals",
    }


def forecast_response(body: dict[str, Any]) -> dict[str, Any]:
    horizon = body.get("horizon", 14)
    return {
        "history": [{"timestamp": _day(i), "value": 190_000.0} for i in range(6, -1, -1)],
        "forecast": [
            {
                "timestamp": (date(2026, 10, 15) + timedelta(days=i)).isoformat() + "T00:00:00Z",
                "value": 195_000.0 + i,
                "lower": 170_000.0,
                "upper": 220_000.0,
            }
            for i in range(horizon)
        ],
        "methodUsed": "ets",
        "backtest": {"mape": 8.0, "holdoutDays": 14},
        "computationMethod": "Holt-Winters ETS (weekly seasonality), 14-day holdout backtest",
    }


ROUTES = {
    "/kpis": kpi_response,
    "/anomalies/detect": anomaly_response,
    "/forecast": forecast_response,
}


class FakeAnalyticsEngine:
    """MockTransport-backed engine. Flip `down` or fill `failures` to simulate errors."""

    def __init__(self) -> None:
        self.requests: list[tuple[str, dict[str, Any]]] = []
        self.down = False
        #: path -> (status_code, detail)
        self.failures: dict[str, tuple[int, str]] = {}
        #: path -> full response override
        self.overrides: dict[str, dict[str, Any]] = {}

    @property
    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self._handle)

    def paths(self) -> list[str]:
        return [path for path, _ in self.requests]

    def _handle(self, request: httpx.Request) -> httpx.Response:
        if self.down:
            raise httpx.ConnectError("[Errno 61] Connection refused", request=request)
        path = request.url.path
        body = json.loads(request.content or b"{}")
        self.requests.append((path, body))
        if path in self.failures:
            status, detail = self.failures[path]
            return httpx.Response(status, json={"detail": detail})
        if path in self.overrides:
            return httpx.Response(200, json=self.overrides[path])
        handler = ROUTES.get(path)
        if handler is None:
            return httpx.Response(404, json={"detail": "Not Found"})
        return httpx.Response(200, json=handler(body))


def orders_data_source(data_source_id: str) -> dict[str, Any]:
    """Wire-shape DataSourceContext matching tests/fixtures/orders.csv."""
    return {
        "id": data_source_id,
        "name": "Orders CSV",
        "type": "CSV",
        "schemas": [
            {
                "tableName": "orders",
                "rowCountEstimate": 22000,
                "columns": [
                    {"name": "order_id", "type": "string", "nullable": False,
                     "semanticType": "identifier"},
                    {"name": "created_at", "type": "datetime64[ns, UTC]", "nullable": False,
                     "semanticType": "datetime"},
                    {"name": "customer_id", "type": "string", "nullable": False,
                     "semanticType": "identifier"},
                    {"name": "segment", "type": "string", "nullable": False,
                     "semanticType": "categorical"},
                    {"name": "channel", "type": "string", "nullable": False,
                     "semanticType": "categorical"},
                    {"name": "amount", "type": "float64", "nullable": False,
                     "semanticType": "currency"},
                    {"name": "status", "type": "string", "nullable": False,
                     "semanticType": "categorical"},
                ],
            }
        ],
    }
