# ADR-007: How an investigation executes (Phases 4 and 5)

## Status
Accepted

## Context
Phase 5 makes `POST /investigations` actually run something:
Coordinator, then Analytics Agent, then findings, then the final
investigation. Three questions needed an answer:

1. Where does orchestration live: `apps/api` (TypeScript) or
   `services/agent-runtime` (Python)?
2. Who writes the reasoning trail (steps, tasks, evidence, findings) to
   Postgres?
3. How do agents "reason" before an LLM is wired in?

## Decision
**The Coordinator orchestrates and the API persists.** `apps/api` creates the
`Investigation` row and then calls `services/agent-runtime`'s
`POST /investigations/run` in the background. In agent-runtime the
`CoordinatorAgent` plans, creates the `AgentTask`, and dispatches it to the
Analytics Agent in-process through the agent registry. Phase 5 explicitly
allows this direct call. Real message routing arrives with
`services/a2a-gateway` in Phase 7. The Coordinator then synthesizes the
summary, root cause and recommendations, and returns the whole trail as one
structured `InvestigationRunResult`.

`apps/api` persists that result in a single Prisma transaction. All ids are
generated in Python, so the rows the API writes match the ids that live
progress events already referenced. Agents stay stateless, and Postgres
access stays in one place (ADR-002).

**Live status comes from progress callbacks.** While it runs, the
Coordinator posts status changes and timeline events (`PLANNING`,
`plan.produced`, `IN_PROGRESS`, `task.dispatched`, `task.completed` /
`task.failed`, `investigation.synthesized`) to the internal endpoint
`POST /api/v1/internal/investigations/:id/progress`. This is best effort: if
the API is unreachable, the run continues and the final result is still
persisted. The API owns the terminal status and the `investigation.created`,
`.completed`, `.failed` and `.cancelled` events.

**Reasoning is deterministic for now.** Tool selection (which metric, which
table, whether to forecast), planning (one ANALYTICS step), root cause
selection and recommendation wording are rule-based. Each lives in its own
module (`planner.py`, `synthesis.py`), so an LLM-backed implementation can
replace it without changing the agent or wire contracts. Under ADR-005 the
LLM would only ever replace those modules. Every number still comes from
`services/analytics-engine`.

**Confidence is derived, not invented.**
- Anomaly evidence: `erf(|z| / sqrt(2))` of the detector's robust z-score.
- KPI change: `1 - p` from a Welch t-test of daily values.
- Forecasts: `1 - backtest MAPE`.

## Consequences
- An investigation is a single long HTTP call (120s timeout) from the API to
  agent-runtime. If the API process dies mid-run, the investigation is left
  in a non-terminal status. A durable queue (Redis/BullMQ) is the upgrade
  path, and it becomes necessary once Phase 9 adds autonomous triggers.
- Phase 4's "manual harness" is agent-runtime's
  `POST /agents/{type}/execute`. No temporary task-creation endpoint was
  added to `apps/api`, so there was nothing to retire in Phase 5.
- Context is still hand-assembled (question, organization, connected data
  sources and their schemas). `ContextSnapshot` rows are not written until
  Phase 6 replaces this with `services/context-engine`.

## Alternatives considered
- **Orchestrate in `apps/api` and call each agent separately.** This is
  simpler to make durable, but it moves planning and dispatch out of the
  Coordinator agent, so the Coordinator becomes a pair of pure functions and
  Phase 7's A2A routing would have to be rebuilt from the API side.
- **Have agents write to Postgres directly.** Rejected because it spreads
  Prisma-owned schema knowledge into Python and weakens the single
  persistence boundary.
