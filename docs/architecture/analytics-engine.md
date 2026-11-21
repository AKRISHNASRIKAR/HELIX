# Analytics Engine

## The rule this exists to enforce

**The LLM never performs numerical analytics.** If a user asks "what was the
percentage increase in refunds?", the answer must come from an actual
computation over real data, not the LLM estimating a plausible-sounding
number.

```
User Question
     ↓
Agent
     ↓
Analytics Tool (services/analytics-engine, backed by analytics/*)
     ↓
Actual computation (pandas / numpy / scipy / statsmodels / duckdb)
     ↓
Structured result (Metric / Anomaly — packages/contracts, packages/contracts-py)
     ↓
LLM interpretation (turns the structured result into a Finding statement)
```

## Layers

- **`analytics/*`** — pure algorithm libraries: `anomaly-detection`,
  `forecasting`, `correlation`, `segmentation`, `root-cause`. No HTTP, no
  agent awareness — just functions over dataframes.
- **`services/analytics-engine`** — the FastAPI service that composes those
  libraries into endpoints agents call, and is responsible for turning
  results into `Metric`/`Anomaly` contract objects with a
  `computationMethod` string (so every number is traceable to *how* it was
  computed, per project brief section 15).

## The four analytics types

| Type | Question | Examples |
|---|---|---|
| Descriptive | What happened? | Revenue, growth, conversion, retention |
| Diagnostic | Why did it happen? | Correlation, root cause, dependency, segment comparison |
| Predictive | What's likely next? | Revenue forecast, churn prediction, demand forecast |
| Prescriptive | What should we do? | Recommended actions, risk mitigation, prioritization |

`AnalyticsType` (in `packages/types` and `packages/contracts-py`) tags every
`Finding` with which of these it answers.

## Status

Implemented in Phase 3. `services/analytics-engine` exposes `POST /kpis`
(with Welch t-test p-values), `/statistics`, `/trends`, `/anomalies/detect`
and `/forecast`. Datasets are passed inline or loaded through
`services/ingestion-service`'s `/extract`. Detection lives in
`analytics/anomaly-detection` (robust z-score, IQR, STL seasonal residuals)
and forecasting in `analytics/forecasting` (ETS and ARIMA baselines with a
holdout backtest). Every result carries a non-empty `computationMethod`.
Ground-truth tests run against `tests/fixtures/orders.csv`. Correlation,
segmentation and root-cause analytics remain Phase 10 work.
