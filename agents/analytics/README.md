# Analytics Agent

Receives an investigation task, decides what analytics are required, calls
`services/analytics-engine` for the actual computation, and produces
structured, evidence-backed findings (KPI change, anomalies, forecast).

Python package: `helix_agent_analytics` (pip-installable, `pip install -e agents/analytics`).
Implements `BaseAgent` from `helix_contracts` (`packages/contracts-py`).
`services/agent-runtime` registers it at startup as agent type `ANALYTICS`.

**Status:** Phase 4, implemented; segment step added in Phase 7. Rule-based (no LLM).

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
4. **Segment step** (Phase 7): when the top-ranked anomaly is HIGH or
   CRITICAL, `POST /segments/compare` for that day (same series spec,
   same-weekday baseline over 4 weeks, dimensions = categorical columns minus
   identifiers and status-like outcome columns). When the engine returns a
   `topSlice`, a `segment` evidence + DIAGNOSTIC finding is added, e.g.
   "The revenue drop on Thursday 2026-10-08 is concentrated in channel = web:
   web revenue was $2,991.88 against an expected $17,515.16 (-82.9%), 115.1%
   of the total shortfall (other channel values partly offset it)." A null
   topSlice adds nothing; a failed call only adds a warning.

Confidence comes from the engine's statistics: anomalies `erf(|z|/sqrt(2))`
capped at 0.999, KPI change `1 - pValue` (0.5 if null), forecast
`max(0, 1 - mape)`, segment `anomaly confidence * concentration`.

`task.result = { evidence, findings, metrics, anomalies, toolCalls, analysisPlan, plan, warnings, anomalyCount }`,
with list items already in `InvestigationRunResult` shape (`plan` is the same
dict as `analysisPlan`, including `reasoning`).

`execute()` never raises: an unreachable engine, a 4xx/5xx, or no usable
dataset returns the task as `FAILED` with a readable `error`. A failed
forecast or segment comparison only adds a warning.

`context_requirements`: semanticTypes datetime, currency, numeric,
categorical, identifier; `includeUpstream=False` (it is always step 0).

## Inputs

`task.inputContext` is an `AssembledContext` (Phase 6, see
`helix_contracts.context`) or its Phase 5 subset: `{ question, organizationId, dataSources: [{ id, name, type, schemas: [{ tableName, columns: [{ name, type, nullable, semanticType? }], rowCountEstimate }] }] }`.

## Shared toolkit for the domain agents

The Finance, Customer and Product agents import helpers from this package
instead of copying them (they never import `AnalyticsAgent` itself):

| Module | What it gives them |
|---|---|
| `engine_client.py` | `AnalyticsEngineClient` incl. `compare_segments`, `correlate`, `align_events` |
| `planner.py` | column heuristics, `plan_for_metric`, `pick_segment_dimensions`, `non_refund_filter` |
| `records.py` | `Outputs`, `Recorder` (kpi / anomaly / co_anomaly records), segment evidence helpers |
| `task_context.py` | defensive `AssembledContext` parsing (focus dates, upstream topSlices) |
| `domain.py` | `DomainAgent`: the never-raising `execute()` boundary and focus resolution |
| `formatting.py` | number/date formatting and `confidence_from_*` |
| `testing.py` | `FakeAnalyticsEngine` (all six endpoints), fixtures, `assert_numbers_backed` |

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `ANALYTICS_ENGINE_URL` | `http://localhost:8002` | analytics-engine base URL (used when no client is injected) |

## Development

```bash
pnpm --filter @helix/agent-analytics test   # or: bash ../../scripts/python-run.sh test
```

`helix_agent_analytics.testing.FakeAnalyticsEngine` is an `httpx.MockTransport`
fake of the engine, reused by agent-runtime's and the domain agents' tests.
The Phase 7 endpoints return numbers computed from `tests/fixtures/orders.csv`
and the deployments fixture. `assert_numbers_backed(result)` checks that every
number in every finding statement appears in its linked evidence data.
