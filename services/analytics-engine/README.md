# analytics-engine

Performs real, structured computation (descriptive statistics, KPIs, trends,
anomaly detection, forecasting, segment comparison, correlation, event
alignment) so agents never estimate numbers themselves. Algorithms live in
`analytics/anomaly-detection` (`helix_anomaly`), `analytics/forecasting`
(`helix_forecasting`), `analytics/segmentation` (`helix_segmentation`) and
`analytics/correlation` (`helix_correlation`), installed editable via
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
| `POST /segments/compare` | `{ dataset, ...series, targetDate, dimensions?, baseline?: same_weekday, baselinePeriods?: 4, unit?, metricName? }` | `{ targetDate, metricName, unit, aggregation, total, dimensions: [{ column, concentration, slices }], topSlice, computationMethod }` |
| `POST /correlation` | `{ a: series + name?, b: series + name?, method?: spearman, maxLag?: 3 }` | `{ coefficient, method, lag, pValue, n, a: { name }, b: { name }, computationMethod }` |
| `POST /events/align` | `{ events: { dataset, timeColumn, labelColumns?, filter? }, targets: [{ date, label? }], windowHoursBefore?: 24, windowHoursAfter?: 24 }` | `{ matches: [{ target, events: [{ time, labels, hoursBefore, sameDay }] }], computationMethod }` |

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

### Diagnostics

- `/segments/compare`: per slice, `expected` = mean of the slice's daily
  aggregate over the baseline days (`same_weekday`: the previous N same
  weekdays; `trailing_mean`: the previous N*7 days), `delta = actual -
  expected`, `shareOfDelta = delta / total.delta`. A dimension's
  `concentration` is the largest share among slices moving with the total
  (clipped to [0, 1]). `topSlice` is the best slice of the most concentrated
  dimension when concentration >= 0.5 and its |deltaPercent| is >= 1.5x the
  total's, else null. Default `dimensions`: text columns with 2..20 distinct
  values, excluding `timeColumn`, `valueColumn` and the filter column (with
  `dataSourceId` datasets the whole table is extracted to find them). See
  `analytics/segmentation/README.md`.
- `/correlation`: both series are built as daily series, aligned on day, and
  correlated at lags 0..`maxLag` (max 14; lag k = b shifted forward k days, so
  b leads a). The lag with the largest |coefficient| is returned. 422 with
  fewer than 10 overlapping days.
- `/events/align`: an event matches target day D when its time is in
  `[D 00:00 - windowHoursBefore, D 00:00 + 24h + windowHoursAfter)`.
  `hoursBefore = (D 00:00 - time)` in hours (negative = during or after the
  start of D), `sameDay` = event date is D, sorted by |hoursBefore|.
  `labels` default to every column except `timeColumn`.

Example (ground truth, `tests/fixtures/orders.csv`):

```bash
curl -X POST {{base_url}}/segments/compare -H 'Content-Type: application/json' -d '{
  "dataset": { "dataSourceId": "...", "organizationId": "...", "table": "orders" },
  "timeColumn": "created_at", "valueColumn": "amount", "aggregation": "sum",
  "targetDate": "2026-10-08", "metricName": "revenue", "unit": "USD" }'
# total: actual 19944.04, expected 32565.75 (-38.8%)
# topSlice: channel = web, actual 2991.88, expected 17515.16 (-82.9%), shareOfDelta 1.15
```

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
