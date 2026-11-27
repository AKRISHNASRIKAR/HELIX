# ADR-010: Multi-agent root-cause synthesis and the optional LLM (Phases 7 and 10)

## Status
Accepted

## Context
With four domain agents, an investigation produces anomalies (what and when),
segment breakdowns (where), deploy alignments (what changed) and related
anomalies (what else moved). Phase 5 simply picked the highest-confidence
diagnostic finding as the root cause, which can name the day but never the
reason. Separately, the user asked for an LLM to be optional: useful when a key
is configured, never required.

## Decision
**Root causes are ranked by `analytics/root-cause` (`helix_root_cause`).**
`rank_root_causes(findings, evidence)` builds one candidate per anchor anomaly
on the investigated metric and enriches it with evidence for the same day:
- `s`: segment concentration (`segment` evidence on the same metric, or the
  order-volume breakdown for revenue, orders, AOV and customer anomalies);
- `e`: the best aligned deploy (`event_alignment`), preferring keyword matches
  and never choosing a revert or hotfix as the trigger;
- `c`: the strongest related anomaly on another metric within one day;
- `segment_neutral` evidence is mentioned as ruled out.

```
score = 1 - (1 - 0.7a)(1 - 0.6s)(1 - 0.5e)(1 - 0.2c)
```
where `a` is the anchor anomaly's confidence (capped at 0.7 alone, so a bare
anomaly never looks like an explanation). The score is deterministic, in
[0, 1] and monotonic in every component. A candidate becomes the root cause at
score >= 0.75; the Coordinator records it as a COORDINATOR finding linked to
all contributing evidence plus a `root_cause_ranking` evidence row from a real
synthesis task. When nothing enriches the anomaly, the Phase 5 rule applies.

**Culprit and fix plan.** When the selected candidate's trigger is a deploy
that is not a revert, the `root_cause_ranking` evidence also carries a
`culprit` and a `fixPlan`, and the root cause statement ends with "shipped by
<author>". The Product Agent supplies the facts: each `event_alignment` has a
`change` (author, service, version, status, commit, copied from the feed's
labels) and a `history` from one extra `/events/align` call filtered to the
same services (`previous` = the last earlier deploy that did not fail and was
not rolled back, `rollback` = the next deploy when it reads as a revert or the
change is marked rolled back). The Coordinator turns these into 3 to 5 ordered
steps by rules (`helix_agent_coordinator/fix_plan.py`): `rolled_back`,
`needs_rollback` or `failed`, plus `recovered`, which is true only when the run
has no further anomaly on the investigated metric after the rollback day,
up to the end of the metric's KPI window. The LLM is not involved, and every
name, version, time and commit in the plan comes from the feed or from
evidence. The event recommendation names the author and the first steps, and
the "investigation completed" notification adds "Caused by <author>". Because
the Analytics Agent records only its top anomalies, `recovered` can miss a
small later drop; it is a check on the evidence the run has, not a new test.

**The LLM is optional and narrow.** `packages/llm-py` (`helix_llm`) wraps
Claude (default model `claude-opus-5-5`, structured JSON outputs, server-side
refusal fallbacks). It is used only when `ANTHROPIC_API_KEY` is set and
`HELIX_LLM` is not `off`, and only for:
- planning which agents to involve (validated: Analytics first, dependencies
  must point backwards, agent types must be registered);
- writing the summary, rejected if it states any number that is not in the
  findings or evidence.
Any LLM error or rejected output falls back to the rules, and `meta` on the run
records which path ran. Every number still comes from the analytics engine
(ADR-005); the LLM never computes or ranks.

## Consequences
- The answer names what, when, where and what changed, with every number
  traceable. The evaluation harness checks this on every run (0 untraced
  numbers in the latest run, docs/research/evaluation-results.md).
- The ranking weights are hand-set. They should be re-tuned once there are
  real investigations with known causes.
- The LLM path is covered by tests with a fake client but has not been run
  against the live API in this repository.

## Alternatives considered
- **Let an LLM pick the root cause.** Rejected: it would be the one unchecked
  number-like judgement in the pipeline, and it would make results depend on a
  key and a network call.
- **Learned ranking.** Deferred until there is labelled investigation history.
