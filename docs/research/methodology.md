# Methodology

## Development approach

HELIX is built incrementally, in the ten phases defined in the project
brief (section 18) — architecture and foundations first, then core platform,
data ingestion, the analytics engine, a first single agent, a coordinator,
context engineering, multi-agent A2A, MCP integrations, autonomous
investigations, and finally explainability/replay tooling. Each phase
produces something runnable; no phase is "half of a feature."

Every non-trivial architectural choice is recorded as an ADR
(`docs/decisions/`) at the time it's made, capturing the alternatives
considered and why they were rejected — so later phases can revisit a
decision with the original reasoning in hand rather than reconstructing it
from code.

## Evaluation approach (planned — see `docs/research/evaluation.md`)

Correctness of the platform layer (auth, CRUD, permissions) is evaluated with
conventional unit/integration/API tests. Correctness of the analytics layer
is evaluated against known statistical ground truth (e.g. a synthetic dataset
with a known, injected anomaly). Correctness of agent/investigation behavior
is evaluated against a curated set of business scenarios with a known
expected root cause — see `docs/research/evaluation.md` for the planned
dataset shape and metrics (accuracy, hallucination rate, context relevance,
investigation completion rate, latency, cost).

## What "done" means for this foundation

For Phase 0 specifically, "done" means: every service boots and reports
healthy, the domain contracts exist in both TypeScript and Python and agree
with each other, the database schema is defined through reviewable
migrations, and the whole system can be started with one documented command.
It deliberately does not mean any investigation can yet be run — see the
root `README.md`'s "What has deliberately not been implemented yet."
