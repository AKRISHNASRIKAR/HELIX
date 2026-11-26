"""Endpoint tests for /segments/compare, /correlation and /events/align."""

import httpx
import numpy as np
import pandas as pd
import pytest
from app import dataset
from app.main import app
from fastapi.testclient import TestClient
from scipy import stats

client = TestClient(app)
START = pd.Timestamp("2026-03-01", tz="UTC")


def _orders(days: int = 35, drop_day: int = 28) -> list[dict]:
    """Per day: 10 web orders and 10 mobile orders of 10.0; web keeps 2 on drop_day."""
    rows = []
    for d in range(days):
        day = START + pd.Timedelta(days=d)
        for channel in ("web", "mobile"):
            n = 2 if (d == drop_day and channel == "web") else 10
            for k in range(n):
                rows.append(
                    {
                        "created_at": (day + pd.Timedelta(hours=k)).isoformat(),
                        "channel": channel,
                        "segment": "smb" if k % 2 else "enterprise",
                        "status": "completed",
                        "amount": 10.0,
                        "order_id": f"o{d}{channel}{k}",
                    }
                )
    return rows


def _compare(rows, **spec) -> httpx.Response:
    body = {
        "dataset": {"rows": rows},
        "timeColumn": "created_at",
        "targetDate": "2026-03-29",
        **spec,
    }
    return client.post("/segments/compare", json=body)


def test_segments_compare_shape_and_numbers():
    response = _compare(_orders(), valueColumn="amount", unit="USD", metricName="revenue")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["targetDate"] == "2026-03-29"
    assert (body["metricName"], body["unit"], body["aggregation"]) == ("revenue", "USD", "sum")
    # total: 20 + 100 = 120 vs 200.
    assert body["total"] == {
        "actual": 120.0,
        "expected": 200.0,
        "delta": -80.0,
        "deltaPercent": -40.0,
    }
    # status has one value, order_id too many: only channel and segment are dimensions.
    assert [d["column"] for d in body["dimensions"]] == ["channel", "segment"]
    web = body["dimensions"][0]["slices"][0]
    assert web == {
        "value": "web",
        "actual": 20.0,
        "expected": 100.0,
        "delta": -80.0,
        "deltaPercent": -80.0,
        "shareOfDelta": 1.0,
    }
    assert body["topSlice"] == {**web, "column": "channel"}
    assert "same weekday" in body["computationMethod"]


def test_segments_compare_filter_and_explicit_dimensions():
    rows = _orders()
    response = _compare(
        rows,
        aggregation="count",
        dimensions=["segment"],
        filter={"column": "channel", "op": "eq", "value": "web"},
        baseline="trailing_mean",
        baselinePeriods=1,
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total"]["actual"] == 2.0
    assert body["total"]["expected"] == 10.0
    [segment] = body["dimensions"]
    assert segment["column"] == "segment"
    # Within web, both segments fall 80%: not concentrated enough to name one.
    assert body["topSlice"] is None
    assert "where channel = 'web'" in body["computationMethod"]


def test_segments_compare_default_dimensions_exclude_filter_column():
    body = _compare(
        _orders(), valueColumn="amount", filter={"column": "channel", "op": "eq", "value": "web"}
    ).json()
    assert [d["column"] for d in body["dimensions"]] == ["segment"]


def test_segments_compare_errors_are_422():
    rows = _orders()
    assert _compare(rows, valueColumn="amount", targetDate="2027-01-01").status_code == 422
    assert _compare(rows, valueColumn="amount", targetDate="2026-03-02").status_code == 422
    unknown = _compare(rows, valueColumn="amount", dimensions=["nope"])
    assert unknown.status_code == 422
    assert "nope" in unknown.json()["detail"]
    assert _compare(rows, aggregation="sum").status_code == 422  # sum needs valueColumn
    assert _compare(rows, valueColumn="amount", targetDate="not a date").status_code == 422
    no_dims = _compare([{"created_at": r["created_at"], "amount": r["amount"]} for r in rows],
                       valueColumn="amount")
    assert no_dims.status_code == 422
    assert "No dimensions" in no_dims.json()["detail"]


def _daily_rows(values, column="amount", start=START) -> list[dict]:
    return [
        {"created_at": (start + pd.Timedelta(days=i)).isoformat(), column: float(v)}
        for i, v in enumerate(values)
    ]


def test_correlation_finds_lag_and_matches_scipy():
    rng = np.random.default_rng(5)
    b_values = rng.normal(100, 10, 30)
    # a[t] = 2 * b[t - 1] + noise: b leads a by one day.
    a_values = np.concatenate([[200.0], 2 * b_values[:-1]]) + rng.normal(0, 1, 30)
    body = {
        "a": {"dataset": {"rows": _daily_rows(a_values)}, "timeColumn": "created_at",
              "valueColumn": "amount", "name": "revenue"},
        "b": {"dataset": {"rows": _daily_rows(b_values)}, "timeColumn": "created_at",
              "valueColumn": "amount"},
        "method": "pearson",
        "maxLag": 3,
    }
    response = client.post("/correlation", json=body)
    assert response.status_code == 200, response.text
    out = response.json()
    assert out["lag"] == 1
    assert out["method"] == "pearson"
    assert out["n"] == 29
    expected = stats.pearsonr(a_values[1:], b_values[:-1])
    assert out["coefficient"] == pytest.approx(expected.statistic)
    assert out["pValue"] == pytest.approx(expected.pvalue)
    assert out["a"] == {"name": "revenue"}
    assert out["b"] == {"name": "sum(amount)"}
    assert "Pearson" in out["computationMethod"]


def test_correlation_needs_ten_overlapping_days():
    spec = {"dataset": {"rows": _daily_rows(range(9))}, "timeColumn": "created_at",
            "valueColumn": "amount"}
    response = client.post("/correlation", json={"a": spec, "b": spec})
    assert response.status_code == 422
    assert "10 overlapping days" in response.json()["detail"]
    too_far = client.post("/correlation", json={"a": spec, "b": spec, "maxLag": 15})
    assert too_far.status_code == 422


DEPLOYS = [
    {"deployed_at": "2026-10-08T08:40:00Z", "service": "web-checkout", "version": "v2.14.0",
     "environment": "production", "status": "succeeded"},
    {"deployed_at": "2026-10-07T21:00:00Z", "service": "search", "version": "v1.3.2",
     "environment": "production", "status": "succeeded"},
    {"deployed_at": "2026-10-01T10:00:00Z", "service": "web-checkout", "version": "v2.13.0",
     "environment": "production", "status": "succeeded"},
    {"deployed_at": "2026-10-08T12:00:00Z", "service": "api", "version": "v9.0.0",
     "environment": "staging", "status": "succeeded"},
]


def _align(**spec) -> httpx.Response:
    body = {
        "events": {"dataset": {"rows": DEPLOYS}, "timeColumn": "deployed_at"},
        "targets": [{"date": "2026-10-08", "label": "revenue drop"}],
        **spec,
    }
    return client.post("/events/align", json=body)


def test_events_align_matches_and_orders_by_distance():
    response = _align()
    assert response.status_code == 200, response.text
    [match] = response.json()["matches"]
    assert match["target"] == {"date": "2026-10-08", "label": "revenue drop"}
    times = [e["time"] for e in match["events"]]
    assert times == ["2026-10-07T21:00:00Z", "2026-10-08T08:40:00Z", "2026-10-08T12:00:00Z"]
    search, checkout, _ = match["events"]
    assert search["hoursBefore"] == pytest.approx(3.0)
    assert search["sameDay"] is False
    assert checkout["hoursBefore"] == pytest.approx(-(8 + 40 / 60))
    assert checkout["sameDay"] is True
    # Default labels = every column except the time column.
    assert checkout["labels"] == {
        "service": "web-checkout",
        "version": "v2.14.0",
        "environment": "production",
        "status": "succeeded",
    }
    assert "|hoursBefore|" in response.json()["computationMethod"]


def test_events_align_filter_label_columns_and_windows():
    response = _align(
        events={
            "dataset": {"rows": DEPLOYS},
            "timeColumn": "deployed_at",
            "labelColumns": ["service", "version"],
            "filter": {"column": "environment", "op": "eq", "value": "production"},
        },
        targets=[{"date": "2026-10-08"}, {"date": "2026-10-02"}],
        windowHoursBefore=0,
        windowHoursAfter=0,
    )
    assert response.status_code == 200, response.text
    first, second = response.json()["matches"]
    assert first["target"] == {"date": "2026-10-08", "label": None}
    assert first["events"] == [
        {
            "time": "2026-10-08T08:40:00Z",
            "labels": {"service": "web-checkout", "version": "v2.14.0"},
            "hoursBefore": pytest.approx(-(8 + 40 / 60)),
            "sameDay": True,
        }
    ]
    assert second["events"] == []


def test_events_align_errors_are_422():
    assert _align(targets=[]).status_code == 422
    assert _align(windowHoursBefore=-1).status_code == 422
    bad = _align(events={"dataset": {"rows": DEPLOYS}, "timeColumn": "deployed_at",
                         "labelColumns": ["nope"]})
    assert bad.status_code == 422
    missing_time = _align(events={"dataset": {"rows": DEPLOYS}, "timeColumn": "nope"})
    assert missing_time.status_code == 422


def test_events_align_through_ingestion_requests_needed_columns(monkeypatch):
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(httpx.Response(200, content=request.content).json())
        return httpx.Response(200, json={"rows": DEPLOYS})

    real = httpx.AsyncClient

    def factory(*args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(handler)
        return real(*args, **kwargs)

    monkeypatch.setattr(dataset.httpx, "AsyncClient", factory)
    ref = {"dataSourceId": "ds", "organizationId": "org", "table": "deployments"}
    response = _align(
        events={"dataset": ref, "timeColumn": "deployed_at", "labelColumns": ["service"]}
    )
    assert response.status_code == 200, response.text
    assert seen[0]["columns"] == ["deployed_at", "service"]
    assert seen[0]["table"] == "deployments"
