# ADR-003: BaseAgent contract + AgentMessage envelope, not one giant agent

## Status
Accepted

## Context
The project brief is explicit: HELIX must not become
`Frontend → One API → One LLM → Answer`. Different domains (finance,
customer, product, operations) have different data, different failure modes,
and benefit from being reasoned about separately. But building seven agents
before any of them work end-to-end would be premature.

## Decision
- Define one contract, `BaseAgent` (`packages/contracts-py/helix_contracts/agent_base.py`, re-exported by `services/agent-runtime/app/agents/base.py`),
  that every agent implements: `capabilities` (published to the Agent
  Registry) and `execute(task: AgentTask) -> AgentTask`.
- Define one message envelope, `AgentMessage`, for all inter-agent
  communication, routed by `services/a2a-gateway` — agents never call each
  other's code directly.
- Build agents in this order: **Coordinator → Analytics → Finance → (Customer,
  Product, Operations, Visualization)**. Finance was picked as the third agent
  specifically because revenue/refund metrics are the most concrete and
  easiest to verify against ground truth, making it the best agent to
  validate the multi-agent evidence/finding pipeline against.
- A failed agent must return `AgentTask.error`, never raise past its own
  boundary — the Coordinator must be able to assemble a partial investigation
  (project brief, section 20).

## Consequences
- Adding a new agent means writing a class that satisfies `BaseAgent` and
  registering it with `agent-runtime` — no changes to the Coordinator, the
  gateway, or other agents.
- Because `AgentMessage` is transport-agnostic, `services/a2a-gateway` can
  swap Redis pub/sub for a formal A2A protocol later without touching any
  agent's code (see `docs/architecture/a2a.md`).
- As of Phase 0, only the interfaces exist — every `agents/*` directory is a
  README describing what it will own. This is intentional: implementing
  seven agents against contracts that haven't been proven by a single working
  investigation would risk building the wrong contract seven times over.

## Alternatives considered
- **One agent with a big system prompt and many tools** — rejected; makes
  context bloat, evidence attribution, and partial-failure handling much
  harder, and works against the explainability requirement (every finding
  needs a specific responsible agent).
- **LangGraph / CrewAI / AutoGen as the agent framework** — deferred, not
  rejected. The `BaseAgent`/`AgentMessage` abstraction is intentionally
  framework-agnostic so one of these (or a hand-rolled orchestrator) can sit
  *inside* `agent-runtime` or the Coordinator later without changing what
  external callers depend on.
