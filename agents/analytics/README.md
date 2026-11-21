# Analytics Agent

Receives an investigation task, decides what analytics are required, calls
`services/analytics-engine` for the actual computation, and produces
structured, evidence-backed findings (KPI change, anomalies, forecast).

Python package: `helix_agent_analytics` (pip-installable, `pip install -e agents/analytics`).
Implements `BaseAgent` from `helix_contracts` (`packages/contracts-py`).
`services/agent-runtime` registers it at startup as agent type `ANALYTICS`.

**Status:** Phase 4, implemented. Rule-based (no LLM).

## How `execute(task)` works

1. **Plan** (`planner.py`, pure and deterministic, so an LLM can replace it later):
   parse the question for the metric (revenue/sales -> sum of the currency
   column, orders/volume -> row count, refunds -> count with a status filter
   `in ["refunded","refund","returned"]`, refund rate -> ratio KPI, average order
   value -> mean, customers -> distinct customer ids), pick the first data
   source + table with a datetime column and the columns the metric needs
   (ingestion `semanticType` first, then column type, then name heuristics),
   and decide whether to forecast (forecast/predict/next/expect/will ...).
2. **Call the engine** (`engine_client.py`): `POST /kpis` (windowDays 7),
   `POST /anomalies/detect` (method auto), and `POST /forecast` when the
   question looks ahead, with `dataset = { dataSourceId, organizationId, table }`.
3. **Wrap the output**: Metric/Anomaly records, Evidence (`METRIC` with
   `data.metricId`, `ANOMALY` with `data.anomalyId`, top 3 anomalies) and
   Findings (DESCRIPTIVE KPI change, DIAGNOSTIC per anomaly, PREDICTIVE
   forecast). Statements are templates over engine numbers; the agent never
   computes a statistic itself (ADR-005).

Confidence comes from the engine's statistics: anomalies `erf(|z|/sqrt(2))`
capped at 0.999, KPI change `1 - pValue` (0.5 if null), forecast
`max(0, 1 - mape)`.

`task.result = { evidence, findings, metrics, anomalies, toolCalls, analysisPlan, warnings, anomalyCount }`,
with list items already in `InvestigationRunResult` shape.

`execute()` never raises: an unreachable engine, a 4xx/5xx, or no usable
dataset returns the task as `FAILED` with a readable `error`. A failed
forecast only adds a warning.

## Inputs

`task.inputContext`: `{ question, organizationId, dataSources: [{ id, name, type, schemas: [{ tableName, columns: [{ name, type, nullable, semanticType? }], rowCountEstimate }] }] }`.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `ANALYTICS_ENGINE_URL` | `http://localhost:8002` | analytics-engine base URL (used when no client is injected) |

## Development

```bash
pnpm --filter @helix/agent-analytics test   # or: bash ../../scripts/python-run.sh test
```

`helix_agent_analytics.testing.FakeAnalyticsEngine` is an `httpx.MockTransport`
fake of the engine, reused by agent-runtime's tests.
