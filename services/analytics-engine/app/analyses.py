"""The computations behind each endpoint. Synchronous and CPU-bound: main.py
runs them in a worker thread. Every result carries a `computationMethod`
string that says exactly how its numbers were produced, so a Finding built on
top of them can be traced back to real computation (ADR-005).
"""

from __future__ import annotations

import math
from datetime import UTC, datetime

import numpy as np
import pandas as pd
from helix_anomaly import MIN_POINTS as ANOMALY_MIN_POINTS
from helix_anomaly import detect
from helix_forecasting import MIN_POINTS as FORECAST_MIN_POINTS
from helix_forecasting import forecast as run_forecast
from scipy import stats

from .errors import AnalyticsError
from .models import (
    AggSpec,
    AnomalyRequest,
    ForecastRequest,
    KpiRequest,
    KpiSpec,
    StatisticsRequest,
    TrendsRequest,
)
from .series import (
    DailySeries,
    aggregate,
    daily_series,
    filter_mask,
    iso_day,
    label,
    parse_day,
    parse_time,
)


def _num(value) -> float | None:
    if value is None:
        return None
    value = float(value)
    return value if math.isfinite(value) else None


def _change(current: float | None, previous: float | None) -> float | None:
    if current is None or previous is None or previous == 0:
        return None
    return _num((current - previous) / abs(previous) * 100)


def _now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _series_for(df: pd.DataFrame, spec) -> DailySeries:
    return daily_series(df, spec.time_column, spec.aggregation, spec.value_column, spec.filter)


def _metric_name(spec) -> str:
    return label(spec.aggregation, spec.value_column, spec.filter)


# -- /kpis ---------------------------------------------------------------------------


def _agg_label(part: AggSpec | KpiSpec) -> str:
    return label(part.aggregation, part.column, part.filter)


def _window_value(df, times_days, start, end, part) -> float | None:
    mask = (times_days >= start) & (times_days <= end) & filter_mask(df, part.filter)
    return aggregate(df.loc[mask], part.aggregation, part.column)


def _daily(df, time_column, times, start, end, part) -> pd.Series:
    return daily_series(
        df, time_column, part.aggregation, part.column, part.filter, start, end, times
    ).values


def compute_kpis(df: pd.DataFrame, request: KpiRequest) -> dict:
    times = parse_time(df, request.time_column)
    days = times.dt.floor("D")
    as_of = parse_day(request.as_of) if request.as_of else days.max()
    w = request.window_days
    cur_start = as_of - pd.Timedelta(days=w - 1)
    prev_end = cur_start - pd.Timedelta(days=1)
    prev_start = prev_end - pd.Timedelta(days=w - 1)
    window = {
        "currentStart": iso_day(cur_start),
        "currentEnd": iso_day(as_of),
        "previousStart": iso_day(prev_start),
        "previousEnd": iso_day(prev_end),
    }
    rows_current = int(((days >= cur_start) & (days <= as_of)).sum())
    rows_previous = int(((days >= prev_start) & (days <= prev_end)).sum())

    metrics = []
    for kpi in request.kpis:
        if kpi.aggregation == "ratio":
            num_cur = _window_value(df, days, cur_start, as_of, kpi.numerator)
            den_cur = _window_value(df, days, cur_start, as_of, kpi.denominator)
            num_prev = _window_value(df, days, prev_start, prev_end, kpi.numerator)
            den_prev = _window_value(df, days, prev_start, prev_end, kpi.denominator)
            value = _num(num_cur / den_cur) if num_cur is not None and den_cur else None
            baseline = _num(num_prev / den_prev) if num_prev is not None and den_prev else None
            num_daily = _daily(df, request.time_column, times, prev_start, as_of, kpi.numerator)
            den_daily = _daily(df, request.time_column, times, prev_start, as_of, kpi.denominator)
            daily = (num_daily / den_daily.replace(0, np.nan)).astype(float)
            what = f"ratio {_agg_label(kpi.numerator)} / {_agg_label(kpi.denominator)}"
            daily_what = "daily ratios (days with a zero denominator excluded)"
        else:
            value = _num(_window_value(df, days, cur_start, as_of, kpi))
            baseline = _num(_window_value(df, days, prev_start, prev_end, kpi))
            daily = _daily(df, request.time_column, times, prev_start, as_of, kpi)
            what = _agg_label(kpi)
            daily_what = f"daily {kpi.aggregation} values"

        current_daily = daily[daily.index >= cur_start].dropna().to_numpy()
        previous_daily = daily[daily.index <= prev_end].dropna().to_numpy()
        p_value = None
        if len(current_daily) >= 2 and len(previous_daily) >= 2:
            result = stats.ttest_ind(current_daily, previous_daily, equal_var=False)
            p_value = _num(result.pvalue)

        method = (
            f"{what} over rows whose {request.time_column} falls in UTC days "
            f"{cur_start.date()}..{as_of.date()} ({w} days, {rows_current} rows); baseline = "
            f"same over {prev_start.date()}..{prev_end.date()} ({rows_previous} rows); "
            "changePercent = (value - baseline) / |baseline| * 100; pValue = Welch two-sample "
            f"t-test (scipy.stats.ttest_ind, equal_var=False) of the {daily_what} in the "
            "current vs previous window (null if either window has < 2 days or the test is "
            "undefined). series = daily values over both windows."
        )
        metrics.append(
            {
                "name": kpi.name,
                "unit": kpi.unit,
                "value": value,
                "baseline": baseline,
                "changePercent": _change(value, baseline),
                "series": [
                    {"timestamp": iso_day(ts), "value": _num(v) if pd.notna(v) else None}
                    for ts, v in daily.items()
                ],
                "computationMethod": method,
                "computedAt": _now(),
                "pValue": p_value,
                "window": window,
            }
        )
    return {"metrics": metrics}


# -- /statistics -----------------------------------------------------------------


def compute_statistics(df: pd.DataFrame, request: StatisticsRequest) -> dict:
    if request.columns:
        unknown = [c for c in request.columns if c not in df.columns]
        if unknown:
            raise AnalyticsError(f"Unknown column(s): {', '.join(unknown)}")
        candidates = request.columns
    else:
        candidates = [str(c) for c in df.columns]

    total = len(df)
    columns, skipped = [], []
    for name in candidates:
        raw = df[name]
        if pd.api.types.is_bool_dtype(raw):
            skipped.append(name)
            continue
        values = pd.to_numeric(raw, errors="coerce")
        non_null = int(raw.notna().sum())
        # A text column counts as numeric when >= 95% of its non-null values parse.
        if non_null == 0 or values.notna().sum() < 0.95 * non_null:
            skipped.append(name)
            continue
        x = values.dropna().to_numpy(dtype=float)
        p05, p25, p75, p95 = np.percentile(x, [5, 25, 75, 95])
        columns.append(
            {
                "name": name,
                "count": int(len(x)),
                "nullRate": 1 - len(x) / total if total else 0.0,
                "mean": _num(x.mean()),
                "median": _num(np.median(x)),
                "std": _num(x.std(ddof=1)) if len(x) > 1 else None,
                "min": _num(x.min()),
                "max": _num(x.max()),
                "p05": _num(p05),
                "p25": _num(p25),
                "p75": _num(p75),
                "p95": _num(p95),
            }
        )
    skipped_text = f" Skipped non-numeric columns: {', '.join(skipped)}." if skipped else ""
    method = (
        f"Descriptive statistics over {total} rows with numpy: count = non-null numeric values; "
        "nullRate = 1 - count / rowCount (values that do not parse as numbers count as null); "
        "std = sample standard deviation (ddof=1); percentiles by linear interpolation "
        f"(numpy.percentile).{skipped_text}"
    )
    return {"rowCount": total, "columns": columns, "computationMethod": method}


# -- /trends -----------------------------------------------------------------------


def compute_trends(df: pd.DataFrame, request: TrendsRequest) -> dict:
    daily = _series_for(df, request)
    values = daily.values
    rolling = values.rolling(request.rolling_window, min_periods=1).mean()

    p = request.period_days
    additive = request.aggregation in ("sum", "count")
    current_slice = values.iloc[-p:]
    previous_slice = values.iloc[-2 * p : -p] if len(values) >= 2 * p else None

    def period_total(chunk: pd.Series | None) -> float | None:
        if chunk is None or chunk.dropna().empty:
            return None
        return _num(chunk.sum() if additive else chunk.mean())

    current, previous = period_total(current_slice), period_total(previous_slice)

    observed = values.dropna()
    slope = None
    if len(observed) >= 2:
        x = (observed.index - values.index[0]).days.to_numpy(dtype=float)
        slope = _num(np.polyfit(x, observed.to_numpy(dtype=float), 1)[0])

    combine = "sum" if additive else "mean"
    method = (
        f"{daily.describe(request.time_column)}. rollingMean = trailing {request.rolling_window}-"
        "day mean (pandas rolling, min_periods=1, ignores empty days). periodOverPeriod = "
        f"{combine} of the last {p} days vs the {p} days before "
        f"(changePercent = (current - previous) / |previous| * 100). slope = least-squares "
        "linear fit of the daily values against day number (units per day, numpy.polyfit)."
    )
    return {
        "series": [
            {
                "timestamp": iso_day(ts),
                "value": _num(v) if pd.notna(v) else None,
                "rollingMean": _num(r) if pd.notna(r) else None,
            }
            for (ts, v), r in zip(values.items(), rolling.to_numpy(), strict=True)
        ],
        "periodOverPeriod": {
            "current": current,
            "previous": previous,
            "changePercent": _change(current, previous),
        },
        "slope": slope,
        "computationMethod": method,
    }


# -- /anomalies/detect -------------------------------------------------------------


def _anomaly_description(name, ts, value, expected, score, direction, method) -> str:
    relation = "above" if direction == "spike" else "below"
    pct = f"{abs(value - expected) / abs(expected) * 100:.1f}% " if expected else ""
    return (
        f"{name} on {ts.date()} was {value:,.2f}, {pct}{relation} the expected "
        f"{expected:,.2f} (deviation score {score:+.2f}, {method})."
    )


def compute_anomalies(df: pd.DataFrame, request: AnomalyRequest) -> dict:
    daily = _series_for(df, request)
    observed = daily.values.dropna()
    if len(observed) < ANOMALY_MIN_POINTS:
        raise AnalyticsError(
            f"Anomaly detection needs at least {ANOMALY_MIN_POINTS} daily points; "
            f"the series has {len(observed)}."
        )
    try:
        result = detect(observed, method=request.method, threshold=request.threshold)
    except ValueError as exc:
        raise AnalyticsError(str(exc)) from None

    name = request.metric_name or _metric_name(request)
    gaps = (
        " Days with no observations were excluded before detection."
        if len(observed) < len(daily.values)
        else ""
    )
    method = f"{daily.describe(request.time_column)}.{gaps} {result.description}"
    last_value = float(observed.iloc[-1])
    last_expected = float(result.expected[-1])
    anomalies = [
        {
            "timestamp": iso_day(point.timestamp),
            "value": point.value,
            "expectedValue": point.expected,
            "deviationScore": point.score,
            "severity": point.severity,
            "direction": point.direction,
            "detectionMethod": point.method,
            "description": _anomaly_description(
                name,
                point.timestamp,
                point.value,
                point.expected,
                point.score,
                point.direction,
                point.method,
            ),
        }
        for point in result.anomalies
    ]
    return {
        "metric": {
            "name": name,
            "unit": request.unit,
            "value": _num(last_value),
            "baseline": _num(last_expected),
            "changePercent": _change(last_value, last_expected),
            "series": daily.points(),
            "computationMethod": (
                f"value = last day's {daily.label}; baseline = the detector's expected value "
                f"for that day. {method}"
            ),
            "computedAt": _now(),
        },
        "methodUsed": result.method_used,
        "anomalies": anomalies,
        "computationMethod": method,
    }


# -- /forecast ---------------------------------------------------------------------


def compute_forecast(df: pd.DataFrame, request: ForecastRequest) -> dict:
    daily = _series_for(df, request)
    observed = daily.values.dropna()
    if len(observed) < FORECAST_MIN_POINTS:
        raise AnalyticsError(
            f"Forecasting needs at least {FORECAST_MIN_POINTS} daily points; "
            f"the series has {len(observed)}."
        )
    try:
        result = run_forecast(observed, horizon=request.horizon, method=request.method)
    except ValueError as exc:
        raise AnalyticsError(str(exc)) from None

    clamp = request.aggregation in ("count", "count_distinct")
    lower = np.maximum(result.lower, 0) if clamp else result.lower
    mean = np.maximum(result.mean, 0) if clamp else result.mean
    index = result.index
    if index is None:  # only one observed day; cannot happen past MIN_POINTS, but be safe
        index = pd.date_range(observed.index[-1], periods=request.horizon + 1, freq="D")[1:]
    clamp_text = " Counts are clamped at 0." if clamp else ""
    gaps = (
        " Days with no observations were excluded."
        if len(observed) < len(daily.values)
        else ""
    )
    return {
        "history": daily.points(),
        "forecast": [
            {
                "timestamp": iso_day(ts),
                "value": float(m),
                "lower": float(lo),
                "upper": float(hi),
            }
            for ts, m, lo, hi in zip(index, mean, lower, result.upper, strict=True)
        ],
        "methodUsed": result.method_used,
        "backtest": {"mape": _num(result.backtest_mape), "holdoutDays": result.holdout_days},
        "computationMethod": (
            f"{daily.describe(request.time_column)}.{gaps} {result.description}{clamp_text}"
        ),
    }


__all__ = [
    "compute_anomalies",
    "compute_forecast",
    "compute_kpis",
    "compute_statistics",
    "compute_trends",
]
