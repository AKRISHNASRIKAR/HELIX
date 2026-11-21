"""Daily series building shared by /kpis, /trends, /anomalies/detect and /forecast.

Rules (HELIX build spec, section C):
- Timestamps are parsed as UTC and bucketed into UTC calendar days.
- The day range spans the whole (unfiltered) dataset, or an explicit range,
  so a filtered series (e.g. refunds only) still has every day.
- Missing days are 0 for sum / count / count_distinct (nothing happened) and
  missing (NaN) for mean (no observations to average).
"""

from __future__ import annotations

import warnings
from dataclasses import dataclass

import numpy as np
import pandas as pd

from .errors import AnalyticsError
from .models import FilterSpec

ZERO_FILLED = ("sum", "count", "count_distinct")


def iso_day(ts: pd.Timestamp) -> str:
    return ts.strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_time(df: pd.DataFrame, column: str) -> pd.Series:
    """UTC timestamps for `column`; unparseable values become NaT."""
    if column not in df.columns:
        raise AnalyticsError(f"Unknown time column '{column}'.")
    raw = df[column]
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        if pd.api.types.is_numeric_dtype(raw):
            raise AnalyticsError(f"Time column '{column}' is numeric, not a timestamp.")
        parsed = pd.to_datetime(raw, errors="coerce", utc=True, format="mixed")
    if parsed.notna().sum() == 0:
        raise AnalyticsError(f"Time column '{column}' has no parseable timestamps.")
    return parsed


def parse_day(value: str) -> pd.Timestamp:
    try:
        ts = pd.Timestamp(value)
    except (ValueError, TypeError):
        raise AnalyticsError(f"Could not parse date '{value}'.") from None
    ts = ts.tz_localize("UTC") if ts.tzinfo is None else ts.tz_convert("UTC")
    return ts.floor("D")


def numeric_column(df: pd.DataFrame, column: str) -> pd.Series:
    if column not in df.columns:
        raise AnalyticsError(f"Unknown column '{column}'.")
    values = df[column]
    if pd.api.types.is_bool_dtype(values):
        return values.astype(float)
    converted = pd.to_numeric(values, errors="coerce")
    if values.notna().any() and converted.notna().sum() == 0:
        raise AnalyticsError(f"Column '{column}' is not numeric.")
    return converted


def describe_filter(spec: FilterSpec | None) -> str:
    if spec is None:
        return ""
    symbol = {"eq": "=", "neq": "!=", "in": "in"}[spec.op]
    return f" where {spec.column} {symbol} {spec.value!r}"


def filter_mask(df: pd.DataFrame, spec: FilterSpec | None) -> pd.Series:
    """Boolean mask for a filter. Numeric columns compare numerically when the
    filter value is numeric; otherwise both sides compare as strings."""
    if spec is None:
        return pd.Series(True, index=df.index)
    if spec.column not in df.columns:
        raise AnalyticsError(f"Unknown filter column '{spec.column}'.")
    column = df[spec.column]
    values = spec.value if spec.op == "in" else [spec.value]
    numeric = pd.api.types.is_numeric_dtype(column) and not pd.api.types.is_bool_dtype(column)
    if numeric and all(isinstance(v, int | float) and not isinstance(v, bool) for v in values):
        mask = column.isin(values)
    else:
        mask = column.astype(str).isin([str(v) for v in values]) & column.notna()
    return ~mask if spec.op == "neq" else mask


def label(aggregation: str, column: str | None, spec: FilterSpec | None = None) -> str:
    return f"{aggregation}({column or '*'}){describe_filter(spec)}"


def aggregate(df: pd.DataFrame, aggregation: str, column: str | None) -> float | None:
    """One aggregate over the rows of `df` (already filtered/windowed)."""
    if aggregation == "count":
        return float(len(df) if column is None else df[column].notna().sum())
    if aggregation == "count_distinct":
        return float(df[column].nunique(dropna=True))
    values = numeric_column(df, column).dropna() if len(df) else pd.Series(dtype=float)
    if aggregation == "sum":
        return float(values.sum())
    if aggregation == "mean":
        return float(values.mean()) if len(values) else None
    raise AnalyticsError(f"Unsupported aggregation '{aggregation}'.")


@dataclass
class DailySeries:
    values: pd.Series  # indexed by UTC day (tz-aware), NaN only for empty mean days
    rows_used: int
    rows_dropped: int  # rows whose timestamp could not be parsed
    label: str

    def points(self) -> list[dict]:
        return [
            {"timestamp": iso_day(ts), "value": None if pd.isna(v) else float(v)}
            for ts, v in self.values.items()
        ]

    def describe(self, time_column: str) -> str:
        first, last = self.values.index[0], self.values.index[-1]
        dropped = (
            f"; {self.rows_dropped} rows with unparseable {time_column} were dropped"
            if self.rows_dropped
            else ""
        )
        return (
            f"Daily series of {self.label} bucketed by UTC day of {time_column}, "
            f"{first.date()}..{last.date()} ({len(self.values)} days, {self.rows_used} rows"
            f"{dropped})"
        )


def daily_series(
    df: pd.DataFrame,
    time_column: str,
    aggregation: str,
    value_column: str | None,
    spec: FilterSpec | None = None,
    start: pd.Timestamp | None = None,
    end: pd.Timestamp | None = None,
    times: pd.Series | None = None,
) -> DailySeries:
    """Build the daily series. `times` lets callers reuse already-parsed timestamps."""
    times = parse_time(df, time_column) if times is None else times
    valid = times.notna()
    days = times.dt.floor("D")
    start = days[valid].min() if start is None else start
    end = days[valid].max() if end is None else end
    index = pd.date_range(start, end, freq="D", tz="UTC")

    mask = valid & filter_mask(df, spec) & (days >= start) & (days <= end)
    frame = df.loc[mask]
    keys = days[mask]
    if aggregation == "count":
        grouped = (
            frame.groupby(keys).size()
            if value_column is None
            else frame[value_column].notna().groupby(keys).sum()
        )
    elif aggregation == "count_distinct":
        if value_column not in df.columns:
            raise AnalyticsError(f"Unknown column '{value_column}'.")
        grouped = frame[value_column].groupby(keys).nunique()
    else:
        values = numeric_column(frame, value_column)
        grouped = values.groupby(keys).sum() if aggregation == "sum" else values.groupby(
            keys
        ).mean()
    fill = 0.0 if aggregation in ZERO_FILLED else np.nan
    series = grouped.astype(float).reindex(index, fill_value=fill)
    return DailySeries(
        values=series,
        rows_used=int(mask.sum()),
        rows_dropped=int((~valid).sum()),
        label=label(aggregation, value_column, spec),
    )
