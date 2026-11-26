# Root Cause Analysis (`helix_root_cause`)

Ranks root-cause candidates from the findings and evidence that HELIX agents
produced for one investigation. This is Diagnostic Analytics: it combines
anomaly, segment, event-alignment and co-anomaly signals into one composed
statement with a score. It is called by the Coordinator's synthesis step and
never computes a new statistic from data (ADR-005); it only combines the
confidences agents derived and quotes numbers already present in evidence.

```python
from helix_root_cause import rank_root_causes

candidates = rank_root_causes(findings, evidence)          # list[RunFinding], list[RunEvidence]
candidates = rank_root_causes(findings, evidence, metric_key="revenue")
top = candidates[0]
top.statement, top.score, top.components
top.contributing_finding_ids, top.contributing_evidence_ids, top.anomaly_evidence_id
top.enriched     # False when only the bare anomaly contributed
top.formatted    # display strings for every number in the statement (+ "score")
```

## Candidates

One candidate per anchor: an `anomaly` evidence on the question's metric
(`metric_key`, default the metricKey of the first `anomaly` evidence, which is
the Analytics Agent's top-ranked one). Anchors keep their input order. Each is
enriched with evidence about the same day (evidence kinds: see the build spec,
section 3):

| Signal | Evidence | Component |
|---|---|---|
| where | `segment` / `segment_volume`, same date, topSlice set | s = max concentration |
| trigger | `event_alignment`, same date (keywordMatch preferred, then confidence) | e = its confidence |
| related | `co_anomaly`, or `anomaly` on another metric, within 1 day | c = max confidence |
| correlation | `correlation` linking the anchor metric to a co-anomaly metric, abs(coefficient) >= 0.5 | informational |
| ruled out | `segment_neutral`, same date | mentioned, not scored |

## Score

```
a = anomaly confidence * 0.7        (an anomaly alone caps at 0.7)
score = 1 - (1 - a) * (1 - 0.6 s) * (1 - 0.5 e) * (1 - 0.2 c)
```

Deterministic, in [0, 0.952], monotonic in each component, rounded to 4
decimals. Candidates are sorted by score (stable). The Coordinator calls a
root cause only at score >= 0.75 and only for an enriched candidate; a bare
anomaly falls back to the Phase 5 rule.

## Statement

Composed from the parts that exist: what/when (anomaly, with the segment
total's percent change), where (topSlice; "web orders collapsed" when the
order-volume slice confirms a drop of 50% or more), trigger (event), related
(co-anomalies), ruled out (segment_neutral). For the orders ground truth
(`helix_root_cause.testing.orders_ground_truth()`):

> Revenue dropped 40.0% on Thursday 2026-10-08 because web orders collapsed
> (channel = web explains 94.8% of the $13,174.00 shortfall), starting shortly
> after the web-checkout v2.14.0 deploy at 08:40 UTC (later rolled back);
> refunds also spiked on 2026-10-08 and 2026-10-09. Customer segment mix was
> ruled out as the driver.

Score 0.949.

## Development

```bash
pnpm --filter @helix/root-cause test   # or: bash ../../scripts/python-run.sh test
```
