# Forecasting (`helix_forecasting`)

Baseline statistical forecasts for a daily metric series, with prediction
intervals and an honest holdout backtest. Pure functions; called by
`services/analytics-engine` from `POST /forecast`.

```python
from helix_forecasting import forecast

result = forecast(series, horizon=14, method="auto")  # pd.Series indexed by day
result.method_used                      # "ets" | "arima"
result.index, result.mean, result.lower, result.upper   # 95% interval by default
result.backtest_mape, result.holdout_days
result.description                      # becomes computationMethod
```

## Models

- **ETS**: statsmodels `ETSModel` (state-space exponential smoothing, which
  gives analytic prediction intervals): additive error, additive damped
  trend, additive weekly seasonality when there are >= 3 full weeks of data,
  otherwise ETS(A,Ad,N).
- **ARIMA**: ARIMA(1,1,1), plus a seasonal AR(1) at lag 7
  (SARIMA(1,1,1)x(1,0,0,7)) when there are >= 3 full weeks.

## Backtest and `auto`

The last `min(horizon, n // 4, n - 14)` points are held out, the model is
refit on the rest and MAPE (percent, over non-zero actuals) is measured on
the holdout. `auto` backtests both models and keeps the lower MAPE (ties go
to ETS). Series need at least 10 points; with fewer than 15 there is no
backtest (`backtest_mape = None`).

Not a learned model: see `docs/research/future-work.md` for what would
justify one.

## Development

```bash
pnpm --filter @helix/forecasting test   # or: bash ../../scripts/python-run.sh test
.venv/bin/ruff check .
```
