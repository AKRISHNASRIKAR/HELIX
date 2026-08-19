# Phase 3: Analytics Engine

**Status:** Not started
**Depends on:** [Phase 2](./phase-02-data-ingestion.md) — needs real,
connected data to compute over; otherwise this is untestable.

## Goal

Give `services/analytics-engine` real endpoints that compute actual numbers
— the piece that makes ADR-005 (`docs/decisions/ADR-005-structured-analytics.md`)
true instead of aspirational. Everything here is pure computation with no
agent or LLM involved yet.

## What ships

- **KPI calculation** — revenue, growth rate, conversion, retention, order
  count, etc., computed with pandas/DuckDB directly against a `DataSource`
  (or a Postgres query through `services/ingestion-service`'s adapters).
  Every result returns a `Metric` (`packages/contracts-py`) with a populated
  `computationMethod` string.
- **Statistical profiling** — mean/median/stddev/percentiles per numeric
  column, building on Phase 2's basic profiling with real statistics
  (scipy/statsmodels).
- **Anomaly detection** — `analytics/anomaly-detection` gets its first real
  implementation: z-score / IQR for simple cases, seasonal decomposition for
  time series with clear periodicity. Results are `Anomaly` rows
  (`packages/contracts-py`), not just a flagged boolean — each carries
  `value`, `expectedValue`, `deviationScore`, `detectionMethod`.
- **Trend analysis** — rolling averages, period-over-period comparison
  (`changePercent` on `Metric`), the exact computation the project brief's
  "percentage increase in refunds" example needs.
- **Basic forecasting** — `analytics/forecasting` gets a statsmodels
  baseline (ETS or ARIMA) for simple univariate time series. Explicitly
  "basic" — no learned model yet (see `docs/research/future-work.md`).
- **`services/analytics-engine` HTTP surface** — endpoints like
  `POST /kpis`, `POST /anomalies/detect`, `POST /forecast`, each taking a
  `DataSource`/query reference and returning contract-shaped results. This
  is the surface [Phase 4](./phase-04-first-agent.md)'s Analytics Agent calls.

## What we're deliberately not doing yet

- **No correlation, segmentation, or root-cause analysis** — those are
  diagnostic analytics that only make sense once there's more than one
  agent's evidence to relate (`analytics/correlation`, `analytics/segmentation`,
  and `analytics/root-cause` stay READMEs until [Phase 10](./phase-10-explainability-replay.md)).
- **No agent calls this yet** — these are directly-testable HTTP endpoints
  first, consumed by an agent second. Building and testing the computation
  in isolation is deliberately separated from building the agent that calls
  it.
- **No learned/ML forecasting model** — statistical baselines only, per the
  project brief's instruction not to over-engineer early.

## Where the work lands

| What | Where |
|---|---|
| Algorithm implementations | `analytics/anomaly-detection/`, `analytics/forecasting/` (first real code — currently READMEs) |
| HTTP endpoints | `services/analytics-engine/app/main.py` (extend — currently only `/health`) |
| Contract results | `packages/contracts` / `packages/contracts-py` — `Metric` and `Anomaly` already modeled; extend only if a field is missing |
| Analytics UI (optional this phase) | `apps/web/app/analytics/` (new) — can slip to Phase 4+ if time-constrained; not required for the Analytics Agent to work |

## Definition of done

- Given a connected `DataSource`, `services/analytics-engine` returns a
  correct KPI value, a correctly-flagged anomaly on a dataset with a known
  injected anomaly, and a forecast within a documented error tolerance —
  each verified with the ground-truth-dataset approach described in
  `docs/research/evaluation.md`.
- Every returned `Metric`/`Anomaly` has a non-empty `computationMethod`.

## What's next

[Phase 4: First AI Agent](./phase-04-first-agent.md) — the Analytics Agent
calls these endpoints instead of guessing.
