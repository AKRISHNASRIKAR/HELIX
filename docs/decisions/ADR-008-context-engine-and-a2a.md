# ADR-008: Context assembly and agent-to-agent routing (Phases 6 and 7)

## Status
Accepted

## Context
Phase 5 had one domain agent, a hand-assembled `inputContext` and an
in-process call from the Coordinator to the Analytics Agent (ADR-007).
Phases 6 and 7 add three more agents (Finance, Customer, Product) that run
after Analytics, so two questions needed an answer:

1. Who decides what each agent sees, and how do we prove afterwards what it saw?
2. How do tasks travel between agents once there is more than one?

## Decision
**A context engine assembles every task's input.** Each agent declares
`context_requirements` (semantic types, table keywords, data source types,
history window, token budget) on its `BaseAgent` class. Before dispatching a
task the Coordinator calls `services/context-engine` `POST /context/assemble`,
which:
- keeps only the data sources and tables the agent can use;
- derives the focus (anomaly days, metric, direction) from the trigger and the
  findings of the steps the task depends on, keeping only days that move the
  way the question asks and that are HIGH or CRITICAL severity;
- pulls recent metrics, anomalies and findings for the organization from an
  internal API endpoint (`GET /api/v1/internal/organizations/:id/context`);
- trims to the token budget and records every filtering choice as a decision.

The result (an `AssembledContext`, a superset of the Phase 5 shape) becomes the
task's `inputContext` and is returned in the run result as a
`RunContextSnapshot`, which the API stores as a `ContextSnapshot` row in the
same transaction as everything else (ADR-007's single persistence boundary is
unchanged). If the context engine is unreachable, the Coordinator assembles a
local fallback context (`source: "fallback"`) and the run continues.

**Tasks travel over an A2A gateway.** `services/a2a-gateway` exposes
`POST /messages/request`: it subscribes to `helix:a2a:reply:<correlationId>`,
publishes the TASK_REQUEST on `helix:a2a:agent:<TYPE>` (Redis pub/sub) and
waits for the TASK_RESULT or ERROR. A worker inside `services/agent-runtime`
subscribes to the channel of every registered domain agent, runs the task and
publishes the reply. `HELIX_A2A_MODE=gateway` uses this path; when the gateway
or Redis is unavailable, dispatch falls back to an in-process call and marks
the task's transport accordingly. `inprocess` skips the gateway entirely.

The Coordinator records the messages itself (TASK_REQUEST before dispatch,
TASK_RESULT or ERROR after, correlation id = task id, transport in the
payload) and returns them as `RunMessage`s, stored as `AgentMessage` rows.

Steps whose dependencies are satisfied run concurrently, in waves.

## Consequences
- Every finding can be traced to the exact context its agent received, which
  the Trace tab (Phase 10) shows, decisions included.
- Agents stay stateless and never call each other; only the Coordinator plans
  and dispatches.
- Redis pub/sub fans out: two agent-runtime replicas hosting the same agent
  type would both run a task. Fine for one local runtime; a consumer group
  (Redis Streams) is the upgrade before running replicas.
- A 504 or read timeout from the gateway becomes TIMED_OUT and is never re-run
  in process, so a slow task cannot run twice.
- No vector database or cross-investigation learning: relevance is filtering
  and ranking over structured data, as the Phase 6 roadmap intended.

## Alternatives considered
- **Agents fetch their own context.** Rejected: it spreads data access and
  makes "what did the agent see" unanswerable.
- **The API routes tasks between agents.** Rejected for the same reason as in
  ADR-007: it would turn the Coordinator into a library and move planning into
  TypeScript.
- **A standard external A2A protocol now.** Deferred until HELIX has to talk to
  agents outside this system (docs/architecture/a2a.md).
