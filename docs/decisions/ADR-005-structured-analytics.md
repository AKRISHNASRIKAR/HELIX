# ADR-005: Analytics computation is never delegated to the LLM

## Status
Accepted

## Context
It is tempting to let an LLM agent "just compute" a percentage change or
forecast from data pasted into its context — it often produces a
plausible-looking number. But it is not a real computation, it cannot be
audited, and it will occasionally be wrong in ways that are hard to detect
because the output still reads fluently.

## Decision
Every numerical claim in a HELIX finding must originate from an actual
computation in `services/analytics-engine` (or the `analytics/*` libraries it
calls), using pandas/numpy/scipy/statsmodels/duckdb as appropriate — never
from an LLM estimating a value from context. The LLM's role is strictly
downstream: interpreting a structured `Metric`/`Anomaly` result into a
`Finding.statement`. See `docs/architecture/analytics-engine.md` for the
full pipeline diagram.

This is enforced structurally, not just by convention: `Metric` and `Finding`
(`packages/contracts`, `packages/contracts-py`) both carry a
`computationMethod` / evidence trail, so a finding with no traceable
computation behind it is a schema violation, not just a style violation.

## Consequences
- Agents call `services/analytics-engine` as a tool; they do not receive raw
  dataframes and reason freely over them for numerical claims.
- Every `Metric` includes `computationMethod` (human-readable description of
  how it was computed) so results are traceable, per the confidence/evidence
  requirements in the project brief (section 15).
- This adds a network hop (agent → analytics-engine) for numbers an LLM could
  technically approximate itself — accepted, because correctness and
  auditability matter more than latency for an investigation platform.

## Alternatives considered
- **Let agents compute via code execution (e.g. a Python sandbox per
  agent)** — deferred, not rejected. Could complement `analytics-engine` for
  one-off/ad-hoc computations later, but the core, repeatable analytics
  (KPIs, anomaly detection, forecasting) stay centralized so their methods
  are consistent and testable across every agent that needs them.
