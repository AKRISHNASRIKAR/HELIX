"""Diagnostic computations: /segments/compare, /correlation and /events/align.

Same conventions as analyses.py: synchronous (main.py runs them in a worker
thread), UTC days, and a `computationMethod` on every result. The algorithms
live in analytics/segmentation (`helix_segmentation`) and
analytics/correlation (`helix_correlation`); this module only adapts
DataFrames and wire models to them.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd
from helix_correlation import align_events, correlate
from helix_segmentation import candidate_dimensions, compare_segments

from .errors import AnalyticsError
from .models import CorrelationRequest, EventsAlignRequest, SegmentCompareRequest
from .series import daily_series, describe_filter, filter_mask, label, parse_day, parse_time


def _num(value: float | None) -> float | None:
    if value is None:
        return None
    value = float(value)
    return value if math.isfinite(value) else None


def _change(change) -> dict:
    return {
        "actual": float(change.actual),
        "expected": float(change.expected),
        "delta": float(change.delta),
        "deltaPercent": _num(change.delta_percent),
    }


def _slice(item) -> dict:
    return {**_change(item), "value": item.value, "shareOfDelta": float(item.share_of_delta)}


# -- /segments/compare -------------------------------------------------------------


def segment_dimensions(df: pd.DataFrame, request: SegmentCompareRequest) -> list[str]:
    if request.dimensions is not None:
        return list(request.dimensions)
    exclude = [request.time_column, request.value_column]
    if request.filter:
        exclude.append(request.filter.column)
    return candidate_dimensions(df, exclude=[c for c in exclude if c])


def compute_segments(df: pd.DataFrame, request: SegmentCompareRequest) -> dict:
    times = parse_time(df, request.time_column)
    days = times.dt.floor("D")
    valid = times.notna()
    # The day range spans the whole (unfiltered) dataset, like the daily series.
    first_day, last_day = days[valid].min(), days[valid].max()
    target = parse_day(request.target_date)
    mask = valid & filter_mask(df, request.filter)
    if request.value_column and request.value_column not in df.columns:
        raise AnalyticsError(f"Unknown column '{request.value_column}'.")
    if request.aggregation in ("sum", "mean"):
        values = pd.to_numeric(df[request.value_column], errors="coerce")
        if df[request.value_column].notna().any() and values.notna().sum() == 0:
            raise AnalyticsError(f"Column '{request.value_column}' is not numeric.")

    dimensions = segment_dimensions(df, request)
    if not dimensions:
        raise AnalyticsError(
            "No dimensions to compare: pass `dimensions`, or include text columns with "
            "2..20 distinct values."
        )
    what = label(request.aggregation, request.value_column, request.filter)
    try:
        result = compare_segments(
            df.loc[mask],
            days[mask],
            target,
            aggregation=request.aggregation,
            value_column=request.value_column,
            dimensions=dimensions,
            baseline=request.baseline,
            baseline_periods=request.baseline_periods,
            first_day=first_day,
            last_day=last_day,
            metric_label=what,
        )
    except ValueError as exc:
        raise AnalyticsError(str(exc)) from None

    dropped = int((~valid).sum())
    dropped_text = (
        f" {dropped} rows with unparseable {request.time_column} were dropped." if dropped else ""
    )
    top = result.top_slice
    return {
        "targetDate": str(target.date()),
        "metricName": request.metric_name or what,
        "unit": request.unit,
        "aggregation": request.aggregation,
        "total": _change(result.total),
        "dimensions": [
            {
                "column": d.column,
                "concentration": float(d.concentration),
                "slices": [_slice(s) for s in d.slices],
            }
            for d in result.dimensions
        ],
        "topSlice": {**_slice(top.slice), "column": top.column} if top else None,
        "computationMethod": (
            f"Rows bucketed by UTC day of {request.time_column} ({int(mask.sum())} rows"
            f"{describe_filter(request.filter)}).{dropped_text} {result.description}"
        ),
    }


# -- /correlation -------------------------------------------------------------------


def series_name(spec) -> str:
    return spec.name or label(spec.aggregation, spec.value_column, spec.filter)


def compute_correlation(
    df_a: pd.DataFrame, df_b: pd.DataFrame, request: CorrelationRequest
) -> dict:
    a = daily_series(
        df_a, request.a.time_column, request.a.aggregation, request.a.value_column, request.a.filter
    )
    b = daily_series(
        df_b, request.b.time_column, request.b.aggregation, request.b.value_column, request.b.filter
    )
    try:
        result = correlate(a.values, b.values, method=request.method, max_lag=request.max_lag)
    except ValueError as exc:
        raise AnalyticsError(str(exc)) from None
    return {
        "coefficient": float(result.coefficient),
        "method": result.method,
        "lag": result.lag,
        "pValue": _num(result.p_value),
        "n": result.n,
        "a": {"name": series_name(request.a)},
        "b": {"name": series_name(request.b)},
        "computationMethod": (
            f"a: {a.describe(request.a.time_column)}. b: {b.describe(request.b.time_column)}. "
            f"{result.description}"
        ),
    }


# -- /events/align ------------------------------------------------------------------


def _json_value(value: Any) -> Any:
    """Make a cell JSON-safe: NaN/NaT -> None, numpy scalars -> Python, timestamps -> ISO."""
    if value is None:
        return None
    if isinstance(value, pd.Timestamp):
        return None if pd.isna(value) else value.isoformat()
    if isinstance(value, np.generic):
        value = value.item()
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if not isinstance(value, list | dict) and pd.isna(value):
        return None
    return value


def _iso(ts: pd.Timestamp) -> str:
    return ts.strftime("%Y-%m-%dT%H:%M:%SZ")


def event_label_columns(df: pd.DataFrame, request: EventsAlignRequest) -> list[str]:
    spec = request.events
    if spec.label_columns is not None:
        return list(spec.label_columns)
    return [str(c) for c in df.columns if c != spec.time_column]


def compute_event_alignment(df: pd.DataFrame, request: EventsAlignRequest) -> dict:
    spec = request.events
    times = parse_time(df, spec.time_column)
    mask = times.notna() & filter_mask(df, spec.filter)
    columns = event_label_columns(df, request)
    unknown = [c for c in columns if c not in df.columns]
    if unknown:
        raise AnalyticsError(f"Unknown label column(s): {', '.join(unknown)}")
    events = df.loc[mask]
    labels = [
        {c: _json_value(row[c]) for c in columns} for row in events.to_dict("records")
    ]
    targets = [(parse_day(t.date), t.label) for t in request.targets]
    try:
        aligned = align_events(
            times[mask],
            targets,
            labels,
            window_hours_before=request.window_hours_before,
            window_hours_after=request.window_hours_after,
        )
    except ValueError as exc:
        raise AnalyticsError(str(exc)) from None

    matches = [
        {
            "target": {"date": str(item.date.date()), "label": item.label},
            "events": [
                {
                    "time": _iso(e.time),
                    "labels": e.labels,
                    "hoursBefore": float(e.hours_before),
                    "sameDay": bool(e.same_day),
                }
                for e in item.events
            ],
        }
        for item in aligned
    ]
    before, after = request.window_hours_before, request.window_hours_after
    method = (
        f"{int(mask.sum())} events with a parseable {spec.time_column}"
        f"{describe_filter(spec.filter)} (of {len(df)} rows), times in UTC. For each target UTC "
        f"day D an event matches when D 00:00 - {before:g}h <= time < D 00:00 + 24h + "
        f"{after:g}h. hoursBefore = (D 00:00 - time) in hours (negative = during or after the "
        "start of D); sameDay = the event's UTC date is D. Events sorted by |hoursBefore|."
    )
    return {"matches": matches, "computationMethod": method}


__all__ = [
    "compute_correlation",
    "compute_event_alignment",
    "compute_segments",
    "event_label_columns",
    "segment_dimensions",
]
