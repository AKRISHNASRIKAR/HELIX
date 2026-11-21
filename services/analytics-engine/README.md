# analytics-engine

Performs real, structured computation (descriptive statistics, KPIs, trends,
anomaly detection, forecasting) so agents never estimate numbers themselves.
Algorithms live in `analytics/anomaly-detection` (`helix_anomaly`) and
`analytics/forecasting` (`helix_forecasting`), installed editable via
`requirements.txt`.

Port 8002 (`pnpm --filter @helix/analytics-engine dev`).

## Datasets

Every endpoint takes `dataset`: inline `{ rows: [...] }`, or
`{ dataSourceId, organizationId, table }`, fetched from the ingestion
service's `POST /extract` (only the needed columns are requested).

Series endpoints share one daily-series builder (`app/series.py`):
`timeColumn`, `valueColumn?`, `aggregation` (`sum` | `mean` | `count` |
`count_distinct`, default `sum`), `filter?` (`{ column, op: eq|neq|in, value }`).
Timestamps are bucketed into UTC days across the whole dataset's range;
missing days are 0 for sum/count/count_distinct and null for mean.

## Endpoints

| Endpoint | Body | Response |
|---|---|---|
| `POST /kpis` | `{ dataset, timeColumn, kpis: [KpiSpec], windowDays?: 7, asOf? }` | `{ metrics: [MetricOut + { pValue, window }] }` |
| `POST /statistics` | `{ dataset, columns? }` | `{ rowCount, columns: [{ name, count, nullRate, mean, median, std, min, max, p05, p25, p75, p95 }], computationMethod }` |
| `POST /trends` | `{ dataset, ...series, rollingWindow?: 7, periodDays?: 7 }` | `{ series: [{ timestamp, value, rollingMean }], periodOverPeriod, slope, computationMethod }` |
| `POST /anomalies/detect` | `{ dataset, ...series, method?: auto, threshold?: 3, metricName? }` | `{ metric: MetricOut, methodUsed, anomalies: [...], computationMethod }` |
| `POST /forecast` | `{ dataset, ...series, horizon?: 14, method?: auto }` | `{ history, forecast: [{ timestamp, value, lower, upper }], methodUsed, backtest: { mape, holdoutDays }, computationMethod }` |

`MetricOut` is `{ name, unit, value, baseline, changePercent, series: [{ timestamp, value }], computationMethod, computedAt }`.
Every result carries a non-empty `computationMethod` describing exactly how
it was computed. Errors: 422 `{ detail }` for bad specs or unusable data,
502 `{ detail }` if the ingestion service is unreachable.

Details worth knowing:

- KPI windows are inclusive UTC days: current = the `windowDays` days ending
  at `asOf` (default: the last day in the data), previous = the `windowDays`
  before. `window.*` timestamps are the start of the first/last day of each
  window. `pValue` is a Welch t-test of the daily values in each window.
  KPI `series` covers both windows.
- `periodOverPeriod` sums daily values for `sum`/`count` and averages them for
  `mean`/`count_distinct`. `slope` is units per day (least squares).
- Optional `unit` on series requests is echoed on `metric.unit`.
- Forecast bounds and values are clamped at 0 for count aggregations.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `INGESTION_SERVICE_URL` (or `ANALYTICS_ENGINE_INGESTION_SERVICE_URL`) | `http://localhost:8004` | Where `/extract` is called |
| `ANALYTICS_ENGINE_INGESTION_TIMEOUT_SECONDS` | `60` | Timeout for `/extract` |
| `ANALYTICS_ENGINE_EXTRACT_LIMIT` | `200000` | Row cap requested from `/extract` |

## Tests

`pnpm --filter @helix/analytics-engine test`. `tests/test_ground_truth.py`
runs against the evaluation dataset in `tests/fixtures/` (see its README for
the scenario and tolerances).
