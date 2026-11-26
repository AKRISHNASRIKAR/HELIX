"""Temporal alignment of discrete events (deploys, incidents, campaigns) with
target days (usually anomaly days).

For a target UTC day D, an event matches when its time t falls in
[D 00:00 - window_hours_before, D 00:00 + 24h + window_hours_after).
hours_before = (D 00:00 - t) in hours: positive when the event happened
before the day started, negative when it happened during or after it.
same_day = the event's UTC date is D. Matches are sorted by |hours_before|,
then by time.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import pandas as pd

HOUR = pd.Timedelta(hours=1)


@dataclass
class EventMatch:
    index: int  # position of the event in the input
    time: pd.Timestamp
    labels: dict[str, Any]
    hours_before: float
    same_day: bool


@dataclass
class TargetAlignment:
    date: pd.Timestamp
    label: str | None
    events: list[EventMatch] = field(default_factory=list)


def _utc(ts: pd.Timestamp) -> pd.Timestamp:
    ts = pd.Timestamp(ts)
    return ts.tz_localize("UTC") if ts.tzinfo is None else ts.tz_convert("UTC")


def align_events(
    times: pd.Series | list,
    targets: list[tuple[pd.Timestamp, str | None]],
    labels: list[dict[str, Any]] | None = None,
    window_hours_before: float = 24.0,
    window_hours_after: float = 24.0,
) -> list[TargetAlignment]:
    """Match events (`times`, with optional per-event `labels`) to each target day.

    Event times that are missing (NaT/None) never match. Target days are
    floored to the UTC day.
    """
    if window_hours_before < 0 or window_hours_after < 0:
        raise ValueError("Alignment windows must be >= 0 hours")
    stamps = pd.to_datetime(pd.Series(list(times), dtype=object), utc=True, errors="coerce")
    if labels is not None and len(labels) != len(stamps):
        raise ValueError("labels must have one entry per event")

    out = []
    for target, label in targets:
        day = _utc(target).floor("D")
        start = day - window_hours_before * HOUR
        end = day + pd.Timedelta(days=1) + window_hours_after * HOUR
        matches = []
        for i, t in enumerate(stamps):
            if pd.isna(t) or not start <= t < end:
                continue
            matches.append(
                EventMatch(
                    index=i,
                    time=t,
                    labels=dict(labels[i]) if labels is not None else {},
                    hours_before=(day - t) / HOUR,
                    same_day=t.floor("D") == day,
                )
            )
        matches.sort(key=lambda m: (abs(m.hours_before), m.time))
        out.append(TargetAlignment(date=day, label=label, events=matches))
    return out
