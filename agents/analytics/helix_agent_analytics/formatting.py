"""Presentation helpers: turn engine output into human-readable text.

These only format numbers the engine already computed (ADR-005). The one
place that maps a computed statistic to a confidence lives here too
(`confidence_from_*`), so the mapping is defined once and unit-tested.
"""

from __future__ import annotations

import math
from datetime import UTC, date, datetime
from typing import Any


def parse_timestamp(value: Any) -> datetime:
    """Engine timestamps (ISO string, date-only string, or datetime) -> aware UTC."""
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, date):
        parsed = datetime(value.year, value.month, value.day)
    else:
        text = str(value).strip().replace("Z", "+00:00")
        parsed = datetime.fromisoformat(text)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def format_date(value: Any) -> str:
    return parse_timestamp(value).date().isoformat()


def format_day(value: Any) -> str:
    """'Thursday 2026-10-08'."""
    parsed = parse_timestamp(value)
    return f"{parsed.strftime('%A')} {parsed.date().isoformat()}"


def format_value(value: float | None, unit: str | None) -> str:
    if value is None:
        return "n/a"
    unit_key = (unit or "").lower()
    if unit_key in ("usd", "currency", "$"):
        sign = "-" if value < 0 else ""
        return f"{sign}${abs(value):,.2f}"
    if unit_key in ("ratio", "rate"):
        return f"{value * 100:.1f}%"
    if unit_key in ("percent", "%"):
        return f"{value:.1f}%"
    if float(value).is_integer():
        return f"{int(value):,}"
    return f"{value:,.2f}"


def format_percent_change(change_percent: float) -> str:
    """Engine changePercent is in percentage points (e.g. -12.3 means -12.3%)."""
    return f"{abs(change_percent):.1f}%"


def capitalize(text: str) -> str:
    return text[:1].upper() + text[1:]


def _clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def confidence_from_deviation(deviation_score: float | None) -> float:
    """Two-sided normal coverage of |z|: erf(|z| / sqrt(2)), capped at 0.999."""
    if deviation_score is None:
        return 0.5
    return round(min(0.999, math.erf(abs(deviation_score) / math.sqrt(2))), 4)


def confidence_from_p_value(p_value: float | None) -> float:
    """1 - p of the engine's Welch t-test; 0.5 when the test wasn't computable."""
    if p_value is None:
        return 0.5
    return round(_clamp(1.0 - p_value), 4)


def confidence_from_mape(mape: float | None) -> float:
    """max(0, 1 - MAPE) of the engine's holdout backtest. The engine reports
    MAPE as a percentage (10.8 means 10.8%), so it is converted first."""
    if mape is None:
        return 0.5
    return round(_clamp(1.0 - mape / 100.0), 4)
