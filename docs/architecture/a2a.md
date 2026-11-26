# A2A (Agent-to-Agent Communication)

## A2A vs. MCP — do not confuse them

```
A2A:  Agent ↔ Agent      (services/a2a-gateway, AgentMessage)
MCP:  Agent ↔ Tool/Data  (services/ingestion-service, DataSourceAdapter)
```

A2A is about **coordination between independent agents** — the Coordinator
delegating to the Analytics Agent, agents reporting results back. MCP (and
`DataSourceAdapter` today) is about **an agent reaching a tool or data
source** — a database, a file, a REST API. These are different concerns with
different lifecycles; conflating them would couple agent coordination logic
to whatever integration protocol happens to be fashionable.

## The internal abstraction

HELIX does not couple its codebase to one A2A implementation up front.
Instead:

- **`AgentMessage`** (`packages/contracts/src/agent-message.ts`,
  `packages/contracts-py/helix_contracts/models.py`) is the envelope every
  inter-agent communication uses: `type`, `fromAgent`, `toAgent`,
  `investigationId`, `agentTaskId`, `payload`, `correlationId`.
- **`AgentTask`**, **`AgentCapability`**, **`AgentStatus`** — the
  surrounding vocabulary (what work looks like, what an agent can do, what
  state it's in).
- **`services/a2a-gateway`** — the transport. Today: Redis pub/sub, planned
  for Phase 7 once there are ≥2 agents to route between.

Because callers only ever construct and read `AgentMessage`s — never touch
the gateway's internals — a formal A2A protocol (e.g. an emerging standard
transport/handshake) can be adopted later by changing what's inside
`services/a2a-gateway`, without changing any agent's code.

## Example flow

```
Coordinator
      ↓ TASK_REQUEST (AgentMessage)
Analytics Agent
      ↓ TASK_RESULT (AgentMessage)
Coordinator
      ↓ TASK_REQUEST (AgentMessage)
Customer Agent
      ↓ TASK_RESULT (AgentMessage)
Coordinator
      ↓ (assembles final investigation)
```

## Status

Implemented in Phase 7 (see ADR-008). `services/a2a-gateway` routes
TASK_REQUEST messages over Redis pub/sub (`helix:a2a:agent:<TYPE>`) and waits
for the TASK_RESULT or ERROR on `helix:a2a:reply:<correlationId>`. A worker in
`services/agent-runtime` serves every registered domain agent. When the
gateway or Redis is unavailable, dispatch falls back to an in-process call and
the transport is recorded. Every message is stored as an `AgentMessage` row.
Pub/sub fans out, so running two runtime replicas of the same agent type is
not supported yet (Redis Streams consumer groups are the upgrade).
