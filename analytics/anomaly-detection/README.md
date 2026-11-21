# Anomaly Detection (`helix_anomaly`)

Statistical anomaly detection over a daily metric series. Pure functions, no
HTTP and no agent awareness; `services/analytics-engine` calls it from
`POST /anomalies/detect` and turns results into contract-shaped anomalies.

```python
from helix_anomaly import detect

result = detect(series, method="auto", threshold=3.0)  # pd.Series indexed by day
result.method_used        # "seasonal" | "zscore" | "iqr"
result.expected, result.scores  # per point
result.anomalies          # [AnomalyPoint(index, timestamp, value, expected, score, severity, direction, method)]
result.description        # exactly how it was computed (becomes computationMethod)
```

## Methods

Every method produces an expected value per point and a signed, robust
z-score of the residual (`value - expected`), scaled by `1.4826 * MAD` so the
anomalies being hunted cannot inflate the yardstick.

| Method | Expected value | Flagged when |
|---|---|---|
| `zscore` | series median | abs(score) >= threshold |
| `iqr` | series median (score uses sigma ~ IQR / 1.349) | outside Tukey fences `[Q1 - k*IQR, Q3 + k*IQR]`, `k = threshold / 2` (1.5 at the default) |
| `seasonal` | STL trend + seasonal (period 7, seasonal window 35, trend window 43, robust LOESS) | abs(robust z of STL residual) >= threshold |
| `auto` | `seasonal` when there are >= 28 points and seasonal strength >= 0.3, else `zscore` | |

Seasonal strength is `max(0, 1 - Var(resid) / Var(seasonal + resid))` (Wang,
Smith and Hyndman). The STL windows are wider than statsmodels' defaults on
purpose: with the defaults a robust fit bends around individual days,
shrinks the residual MAD and inflates every score.

Severity by abs(score): `>= 6` CRITICAL, `4..6` HIGH, `3..4` MEDIUM, `< 3` LOW
(LOW only occurs when the caller lowers the threshold below 3, or an IQR fence
fires before abs(score) reaches 3).

Inputs need at least 7 points, no missing values (`seasonal` needs 15).

## Development

```bash
pnpm --filter @helix/anomaly-detection test   # or: bash ../../scripts/python-run.sh test
.venv/bin/ruff check .
```

Not yet implemented: isolation forest / multivariate detection (later phases).
