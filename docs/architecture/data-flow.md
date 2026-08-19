# Data Flow

## Source of truth

- **PostgreSQL** (`packages/database`) is the only source of truth for
  persistent data — users, organizations, investigations, evidence,
  findings, metrics, etc. Every table is listed in
  `packages/database/prisma/schema.prisma`.
- **Redis** is cache, queues, agent coordination, and short-lived
  investigation state. It is disposable — losing Redis should degrade
  performance, never lose data. Nothing is ever written to Redis as its only
  copy.

## Target end-to-end flow (Phase 5+, once the Coordinator exists)

```
User asks a question (apps/web)
        │
        ▼
apps/api creates an Investigation row (status = PENDING)
        │
        ▼
Coordinator agent (agents/coordinator, via services/agent-runtime)
  produces an InvestigationPlan → persisted on Investigation.plan
  and as InvestigationStep rows
        │
        ▼
For each step: apps/api (or the Coordinator directly) creates an
  AgentTask, services/context-engine assembles that task's
  input_context (persisted as a ContextSnapshot), and
  services/a2a-gateway delivers a TASK_REQUEST AgentMessage to the
  target agent
        │
        ▼
The agent (e.g. agents/analytics) calls services/analytics-engine
  for real computation, wraps the result as Evidence + Finding rows,
  and returns a TASK_RESULT AgentMessage
        │
        ▼
Coordinator collects results across agents, determines the root
  cause (Finding.isRootCause), and writes Investigation.summary /
  overallConfidence / recommendations
        │
        ▼
apps/web renders the Investigation page: evidence, findings,
  confidence, root cause, recommendation, timeline
        │
        ▼
Every step above also appends an InvestigationEvent row — the
  timeline that powers Investigation Replay (docs/architecture/
  agent-architecture.md, "Replay")
```

## What exists today (Phase 0)

Only the first and last legs are wired: `apps/web`'s dashboard does a
server-side `fetch` to `apps/api`'s `/health`, and `GET /api/v1/investigations`
reads (empty, for now) `Investigation` rows straight out of Postgres via
Prisma. Nothing in the middle (Coordinator, agents, context engine, a2a
routing) exists yet — see the phase plan in the project brief, section 18.

## Data source ingestion flow (Phase 2)

```
User connects a DataSource (Postgres or CSV) via apps/web
        │
        ▼
apps/api persists the DataSource row (status = PENDING,
  connectionConfig has no secrets — credentials resolve at
  connect-time from a secret manager)
        │
        ▼
services/ingestion-service's matching DataSourceAdapter
  (app/adapters/base.py) connects, discovers schema, and writes
  DataSourceSchema rows; DataSource.status becomes CONNECTED
        │
        ▼
Agents query through the same adapter abstraction when they need
  raw data — never a hard-coded connection string per agent
```
