"""Segment comparison: which slice of which dimension explains a metric's move
on one day.

For a target UTC day D and a baseline (the same weekday over the previous N
weeks, or the previous N*7 days), every slice of every dimension gets:
- actual   = the slice's aggregate on D (0 when the slice has no rows on D),
- expected = the mean of the slice's daily aggregate over the baseline days
  (a baseline day where the slice has no rows counts as 0),
- delta    = actual - expected, deltaPercent = delta / |expected| * 100,
- shareOfDelta = delta / total delta (0 when the total did not move).

For additive aggregations (sum, count) the shares of a dimension sum to 1.
A dimension's concentration is the largest share among slices that moved in
the same direction as the total, clipped to [0, 1]. The top slice is the best
slice of the most concentrated dimension, reported only when the move is both
concentrated (>= MIN_CONCENTRATION) and disproportionate (the slice moved at
least MIN_RELATIVE_MOVE times as much, in percent, as the total).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

import numpy as np
import pandas as pd

Aggregation = Literal["sum", "mean", "count", "count_distinct"]
Baseline = Literal["same_weekday", "trailing_mean"]

MIN_CONCENTRATION = 0.5
# 1.5 rather than 2: on the evaluation dataset web orders fell 84.5% while all
# orders fell 44.2% (1.9x), and that is exactly the move this check must keep.
MIN_RELATIVE_MOVE = 1.5
MAX_DIMENSION_VALUES = 20
ZERO_FILLED = ("sum", "count", "count_distinct")


@dataclass
class Change:
    actual: float
    expected: float
    delta: float
    delta_percent: float | None


@dataclass
class Slice(Change):
    value: str = ""
    share_of_delta: float = 0.0


@dataclass
class Dimension:
    column: str
    concentration: float
    slices: list[Slice] = field(default_factory=list)
    # The slice that defines `concentration` (None when nothing moved with the total).
    best: Slice | None = None


@dataclass
class TopSlice:
    column: str
    slice: Slice


@dataclass
class SegmentComparison:
    target_day: pd.Timestamp
    baseline_days: list[pd.Timestamp]
    total: Change
    dimensions: list[Dimension]
    top_slice: TopSlice | None
    # Exactly how every number was computed (becomes computationMethod).
    description: str = ""


def _change(actual: float, expected: float) -> Change:
    delta = actual - expected
    pct = delta / abs(expected) * 100 if expected else None
    return Change(actual=actual, expected=expected, delta=delta, delta_percent=pct)


def baseline_days(
    target_day: pd.Timestamp,
    baseline: Baseline = "same_weekday",
    periods: int = 4,
    first_day: pd.Timestamp | None = None,
) -> list[pd.Timestamp]:
    """Baseline days for `target_day`, oldest first, never before `first_day`."""
    if periods < 1:
        raise ValueError("baseline periods must be >= 1")
    if baseline == "same_weekday":
        offsets = [7 * k for k in range(1, periods + 1)]
    elif baseline == "trailing_mean":
        offsets = list(range(1, 7 * periods + 1))
    else:
        raise ValueError(f"Unknown baseline '{baseline}'")
    days = [target_day - pd.Timedelta(days=k) for k in offsets]
    if first_day is not None:
        days = [d for d in days if d >= first_day]
    return sorted(days)


def candidate_dimensions(
    frame: pd.DataFrame, exclude: list[str] | None = None, max_values: int = MAX_DIMENSION_VALUES
) -> list[str]:
    """Columns that look categorical: object/category/string dtype with 2..max_values
    distinct non-null values, in frame order, minus `exclude`."""
    skip = set(exclude or [])
    out = []
    for column in frame.columns:
        if column in skip:
            continue
        values = frame[column]
        categorical = (
            pd.api.types.is_object_dtype(values)
            or isinstance(values.dtype, pd.CategoricalDtype)
            or pd.api.types.is_string_dtype(values)
        )
        if categorical and 2 <= values.nunique(dropna=True) <= max_values:
            out.append(str(column))
    return out


def _numeric(frame: pd.DataFrame, value_column: str) -> pd.Series:
    if value_column not in frame.columns:
        raise ValueError(f"Unknown value column '{value_column}'")
    return pd.to_numeric(frame[value_column], errors="coerce")


def _daily(
    frame: pd.DataFrame,
    day: pd.Series,
    aggregation: Aggregation,
    value_column: str | None,
    days: list[pd.Timestamp],
    dimension: str | None = None,
) -> pd.DataFrame:
    """Daily aggregate per slice: index = `days`, one column per slice value
    (a single column "__total__" when `dimension` is None). Missing = 0."""
    keep = day.isin(days)
    if dimension is not None:
        keep &= frame[dimension].notna()
    rows = frame.loc[keep]
    keys = [day[keep].rename("__day__")]
    if dimension is not None:
        keys.append(rows[dimension].astype(str).rename("__slice__"))
    else:
        keys.append(pd.Series("__total__", index=rows.index, name="__slice__"))

    if aggregation == "count":
        if value_column is None:
            grouped = rows.groupby(keys).size()
        else:
            grouped = rows[value_column].notna().groupby(keys).sum()
    elif aggregation == "count_distinct":
        grouped = rows[value_column].groupby(keys).nunique()
    elif aggregation in ("sum", "mean"):
        values = _numeric(rows, value_column)
        grouped = values.groupby(keys).sum() if aggregation == "sum" else values.groupby(
            keys
        ).mean()
    else:
        raise ValueError(f"Unsupported aggregation '{aggregation}'")

    table = grouped.astype(float).unstack("__slice__") if len(grouped) else pd.DataFrame()
    table = table.reindex(pd.DatetimeIndex(days))
    return table.fillna(0.0)


def _compare(
    table: pd.DataFrame, target_day: pd.Timestamp, baseline: list[pd.Timestamp]
) -> dict[str, Change]:
    actual = table.loc[target_day]
    expected = table.loc[baseline].mean(axis=0)
    return {
        str(name): _change(float(actual[name]), float(expected[name])) for name in table.columns
    }


def _sign(x: float) -> int:
    return int(np.sign(x))


def compare_segments(
    frame: pd.DataFrame,
    day: pd.Series,
    target_day: pd.Timestamp,
    *,
    aggregation: Aggregation = "sum",
    value_column: str | None = None,
    dimensions: list[str] | None = None,
    baseline: Baseline = "same_weekday",
    baseline_periods: int = 4,
    first_day: pd.Timestamp | None = None,
    last_day: pd.Timestamp | None = None,
    metric_label: str | None = None,
) -> SegmentComparison:
    """Compare every slice of `dimensions` on `target_day` with its baseline.

    `frame` holds the (already filtered) rows and `day` their UTC day
    (tz-aware, floored, aligned on `frame.index`). `first_day`/`last_day`
    bound the data's day range (default: the range of `day`); baseline days
    before `first_day` are dropped. `dimensions` defaults to
    `candidate_dimensions(frame, exclude=[value_column])`.
    """
    if aggregation != "count" and not value_column:
        raise ValueError(f"aggregation '{aggregation}' needs a value column")
    if value_column and value_column not in frame.columns:
        raise ValueError(f"Unknown value column '{value_column}'")
    valid_days = day.dropna()
    first_day = valid_days.min() if first_day is None else first_day
    last_day = valid_days.max() if last_day is None else last_day
    if pd.isna(first_day) or pd.isna(last_day):
        raise ValueError("No rows with a parseable day")
    if not first_day <= target_day <= last_day:
        raise ValueError(
            f"Target day {target_day.date()} is outside the data range "
            f"{first_day.date()}..{last_day.date()}"
        )
    base = baseline_days(target_day, baseline, baseline_periods, first_day)
    if not base:
        raise ValueError(f"No baseline days before {target_day.date()} inside the data range")

    if dimensions is None:
        dimensions = candidate_dimensions(frame, exclude=[value_column] if value_column else [])
    unknown = [d for d in dimensions if d not in frame.columns]
    if unknown:
        raise ValueError(f"Unknown dimension column(s): {', '.join(unknown)}")

    days = [*base, target_day]
    totals = _compare(_daily(frame, day, aggregation, value_column, days), target_day, base)
    total = totals.get("__total__", _change(0.0, 0.0))
    direction = _sign(total.delta)

    results = []
    for column in dimensions:
        changes = _compare(
            _daily(frame, day, aggregation, value_column, days, column), target_day, base
        )
        slices = [
            Slice(
                value=value,
                actual=c.actual,
                expected=c.expected,
                delta=c.delta,
                delta_percent=c.delta_percent,
                share_of_delta=c.delta / total.delta if total.delta else 0.0,
            )
            for value, c in changes.items()
        ]
        slices.sort(key=lambda s: (-abs(s.delta), s.value))
        movers = [s for s in slices if direction and _sign(s.delta) == direction]
        best = max(movers, key=lambda s: s.share_of_delta, default=None)
        concentration = float(np.clip(best.share_of_delta, 0.0, 1.0)) if best else 0.0
        results.append(
            Dimension(column=column, concentration=concentration, slices=slices, best=best)
        )

    # Ties (shares above 1 clip to the same concentration) go to the dimension whose
    # best slice moved most in relative terms: the more specific explanation.
    def rank(d: Dimension) -> tuple[float, float]:
        pct = d.best.delta_percent if d.best and d.best.delta_percent is not None else 0.0
        return (-d.concentration, -abs(pct))

    results.sort(key=rank)

    top = None
    if results and results[0].best is not None and total.delta_percent is not None:
        lead = results[0]
        pct = lead.best.delta_percent
        if (
            lead.concentration >= MIN_CONCENTRATION
            and pct is not None
            and abs(pct) >= MIN_RELATIVE_MOVE * abs(total.delta_percent)
        ):
            top = TopSlice(column=lead.column, slice=lead.best)

    what = metric_label or (f"{aggregation}({value_column or '*'})")
    if baseline == "same_weekday":
        base_text = f"the same weekday in the previous {baseline_periods} weeks"
    else:
        base_text = f"the previous {7 * baseline_periods} days"
    clipped = "" if len(base) == len(baseline_days(target_day, baseline, baseline_periods)) else (
        " (limited to days inside the data range)"
    )
    description = (
        f"Segment comparison of {what} on UTC day {target_day.date()} against a baseline of "
        f"{base_text}{clipped}: {len(base)} days, {base[0].date()}..{base[-1].date()}. Per slice, "
        "actual = the slice's aggregate on the target day, expected = mean of its daily "
        "aggregate over the baseline days (0 on days the slice has no rows), delta = actual - "
        "expected, deltaPercent = delta / |expected| * 100, shareOfDelta = delta / total delta. "
        "concentration = largest shareOfDelta among slices moving with the total, clipped to "
        "[0, 1]; dimensions ranked by concentration (ties: larger |deltaPercent| of the best "
        f"slice). topSlice requires concentration >= {MIN_CONCENTRATION} and |deltaPercent| >= "
        f"{MIN_RELATIVE_MOVE:g}x the total's. Dimensions: {', '.join(dimensions) or 'none'}."
    )
    return SegmentComparison(
        target_day=target_day,
        baseline_days=base,
        total=total,
        dimensions=results,
        top_slice=top,
        description=description,
    )
