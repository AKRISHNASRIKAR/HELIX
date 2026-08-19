# Phase 5: Coordinator Agent

**Status:** Not started
**Depends on:** [Phase 4](./phase-04-first-agent.md) — needs one working
agent to delegate to before delegation itself can be tested.

## Goal

Close the first complete vertical slice described in the project brief:

```
User Question → Coordinator → Analytics Agent → Result → Coordinator → Final Investigation
```

This is the phase where `Investigation` stops being a static record
(Phase 1) and becomes something that actually runs.

## What ships

- **`agents/coordinator`'s first real code** — a `BaseAgent` implementation
  whose `execute()` doesn't call an analytics tool directly; instead it:
  1. Reads the `Investigation.question`.
  2. Produces an `InvestigationPlan` (`packages/contracts`) — for this phase,
     a plan with exactly one step delegating to the Analytics Agent (multi-step
     plans arrive naturally once [Phase 7](./phase-07-multi-agent-a2a.md) adds
     more agents to plan across).
  3. Creates and dispatches an `AgentTask` for that step.
  4. Collects the result, and writes `Investigation.summary`,
     `overallConfidence`, and (if the finding qualifies) `rootCauseFindingId`.
- **Real investigation execution trigger** — `POST /investigations` (from
  Phase 1) now actually starts the Coordinator instead of just creating a
  `PENDING` row; `Investigation.status` moves through
  `PENDING → PLANNING → IN_PROGRESS → COMPLETED` (or `FAILED`/
  `PARTIALLY_COMPLETED`) for real.
- **`InvestigationStep` persistence** — the Coordinator's plan is written as
  real `InvestigationStep` rows, not just the `Investigation.plan` JSON blob
  — this is what Phase 10's replay will walk.
- **`InvestigationEvent` logging** — every meaningful transition (plan
  produced, task dispatched, task completed, investigation completed) writes
  an `InvestigationEvent` row. This phase is what actually populates the
  timeline table that's existed since Phase 0.
- **Investigation Page (v1)** — `apps/web` gets a real investigation detail
  view: question, status, the one agent task, its finding, confidence. Not
  the full timeline/evidence-graph UI (that's Phase 10) — just enough to see
  an investigation actually happened.
- **Retire the Phase 4 manual harness** — the ad-hoc "create an AgentTask by
  hand" endpoint from Phase 4 is removed or folded into the Coordinator's
  real dispatch path.

## What we're deliberately not doing yet

- **Still only one agent** — the Coordinator's plan always has one step. The
  planning logic that chooses *which* agents to involve only gets
  interesting once there's more than one to choose from
  ([Phase 7](./phase-07-multi-agent-a2a.md)).
- **No real A2A routing** — `services/a2a-gateway` stays a health-check stub;
  the Coordinator can call the Analytics Agent directly (or through
  `services/agent-runtime`'s HTTP surface) without needing message routing
  for a one-agent plan.
- **No context engine** — same manual/trivial context assembly as Phase 4.

## Where the work lands

| What | Where |
|---|---|
| Coordinator implementation | `agents/coordinator/` (first real code — currently a README) |
| Investigation execution trigger | `apps/api/src/investigations/` (extend — from Phase 1) |
| Plan/step/event persistence | `apps/api/src/investigations/` — schema already supports this (`InvestigationStep`, `InvestigationEvent` since Phase 0) |
| Investigation Page | `apps/web/app/investigations/[id]/` (new) |

## Definition of done

- Creating an investigation through `apps/web` with a real question about
  a connected data source results in a completed investigation with a
  correct root-cause finding, visible on the Investigation Page, with a
  populated `InvestigationEvent` timeline in the database (even if not yet
  rendered).
- A deliberately failing Analytics Agent task results in
  `Investigation.status = PARTIALLY_COMPLETED` (or `FAILED` if it's the only
  step), not a crash — the reliability rule proven at the agent level in
  Phase 4 now proven at the investigation level.

## What's next

[Phase 6: Context Engine](./phase-06-context-engine.md) — stop hand-assembling
each agent's input context.
