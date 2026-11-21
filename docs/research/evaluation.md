# Evaluation Plan

Partially in place as of Phase 5. The first seeded scenario
(`tests/fixtures/orders.csv`, see `tests/fixtures/README.md`) exists, and
ground-truth tests in `services/analytics-engine/tests/test_ground_truth.py`
check that its injected anomalies are detected. The full end-to-end
evaluation run (accuracy, hallucination rate, latency/cost) is still Phase 10
work. This document records the intended approach so evaluation is designed
alongside the features it measures, not bolted on afterward.

## Planned dataset

A set of synthetic or anonymized business scenarios, each with:
- A seeded dataset (e.g. a revenue drop caused by a specific, known event —
  a deployment, a pricing change, a payment provider outage).
- The expected root cause and expected supporting evidence.
- The expected recommendation category (not necessarily exact wording).

Stored under `tests/fixtures/` as they're built. The first one is the
orders scenario: a revenue drop concentrated in the web channel on
2026-10-08 plus a refund spike on 2026-10-08/09, with ground truth in
`tests/fixtures/ground_truth.json`.

## Planned metrics (project brief, section 19)

| Metric | What it measures |
|---|---|
| Accuracy | Does the identified root cause match the seeded ground truth? |
| Hallucination rate | Does every claim in the final summary trace to a real `Evidence` row? |
| Context relevance | Did each agent receive context that was actually useful for its task? |
| Investigation completion rate | Does the investigation reach a `COMPLETED`/`PARTIALLY_COMPLETED` state rather than `FAILED`, including under partial agent failure? |
| Latency | Wall-clock time from question to completed investigation |
| Token usage / cost | Per investigation, broken down by agent |
| Recommendation quality | Human-rated usefulness of the final recommendation |

## Testing layers below full evaluation

Full investigation evaluation sits on top of narrower, faster tests that
exist earlier in the phase plan:
- **Analytics correctness** — unit tests in `services/analytics-engine`
  asserting computed values against hand-calculated expected results (Phase 3).
- **Agent contract tests** — does a `BaseAgent` implementation return a valid
  `AgentTask` shape, and does it degrade to `error` instead of raising on
  tool failure (Phase 4+)?
- **Reproducibility tests** — replaying a stored investigation's
  `AgentMessage`/`ContextSnapshot` trail should be able to reconstruct the
  same findings (Phase 10).

See `docs/research/methodology.md` for how these fit into the overall phase
plan.
