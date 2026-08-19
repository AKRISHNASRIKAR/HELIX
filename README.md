# HELIX

**An Autonomous Enterprise Investigation Platform.**

Traditional BI answers "what happened." HELIX is built to eventually answer:
what happened, why it happened, what evidence supports that conclusion, what
is likely to happen next, and what should be done about it — via multi-agent
AI, real statistical/ML analytics, and an explainable evidence trail, not a
single LLM call over your data.

This repository is a **monorepo** containing the whole system: web app, API,
AI/analytics services, agents, and shared contracts. See
`docs/architecture/system-overview.md` for the full architecture and
`docs/decisions/` for why it's built this way.

> **Status:** Phase 0 — foundation. See "What has been implemented" below.

## Repository structure

```
apps/
  web/            Next.js — presentation only, no business logic
  api/            NestJS — auth, orgs, projects, investigations, data sources

services/
  agent-runtime/    Hosts/executes agents behind a shared BaseAgent contract
  analytics-engine/ Real statistical computation (pandas/numpy/scipy/...)
  context-engine/   Assembles per-agent-task context (not "RAG")
  ingestion-service/ Data source connection, schema discovery, profiling
  a2a-gateway/      Agent-to-agent message routing

agents/           One directory per agent's domain logic (mostly READMEs for now)
analytics/        Algorithm libraries analytics-engine composes (mostly READMEs for now)

packages/
  types/            Shared enums
  contracts/         Shared zod schemas + inferred types (TypeScript)
  contracts-py/       Pydantic mirror of contracts/ (Python)
  config/            Typed env loading (Node)
  logger/            Shared structured logger (Node)
  database/          Prisma schema, migrations, typed client
  ui/                Shared React components

infrastructure/   Docker, Postgres, Redis, monitoring config
docs/             Architecture docs, ADRs, research notes, API docs
scripts/          Bootstrap + cross-language task-runner scripts
tests/            Cross-cutting e2e tests and shared fixtures
```

## Running HELIX

### Prerequisites
- Node.js ≥ 20, [pnpm](https://pnpm.io) ≥ 9 (`corepack enable` will install
  the pinned version automatically)
- Python 3.11+ available as `python3.12` on your `PATH` (or set
  `HELIX_PYTHON` to point at your interpreter)
- Docker + Docker Compose (for Postgres/Redis, or the whole stack)

### Option A — everything in Docker
```bash
cp .env.example .env   # fill in real values
docker compose up
```
Starts Postgres, Redis, and every app/service as containers. Web:
http://localhost:3000, API: http://localhost:4000/health.

### Option B — infra in Docker, apps via monorepo tooling (recommended for active development)
```bash
./scripts/bootstrap.sh          # installs deps, copies .env, generates Prisma client
docker compose up -d postgres redis
pnpm db:migrate                 # applies migrations (prompts to name the first one)
pnpm dev                        # turbo runs every app/service's dev script in parallel
```
This gives hot reload for `apps/web` (Next.js) and `apps/api` (NestJS
`--watch`), and `uvicorn --reload` for the Python services.

### Health checks
Every service exposes `GET /health`:

| Service | URL |
|---|---|
| web | http://localhost:3000 |
| api | http://localhost:4000/health |
| agent-runtime | http://localhost:8001/health |
| analytics-engine | http://localhost:8002/health |
| context-engine | http://localhost:8003/health |
| ingestion-service | http://localhost:8004/health |
| a2a-gateway | http://localhost:8005/health |

### Common commands
```bash
pnpm dev            # start every app/service in dev mode (turbo)
pnpm build           # build every app/service
pnpm lint            # lint everything (ESLint + Ruff)
pnpm test            # test everything (Jest/Vitest + pytest)
pnpm typecheck        # typecheck everything
pnpm db:migrate        # create/apply a Prisma migration
pnpm db:studio         # open Prisma Studio
pnpm --filter @helix/api dev   # run just one package's script
```

## Environment variables

See `.env.example` at the repo root for the full list with defaults —
covers Postgres/Redis connection info, each service's port, `WEB_APP_URL` /
`NEXT_PUBLIC_API_URL` for CORS and API calls, and an `ANTHROPIC_API_KEY`
placeholder for Phase 4+ agent reasoning (unused today). Never commit `.env`
— only `.env.example` (placeholders only) is tracked.

## Database schema

Owned entirely by `packages/database/prisma/schema.prisma`, applied via
Prisma migrations — never hand-edit the database. Current entities: `User`,
`Organization`, `OrganizationMember`, `Project`, `DataSource`,
`DataSourceSchema`, `Investigation`, `InvestigationStep`,
`InvestigationEvent`, `Agent`, `AgentTask`, `AgentMessage`, `Evidence`,
`Finding` (+ `FindingEvidence` join), `Recommendation` (+
`RecommendationFinding` join), `Metric`, `Anomaly`, `ContextSnapshot`,
`AuditLog`. See `docs/architecture/system-overview.md` for what each owns.

## What has been implemented (Phase 0)

- Monorepo tooling: pnpm workspaces, Turborepo, shared TS config, ESLint,
  Prettier, a shared Ruff/pytest config for Python.
- `apps/web` (Next.js + Tailwind v4) and `apps/api` (NestJS) skeletons, both
  building and running.
- All five Python services (`agent-runtime`, `analytics-engine`,
  `context-engine`, `ingestion-service`, `a2a-gateway`) as FastAPI apps with
  working `/health` endpoints.
- Shared domain contracts for `Investigation`, `Agent`, `AgentTask`,
  `AgentMessage`, `Evidence`, `Finding`, `Recommendation`, `DataSource`,
  `Metric` — as zod schemas (`packages/contracts`) *and* Pydantic models
  (`packages/contracts-py`), kept in sync by hand today.
- Full Prisma schema + an initial migration covering every entity above.
- `BaseAgent` interface (`services/agent-runtime/app/agents/base.py`) and
  `DataSourceAdapter` interface (`services/ingestion-service/app/adapters/base.py`)
  — the two seams concrete agents and data connectors will plug into.
- One real vertical slice: `apps/web`'s dashboard server-fetches
  `apps/api`'s `/health`, and `GET /api/v1/investigations` reads real (empty)
  rows from Postgres via Prisma — proving the Next.js → NestJS → Postgres
  path actually works.
- Docker Compose covering every service, and Dockerfiles for each.
- Unit tests (NestJS service, Python contracts) and integration/e2e tests
  (API health check against real Postgres/Redis, every service's health
  endpoint) — see each package's own tests.
- Architecture docs (`docs/architecture/`), five ADRs (`docs/decisions/`),
  and research notes (`docs/research/`).

## What has deliberately NOT been implemented yet

- Authentication, authorization, and any real CRUD beyond the one read-only
  investigations endpoint (Phase 1).
- Any data source connector (Postgres/CSV adapters — Phase 2) — only the
  `DataSourceAdapter` interface exists.
- Any real analytics computation (KPIs, anomaly detection, forecasting —
  Phase 3) — `analytics-engine` only has a health check.
- Any agent logic — every `agents/*` directory is currently just a README.
  Analytics Agent is next (Phase 4), then the Coordinator (Phase 5).
- Context assembly (Phase 6), real A2A routing (Phase 7), MCP integrations
  (Phase 8), autonomous/anomaly-triggered investigations (Phase 9), and the
  investigation replay UI (Phase 10).
- Observability/monitoring (`infrastructure/monitoring` is a placeholder).

## Recommended next phase

**Phase 1: Core Platform** — auth, users, organizations, data source CRUD,
a real investigation-creation endpoint, and a basic dashboard reading live
data — still with no AI. This turns today's one read-only proof-of-wiring
endpoint into an actually usable platform, and is the right foundation to
build the Analytics Agent (Phase 4) on top of.

## Contributing

See `CONTRIBUTING.md`.
