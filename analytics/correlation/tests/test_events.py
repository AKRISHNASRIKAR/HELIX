import pandas as pd
import pytest
from helix_correlation import align_events

DAY = pd.Timestamp("2026-10-08", tz="UTC")


def test_hours_before_same_day_and_ordering():
    times = [
        "2026-10-08T08:40:00Z",  # during the day: -8.67h
        "2026-10-07T22:00:00Z",  # 2h before the day starts
        "2026-10-09T23:00:00Z",  # inside the after-window (ends 10-10 00:00 with 24h)
        "2026-10-06T12:00:00Z",  # 36h before: outside the 24h window
        "2026-10-10T00:00:00Z",  # window end is exclusive
    ]
    labels = [{"service": s} for s in ("web-checkout", "api", "search", "old", "edge")]
    [match] = align_events(times, [(DAY, "revenue drop")], labels)
    assert match.label == "revenue drop"
    assert [e.labels["service"] for e in match.events] == ["api", "web-checkout", "search"]
    api, checkout, search = match.events
    assert api.hours_before == pytest.approx(2.0)
    assert api.same_day is False
    assert checkout.hours_before == pytest.approx(-(8 + 40 / 60))
    assert checkout.same_day is True
    assert search.hours_before == pytest.approx(-47.0)
    assert search.index == 2


def test_windows_are_configurable():
    times = ["2026-10-06T12:00:00Z", "2026-10-09T05:00:00Z"]
    [match] = align_events(times, [(DAY, None)], window_hours_before=48, window_hours_after=0)
    assert [e.hours_before for e in match.events] == [36.0]


def test_multiple_targets_naive_dates_and_missing_times():
    times = [pd.Timestamp("2026-10-08T01:00:00Z"), None, "not a time"]
    targets = [(pd.Timestamp("2026-10-08 13:00"), None), (DAY + pd.Timedelta(days=5), "x")]
    out = align_events(times, targets)
    assert out[0].date == DAY
    assert [e.index for e in out[0].events] == [0]
    assert out[0].events[0].labels == {}
    assert out[1].events == []


def test_rejects_bad_arguments():
    with pytest.raises(ValueError):
        align_events(["2026-10-08T00:00:00Z"], [(DAY, None)], window_hours_before=-1)
    with pytest.raises(ValueError):
        align_events(["2026-10-08T00:00:00Z"], [(DAY, None)], labels=[])
