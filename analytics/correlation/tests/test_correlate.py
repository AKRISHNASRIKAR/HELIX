import numpy as np
import pandas as pd
import pytest
from helix_correlation import correlate
from scipy import stats


def _series(values, start="2026-01-01") -> pd.Series:
    index = pd.date_range(start, periods=len(values), freq="D", tz="UTC")
    return pd.Series(np.asarray(values, dtype=float), index=index)


def test_identical_series_correlate_perfectly_at_lag_zero():
    a = _series(np.arange(20) % 7 + np.arange(20) * 0.1)
    result = correlate(a, a.copy(), method="pearson", max_lag=3)
    assert result.coefficient == pytest.approx(1.0)
    assert result.lag == 0
    assert result.n == 20
    assert result.p_value < 1e-6
    assert [lag.lag for lag in result.lags] == [0, 1, 2, 3]


def test_leading_series_is_found_at_its_lag():
    rng = np.random.default_rng(3)
    b = _series(rng.normal(0, 1, 40))
    # a[t] = b[t - 2]: b leads a by 2 days.
    a = b.copy()
    a.index = a.index + pd.Timedelta(days=2)
    result = correlate(a, b, method="spearman", max_lag=5)
    assert result.lag == 2
    assert result.coefficient == pytest.approx(1.0)
    assert result.n == 40
    assert "Spearman" in result.description


def test_matches_scipy_on_the_aligned_overlap():
    rng = np.random.default_rng(11)
    a = _series(rng.normal(0, 1, 30))
    b = _series(0.5 * a.to_numpy() + rng.normal(0, 1, 30), start="2026-01-06")
    result = correlate(a, b, method="pearson", max_lag=0)
    overlap = a.index.intersection(b.index)
    expected = stats.pearsonr(a[overlap], b[overlap])
    assert result.n == len(overlap) == 25
    assert result.coefficient == pytest.approx(expected.statistic)
    assert result.p_value == pytest.approx(expected.pvalue)


def test_missing_days_are_dropped():
    a = _series(np.arange(15))
    b = _series(np.arange(15) * 2.0)
    b.iloc[3] = np.nan
    result = correlate(a, b, method="pearson", max_lag=0)
    assert result.n == 14


def test_needs_ten_overlapping_days():
    with pytest.raises(ValueError, match="at least 10 overlapping days"):
        correlate(_series(range(9)), _series(range(9)))


def test_constant_series_is_rejected():
    with pytest.raises(ValueError, match="constant"):
        correlate(_series([1.0] * 15), _series(range(15)))


def test_rejects_bad_arguments():
    a = _series(range(15))
    with pytest.raises(ValueError):
        correlate(a, a, max_lag=15)
    with pytest.raises(ValueError):
        correlate(a, a, method="kendall")
