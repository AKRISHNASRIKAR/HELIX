# Agent Architecture

## Principle

HELIX does not have one giant agent. Every agent is an independent actor with
a defined identity, capabilities, input/output contract, tools, and context
requirements — never a direct dependency on another agent's internals.

## The `BaseAgent` contract

Defined in `services/agent-runtime/app/agents/base.py`:

```python
class BaseAgent(ABC):
    agent_type: AgentType

    @property
    @abstractmethod
    def capabilities(self) -> list[AgentCapability]: ...

    @abstractmethod
    async def execute(self, task: AgentTask) -> AgentTask: ...
```

Every concrete agent under `agents/*` implements this. `execute()` takes a
task with pre-assembled context (from `services/context-engine`) and returns
the task with `result` populated or `error` set — an agent must never raise
past this boundary, so one failed agent doesn't destroy the whole
investigation (project brief, section 20).

## Agent rollout order

1. **Coordinator** (`agents/coordinator`) — understands the question, builds
   an `InvestigationPlan`, delegates, collects results, detects missing
   evidence, assembles the final investigation. Phase 5.
2. **Analytics** (`agents/analytics`) — the first agent built (Phase 4).
   Turns a question into calls against `services/analytics-engine` and
   returns structured `Finding`s.
3. **Finance** (`agents/finance`) — the first domain agent, added in Phase 7
   because revenue/refunds are the most concrete, verifiable metrics to
   investigate.
4. **Customer, Product, Operations, Visualization** — added after, in that
   rough order, as `docs/decisions/ADR-003-agent-architecture.md` explains.

Only READMEs exist for unimplemented agents today — see each `agents/*/README.md`
for what it will own and when.

## A2A (agent-to-agent communication)

Agents never call each other directly. All coordination goes through:

- **`AgentMessage`** — a transport-agnostic envelope (`packages/contracts`,
  `packages/contracts-py`) carrying `type`, `fromAgent`, `toAgent`,
  `investigationId`, `payload`, and a `correlationId`.
- **`services/a2a-gateway`** — routes these envelopes (Redis pub/sub today).

Because the envelope shape is decoupled from the transport, a formal A2A
protocol can replace the gateway's internals later without changing what
agents send or receive. See `docs/architecture/a2a.md`.

## Investigation Replay

Every `AgentTask`, `AgentMessage`, `ContextSnapshot`, and `InvestigationEvent`
is persisted, so an investigation's full reasoning chain — question → trigger
→ per-agent findings → root cause → recommendation — can be reconstructed and
displayed later. This is what makes HELIX's conclusions auditable rather than
a black box (project brief, sections 14–15). No replay UI exists yet
(Phase 10); only the schema that will support it exists today.
