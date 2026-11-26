"""Lagged correlation between two daily metric series.

Both series are indexed by UTC day. For each lag k in 0..max_lag, b is
shifted forward by k days (b's value on day t is paired with a's value on day
t + k, so a positive lag means b leads a), the pair is aligned on day, days
missing in either series are dropped, and the coefficient is computed with
scipy (Pearson r or Spearman rho, with the test's two-sided p-value). The lag
with the largest |coefficient| wins; ties go to the smaller lag.
"""

from __future__ import annotations

import math
import warnings
from dataclasses import dataclass
from typing import Literal

import pandas as pd
from scipy import stats

Method = Literal["pearson", "spearman"]

MIN_OVERLAP = 10
MAX_LAG = 14


@dataclass
class LagResult:
    lag: int
    coefficient: float
    p_value: float
    n: int


@dataclass
class CorrelationResult:
    coefficient: float
    method: str
    lag: int
    p_value: float
    n: int
    # Every lag that could be computed, in lag order.
    lags: list[LagResult]
    description: str = ""


def _pair(a: pd.Series, b: pd.Series, lag: int) -> pd.DataFrame:
    shifted = b.copy()
    shifted.index = shifted.index + pd.Timedelta(days=lag)
    return pd.concat([a.rename("a"), shifted.rename("b")], axis=1, join="inner").dropna()


def _coefficient(x: pd.Series, y: pd.Series, method: Method) -> tuple[float, float]:
    with warnings.catch_warnings():
        # Constant input: scipy warns and returns NaN, which the caller skips.
        warnings.simplefilter("ignore")
        if method == "pearson":
            result = stats.pearsonr(x.to_numpy(dtype=float), y.to_numpy(dtype=float))
        else:
            result = stats.spearmanr(x.to_numpy(dtype=float), y.to_numpy(dtype=float))
    return float(result.statistic), float(result.pvalue)


def correlate(
    a: pd.Series,
    b: pd.Series,
    method: Method = "spearman",
    max_lag: int = 3,
    min_overlap: int = MIN_OVERLAP,
) -> CorrelationResult:
    """Correlate daily series `a` and `b` over lags 0..max_lag (b shifted by k days)."""
    if method not in ("pearson", "spearman"):
        raise ValueError(f"Unknown correlation method '{method}'")
    if not 0 <= max_lag <= MAX_LAG:
        raise ValueError(f"maxLag must be between 0 and {MAX_LAG}")
    overlap = len(_pair(a, b, 0))
    if overlap < min_overlap:
        raise ValueError(
            f"Correlation needs at least {min_overlap} overlapping days; the series share "
            f"{overlap}."
        )

    lags = []
    for lag in range(max_lag + 1):
        pair = _pair(a, b, lag)
        if len(pair) < min_overlap:
            continue
        coefficient, p_value = _coefficient(pair["a"], pair["b"], method)
        if math.isfinite(coefficient):
            lags.append(LagResult(lag=lag, coefficient=coefficient, p_value=p_value, n=len(pair)))
    if not lags:
        raise ValueError("Correlation is undefined: at least one series is constant.")

    best = lags[0]
    for candidate in lags[1:]:
        if abs(candidate.coefficient) > abs(best.coefficient):
            best = candidate
    name = "Pearson r" if method == "pearson" else "Spearman rank correlation (rho)"
    description = (
        f"{name} between the two daily series (scipy.stats.{method}r, two-sided p-value), "
        f"aligned on UTC day with days missing in either series dropped. Lags 0..{max_lag} "
        "tried (lag k pairs b on day t with a on day t + k, so b leads a by k days; lags with "
        f"fewer than {min_overlap} overlapping days skipped); reported lag = largest "
        f"|coefficient| (ties: smaller lag): lag {best.lag}, n = {best.n}."
    )
    return CorrelationResult(
        coefficient=best.coefficient,
        method=method,
        lag=best.lag,
        p_value=best.p_value,
        n=best.n,
        lags=lags,
        description=description,
    )
