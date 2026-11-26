"""Test fixtures: agent results shaped like the spec section 3 evidence kinds.

orders_ground_truth() reproduces what the Analytics, Finance, Customer and
Product agents report for tests/fixtures/orders.csv plus the deployments feed
(web checkout broke on 2026-10-08 after a web-checkout deploy). The numbers
are representative, not recomputed; they only have to be internally
consistent. Used by this package's tests and by the Coordinator's tests.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

COLLECTED_AT = datetime(2026, 10, 15, tzinfo=UTC).isoformat()
DAY = "2026-10-08"


def _evidence(task_id: str, kind_data: dict[str, Any], *, source_type: str, summary: str,
              confidence: float) -> dict[str, Any]:
    return {
        "id": str(uuid4()),
        "agentTaskId": task_id,
        "sourceType": source_type,
        "source": {"agentTaskId": task_id, "description": summary},
        "summary": summary,
        "data": kind_data,
        "confidence": confidence,
        "collectedAt": COLLECTED_AT,
    }


def _finding(task_id: str, agent: str, statement: str, confidence: float,
             evidence: list[dict[str, Any]], analytics_type: str = "DIAGNOSTIC") -> dict[str, Any]:
    return {
        "id": str(uuid4()),
        "agentTaskId": task_id,
        "agentType": agent,
        "analyticsType": analytics_type,
        "statement": statement,
        "confidence": confidence,
        "isRootCause": False,
        "evidenceIds": [e["id"] for e in evidence],
    }


def _result(evidence, findings, metrics=None, anomalies=None) -> dict[str, Any]:
    return {"evidence": evidence, "findings": findings, "metrics": metrics or [],
            "anomalies": anomalies or [], "plan": {"reasoning": "fixture"}}


def analytics_result(task_id: str) -> dict[str, Any]:
    metric_id, anomaly_id = str(uuid4()), str(uuid4())
    metric = {"id": metric_id, "dataSourceId": None, "name": "revenue (daily)", "unit": "USD",
              "value": 19761.0, "series": [{"timestamp": COLLECTED_AT, "value": 19761.0}],
              "computationMethod": "daily sum", "computedAt": COLLECTED_AT}
    anomaly_row = {"id": anomaly_id, "metricId": metric_id, "dataSourceId": None,
                   "description": "Revenue drop on 2026-10-08", "severity": "CRITICAL",
                   "detectedAt": f"{DAY}T00:00:00Z", "detectionMethod": "seasonal",
                   "value": 19761.0, "expectedValue": 32935.0, "deviationScore": -6.1}
    kpi = _evidence(task_id, {
        "kind": "kpi", "metricKey": "revenue", "metricName": "revenue", "unit": "USD",
        "changePercent": -13.9,
        "formatted": {"value": "$1,204,331.25", "baseline": "$1,398,120.50",
                      "changePercent": "13.9%", "period": "the 7 days ending 2026-10-14"},
    }, source_type="METRIC", summary="Revenue KPI", confidence=0.988)
    anomaly = _evidence(task_id, {
        "kind": "anomaly", "anomalyId": anomaly_id, "metricId": metric_id,
        "metricKey": "revenue", "metricName": "revenue", "unit": "USD",
        "timestamp": f"{DAY}T00:00:00+00:00", "date": DAY, "direction": "drop",
        "severity": "CRITICAL", "value": 19761.0, "expectedValue": 32935.0,
        "deviationScore": -6.1, "detectionMethod": "seasonal",
        "formatted": {"value": "$19,761.00", "expectedValue": "$32,935.00",
                      "day": "Thursday 2026-10-08"},
    }, source_type="ANOMALY", summary="Revenue drop on 2026-10-08", confidence=0.999)
    segment = _evidence(task_id, {
        "kind": "segment", "metricKey": "revenue", "metricName": "revenue", "unit": "USD",
        "date": DAY, "direction": "drop",
        "total": {"actual": 19761.0, "expected": 32935.0, "delta": -13174.0,
                  "deltaPercent": -40.0},
        "topSlice": {"column": "channel", "value": "web", "actual": 2206.3, "expected": 14700.0,
                     "delta": -12493.7, "deltaPercent": -85.0, "shareOfDelta": 0.948},
        "concentration": 0.948,
        "dimensions": [
            {"column": "channel", "concentration": 0.948, "slices": [
                {"value": "web", "actual": 2206.3, "expected": 14700.0, "delta": -12493.7,
                 "deltaPercent": -85.0, "shareOfDelta": 0.948},
                {"value": "mobile", "actual": 11800.0, "expected": 12300.0, "delta": -500.0,
                 "deltaPercent": -4.1, "shareOfDelta": 0.038},
            ]},
        ],
        "computationMethod": "same_weekday baseline over 4 periods",
        "formatted": {"actual": "$2,206.30", "expected": "$14,700.00",
                      "deltaPercent": "-85.0%", "shareOfDelta": "94.8%",
                      "totalDelta": "$13,174.00", "day": "Thursday 2026-10-08"},
    }, source_type="METRIC", summary="Revenue drop concentrated in channel = web",
        confidence=0.947)
    findings = [
        _finding(task_id, "ANALYTICS", "Revenue was down 13.9% over the 7 days ending "
                 "2026-10-14.", 0.988, [kpi], "DESCRIPTIVE"),
        _finding(task_id, "ANALYTICS", "Revenue dropped on Thursday 2026-10-08: $19,761.00 "
                 "against an expected $32,935.00 (deviation score -6.1, CRITICAL severity, "
                 "detected by seasonal).", 0.999, [anomaly]),
        _finding(task_id, "ANALYTICS", "The revenue drop on Thursday 2026-10-08 is concentrated "
                 "in channel = web: web revenue was $2,206.30 against an expected $14,700.00 "
                 "(-85.0%), 94.8% of the total shortfall.", 0.947, [segment]),
    ]
    return _result([kpi, anomaly, segment], findings, [metric], [anomaly_row])


def _refund_co_anomaly(task_id: str, day: str, weekday: str, value: float, expected: float,
                       score: float, confidence: float) -> dict[str, Any]:
    return _evidence(task_id, {
        "kind": "co_anomaly", "anomalyId": None, "metricId": None,
        "metricKey": "refunds", "metricName": "refunds", "unit": "count",
        "timestamp": f"{day}T00:00:00+00:00", "date": day, "direction": "spike",
        "severity": "HIGH", "value": value, "expectedValue": expected,
        "deviationScore": score, "detectionMethod": "seasonal",
        "relatedTo": {"metricKey": "revenue", "date": DAY},
        "formatted": {"value": f"{value:g}", "expectedValue": f"{expected:g}",
                      "day": f"{weekday} {day}"},
    }, source_type="ANOMALY", summary=f"Refund spike on {day}", confidence=confidence)


def finance_result(task_id: str) -> dict[str, Any]:
    volume = _evidence(task_id, {
        "kind": "segment_volume", "metricKey": "orders", "metricName": "orders", "unit": "count",
        "date": DAY, "direction": "drop",
        "total": {"actual": 241.0, "expected": 392.5, "delta": -151.5, "deltaPercent": -38.6},
        "topSlice": {"column": "channel", "value": "web", "actual": 26.0, "expected": 171.5,
                     "delta": -145.5, "deltaPercent": -84.8, "shareOfDelta": 0.96},
        "concentration": 0.96,
        "dimensions": [{"column": "channel", "concentration": 0.96, "slices": []}],
        "computationMethod": "same_weekday baseline over 4 periods",
        "formatted": {"actual": "26", "expected": "171.5", "deltaPercent": "-84.8%",
                      "day": "Thursday 2026-10-08"},
    }, source_type="METRIC", summary="Web order volume collapse", confidence=0.96)
    refunds_08 = _refund_co_anomaly(task_id, DAY, "Thursday", 41, 9, 5.2, 0.999)
    refunds_09 = _refund_co_anomaly(task_id, "2026-10-09", "Friday", 33, 9, 4.1, 0.999)
    correlation = _evidence(task_id, {
        "kind": "correlation", "metricKey": "revenue", "otherMetricKey": "refunds",
        "metricName": "revenue", "unit": "USD", "coefficient": -0.62, "method": "spearman",
        "lag": 0, "pValue": 0.001, "n": 90,
        "formatted": {"coefficient": "-0.62", "pValue": "0.001"},
    }, source_type="METRIC", summary="Revenue vs refunds correlation", confidence=0.999)
    findings = [
        _finding(task_id, "FINANCE", "Web orders fell to 26 on Thursday 2026-10-08 against an "
                 "expected 171.5 (-84.8%), while other channels were within their normal "
                 "range, which points to a checkout or payment failure in the web channel "
                 "rather than lower demand.", 0.96, [volume]),
        _finding(task_id, "FINANCE", "Refunds spiked on Thursday 2026-10-08: 41 against an "
                 "expected 9.", 0.999, [refunds_08]),
        _finding(task_id, "FINANCE", "Refunds spiked on Friday 2026-10-09: 33 against an "
                 "expected 9.", 0.999, [refunds_09]),
        _finding(task_id, "FINANCE", "Daily revenue and refunds are negatively correlated "
                 "(spearman -0.62).", 0.999, [correlation], "DESCRIPTIVE"),
    ]
    return _result([volume, refunds_08, refunds_09, correlation], findings)


def customer_result(task_id: str) -> dict[str, Any]:
    neutral = _evidence(task_id, {
        "kind": "segment_neutral", "metricKey": "revenue", "metricName": "revenue",
        "unit": "USD", "date": DAY, "direction": "drop",
        "total": {"actual": 19761.0, "expected": 32935.0, "delta": -13174.0,
                  "deltaPercent": -40.0},
        "topSlice": None, "concentration": 0.38,
        "dimensions": [{"column": "segment", "concentration": 0.38, "slices": [
            {"value": "enterprise", "actual": 7000.0, "expected": 12000.0, "delta": -5000.0,
             "deltaPercent": -41.7, "shareOfDelta": 0.38},
            {"value": "mid_market", "actual": 6800.0, "expected": 11000.0, "delta": -4200.0,
             "deltaPercent": -38.2, "shareOfDelta": 0.32},
            {"value": "smb", "actual": 5961.0, "expected": 9935.0, "delta": -3974.0,
             "deltaPercent": -40.0, "shareOfDelta": 0.30},
        ]}],
        "computationMethod": "same_weekday baseline over 4 periods",
        "formatted": {"concentration": "38.0%", "day": "Thursday 2026-10-08"},
    }, source_type="METRIC", summary="Customer segments are not the driver", confidence=0.62)
    findings = [
        _finding(task_id, "CUSTOMER", "Customer segments do not explain the drop on 2026-10-08: "
                 "enterprise, mid_market and smb all moved within 1.7% of the overall change.",
                 0.62, [neutral]),
    ]
    return _result([neutral], findings)


def product_result(task_id: str) -> dict[str, Any]:
    event = _evidence(task_id, {
        "kind": "event_alignment", "metricKey": "revenue", "metricName": "revenue",
        "unit": "USD", "date": DAY, "anomalyTimestamp": f"{DAY}T00:00:00+00:00",
        "event": {"time": f"{DAY}T08:40:00+00:00", "labels": {
            "service": "web-checkout", "version": "v2.14.0", "environment": "production",
            "description": "New checkout flow", "status": "rolled_back", "author": "ci-bot"}},
        "hoursBefore": -8.67, "sameDay": True, "keywordMatch": ["web", "checkout"],
        "formatted": {"time": "08:40 UTC on Thursday 2026-10-08", "hoursBefore": "0"},
    }, source_type="API_RESPONSE", summary="web-checkout v2.14.0 deploy on 2026-10-08",
        confidence=1.0)
    findings = [
        _finding(task_id, "PRODUCT", "Deployment web-checkout v2.14.0 to production at 08:40 UTC "
                 "on Thursday 2026-10-08 came 0 hours before the start of the revenue drop day "
                 "(same day); it was later rolled back.", 1.0, [event]),
    ]
    return _result([event], findings)


RESULT_BUILDERS = {
    "ANALYTICS": analytics_result,
    "FINANCE": finance_result,
    "CUSTOMER": customer_result,
    "PRODUCT": product_result,
}


def orders_ground_truth(task_ids: dict[str, str] | None = None) -> dict[str, dict[str, Any]]:
    """{agentType: result JSON} for the four domain agents."""
    task_ids = task_ids or {}
    return {
        agent: build(task_ids.get(agent) or str(uuid4()))
        for agent, build in RESULT_BUILDERS.items()
    }
