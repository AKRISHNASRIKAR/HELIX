# Phase 7: Multiple Agents + A2A

**Status:** ✅ Complete
**Depends on:** [Phase 6](./phase-06-context-engine.md) — new agents should
get properly-scoped context from day one, not the manual approach Phases 4–5
used temporarily.

## Goal

Prove the architecture actually scales past one agent: add the first domain
agent, wire up real agent-to-agent message routing, and let the Coordinator
produce genuinely multi-step plans.

## What ships

- **`agents/finance`'s first real code** — the third agent (after
  Coordinator, Analytics), chosen specifically because revenue/refund
  metrics are the most concrete and verifiable evidence to validate the
  multi-agent pipeline against (see
  `docs/decisions/ADR-003-agent-architecture.md`). Implements `BaseAgent`
  with capabilities like "refund analysis," "payment failure analysis."
- **Real `services/a2a-gateway` routing** — this phase is what finally gives
  the gateway something to route. `AgentMessage`s (`TASK_REQUEST`,
  `TASK_RESULT`) flow Coordinator → Finance Agent → Coordinator over Redis
  pub/sub, replacing Phase 5's direct-call shortcut.
- **Multi-step `InvestigationPlan`s** — the Coordinator's planning logic now
  genuinely chooses which agents a question needs (e.g. "why did revenue
  drop" → Analytics *and* Finance) and can express step dependencies via
  `InvestigationPlanStep.dependsOn`.
- **Partial-failure handling, for real this time** — with two agents in a
  plan, Phase 0/4/5's "one failed agent shouldn't destroy the investigation"
  rule gets its first real test: Finance Agent fails, Analytics Agent
  succeeds, investigation still completes as `PARTIALLY_COMPLETED` with a
  clear note about what's missing.
- **`agents/customer` and `agents/product`** — added after Finance proves
  the pattern, following the same `BaseAgent` + context-engine + a2a-gateway
  path. Order follows `docs/architecture/agent-architecture.md`'s rollout
  list.
- **Agent Registry UI** — `apps/web` gets a real Agent Registry page
  (available agents, capabilities, status, recent tasks) — this only
  becomes interesting once there's more than one agent to show.

## What we're deliberately not doing yet

- **No formal external A2A protocol** — `services/a2a-gateway` uses Redis
  pub/sub internally; adopting a standard transport is deferred until
  there's an actual need to interoperate with agents outside this system
  (see `docs/architecture/a2a.md`).
- **`agents/operations` and `agents/visualization`** — lowest priority per
  `docs/architecture/agent-architecture.md`; added after Finance/Customer/
  Product prove the pattern, not necessarily within this same phase if time
  is constrained.

## Where the work lands

| What | Where |
|---|---|
| Finance (then Customer, Product) agents | `agents/finance/`, `agents/customer/`, `agents/product/` (first real code — currently READMEs) |
| A2A routing | `services/a2a-gateway/app/` (extend — currently only `/health`) |
| Multi-step planning | `agents/coordinator/` (extend — from Phase 5) |
| Agent Registry UI | `apps/web/app/agents/` (new) |

## Definition of done

- A question that genuinely needs two agents' evidence (e.g. "why did
  revenue drop" needing both an Analytics anomaly and a Finance refund
  spike) produces a plan with both steps, both `AgentMessage` exchanges
  visible in `services/a2a-gateway`'s logs, and a root cause that correctly
  cites both agents' findings.
- Killing the Finance Agent mid-investigation still yields a completed (if
  partial) investigation, not a stuck or crashed one.

## What's next

[Phase 8: MCP Integrations](./phase-08-mcp.md) — give agents more (and more
varied) data sources to reach through, now that the multi-agent flow is
proven.

## Implementation notes

- Finance (`agents/finance`), Customer (`agents/customer`) and Product
  (`agents/product`) shipped together. All are rule-based, reuse the
  Analytics Agent's engine client and planner helpers, and get every number
  from the analytics engine (ADR-005). Operations and Visualization remain
  READMEs.
- The Coordinator's rules planner picks agents from the question or trigger.
  For "Why did revenue drop last week?" the plan is ANALYTICS as step 0;
  FINANCE, CUSTOMER and PRODUCT depending on it and running concurrently;
  and a final COORDINATOR synthesis step depending on all of them. Steps run
  in waves with `asyncio.gather`.
- `services/a2a-gateway` (port 8005) routes TASK_REQUEST messages over Redis
  pub/sub (`helix:a2a:agent:{TYPE}`, replies on
  `helix:a2a:reply:{correlationId}`). agent-runtime runs a worker that
  subscribes for every registered domain agent. Dispatch falls back to
  in-process when the gateway or Redis is unavailable
  (`HELIX_A2A_MODE=inprocess` skips the gateway entirely).
- The Coordinator records a TASK_REQUEST and a TASK_RESULT (or ERROR)
  message per task, with the transport used, and the API persists them as
  `AgentMessage` rows. Gateway logs are not the record; the database is.
- Agent Registry UI is `apps/web/app/(app)/agents/`.
- Known limit: pub/sub fans out, so two runtime replicas hosting the same
  agent type would both run a task (first reply wins). See
  [ADR-008](../decisions/ADR-008-context-engine-and-a2a.md).
