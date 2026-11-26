import pandas as pd
import pytest
from helix_segmentation import baseline_days, candidate_dimensions, compare_segments

START = pd.Timestamp("2026-01-01", tz="UTC")


def _day(n: int) -> pd.Timestamp:
    return START + pd.Timedelta(days=n)


def _frame(drop_web_on: int | None = 28, days: int = 35) -> pd.DataFrame:
    """Per day: web 10 x 10.0, mobile 5 x 10.0, partner 5 x 10.0 (revenue 100/50/50).
    On `drop_web_on`, web keeps only 2 orders. `segment` alternates evenly."""
    rows = []
    for d in range(days):
        for channel, n in (("web", 10), ("mobile", 5), ("partner", 5)):
            if d == drop_web_on and channel == "web":
                n = 2
            for k in range(n):
                rows.append(
                    {
                        "created_at": _day(d) + pd.Timedelta(hours=k),
                        "channel": channel,
                        "segment": "smb" if k % 2 else "enterprise",
                        "amount": 10.0,
                        "order_id": f"o{d}-{channel}-{k}",
                    }
                )
    return pd.DataFrame(rows)


def _days(frame: pd.DataFrame) -> pd.Series:
    return pd.to_datetime(frame["created_at"], utc=True).dt.floor("D")


def test_baseline_days_same_weekday_and_trailing():
    target = _day(28)
    assert baseline_days(target, "same_weekday", 4) == [_day(0), _day(7), _day(14), _day(21)]
    trailing = baseline_days(target, "trailing_mean", 1)
    assert trailing == [_day(n) for n in range(21, 28)]
    # Days before the data start are dropped.
    assert baseline_days(target, "same_weekday", 6, first_day=_day(7)) == [
        _day(7),
        _day(14),
        _day(21),
    ]
    with pytest.raises(ValueError):
        baseline_days(target, "same_weekday", 0)


def test_candidate_dimensions_picks_low_cardinality_text_columns():
    frame = _frame()
    assert candidate_dimensions(frame) == ["channel", "segment"]
    assert candidate_dimensions(frame, exclude=["channel"]) == ["segment"]


def test_web_drop_is_the_top_slice_with_hand_computed_numbers():
    frame = _frame()
    result = compare_segments(
        frame, _days(frame), _day(28), aggregation="sum", value_column="amount"
    )
    # total: actual 20 + 50 + 50 = 120, expected 200 -> delta -80, -40%.
    assert result.total.actual == 120.0
    assert result.total.expected == 200.0
    assert result.total.delta == -80.0
    assert result.total.delta_percent == pytest.approx(-40.0)
    channel = result.dimensions[0]
    assert channel.column == "channel"
    assert channel.concentration == pytest.approx(1.0)
    web = channel.slices[0]
    assert (web.value, web.actual, web.expected, web.delta) == ("web", 20.0, 100.0, -80.0)
    assert web.delta_percent == pytest.approx(-80.0)
    assert web.share_of_delta == pytest.approx(1.0)
    assert sum(s.share_of_delta for s in channel.slices) == pytest.approx(1.0)
    assert result.top_slice is not None
    assert result.top_slice.column == "channel"
    assert result.top_slice.slice.value == "web"
    assert "same weekday" in result.description


def test_even_move_has_no_top_slice():
    """Both segments lose 4 orders (-36% and -44%), close to the total's -40%."""
    frame = _frame()
    result = compare_segments(
        frame, _days(frame), _day(28), value_column="amount", dimensions=["segment"]
    )
    [segment] = result.dimensions
    assert segment.concentration == pytest.approx(0.5)
    # Neither half moved disproportionately (needs >= 1.5x the total's -40%).
    assert sorted(round(s.delta_percent, 1) for s in segment.slices) == [-44.4, -36.4]
    assert result.top_slice is None


def test_count_aggregation_and_trailing_baseline():
    frame = _frame()
    result = compare_segments(
        frame,
        _days(frame),
        _day(28),
        aggregation="count",
        dimensions=["channel"],
        baseline="trailing_mean",
        baseline_periods=2,
    )
    assert len(result.baseline_days) == 14
    assert result.total.actual == 12.0
    assert result.total.expected == 20.0
    assert result.top_slice.slice.value == "web"
    assert result.top_slice.slice.share_of_delta == pytest.approx(1.0)


def test_no_move_gives_zero_shares_and_no_top_slice():
    frame = _frame(drop_web_on=None)
    result = compare_segments(frame, _days(frame), _day(28), value_column="amount")
    assert result.total.delta == 0.0
    assert all(d.concentration == 0.0 for d in result.dimensions)
    assert all(s.share_of_delta == 0.0 for d in result.dimensions for s in d.slices)
    assert result.top_slice is None


def test_slice_absent_on_baseline_counts_as_zero():
    frame = _frame(drop_web_on=None)
    extra = pd.DataFrame(
        [{"created_at": _day(28), "channel": "kiosk", "segment": "smb", "amount": 90.0}]
    )
    frame = pd.concat([frame, extra], ignore_index=True)
    result = compare_segments(
        frame, _days(frame), _day(28), value_column="amount", dimensions=["channel"]
    )
    kiosk = result.dimensions[0].slices[0]
    assert (kiosk.value, kiosk.expected, kiosk.actual) == ("kiosk", 0.0, 90.0)
    assert kiosk.delta_percent is None
    assert kiosk.share_of_delta == pytest.approx(1.0)


def test_rejects_bad_inputs():
    frame = _frame()
    days = _days(frame)
    with pytest.raises(ValueError, match="outside the data range"):
        compare_segments(frame, days, _day(99), value_column="amount")
    with pytest.raises(ValueError, match="No baseline days"):
        compare_segments(frame, days, _day(3), value_column="amount")
    with pytest.raises(ValueError, match="Unknown dimension"):
        compare_segments(frame, days, _day(28), value_column="amount", dimensions=["nope"])
    with pytest.raises(ValueError, match="needs a value column"):
        compare_segments(frame, days, _day(28), aggregation="sum")


def test_relative_move_threshold_is_one_and_a_half():
    """Web is 2/3 of revenue and drops 60%: 1.5x the total's -40% still qualifies."""
    rows = []
    for d in range(29):
        for channel, n in (("web", 10), ("mobile", 5)):
            if d == 28 and channel == "web":
                n = 4
            rows += [{"created_at": _day(d), "channel": channel, "amount": 1.0}] * n
    frame = pd.DataFrame(rows)
    result = compare_segments(frame, _days(frame), _day(28), value_column="amount")
    assert result.total.delta_percent == pytest.approx(-40.0)
    assert result.top_slice.slice.delta_percent == pytest.approx(-60.0)
    assert result.top_slice.slice.value == "web"
