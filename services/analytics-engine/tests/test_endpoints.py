import httpx
import numpy as np
import pandas as pd
import pytest
from app import dataset
from app.config import settings
from app.main import app
from fastapi.testclient import TestClient

client = TestClient(app)


def _rows(days: int = 42, spike_day: int | None = 30) -> list[dict]:
    """Two orders per day with a weekly pattern; one day gets a big spike."""
    rng = np.random.default_rng(7)
    rows = []
    start = pd.Timestamp("2026-03-01", tz="UTC")
    for d in range(days):
        day = start + pd.Timedelta(days=d)
        base = 100.0 if day.dayofweek < 5 else 60.0
        for k in range(2):
            amount = base + rng.normal(0, 3)
            if d == spike_day:
                amount *= 3
            rows.append(
                {
                    "created_at": (day + pd.Timedelta(hours=k * 6)).isoformat(),
                    "amount": round(amount, 2),
                    "status": "refunded" if (d + k) % 9 == 0 else "completed",
                    "customer_id": f"c{(d * 2 + k) % 11}",
                }
            )
    return rows


def test_kpis_shape_and_values():
    rows = _rows()
    body = {
        "dataset": {"rows": rows},
        "timeColumn": "created_at",
        "windowDays": 7,
        "kpis": [
            {"name": "revenue", "aggregation": "sum", "column": "amount", "unit": "USD"},
            {
                "name": "refund_rate",
                "aggregation": "ratio",
                "numerator": {
                    "aggregation": "count",
                    "filter": {"column": "status", "op": "eq", "value": "refunded"},
                },
                "denominator": {"aggregation": "count"},
            },
        ],
    }
    response = client.post("/kpis", json=body)
    assert response.status_code == 200, response.text
    revenue, refund_rate = response.json()["metrics"]
    df = pd.DataFrame(rows)
    df["day"] = pd.to_datetime(df["created_at"]).dt.floor("D")
    last = df["day"].max()
    current = df[df["day"] > last - pd.Timedelta(days=7)]
    week = pd.Timedelta(days=7)
    previous = df[(df["day"] <= last - week) & (df["day"] > last - 2 * week)]
    assert revenue["value"] == pytest.approx(current["amount"].sum(), rel=1e-12)
    assert revenue["baseline"] == pytest.approx(previous["amount"].sum(), rel=1e-12)
    assert revenue["unit"] == "USD"
    assert len(revenue["series"]) == 14
    assert revenue["window"] == {
        "currentStart": "2026-04-05T00:00:00Z",
        "currentEnd": "2026-04-11T00:00:00Z",
        "previousStart": "2026-03-29T00:00:00Z",
        "previousEnd": "2026-04-04T00:00:00Z",
    }
    assert 0 <= revenue["pValue"] <= 1
    assert refund_rate["value"] == pytest.approx((current["status"] == "refunded").mean())
    for metric in (revenue, refund_rate):
        assert metric["computationMethod"]
        assert metric["computedAt"].endswith("Z")


def test_kpi_spec_errors_are_422_with_string_detail():
    response = client.post(
        "/kpis",
        json={"dataset": {"rows": _rows()}, "timeColumn": "created_at",
              "kpis": [{"name": "x", "aggregation": "ratio"}]},
    )
    assert response.status_code == 422
    assert "numerator" in response.json()["detail"]
    response = client.post(
        "/kpis",
        json={"dataset": {"rows": _rows()}, "timeColumn": "created_at",
              "kpis": [{"name": "x", "aggregation": "sum", "column": "nope"}]},
    )
    assert response.status_code == 422
    assert "Unknown column(s): nope" in response.json()["detail"]


def test_statistics():
    rows = [{"a": 1, "b": "x"}, {"a": 2, "b": "y"}, {"a": None, "b": "z"}, {"a": 4, "b": "w"}]
    body = client.post("/statistics", json={"dataset": {"rows": rows}}).json()
    assert body["rowCount"] == 4
    [col] = body["columns"]
    assert col["name"] == "a"
    assert col["count"] == 3
    assert col["nullRate"] == pytest.approx(0.25)
    assert col["mean"] == pytest.approx(7 / 3)
    assert col["median"] == 2
    assert col["min"] == 1 and col["max"] == 4
    assert col["p25"] == pytest.approx(1.5)
    assert "Skipped non-numeric columns: b" in body["computationMethod"]


def test_trends():
    response = client.post(
        "/trends",
        json={"dataset": {"rows": _rows(spike_day=None)}, "timeColumn": "created_at",
              "valueColumn": "amount", "rollingWindow": 7, "periodDays": 7},
    )
    assert response.status_code == 200
    body = response.json()
    assert len(body["series"]) == 42
    values = [p["value"] for p in body["series"]]
    assert body["series"][-1]["rollingMean"] == pytest.approx(np.mean(values[-7:]))
    assert body["periodOverPeriod"]["current"] == pytest.approx(sum(values[-7:]))
    assert body["periodOverPeriod"]["previous"] == pytest.approx(sum(values[-14:-7]))
    assert isinstance(body["slope"], float)
    assert body["computationMethod"]


def test_anomalies_detects_spike():
    response = client.post(
        "/anomalies/detect",
        json={"dataset": {"rows": _rows()}, "timeColumn": "created_at", "valueColumn": "amount",
              "metricName": "revenue", "unit": "USD"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["methodUsed"] == "seasonal"
    spike = next(a for a in body["anomalies"] if a["timestamp"] == "2026-03-31T00:00:00Z")
    assert spike["direction"] == "spike"
    assert spike["severity"] == "CRITICAL"
    assert spike["deviationScore"] > 6
    assert spike["detectionMethod"] == "stl_seasonal"
    assert spike["description"].startswith("revenue on 2026-03-31")
    assert body["metric"]["name"] == "revenue"
    assert body["metric"]["unit"] == "USD"
    assert len(body["metric"]["series"]) == 42
    assert body["metric"]["computationMethod"] and body["computationMethod"]


def test_anomalies_too_few_points_is_422():
    rows = _rows(days=4, spike_day=None)
    response = client.post(
        "/anomalies/detect",
        json={"dataset": {"rows": rows}, "timeColumn": "created_at", "valueColumn": "amount"},
    )
    assert response.status_code == 422
    assert "at least 7 daily points" in response.json()["detail"]


def test_forecast_shape():
    response = client.post(
        "/forecast",
        json={"dataset": {"rows": _rows(spike_day=None)}, "timeColumn": "created_at",
              "valueColumn": "amount", "horizon": 7, "method": "ets"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["methodUsed"] == "ets"
    assert len(body["history"]) == 42
    assert [p["timestamp"] for p in body["forecast"]][0] == "2026-04-12T00:00:00Z"
    assert all(p["lower"] <= p["value"] <= p["upper"] for p in body["forecast"])
    assert body["backtest"]["holdoutDays"] == 7
    assert body["backtest"]["mape"] < 15
    assert body["computationMethod"]


def test_missing_value_column_is_422():
    response = client.post(
        "/trends", json={"dataset": {"rows": _rows()}, "timeColumn": "created_at"}
    )
    assert response.status_code == 422
    assert "valueColumn" in response.json()["detail"]


def test_dataset_ref_needs_rows_or_source():
    response = client.post("/statistics", json={"dataset": {"dataSourceId": "x"}})
    assert response.status_code == 422


def test_ingestion_unreachable_is_502(monkeypatch):
    monkeypatch.setattr(settings, "ingestion_service_url", "http://127.0.0.1:1")
    response = client.post(
        "/statistics",
        json={"dataset": {"dataSourceId": "ds", "organizationId": "org", "table": "orders"}},
    )
    assert response.status_code == 502
    assert "Ingestion service unreachable" in response.json()["detail"]


def test_dataset_fetched_through_ingestion_extract(monkeypatch):
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if b'"table":"missing"' in request.content:
            return httpx.Response(422, json={"detail": "Unknown table 'missing'."})
        return httpx.Response(200, json={"columns": ["a"], "rows": [{"a": 1}, {"a": 3}]})

    real = httpx.AsyncClient

    def factory(*args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(handler)
        return real(*args, **kwargs)

    monkeypatch.setattr(dataset.httpx, "AsyncClient", factory)
    ref = {"dataSourceId": "ds", "organizationId": "org", "table": "orders"}
    body = client.post("/statistics", json={"dataset": ref, "columns": ["a"]}).json()
    assert body["columns"][0]["mean"] == 2
    sent = httpx.Response(200, content=seen[0].content).json()
    assert sent["dataSourceId"] == "ds" and sent["table"] == "orders"
    assert sent["columns"] == ["a"]
    assert seen[0].url.path == "/extract"

    response = client.post("/statistics", json={"dataset": {**ref, "table": "missing"}})
    assert response.status_code == 422
    assert "Unknown table 'missing'" in response.json()["detail"]
