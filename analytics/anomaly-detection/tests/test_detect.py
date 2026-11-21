import numpy as np
import pandas as pd
import pytest
from helix_anomaly import detect, iqr, robust_zscore, seasonal, seasonal_strength, severity_for


def _weekly_series(days: int = 70, seed: int = 1) -> pd.Series:
    rng = np.random.default_rng(seed)
    idx = pd.date_range("2026-01-01", periods=days, freq="D", tz="UTC")
    weekly = np.where(idx.dayofweek >= 5, 70.0, 100.0)
    trend = np.linspace(0, 10, days)
    return pd.Series(weekly + trend + rng.normal(0, 2, days), index=idx)


def test_severity_mapping():
    assert severity_for(2.5) == "LOW"
    assert severity_for(-3.0) == "MEDIUM"
    assert severity_for(3.99) == "MEDIUM"
    assert severity_for(4.0) == "HIGH"
    assert severity_for(-5.9) == "HIGH"
    assert severity_for(6.0) == "CRITICAL"


def test_robust_zscore_flags_spike_and_hand_computed_score():
    values = [10.0, 11.0, 9.0, 10.0, 10.0, 11.0, 9.0, 10.0, 40.0]
    result = robust_zscore(values, threshold=3.0)
    assert result.method_used == "zscore"
    assert [a.index for a in result.anomalies] == [8]
    point = result.anomalies[0]
    # median = 10, |dev| = [0,1,1,0,0,1,1,0,30] -> MAD = 1 -> score = 30 / 1.4826
    assert point.expected == 10.0
    assert point.score == pytest.approx(30 / 1.4826)
    assert point.direction == "spike"
    assert point.severity == "CRITICAL"


def test_robust_zscore_constant_series_flags_nothing():
    result = robust_zscore([5.0] * 10)
    assert result.anomalies == []
    assert np.all(result.scores == 0)


def test_robust_zscore_mad_zero_falls_back_to_mean_absolute_deviation():
    values = [5.0] * 9 + [50.0]
    result = robust_zscore(values)
    assert [a.index for a in result.anomalies] == [9]


def test_iqr_flags_drop():
    values = [100.0, 102, 98, 101, 99, 100, 103, 97, 100, 20]
    result = iqr(values)
    assert [a.index for a in result.anomalies] == [9]
    assert result.anomalies[0].direction == "drop"
    assert result.anomalies[0].score < 0


def test_seasonal_ignores_weekends_but_flags_injected_drop():
    series = _weekly_series()
    series.iloc[50] = series.iloc[50] * 0.6
    result = seasonal(series)
    flagged = [a.index for a in result.anomalies]
    assert 50 in flagged
    assert all(a.direction == "drop" for a in result.anomalies if a.index == 50)
    # Weekends are ~30% lower by construction; a plain z-score would see them as
    # outliers but STL absorbs them into the seasonal component, so no weekend
    # day scores anywhere near the injected drop.
    weekend = [
        abs(result.scores[i]) for i in range(len(series)) if series.index[i].dayofweek >= 5
    ]
    assert max(weekend) < 4
    assert abs(result.scores[50]) > 10
    assert result.seasonal_strength is not None and result.seasonal_strength > 0.8


def test_auto_picks_seasonal_for_weekly_data_and_zscore_otherwise():
    weekly = _weekly_series()
    assert detect(weekly).method_used == "seasonal"
    assert seasonal_strength(weekly) > 0.8

    rng = np.random.default_rng(2)
    flat = pd.Series(100 + rng.normal(0, 2, 70))
    auto = detect(flat)
    assert auto.method_used == "zscore"
    assert "seasonal strength" in auto.description

    short = detect([1.0, 2, 3, 2, 1, 2, 3, 2, 1, 2])
    assert short.method_used == "zscore"
    assert "only 10 points" in short.description


def test_rejects_short_or_missing_input():
    with pytest.raises(ValueError):
        detect([1.0, 2.0, 3.0])
    with pytest.raises(ValueError):
        detect([1.0, 2, 3, None, 5, 6, 7, 8])
    with pytest.raises(ValueError):
        detect([1.0] * 10, method="bogus")
    with pytest.raises(ValueError):
        seasonal([1.0] * 10)


def test_every_result_has_description():
    series = _weekly_series()
    for method in ("auto", "zscore", "iqr", "seasonal"):
        assert detect(series, method=method).description
