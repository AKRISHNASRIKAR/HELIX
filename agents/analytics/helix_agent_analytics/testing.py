"""An in-memory fake of services/analytics-engine (spec section C) for tests.

Shipped inside the package (not tests/) so agent-runtime's and the domain
agents' tests can reuse it. Responses mirror the evaluation dataset scenario
(tests/fixtures): a revenue drop on 2026-10-08 plus a smaller spike, so the
canned output has one clear root cause.

Phase 7 endpoints (/segments/compare, /correlation, /events/align) return
numbers computed once from tests/fixtures/orders.csv (same-weekday baseline,
4 periods) and the deployments fixture of the build spec, so the domain agents'
statements match what the real engine produces. /anomalies/detect and /kpis
vary by request: a refund filter returns refund-count anomalies,
count_distinct returns active-customer numbers, anything else keeps the
original revenue response.
"""

from __future__ import annotations

import json
import re
from datetime import date, datetime, timedelta
from typing import Any

import httpx

COMPUTED_AT = "2026-10-15T00:00:00Z"


def _day(offset_from_end: int) -> str:
    return (date(2026, 10, 14) - timedelta(days=offset_from_end)).isoformat() + "T00:00:00Z"


def _is_refund_filter(spec: dict[str, Any]) -> bool:
    flt = spec.get("filter") or {}
    value = flt.get("value")
    values = value if isinstance(value, list) else [value]
    return flt.get("op") in ("in", "eq") and "refunded" in values


def kpi_response(body: dict[str, Any]) -> dict[str, Any]:
    spec = body["kpis"][0]
    if spec.get("aggregation") == "count_distinct":
        return {
            "metrics": [
                {
                    "name": spec["name"],
                    "unit": spec.get("unit"),
                    "value": 2_031.0,
                    "baseline": 2_290.0,
                    "changePercent": -11.31,
                    "series": [
                        {"timestamp": _day(i), "value": 290.0} for i in range(6, -1, -1)
                    ],
                    "computationMethod": "7-day window count_distinct vs previous 7 days (pandas)",
                    "computedAt": COMPUTED_AT,
                    "pValue": 0.041,
                    "window": {
                        "currentStart": _day(6),
                        "currentEnd": _day(0),
                        "previousStart": _day(13),
                        "previousEnd": _day(7),
                    },
                }
            ]
        }
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


def _series_metric(body: dict[str, Any], value: float, baseline: float, method: str):
    return {
        "name": body.get("metricName") or "metric",
        "unit": None,
        "value": value,
        "baseline": baseline,
        "changePercent": round((value - baseline) / baseline * 100, 2),
        "series": [{"timestamp": _day(i), "value": baseline} for i in range(29, -1, -1)],
        "computationMethod": method,
        "computedAt": COMPUTED_AT,
    }


#: Daily refund counts (status = refunded) from orders.csv: 37 on 10-08 and 52
#: on 10-09 against a same-weekday baseline of 6.5 / 6.75, plus one ordinary blip.
REFUND_ANOMALIES = [
    {
        "timestamp": "2026-09-29T00:00:00Z",
        "value": 15.0,
        "expectedValue": 7.0,
        "deviationScore": 2.9,
        "severity": "MEDIUM",
        "direction": "spike",
        "detectionMethod": "seasonal",
        "description": "Spike in daily refunds on 2026-09-29",
    },
    {
        "timestamp": "2026-10-08T00:00:00Z",
        "value": 37.0,
        "expectedValue": 6.5,
        "deviationScore": 6.4,
        "severity": "HIGH",
        "direction": "spike",
        "detectionMethod": "seasonal",
        "description": "Spike in daily refunds on 2026-10-08",
    },
    {
        "timestamp": "2026-10-09T00:00:00Z",
        "value": 52.0,
        "expectedValue": 6.75,
        "deviationScore": 9.3,
        "severity": "CRITICAL",
        "direction": "spike",
        "detectionMethod": "seasonal",
        "description": "Spike in daily refunds on 2026-10-09",
    },
]

#: Distinct customers per day from orders.csv: 171 on 10-08 vs a baseline of 304.5.
CUSTOMER_ANOMALIES = [
    {
        "timestamp": "2026-10-08T00:00:00Z",
        "value": 171.0,
        "expectedValue": 304.5,
        "deviationScore": -6.8,
        "severity": "CRITICAL",
        "direction": "drop",
        "detectionMethod": "seasonal",
        "description": "Drop in daily active customers on 2026-10-08",
    },
]


def anomaly_response(body: dict[str, Any]) -> dict[str, Any]:
    if _is_refund_filter(body):
        return {
            "metric": _series_metric(body, 13.0, 8.2, "daily count, STL residual robust z-score"),
            "methodUsed": "seasonal",
            "anomalies": [dict(a) for a in REFUND_ANOMALIES],
            "computationMethod": "STL decomposition (period 7) + robust z-score of residuals",
        }
    if body.get("aggregation") == "count_distinct":
        return {
            "metric": _series_metric(
                body, 290.0, 304.5, "daily count_distinct, STL residual robust z-score"
            ),
            "methodUsed": "seasonal",
            "anomalies": [dict(a) for a in CUSTOMER_ANOMALIES],
            "computationMethod": "STL decomposition (period 7) + robust z-score of residuals",
        }
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


# ---------------------------------------------------------------------------
# Phase 7 endpoints
# ---------------------------------------------------------------------------

#: (aggregation, column) -> [(value, actual, expected)] on 2026-10-08, computed
#: from orders.csv with a same-weekday baseline over the previous 4 Thursdays.
SEGMENT_SLICES: dict[tuple[str, str], list[tuple[str, float, float]]] = {
    ("sum", "channel"): [
        ("web", 2991.88, 17515.16),
        ("mobile", 11800.46, 9996.2),
        ("partner", 5151.7, 5054.38),
    ],
    ("sum", "segment"): [
        ("mid_market", 7212.3, 13444.52),
        ("enterprise", 8966.54, 12284.12),
        ("smb", 3765.2, 6837.1),
    ],
    ("count", "channel"): [
        ("web", 26.0, 167.75),
        ("mobile", 104.0, 97.75),
        ("partner", 45.0, 48.0),
    ],
    ("count", "segment"): [
        ("smb", 80.0, 147.25),
        ("mid_market", 60.0, 117.5),
        ("enterprise", 35.0, 48.75),
    ],
}


def _pct(delta: float, expected: float) -> float | None:
    return round(delta / expected * 100, 2) if expected else None


def segments_response(body: dict[str, Any]) -> dict[str, Any]:
    """Implements the spec's /segments/compare definitions over SEGMENT_SLICES."""
    aggregation = body.get("aggregation", "sum")
    agg_key = "count" if aggregation == "count" else "sum"
    requested = body.get("dimensions") or ["channel", "segment"]
    columns = [c for c in requested if (agg_key, c) in SEGMENT_SLICES]
    if not columns:
        columns = ["channel"]
    first = SEGMENT_SLICES[(agg_key, columns[0])]
    actual_total = round(sum(a for _, a, _ in first), 2)
    expected_total = round(sum(e for _, _, e in first), 2)
    total_delta = round(actual_total - expected_total, 2)
    total = {
        "actual": actual_total,
        "expected": expected_total,
        "delta": total_delta,
        "deltaPercent": _pct(total_delta, expected_total),
    }
    dimensions = []
    for column in columns:
        slices = []
        for value, actual, expected in SEGMENT_SLICES[(agg_key, column)]:
            delta = round(actual - expected, 2)
            slices.append(
                {
                    "value": value,
                    "actual": actual,
                    "expected": expected,
                    "delta": delta,
                    "deltaPercent": _pct(delta, expected),
                    "shareOfDelta": round(delta / total_delta, 4) if total_delta else 0.0,
                }
            )
        slices.sort(key=lambda s: -abs(s["delta"]))
        same_sign = [s["shareOfDelta"] for s in slices if s["delta"] * total_delta > 0]
        concentration = round(min(1.0, max(0.0, max(same_sign, default=0.0))), 4)
        dimensions.append({"column": column, "concentration": concentration, "slices": slices})
    dimensions.sort(key=lambda d: -d["concentration"])
    top_slice = None
    best = dimensions[0]
    lead = best["slices"][0]
    if (
        best["concentration"] >= 0.5
        and lead["deltaPercent"] is not None
        and abs(lead["deltaPercent"]) >= 2 * abs(total["deltaPercent"] or 0.0)
    ):
        top_slice = {"column": best["column"], **lead}
    return {
        "targetDate": body.get("targetDate"),
        "metricName": body.get("metricName") or "metric",
        "unit": body.get("unit"),
        "aggregation": aggregation,
        "total": total,
        "dimensions": dimensions,
        "topSlice": top_slice,
        "computationMethod": (
            f"daily {aggregation} per slice on {body.get('targetDate')} vs mean of the previous "
            "4 same weekdays"
        ),
    }


def correlation_response(body: dict[str, Any]) -> dict[str, Any]:
    """Spearman of daily non-refunded revenue vs daily refunds over orders.csv."""
    return {
        "coefficient": 0.2554,
        "method": body.get("method", "spearman"),
        "lag": 0,
        "pValue": 0.0151,
        "n": 90,
        "a": {"name": "a"},
        "b": {"name": "b"},
        "computationMethod": "spearman correlation of daily series, best of lags 0..3",
    }


#: Deployments around the 2026-10-08 incident (build spec section 7.1).
DEPLOYMENTS: list[dict[str, Any]] = [
    {
        "id": "dep_0031",
        "service": "search",
        "version": "v5.3.2",
        "environment": "production",
        "deployed_at": "2026-10-07T15:10:00Z",
        "author": "lena",
        "description": "Tune search ranking weights",
        "status": "success",
        "commit_sha": "4be1c09",
    },
    {
        "id": "dep_0032",
        "service": "web-checkout",
        "version": "v2.14.0",
        "environment": "production",
        "deployed_at": "2026-10-08T08:40:00Z",
        "author": "marco",
        "description": "New payment form and address validation for web checkout",
        "status": "rolled_back",
        "commit_sha": "9f3a2d1",
    },
    {
        "id": "dep_0033",
        "service": "web-checkout",
        "version": "v2.14.1",
        "environment": "production",
        "deployed_at": "2026-10-09T06:15:00Z",
        "author": "marco",
        "description": "Revert payment form changes",
        "status": "success",
        "commit_sha": "c71e5b8",
    },
]


def events_align_response(body: dict[str, Any]) -> dict[str, Any]:
    """Implements the spec's /events/align window rule over DEPLOYMENTS."""
    events_spec = body.get("events") or {}
    time_column = events_spec.get("timeColumn", "deployed_at")
    label_columns = events_spec.get("labelColumns")
    before = float(body.get("windowHoursBefore", 24))
    after = float(body.get("windowHoursAfter", 24))
    matches = []
    for target in body.get("targets") or []:
        day = datetime.fromisoformat(f"{target['date']}T00:00:00+00:00")
        found = []
        for row in DEPLOYMENTS:
            when = datetime.fromisoformat(row[time_column].replace("Z", "+00:00"))
            hours_before = (day - when).total_seconds() / 3600
            if not (-(24 + after) < hours_before <= before):
                continue
            labels = {
                k: v for k, v in row.items()
                if k != time_column and (label_columns is None or k in label_columns)
            }
            found.append(
                {
                    "time": when.isoformat().replace("+00:00", "Z"),
                    "labels": labels,
                    "hoursBefore": round(hours_before, 4),
                    "sameDay": when.date() == day.date(),
                }
            )
        found.sort(key=lambda e: abs(e["hoursBefore"]))
        matches.append(
            {"target": {"date": target["date"], "label": target.get("label")}, "events": found}
        )
    return {
        "matches": matches,
        "computationMethod": f"events within {before:g}h before to {after:g}h after each day",
    }


ROUTES = {
    "/kpis": kpi_response,
    "/anomalies/detect": anomaly_response,
    "/forecast": forecast_response,
    "/segments/compare": segments_response,
    "/correlation": correlation_response,
    "/events/align": events_align_response,
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


def deployments_data_source(data_source_id: str) -> dict[str, Any]:
    """Wire-shape DataSourceContext of the MCP demo server's deployments table."""
    def col(name: str, semantic: str, col_type: str = "string") -> dict[str, Any]:
        return {"name": name, "type": col_type, "nullable": False, "semanticType": semantic}

    return {
        "id": data_source_id,
        "name": "Deployments (MCP)",
        "type": "MCP",
        "schemas": [
            {
                "tableName": "deployments",
                "rowCountEstimate": 40,
                "columns": [
                    col("id", "identifier"),
                    col("service", "categorical"),
                    col("version", "categorical"),
                    col("environment", "categorical"),
                    col("deployed_at", "datetime", "datetime64[ns, UTC]"),
                    col("author", "categorical"),
                    col("description", "text"),
                    col("status", "categorical"),
                    col("commit_sha", "identifier"),
                ],
            }
        ],
    }


# ---------------------------------------------------------------------------
# Test assertion helper: every number in a statement is backed by evidence data
# ---------------------------------------------------------------------------

_DATE_RE = re.compile(r"(?<!\d)\d{4}-\d{2}-\d{2}(?!\d)")
_TIME_RE = re.compile(r"(?<!\d)\d{1,2}:\d{2}(?!\d)")
_VERSION_RE = re.compile(r"\bv?\d+(?:\.\d+){2,}\b")
_NUMBER_RE = re.compile(r"\d[\d,]*(?:\.\d+)?")


def _leaves(value: Any):
    if isinstance(value, dict):
        for item in value.values():
            yield from _leaves(item)
    elif isinstance(value, list):
        for item in value:
            yield from _leaves(item)
    else:
        yield value


def _number_tokens(text: str) -> tuple[set[str], list[str]]:
    """(exact tokens: dates/times/versions, plain number tokens) found in `text`."""
    exact: set[str] = set()
    for pattern in (_DATE_RE, _TIME_RE, _VERSION_RE):
        exact.update(pattern.findall(text))
        text = pattern.sub(" ", text)
    return exact, _NUMBER_RE.findall(text)


def unbacked_numbers(statement: str, evidence_data: list[dict[str, Any]]) -> list[str]:
    """Number tokens in `statement` that do not appear in any of the evidence data.

    Dates (YYYY-MM-DD), clock times and versions must appear verbatim inside a
    string value; other numbers must equal (after rounding to the token's
    precision) some numeric value or some number inside a string value.
    """
    exact_pool: set[str] = set()
    numbers: list[float] = []
    for value in _leaves(evidence_data):
        if isinstance(value, bool) or value is None:
            continue
        if isinstance(value, int | float):
            numbers.append(abs(float(value)))
            continue
        exact, plain = _number_tokens(str(value))
        exact_pool |= exact
        exact_pool |= set(_DATE_RE.findall(str(value)))
        numbers.extend(float(token.replace(",", "")) for token in plain)
    missing: list[str] = []
    exact, plain = _number_tokens(statement)
    missing += sorted(token for token in exact if token not in exact_pool)
    for token in plain:
        target = float(token.replace(",", ""))
        decimals = len(token.split(".")[1]) if "." in token else 0
        tolerance = 0.5 * 10 ** (-decimals) + 1e-9
        if not any(abs(n - target) <= tolerance for n in numbers):
            missing.append(token)
    return missing


def assert_numbers_backed(result: dict[str, Any]) -> None:
    """Assert every finding's statement numbers appear in its linked evidence data."""
    evidence = {e["id"]: e for e in result.get("evidence") or []}
    for finding in result.get("findings") or []:
        data = [evidence[eid]["data"] for eid in finding["evidenceIds"]]
        missing = unbacked_numbers(finding["statement"], data)
        assert not missing, f"unbacked numbers {missing} in: {finding['statement']}"


def assembled_context(
    agent_type: str,
    data_sources: list[dict[str, Any]],
    *,
    question: str = "Why did revenue drop last week?",
    focus_dates: list[str] | None = None,
    metric_keys: list[str] | None = None,
    direction: str | None = None,
    upstream_evidence: list[dict[str, Any]] | None = None,
    organization_id: str | None = None,
) -> dict[str, Any]:
    """A camelCase AssembledContext JSON (the Phase 6 inputContext) for tests."""
    from uuid import uuid4

    from helix_contracts import AssembledContext

    context = AssembledContext.model_validate(
        {
            "contextId": str(uuid4()),
            "source": "context-engine",
            "assembledAt": COMPUTED_AT,
            "agentType": agent_type,
            "agentTaskId": str(uuid4()),
            "question": question,
            "investigationId": str(uuid4()),
            "organizationId": organization_id or str(uuid4()),
            "projectId": str(uuid4()),
            "triggerType": "USER_QUESTION",
            "step": {"order": 1, "objective": question},
            "dataSources": data_sources,
            "focus": {
                "anomalyDates": focus_dates or [],
                "metricKeys": metric_keys or [],
                "direction": direction,
            },
        }
    )
    payload = context.model_dump(mode="json", by_alias=True)
    # Upstream evidence is passed through as raw JSON so tests can hand in
    # exactly what another agent's task.result contained.
    payload["upstream"] = {"findings": [], "evidence": upstream_evidence or []}
    return payload
