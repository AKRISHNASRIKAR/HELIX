import math

import pandas as pd
import pytest
from app.errors import AnalyticsError
from app.models import FilterSpec
from app.series import daily_series, filter_mask

ROWS = pd.DataFrame(
    {
        "ts": [
            "2026-01-01T10:00:00Z",
            "2026-01-01T23:59:59Z",
            "2026-01-03T00:00:00+02:00",  # 2026-01-02 22:00 UTC
            "2026-01-04T08:00:00Z",
            "not a date",
        ],
        "amount": [10.0, 5.5, 7.0, 3.0, 99.0],
        "status": ["ok", "refunded", "ok", "refunded", "ok"],
        "user": ["a", "b", "a", "a", "c"],
    }
)


def test_sum_buckets_by_utc_day_and_fills_zero():
    daily = daily_series(ROWS, "ts", "sum", "amount")
    assert [str(d.date()) for d in daily.values.index] == [
        "2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04",
    ]
    assert daily.values.tolist() == [15.5, 7.0, 0.0, 3.0]
    assert daily.rows_dropped == 1
    assert "1 rows with unparseable ts were dropped" in daily.describe("ts")


def test_count_with_filter_keeps_full_day_range():
    spec = FilterSpec(column="status", op="in", value=["refunded"])
    daily = daily_series(ROWS, "ts", "count", None, spec)
    assert daily.values.tolist() == [1.0, 0.0, 0.0, 1.0]
    assert daily.label == "count(*) where status in ['refunded']"


def test_mean_leaves_empty_days_missing_and_count_distinct_zero():
    mean = daily_series(ROWS, "ts", "mean", "amount").values
    assert mean.iloc[0] == pytest.approx(7.75)
    assert math.isnan(mean.iloc[2])
    distinct = daily_series(ROWS, "ts", "count_distinct", "user").values
    assert distinct.tolist() == [2.0, 1.0, 0.0, 1.0]


def test_filter_ops():
    assert filter_mask(ROWS, FilterSpec(column="status", op="eq", value="ok")).sum() == 3
    assert filter_mask(ROWS, FilterSpec(column="status", op="neq", value="ok")).sum() == 2
    assert filter_mask(ROWS, FilterSpec(column="amount", op="in", value=[3, 7])).sum() == 2
    with pytest.raises(AnalyticsError):
        filter_mask(ROWS, FilterSpec(column="nope", op="eq", value=1))


def test_bad_columns_raise():
    with pytest.raises(AnalyticsError, match="Unknown time column"):
        daily_series(ROWS, "missing", "sum", "amount")
    with pytest.raises(AnalyticsError, match="not numeric"):
        daily_series(ROWS, "ts", "sum", "status")
    with pytest.raises(AnalyticsError, match="no parseable timestamps"):
        daily_series(ROWS, "status", "count", None)
