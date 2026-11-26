# Customer Agent

Explains anomalies through customer activity and segment mix. Every number
comes from `services/analytics-engine` (ADR-005).

Python package: `helix_agent_customer` (`CustomerAgent`, agent type
`CUSTOMER`). Implements `BaseAgent` through `helix_agent_analytics.domain.DomainAgent`
and reuses the Analytics package's planner, engine client and record builders.

**Status:** Phase 7, implemented. Rule-based (no LLM). Reviews, support
tickets and sentiment are not covered yet (no such data source exists).

## How `execute(task)` works

Runs after the Analytics step. The day(s) to explain come from
`inputContext.focus.anomalyDates`; when empty the agent detects anomalies on
the focus metric itself (first known `focus.metricKeys` entry, else revenue).

1. **Customer activity** (`customer_activity`): `/kpis` and
   `/anomalies/detect` on daily active customers (count_distinct of the
   customer id column) -> `kpi` evidence + DESCRIPTIVE finding, and
   active-customer anomalies within one day of a focus date as `co_anomaly`
   evidence + DIAGNOSTIC findings (top 2 `anomaly` when there is no focus).
2. **Segment mix** (`segment_mix`): per focus date, `/segments/compare` on the
   focus metric restricted to customer-attribute columns (name contains
   segment, tier, plan, cohort, region or country; never channel).
   - concentration < 0.5: `segment_neutral` evidence + DIAGNOSTIC finding, e.g.
     "Customer segments do not explain the revenue drop on 2026-10-08:
     enterprise, mid_market and smb all moved within 11.7 percentage points of
     the overall change (-38.8%)."
   - concentration >= 0.5 with an engine `topSlice`: a normal `segment`
     evidence + finding (same wording as the Analytics segment step).

## Confidence

| Evidence | Formula |
|---|---|
| `kpi` | `1 - pValue` (0.5 when null) |
| `co_anomaly` / `anomaly` | `erf(abs(z) / sqrt(2))`, capped at 0.999 |
| `segment_neutral` | `1 - concentration` |
| `segment` | `concentration * upstream anomaly confidence` for that date (concentration alone when none is in context) |

## Result

Same shape as the Analytics Agent (`evidence, findings, metrics, anomalies,
warnings, anomalyCount, toolCalls, analysisPlan, plan`). Engine errors return
the task `FAILED` with a readable `error`; `execute()` never raises.

`context_requirements`: semanticTypes datetime, identifier, categorical;
tableKeywords customer, user, order, account.

## Development

```bash
pnpm --filter @helix/agent-customer test   # or: bash ../../scripts/python-run.sh test
```
