"""Anomaly detectors over a single, evenly spaced (daily) metric series.

Every detector returns the same `DetectionResult` shape: an expected value per
point, a signed robust z-score of the residual (value - expected) per point,
and the flagged points. Scores are "robust" because the scale is estimated
from the median absolute deviation (MAD), not the standard deviation, so the
anomalies being hunted for cannot inflate the yardstick used to find them.

Detectors:
- `robust_zscore`: expected = series median, score = (x - median) / (1.4826 * MAD).
- `iqr`: Tukey fences. Flagged outside [Q1 - k*IQR, Q3 + k*IQR] with
  k = threshold / 2 (threshold 3.0 -> the classic k = 1.5); score uses
  sigma ~ IQR / 1.349.
- `seasonal`: STL decomposition (robust LOESS, period 7 by default);
  expected = trend + seasonal, score = robust z-score of the STL residual.
- `detect(method="auto")`: seasonal when there are >= 4 full periods and the
  seasonal component is material (strength >= 0.3), else robust_zscore.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

import numpy as np
import pandas as pd

Method = Literal["auto", "zscore", "iqr", "seasonal"]
Severity = Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]
Direction = Literal["spike", "drop"]

# 1.4826 * MAD is a consistent estimator of the standard deviation for normal data.
MAD_TO_SIGMA = 1.4826
# IQR / 1.349 is a consistent estimator of the standard deviation for normal data.
IQR_TO_SIGMA = 1.349
MIN_POINTS = 7
SEASONAL_MIN_PERIODS = 4
SEASONAL_STRENGTH_MIN = 0.3


@dataclass
class AnomalyPoint:
    index: int
    timestamp: object | None
    value: float
    expected: float
    score: float
    severity: Severity
    direction: Direction
    method: str


@dataclass
class DetectionResult:
    method_used: str
    expected: np.ndarray
    scores: np.ndarray
    anomalies: list[AnomalyPoint] = field(default_factory=list)
    # Human-readable description of exactly how expected/scores were computed.
    description: str = ""
    seasonal_strength: float | None = None


def severity_for(score: float) -> Severity:
    """Map |score| to a severity. 3..4 MEDIUM, 4..6 HIGH, >=6 CRITICAL, <3 LOW.

    LOW is only reachable for points flagged with |score| < 3, i.e. when the
    caller lowered the threshold below 3 (or an IQR fence fired early).
    """
    magnitude = abs(score)
    if magnitude >= 6:
        return "CRITICAL"
    if magnitude >= 4:
        return "HIGH"
    if magnitude >= 3:
        return "MEDIUM"
    return "LOW"


def _as_series(values: pd.Series | np.ndarray | list[float]) -> pd.Series:
    series = values.copy() if isinstance(values, pd.Series) else pd.Series(values, dtype=float)
    series = series.astype(float)
    if series.isna().any():
        raise ValueError("series contains missing values; fill or drop them before detection")
    if len(series) < MIN_POINTS:
        raise ValueError(f"need at least {MIN_POINTS} points, got {len(series)}")
    return series


def robust_scale(residuals: np.ndarray) -> float:
    """Robust sigma estimate: 1.4826 * MAD, falling back to the mean absolute
    deviation (x 1.2533, also normal-consistent) when more than half the
    residuals are identical and MAD collapses to zero. Returns 0.0 only when
    every residual is the same."""
    centered = residuals - np.median(residuals)
    mad = float(np.median(np.abs(centered)))
    if mad > 0:
        return MAD_TO_SIGMA * mad
    meanad = float(np.mean(np.abs(centered)))
    return 1.2533 * meanad


def _robust_z(residuals: np.ndarray) -> np.ndarray:
    scale = robust_scale(residuals)
    if scale == 0:
        return np.zeros_like(residuals)
    return (residuals - np.median(residuals)) / scale


def _collect(
    series: pd.Series,
    expected: np.ndarray,
    scores: np.ndarray,
    flagged: np.ndarray,
    method: str,
) -> list[AnomalyPoint]:
    points: list[AnomalyPoint] = []
    values = series.to_numpy(dtype=float)
    for i in np.flatnonzero(flagged):
        points.append(
            AnomalyPoint(
                index=int(i),
                timestamp=series.index[i],
                value=float(values[i]),
                expected=float(expected[i]),
                score=float(scores[i]),
                severity=severity_for(float(scores[i])),
                direction="spike" if values[i] >= expected[i] else "drop",
                method=method,
            )
        )
    return points


def robust_zscore(values, threshold: float = 3.0) -> DetectionResult:
    series = _as_series(values)
    x = series.to_numpy(dtype=float)
    median = float(np.median(x))
    expected = np.full_like(x, median)
    scores = _robust_z(x - median)
    flagged = np.abs(scores) >= threshold
    return DetectionResult(
        method_used="zscore",
        expected=expected,
        scores=scores,
        anomalies=_collect(series, expected, scores, flagged, "robust_zscore"),
        description=(
            f"Robust z-score: expected value = series median ({median:.4g}); "
            "score = (value - median) / (1.4826 * MAD); "
            f"flagged when |score| >= {threshold:g} over {len(x)} points."
        ),
    )


def iqr(values, threshold: float = 3.0) -> DetectionResult:
    series = _as_series(values)
    x = series.to_numpy(dtype=float)
    q1, median, q3 = (float(v) for v in np.percentile(x, [25, 50, 75]))
    spread = q3 - q1
    k = threshold / 2
    lower, upper = q1 - k * spread, q3 + k * spread
    expected = np.full_like(x, median)
    scores = (x - median) / (spread / IQR_TO_SIGMA) if spread > 0 else _robust_z(x - median)
    flagged = (x < lower) | (x > upper) if spread > 0 else np.abs(scores) >= threshold
    return DetectionResult(
        method_used="iqr",
        expected=expected,
        scores=scores,
        anomalies=_collect(series, expected, scores, flagged, "iqr"),
        description=(
            f"IQR (Tukey fences): Q1={q1:.4g}, Q3={q3:.4g}, k={k:g}; flagged outside "
            f"[{lower:.4g}, {upper:.4g}]; expected value = median ({median:.4g}); "
            "score = (value - median) / (IQR / 1.349)."
        ),
    )


def _odd(n: int) -> int:
    return n if n % 2 else n + 1


def stl_windows(period: int) -> tuple[int, int]:
    """(seasonal, trend) LOESS windows used for STL.

    statsmodels' defaults (seasonal=7, trend ~1.5 periods) let a robust fit
    bend around individual days, which shrinks the residual MAD and inflates
    every score. A ~5-period seasonal window (a slowly evolving weekly profile)
    and a ~6-period trend window keep the expected value smooth enough that
    the residual reflects day-level noise.
    """
    return _odd(5 * period), _odd(6 * period)


def _stl(series: pd.Series, period: int):
    # Imported lazily: statsmodels is slow to import and only this path needs it.
    from statsmodels.tsa.seasonal import STL

    seasonal_window, trend_window = stl_windows(period)
    return STL(
        series.to_numpy(dtype=float),
        period=period,
        seasonal=seasonal_window,
        trend=trend_window,
        robust=True,
    ).fit()


def seasonal_strength(values, period: int = 7) -> float:
    """Seasonal strength F_s = max(0, 1 - Var(resid) / Var(seasonal + resid))
    (Wang, Smith and Hyndman 2006). ~0 means no seasonality, ~1 means strong."""
    series = _as_series(values)
    if len(series) < 2 * period + 1:
        return 0.0
    fit = _stl(series, period)
    resid = np.asarray(fit.resid)
    detrended = np.asarray(fit.seasonal) + resid
    denom = float(np.var(detrended))
    if denom == 0:
        return 0.0
    return max(0.0, 1.0 - float(np.var(resid)) / denom)


def seasonal(values, threshold: float = 3.0, period: int = 7) -> DetectionResult:
    series = _as_series(values)
    if len(series) < 2 * period + 1:
        raise ValueError(f"seasonal detection needs at least {2 * period + 1} points")
    fit = _stl(series, period)
    trend, season, resid = (np.asarray(a) for a in (fit.trend, fit.seasonal, fit.resid))
    expected = trend + season
    scores = _robust_z(resid)
    flagged = np.abs(scores) >= threshold
    detrended_var = float(np.var(season + resid))
    strength = max(0.0, 1.0 - float(np.var(resid)) / detrended_var) if detrended_var else 0.0
    return DetectionResult(
        method_used="seasonal",
        expected=expected,
        scores=scores,
        anomalies=_collect(series, expected, scores, flagged, "stl_seasonal"),
        description=(
            f"STL decomposition (period {period}, seasonal window {stl_windows(period)[0]}, "
            f"trend window {stl_windows(period)[1]}, robust LOESS) over {len(series)} points; "
            "expected value = trend + seasonal component; score = robust z-score of the "
            f"STL residual ((resid - median) / (1.4826 * MAD)); flagged when |score| >= "
            f"{threshold:g}. Seasonal strength {strength:.2f}."
        ),
        seasonal_strength=strength,
    )


def detect(values, method: Method = "auto", threshold: float = 3.0, period: int = 7):
    """Run one detector, or pick one with `auto` (see module docstring)."""
    if threshold <= 0:
        raise ValueError("threshold must be positive")
    if method == "zscore":
        return robust_zscore(values, threshold)
    if method == "iqr":
        return iqr(values, threshold)
    if method == "seasonal":
        return seasonal(values, threshold, period)
    if method != "auto":
        raise ValueError(f"unknown method {method!r}")

    series = _as_series(values)
    if len(series) >= SEASONAL_MIN_PERIODS * period:
        result = seasonal(series, threshold, period)
        if (result.seasonal_strength or 0.0) >= SEASONAL_STRENGTH_MIN:
            result.description = (
                f"auto selected seasonal: {len(series)} points >= {SEASONAL_MIN_PERIODS * period} "
                f"and seasonal strength {result.seasonal_strength:.2f} >= "
                f"{SEASONAL_STRENGTH_MIN}. " + result.description
            )
            return result
        reason = (
            f"seasonal strength {result.seasonal_strength:.2f} < {SEASONAL_STRENGTH_MIN}"
        )
    else:
        reason = f"only {len(series)} points (< {SEASONAL_MIN_PERIODS * period} for seasonal)"
    result = robust_zscore(series, threshold)
    result.description = f"auto selected robust z-score: {reason}. " + result.description
    return result
