"""Baseline univariate forecasts for a daily metric series.

Two statsmodels baselines, both with prediction intervals:
- ETS: additive error, additive damped trend, additive weekly seasonality
  (statsmodels `ETSModel`, the state-space form of `ExponentialSmoothing`,
  which provides analytic prediction intervals). Seasonality is only used
  when there are at least `MIN_SEASONAL_CYCLES` full periods; otherwise the
  model drops to ETS(A,Ad,N).
- ARIMA: ARIMA(1,1,1), with a seasonal AR(1) term at the weekly lag when there
  are enough full periods (SARIMA(1,1,1)x(1,0,0,7)).

Every forecast is backtested: the last `holdout` days are held out, the model
is refit on the rest, and MAPE is measured on the holdout. `method="auto"`
runs both backtests and keeps the one with the lower MAPE.
"""

from __future__ import annotations

import warnings
from dataclasses import dataclass
from typing import Literal

import numpy as np
import pandas as pd

Method = Literal["auto", "ets", "arima"]

MIN_POINTS = 10
MIN_SEASONAL_CYCLES = 3
MIN_BACKTEST_TRAIN = 14


@dataclass
class ForecastResult:
    method_used: str
    index: pd.DatetimeIndex | None
    mean: np.ndarray
    lower: np.ndarray
    upper: np.ndarray
    backtest_mape: float | None
    holdout_days: int
    # Exactly how the forecast and backtest were produced.
    description: str


def _as_series(values) -> pd.Series:
    series = values.copy() if isinstance(values, pd.Series) else pd.Series(values, dtype=float)
    series = series.astype(float)
    if series.isna().any():
        raise ValueError("series contains missing values; fill or drop them before forecasting")
    if len(series) < MIN_POINTS:
        raise ValueError(f"need at least {MIN_POINTS} points to forecast, got {len(series)}")
    return series


def _seasonal(n: int, period: int) -> bool:
    return n >= MIN_SEASONAL_CYCLES * period


def _fit_predict_ets(y: np.ndarray, horizon: int, period: int, alpha: float):
    from statsmodels.tsa.exponential_smoothing.ets import ETSModel

    seasonal = _seasonal(len(y), period)
    model = ETSModel(
        # A RangeIndex Series, not an ndarray: ETSModel.get_prediction needs an index.
        pd.Series(y),
        error="add",
        trend="add",
        damped_trend=True,
        seasonal="add" if seasonal else None,
        seasonal_periods=period if seasonal else None,
        initialization_method="estimated",
    )
    fit = model.fit(disp=False, maxiter=2000)
    frame = fit.get_prediction(start=len(y), end=len(y) + horizon - 1).summary_frame(alpha=alpha)
    label = f"ETS(A,Ad,A) with period {period}" if seasonal else "ETS(A,Ad,N)"
    return (
        frame["mean"].to_numpy(),
        frame["pi_lower"].to_numpy(),
        frame["pi_upper"].to_numpy(),
        label,
    )


def _fit_predict_arima(y: np.ndarray, horizon: int, period: int, alpha: float):
    from statsmodels.tsa.arima.model import ARIMA

    seasonal = _seasonal(len(y), period)
    seasonal_order = (1, 0, 0, period) if seasonal else (0, 0, 0, 0)
    fit = ARIMA(y, order=(1, 1, 1), seasonal_order=seasonal_order).fit()
    pred = fit.get_forecast(steps=horizon)
    interval = np.asarray(pred.conf_int(alpha=alpha))
    label = f"SARIMA(1,1,1)x(1,0,0,{period})" if seasonal else "ARIMA(1,1,1)"
    return np.asarray(pred.predicted_mean), interval[:, 0], interval[:, 1], label


_FITTERS = {"ets": _fit_predict_ets, "arima": _fit_predict_arima}


def _fit(method: str, y: np.ndarray, horizon: int, period: int, alpha: float):
    # statsmodels warns liberally (convergence, frequency inference); the
    # backtest MAPE is the honest signal of fit quality, so keep logs quiet.
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        return _FITTERS[method](y, horizon, period, alpha)


def mape(actual: np.ndarray, predicted: np.ndarray) -> float | None:
    """Mean absolute percentage error in percent, over points where actual != 0."""
    actual = np.asarray(actual, dtype=float)
    predicted = np.asarray(predicted, dtype=float)
    mask = actual != 0
    if not mask.any():
        return None
    return float(np.mean(np.abs((actual[mask] - predicted[mask]) / actual[mask])) * 100)


def holdout_size(n: int, horizon: int) -> int:
    """Holdout length: the forecast horizon, capped at a quarter of the series
    and leaving at least MIN_BACKTEST_TRAIN points to train on. 0 = no backtest."""
    size = min(horizon, n // 4, n - MIN_BACKTEST_TRAIN)
    return max(size, 0)


def backtest(values, method: str, horizon: int = 14, period: int = 7) -> tuple[float | None, int]:
    """Refit on all but the last `holdout` points and return (MAPE %, holdout)."""
    y = _as_series(values).to_numpy(dtype=float)
    holdout = holdout_size(len(y), horizon)
    if holdout < 1:
        return None, 0
    try:
        mean, _, _, _ = _fit(method, y[:-holdout], holdout, period, 0.05)
    except Exception:  # a failed fit just means no backtest score
        return None, holdout
    return mape(y[-holdout:], mean), holdout


def forecast(
    values,
    horizon: int = 14,
    method: Method = "auto",
    period: int = 7,
    alpha: float = 0.05,
) -> ForecastResult:
    """Forecast `horizon` steps ahead with a (1 - alpha) prediction interval."""
    if horizon < 1:
        raise ValueError("horizon must be >= 1")
    series = _as_series(values)
    y = series.to_numpy(dtype=float)

    if method == "auto":
        scores = {m: backtest(series, m, horizon, period) for m in ("ets", "arima")}
        candidates = [(s[0], m) for m, s in scores.items() if s[0] is not None]
        chosen = min(candidates)[1] if candidates else "ets"
        mape_value, holdout = scores[chosen]
        summary = ", ".join(
            f"{m} {s[0]:.2f}%" if s[0] is not None else f"{m} n/a" for m, s in scores.items()
        )
        selection = f"auto selected {chosen} by lower backtest MAPE ({summary}). "
    elif method in _FITTERS:
        chosen = method
        mape_value, holdout = backtest(series, method, horizon, period)
        selection = ""
    else:
        raise ValueError(f"unknown method {method!r}")

    mean, lower, upper, label = _fit(chosen, y, horizon, period, alpha)

    index = None
    if isinstance(series.index, pd.DatetimeIndex) and len(series.index) >= 2:
        step = series.index[-1] - series.index[-2]
        index = pd.DatetimeIndex([series.index[-1] + step * (i + 1) for i in range(horizon)])

    backtest_text = (
        f"backtest: refit on the first {len(y) - holdout} points, MAPE {mape_value:.2f}% over "
        f"the last {holdout} held-out points"
        if mape_value is not None
        else "backtest: not computable (series too short or all-zero holdout)"
    )
    description = (
        f"{selection}{label} fit by maximum likelihood on {len(y)} points (statsmodels); "
        f"{horizon}-step forecast with {int(round((1 - alpha) * 100))}% prediction interval; "
        f"{backtest_text}."
    )
    return ForecastResult(
        method_used=chosen,
        index=index,
        mean=np.asarray(mean, dtype=float),
        lower=np.asarray(lower, dtype=float),
        upper=np.asarray(upper, dtype=float),
        backtest_mape=mape_value,
        holdout_days=holdout,
        description=description,
    )
