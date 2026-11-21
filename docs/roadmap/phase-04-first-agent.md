# Phase 4: First AI Agent (Analytics Agent)

**Status:** ✅ Complete
**Depends on:** [Phase 3](./phase-03-analytics-engine.md) — the agent has
nothing real to call without it.

## Goal

Build the first concrete `BaseAgent` implementation and prove the single-agent
path end to end: receive a task, decide what analytics are needed, call
`services/analytics-engine`, get real computed results back, produce a
structured `Finding`. No Coordinator, no delegation, no other agents yet —
this phase is deliberately narrow so the agent contract gets proven once,
correctly, before Phase 5 builds delegation on top of it.

## What ships

- **`agents/analytics`'s first real code** — a class implementing `BaseAgent`
  (`services/agent-runtime/app/agents/base.py`): declares its
  `capabilities` (KPI analysis, trend analysis, anomaly detection,
  forecasting — matching Phase 3's endpoints), and implements `execute()`.
- **Tool-calling, not free reasoning** — the agent's `execute()` uses an LLM
  only to (a) decide *which* `services/analytics-engine` endpoint(s) the
  task needs and with what parameters, and (b) turn the structured result
  into a `Finding.statement`. It never computes a number itself — this is
  where ADR-005 gets its first real enforcement point, not just a rule on
  paper.
- **Evidence + Finding persistence** — a successful run writes real
  `Evidence` (wrapping the raw `Metric`/`Anomaly`) and `Finding` rows via
  `apps/api`, with `confidence` derived from the computation (e.g. anomaly
  deviation score → confidence), not invented.
- **Manual task creation for testing** — since there's no Coordinator yet, a
  simple `apps/api` endpoint or script creates an `AgentTask` directly
  (`agentType = ANALYTICS`) and calls `services/agent-runtime` to execute it
  — a deliberately manual harness, replaced by real delegation in Phase 5.
- **Failure handling** — if `services/analytics-engine` is unreachable or
  returns an error, `execute()` returns `AgentTask.error` set, never raises —
  first real exercise of the reliability rule this was designed for
  (project brief, section 20).
- **Agent registration** — `services/agent-runtime` starts registering
  concrete agents into `AGENT_REGISTRY` (currently always empty) and exposes
  them via the health check's `registeredAgents` count and a new
  `GET /agents` listing capabilities.

## What we're deliberately not doing yet

- **No Coordinator** — nothing plans or delegates; a task is handed to the
  Analytics Agent directly for testing. [Phase 5](./phase-05-coordinator-agent.md)
  replaces this harness with real delegation.
- **No context engine** — the task's `inputContext` is assembled by hand
  (or by a trivial "just pass the DataSource id" helper) rather than through
  `services/context-engine`, which stays a health-check-only stub until
  [Phase 6](./phase-06-context-engine.md).
- **No other agents** — Finance/Customer/Product/Operations stay READMEs.

## Where the work lands

| What | Where |
|---|---|
| Agent implementation | `agents/analytics/` (first real code — currently a README) |
| BaseAgent registration | `services/agent-runtime/app/main.py`, `app/agents/` (extend) |
| Evidence/Finding writes | `apps/api/src/evidence/`, `apps/api/src/findings/` (new) |
| Manual test harness | `apps/api/src/agent-tasks/` (new, temporary — expect most of it to be superseded in Phase 5) |

## Definition of done

- Given a `DataSource` with a known, seeded anomaly (from the Phase 3
  evaluation dataset), manually triggering an Analytics Agent task produces
  a `Finding` whose `statement` correctly describes the anomaly, backed by
  `Evidence` that traces to the real `Metric`/`Anomaly` computation.
- A deliberately-broken `services/analytics-engine` connection produces a
  task with `error` set and a readable message — not a crash.

## What's next

[Phase 5: Coordinator Agent](./phase-05-coordinator-agent.md) — stop
manually creating tasks; let a Coordinator plan and delegate them.

## Implementation notes

- No LLM yet. Tool selection is rule-based and lives in
  `agents/analytics/helix_agent_analytics/planner.py`, so an LLM-backed
  planner can replace it without touching the agent or wire contracts (see
  [ADR-007](../decisions/ADR-007-investigation-execution.md)).
- The manual harness is agent-runtime's `POST /agents/{type}/execute`. No
  temporary endpoint was added to `apps/api`.
- `BaseAgent` moved to `packages/contracts-py/helix_contracts/agent_base.py`
  so agent packages can implement it standalone. The old import path still
  works.
