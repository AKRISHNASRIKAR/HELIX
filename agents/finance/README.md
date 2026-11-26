# Finance Agent

Explains revenue anomalies through refunds, payment/checkout failures and
revenue quality. Every number comes from `services/analytics-engine`
(ADR-005); the agent only selects, links and formats.

Python package: `helix_agent_finance` (`FinanceAgent`, agent type `FINANCE`).
Implements `BaseAgent` from `helix_contracts` through the `DomainAgent` base in
`helix_agent_analytics.domain`, and reuses that package's planner, engine
client and record builders. `services/agent-runtime` registers it.

**Status:** Phase 7, implemented. Rule-based (no LLM).

## How `execute(task)` works

Runs after the Analytics step (`dependsOn: [0]`). The day(s) to explain come
from `inputContext.focus.anomalyDates` (AssembledContext); when empty the
agent runs its own revenue anomaly detection and explains the top anomaly.
The orders-like table is picked with the Analytics planner heuristics.

1. **Refunds** (`refund_analysis`): `/anomalies/detect` on the daily refund
   count (status in refunded/refund/returned). Refund anomalies within one day
   of a focus date become `co_anomaly` evidence (with `relatedTo`) + DIAGNOSTIC
   findings; with no focus at all, the top 2 become `anomaly` evidence.
2. **Payment failure** (`payment_failure_analysis`): per focus date,
   `/segments/compare` on the order count -> `segment_volume` evidence. When the
   slice that explains the move fell 50% or more, a DIAGNOSTIC finding:
   "Web orders fell to 26 on Thursday 2026-10-08 against an expected 167.75
   (-84.5%), while other channels were within their normal range, which points
   to a checkout or payment failure in the web channel rather than lower demand."
   (other slices within +-20% count as normal). The engine's strict `topSlice`
   rule rarely holds for counts, so when it is null the most concentrated
   dimension's leading slice is used if that dimension's concentration is
   at least 0.5 (`data.topSliceSource = "best_dimension"`).
3. **Revenue quality** (`revenue_quality`): `/correlation` (Spearman, maxLag 3)
   between daily non-refunded revenue and daily refunds -> `correlation`
   evidence; a DESCRIPTIVE finding only when |coefficient| >= 0.5. A failed
   correlation call only adds a warning.

## Confidence

| Evidence | Formula |
|---|---|
| `co_anomaly` / `anomaly` | `erf(abs(z) / sqrt(2))`, capped at 0.999 |
| `segment_volume` | `concentration * min(1, abs(deltaPercent) / 100 + 0.5)`, clipped to [0, 1] |
| `correlation` | `1 - pValue` (0.5 when null) |

## Result

Same shape as the Analytics Agent: `{ evidence, findings, metrics, anomalies,
warnings, anomalyCount, toolCalls, analysisPlan, plan }` (`plan.reasoning`
explains focus source and skipped steps). Engine errors (unreachable, 4xx,
5xx) and unusable inputs return the task `FAILED` with a readable `error`;
`execute()` never raises.

`context_requirements`: semanticTypes datetime, currency, categorical;
tableKeywords order, payment, refund, transaction, invoice, charge.

## Development

```bash
pnpm --filter @helix/agent-finance test   # or: bash ../../scripts/python-run.sh test
```

Tests use `helix_agent_analytics.testing.FakeAnalyticsEngine`.
