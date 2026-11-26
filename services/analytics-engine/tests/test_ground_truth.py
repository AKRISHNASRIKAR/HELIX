"""Ground-truth tests on the evaluation dataset (tests/fixtures/orders.csv).

The dataset and its injected anomalies are described in
tests/fixtures/README.md and ground_truth.json. Tolerances used here are
documented there too:
- the injected revenue drop and refund spikes must be flagged, in the right
  direction, at CRITICAL severity, and be the most extreme points;
- a KPI value must equal an independent pandas computation (to float
  rounding, rel 1e-12);
- the revenue forecast backtest MAPE (14-day holdout) must be under 15%.
"""

import json
from pathlib import Path

import pandas as pd
import pytest
from app.main import app
from fastapi.testclient import TestClient

FIXTURES = Path(__file__).resolve().parents[3] / "tests" / "fixtures"
REFUNDS = {"column": "status", "op": "in", "value": ["refunded", "refund", "returned"]}
FORECAST_MAPE_TOLERANCE = 15.0

client = TestClient(app)


@pytest.fixture(scope="module")
def orders() -> pd.DataFrame:
    return pd.read_csv(FIXTURES / "orders.csv")


@pytest.fixture(scope="module")
def rows(orders) -> list[dict]:
    return orders.to_dict("records")


@pytest.fixture(scope="module")
def truth() -> dict:
    return json.loads((FIXTURES / "ground_truth.json").read_text())


def _detect(rows, **spec) -> dict:
    response = client.post(
        "/anomalies/detect", json={"dataset": {"rows": rows}, "timeColumn": "created_at", **spec}
    )
    assert response.status_code == 200, response.text
    return response.json()


def _by_day(body) -> dict:
    return {a["timestamp"][:10]: a for a in body["anomalies"]}


def test_revenue_drop_on_2026_10_08_is_flagged(rows, truth):
    expected = next(a for a in truth["anomalies"] if a["metric"] == "revenue")
    body = _detect(rows, valueColumn="amount", metricName="revenue")
    flagged = _by_day(body)
    assert expected["date"] in flagged
    drop = flagged[expected["date"]]
    assert drop["direction"] == expected["direction"] == "drop"
    assert drop["severity"] == "CRITICAL"
    # The injected drop is the single most extreme day in the series.
    assert abs(drop["deviationScore"]) == max(abs(a["deviationScore"]) for a in body["anomalies"])
    assert 0.3 < 1 - drop["value"] / drop["expectedValue"] < 0.5


def test_completed_revenue_drop_is_flagged(rows):
    body = _detect(
        rows,
        valueColumn="amount",
        filter={"column": "status", "op": "eq", "value": "completed"},
    )
    drop = _by_day(body)["2026-10-08"]
    assert drop["direction"] == "drop"
    assert drop["severity"] == "CRITICAL"


def test_refund_spike_is_flagged(rows, truth):
    body = _detect(rows, aggregation="count", filter=REFUNDS, metricName="refunds")
    flagged = _by_day(body)
    for expected in (a for a in truth["anomalies"] if a["metric"] == "refunds"):
        hit = flagged[expected["date"]]
        assert hit["direction"] == "spike"
        assert hit["severity"] == "CRITICAL"
    # Nothing else in the series comes close to the two injected days.
    others = [a for day, a in flagged.items() if day not in ("2026-10-08", "2026-10-09")]
    assert all(abs(a["deviationScore"]) < 9 for a in others)


def test_refund_rate_kpi_spikes_and_matches_pandas(rows, orders):
    response = client.post(
        "/kpis",
        json={
            "dataset": {"rows": rows},
            "timeColumn": "created_at",
            "asOf": "2026-10-09",
            "windowDays": 2,
            "kpis": [
                {
                    "name": "refund_rate",
                    "aggregation": "ratio",
                    "numerator": {"aggregation": "count", "filter": REFUNDS},
                    "denominator": {"aggregation": "count"},
                }
            ],
        },
    )
    assert response.status_code == 200, response.text
    [metric] = response.json()["metrics"]
    days = pd.to_datetime(orders["created_at"], utc=True).dt.strftime("%Y-%m-%d")
    current = orders[days.isin(["2026-10-08", "2026-10-09"])]
    previous = orders[days.isin(["2026-10-06", "2026-10-07"])]
    assert metric["value"] == pytest.approx((current["status"] == "refunded").mean(), rel=1e-12)
    assert metric["baseline"] == pytest.approx((previous["status"] == "refunded").mean(), rel=1e-12)
    assert metric["value"] > 0.15 and metric["baseline"] < 0.05
    assert metric["changePercent"] > 200


def test_weekly_revenue_kpi_matches_hand_computed_pandas(rows, orders):
    response = client.post(
        "/kpis",
        json={
            "dataset": {"rows": rows},
            "timeColumn": "created_at",
            "kpis": [{"name": "revenue", "aggregation": "sum", "column": "amount", "unit": "USD"}],
        },
    )
    [metric] = response.json()["metrics"]
    created = pd.to_datetime(orders["created_at"], utc=True)
    current = orders[(created >= "2026-10-08") & (created < "2026-10-15")]
    previous = orders[(created >= "2026-10-01") & (created < "2026-10-08")]
    assert metric["value"] == pytest.approx(current["amount"].sum(), rel=1e-12)
    assert metric["baseline"] == pytest.approx(previous["amount"].sum(), rel=1e-12)
    assert metric["window"]["currentStart"] == "2026-10-08T00:00:00Z"
    assert metric["window"]["currentEnd"] == "2026-10-14T00:00:00Z"
    assert metric["changePercent"] == pytest.approx(
        (current["amount"].sum() - previous["amount"].sum()) / previous["amount"].sum() * 100
    )
    assert metric["computationMethod"]


def test_revenue_forecast_backtest_within_tolerance(rows):
    response = client.post(
        "/forecast",
        json={"dataset": {"rows": rows}, "timeColumn": "created_at", "valueColumn": "amount",
              "horizon": 14},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["backtest"]["holdoutDays"] == 14
    assert body["backtest"]["mape"] < FORECAST_MAPE_TOLERANCE
    assert len(body["forecast"]) == 14
    assert body["forecast"][0]["timestamp"] == "2026-10-15T00:00:00Z"
    assert body["methodUsed"] in ("ets", "arima")


def test_time_and_currency_columns_match_agent_heuristics(rows):
    """The agent defaults (created_at / amount) produce a seasonal series."""
    body = _detect(rows, valueColumn="amount")
    assert body["methodUsed"] == "seasonal"
    assert "seasonal strength" in body["computationMethod"]


# -- diagnostics (segments, correlation) ---------------------------------------------


def _segments(rows, **spec) -> dict:
    response = client.post(
        "/segments/compare",
        json={"dataset": {"rows": rows}, "timeColumn": "created_at", "targetDate": "2026-10-08",
              **spec},
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_revenue_drop_is_concentrated_in_web(rows, orders, truth):
    expected = next(a for a in truth["anomalies"] if a["metric"] == "revenue")
    body = _segments(rows, valueColumn="amount", metricName="revenue", unit="USD")
    top = body["topSlice"]
    assert {top["column"]: top["value"]} == expected["segment"] == {"channel": "web"}
    assert top["shareOfDelta"] > 0.8
    assert body["dimensions"][0]["column"] == "channel"
    assert body["total"]["delta"] < 0
    # Independent pandas check of the web slice (same weekday, previous 4 weeks).
    day = pd.to_datetime(orders["created_at"], utc=True).dt.strftime("%Y-%m-%d")
    web = orders[orders["channel"] == "web"].groupby(day)["amount"].sum()
    baseline = ["2026-09-10", "2026-09-17", "2026-09-24", "2026-10-01"]
    assert top["actual"] == pytest.approx(web["2026-10-08"], rel=1e-12)
    assert top["expected"] == pytest.approx(web[baseline].mean(), rel=1e-12)
    # Customer segments are not the driver.
    segment = next(d for d in body["dimensions"] if d["column"] == "segment")
    assert segment["concentration"] < 0.5


def test_order_count_drop_is_concentrated_in_web(rows):
    body = _segments(rows, aggregation="count", metricName="orders")
    top = body["topSlice"]
    assert (top["column"], top["value"]) == ("channel", "web")
    assert top["actual"] == 26
    assert top["shareOfDelta"] > 0.8


def test_completed_revenue_drop_is_concentrated_in_web(rows):
    body = _segments(
        rows, valueColumn="amount", filter={"column": "status", "op": "eq", "value": "completed"}
    )
    assert (body["topSlice"]["column"], body["topSlice"]["value"]) == ("channel", "web")
    assert "status" not in [d["column"] for d in body["dimensions"]]


def test_completed_and_total_revenue_correlate(rows):
    def spec(**extra):
        return {"dataset": {"rows": rows}, "timeColumn": "created_at", "valueColumn": "amount",
                **extra}

    response = client.post(
        "/correlation",
        json={"a": spec(), "b": spec(filter={"column": "status", "op": "eq",
                                              "value": "completed"})},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["lag"] == 0
    assert body["coefficient"] > 0.9
    assert body["n"] == 90
    assert body["pValue"] < 1e-6
