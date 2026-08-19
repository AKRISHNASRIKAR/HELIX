# Phase 0: Architecture & Foundations

**Status:** ✅ Complete
**Depends on:** nothing — this is the starting point.

## Goal

Stand up the monorepo, every app/service skeleton, the shared domain
contracts, and the database schema — with everything runnable and tested —
before writing any feature or agent logic.

## What shipped

- Monorepo tooling: pnpm workspaces, Turborepo (`turbo run dev/build/lint/test/typecheck`
  works across both TypeScript and Python packages via `scripts/python-run.sh`).
- `apps/web` (Next.js 15 + Tailwind v4) and `apps/api` (NestJS) — both
  building, both running, `apps/web`'s dashboard server-fetching `apps/api`'s
  health endpoint.
- All five Python services (`services/agent-runtime`, `analytics-engine`,
  `context-engine`, `ingestion-service`, `a2a-gateway`) as FastAPI apps, each
  with a working `/health` endpoint.
- Shared domain contracts — `Investigation`, `Agent`, `AgentTask`,
  `AgentMessage`, `Evidence`, `Finding`, `Recommendation`, `DataSource`,
  `Metric` — as zod schemas (`packages/contracts`) and Pydantic models
  (`packages/contracts-py`).
- Full Prisma schema (`packages/database/prisma/schema.prisma`) and an
  applied initial migration covering every entity in the schema.
- Two seam interfaces with no concrete implementations yet: `BaseAgent`
  (`services/agent-runtime/app/agents/base.py`) and `DataSourceAdapter`
  (`services/ingestion-service/app/adapters/base.py`).
- One real vertical slice: `GET /api/v1/investigations` reads live (empty)
  rows from Postgres through Prisma — proof the Next.js → NestJS → Postgres
  path works, not a placeholder.
- Docker Compose covering every service; unit + integration tests for what
  exists (NestJS service test, API e2e health test against real Postgres/
  Redis, Python contract tests, every service's health-endpoint test).
- Architecture docs (`docs/architecture/`), five ADRs (`docs/decisions/`),
  research notes (`docs/research/`).

## What was deliberately not built

Everything with actual business logic: auth, any CRUD beyond the one
read-only endpoint, any data source connector, any real analytics
computation, any agent behavior, context assembly, A2A routing, MCP
adapters, autonomous triggers, and the replay UI. See each phase below for
when these land.

## Where the work landed

Every top-level directory named in the original project brief now exists
and is either functional (apps, services, packages) or a README stating what
it will hold and when (`agents/*`, `analytics/*`).

## What's next

[Phase 1: Core Platform](./phase-01-core-platform.md) — auth, organizations,
projects, real data source CRUD, and a real investigation-creation endpoint,
still with no AI involved.
