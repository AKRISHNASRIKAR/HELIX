# Product Agent

Explains anomalies through engineering changes: lines up deployments,
releases and commits with the anomaly day. Timing comes from
`services/analytics-engine` `/events/align` (ADR-005).

Python package: `helix_agent_product` (`ProductAgent`, agent type `PRODUCT`).
Implements `BaseAgent` through `helix_agent_analytics.domain.DomainAgent`.

**Status:** Phase 7, implemented. Rule-based (no LLM).

## How `execute(task)` works

1. **Find an events table** in the context's data sources (MCP and GITHUB
   first): a table whose name contains deploy, release or commit and that has
   a datetime column. None -> the task SUCCEEDS with zero findings and
   `plan.reasoning` says why.
2. **Focus**: `inputContext.focus.anomalyDates`; when empty, its own anomaly
   detection on any non-event table in the context (none -> SUCCEEDED, zero
   findings).
3. **Align**: `/events/align` with the focus days as targets (24h before,
   24h after) and every non-time column as a label.
4. **Report**: per day, events before or on the day (later ones cannot be the
   cause and are only mentioned in reasoning), best 3 by confidence ->
   `event_alignment` evidence (`API_RESPONSE`) + DIAGNOSTIC finding, e.g.
   "Deployment web-checkout v2.14.0 to production at 08:40 UTC on Thursday
   2026-10-08 landed 8.7 hours into the revenue drop day (same day); it was
   later rolled back. Its labels mention checkout, payment and web, matching
   the affected metric or segment."

`keywordMatch` = label words that also appear in upstream segment `topSlice`
values (e.g. web) or in the focus metric's vocabulary (revenue: checkout,
payment, cart, billing, order, pricing ...). Status rolled_back / failed is
stated.

## Confidence

`proximity * relevance`, where proximity = 1.0 for a same-day event, else
`exp(-max(0, hoursBefore) / 24)`, and relevance = 1.0 when `keywordMatch` is
non-empty, else 0.4. `hoursBefore` = start of the anomaly day minus event time
(negative inside the day), as returned by the engine.

## Result

Same shape as the Analytics Agent (`evidence, findings, metrics, anomalies,
warnings, anomalyCount, toolCalls, analysisPlan, plan`). Engine errors return
the task `FAILED` with a readable `error`; `execute()` never raises.

`context_requirements`: dataSourceTypes MCP, GITHUB; tableKeywords deploy,
release, commit, change; semanticTypes datetime.

## Development

```bash
pnpm --filter @helix/agent-product test   # or: bash ../../scripts/python-run.sh test
```
