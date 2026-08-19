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

Not implemented — only the service's health check exists (Phase 0). Phase 3
adds KPI calculation, statistical profiling, anomaly detection, trend
analysis, and basic forecasting, all returning structured results per the
diagram above. Library choices (pandas vs. polars, statsmodels vs. a learned
forecasting model, etc.) are made per algorithm as Phase 3 work starts, not
decided wholesale up front.
