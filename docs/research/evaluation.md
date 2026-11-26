# Evaluation Plan

In place as of Phase 10. The seeded scenario (`tests/fixtures/orders.csv` plus
the deployments feed in `tests/fixtures/deployments.json`, see
`tests/fixtures/README.md`) has a known answer in
`tests/fixtures/ground_truth.json`: a web checkout deploy on 2026-10-08 broke
web orders, and refunds spiked on 2026-10-08 and 2026-10-09. Ground-truth unit
tests check the analytics, and `tests/evaluation/` runs the full end-to-end
evaluation against a live local stack. This document records the approach;
the latest numbers are in [evaluation-results.md](./evaluation-results.md).

## The harness (`tests/evaluation`)

`run_eval.py` signs up a throwaway user, uploads `orders.csv`, connects the
`services/mcp-demo` deployments feed, asks every question in
`scenarios.json`, then adds a revenue monitor and runs it twice. It scores:
- **Accuracy:** the root cause names the right day, the web channel and (with
  deployments connected) the `web-checkout` deploy; the expected agents
  succeeded; the autonomous run opens one investigation for 2026-10-08 and the
  second run is deduplicated.
- **Hallucination:** every number in a finding or summary must be traceable to
  computed evidence (`scoring.py`, unit tested with `python3 -m unittest`).
- **Latency:** creation to completion per investigation.

Latest run (2026-11-27, rules planner, no LLM): 24 of 24 checks passed,
0 of 216 stated numbers untraced, about 1.2 seconds per investigation.
LLM cost is not measured yet because the optional LLM path was not enabled.

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
- **Reproducibility tests** (not built yet): replaying a stored
  investigation's `AgentMessage`/`ContextSnapshot` trail should reconstruct
  the same findings. The trail is stored and shown in the Trace tab; an
  automated replay check is future work.

See `docs/research/methodology.md` for how these fit into the overall phase
plan.
