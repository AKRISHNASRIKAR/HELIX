import numpy as np
import pandas as pd
import pytest
from helix_forecasting import backtest, forecast, holdout_size, mape


def _weekly_series(days: int = 84, seed: int = 3) -> pd.Series:
    rng = np.random.default_rng(seed)
    idx = pd.date_range("2026-01-01", periods=days, freq="D", tz="UTC")
    weekly = np.where(idx.dayofweek >= 5, 700.0, 1000.0)
    trend = np.linspace(0, 100, days)
    return pd.Series(weekly + trend + rng.normal(0, 20, days), index=idx)


def test_mape_hand_computed():
    assert mape(np.array([100.0, 200.0]), np.array([110.0, 180.0])) == pytest.approx(10.0)
    assert mape(np.array([0.0, 100.0]), np.array([5.0, 90.0])) == pytest.approx(10.0)
    assert mape(np.array([0.0]), np.array([1.0])) is None


def test_holdout_size_rules():
    assert holdout_size(84, 14) == 14
    assert holdout_size(40, 14) == 10
    assert holdout_size(14, 14) == 0


@pytest.mark.parametrize("method", ["ets", "arima"])
def test_each_method_forecasts_weekly_series_with_intervals(method):
    series = _weekly_series()
    result = forecast(series, horizon=14, method=method)
    assert result.method_used == method
    assert len(result.mean) == 14
    assert np.all(result.lower <= result.mean) and np.all(result.mean <= result.upper)
    assert result.index is not None and result.index[0] == series.index[-1] + pd.Timedelta(days=1)
    assert result.backtest_mape is not None and result.backtest_mape < 10
    assert result.holdout_days == 14
    assert result.description


def test_ets_captures_weekly_pattern():
    series = _weekly_series()
    result = forecast(series, horizon=14, method="ets")
    weekend = [v for t, v in zip(result.index, result.mean, strict=True) if t.dayofweek >= 5]
    weekday = [v for t, v in zip(result.index, result.mean, strict=True) if t.dayofweek < 5]
    assert np.mean(weekend) < np.mean(weekday) * 0.85


def test_auto_picks_lower_backtest_mape():
    series = _weekly_series()
    result = forecast(series, horizon=14, method="auto")
    ets_mape, _ = backtest(series, "ets", 14)
    arima_mape, _ = backtest(series, "arima", 14)
    expected = "ets" if ets_mape <= arima_mape else "arima"
    assert result.method_used == expected
    assert result.backtest_mape == pytest.approx(min(ets_mape, arima_mape))
    assert "auto selected" in result.description


def test_short_series_without_seasonality_still_forecasts():
    result = forecast([10.0, 11, 12, 13, 12, 14, 15, 15, 16, 17, 18, 18], horizon=3, method="ets")
    assert len(result.mean) == 3
    assert "ETS(A,Ad,N)" in result.description
    assert result.backtest_mape is None  # 12 points leave no room for a 14-point training set


def test_rejects_bad_input():
    with pytest.raises(ValueError):
        forecast([1.0, 2, 3])
    with pytest.raises(ValueError):
        forecast(_weekly_series(), method="prophet")
    with pytest.raises(ValueError):
        forecast(_weekly_series(), horizon=0)
