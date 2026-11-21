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

> **Status:** Phases 0 to 5 complete. A user can connect a data source, ask a
> question, and get an evidence-backed root cause. See "What has been
> implemented" below.

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

agents/           One package per agent (analytics, coordinator implemented; others are READMEs)
analytics/        Algorithm libraries analytics-engine composes (anomaly-detection, forecasting implemented)

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

### Option C: no Docker at all
Native Postgres (14+) and Redis work just as well. Create the role and
database once, then use Option B without the `docker compose` step:
```bash
psql -d postgres -c "CREATE ROLE helix LOGIN PASSWORD 'helix' CREATEDB;"
psql -d postgres -c "CREATE DATABASE helix OWNER helix;"
psql -d postgres -c "CREATE DATABASE helix_test OWNER helix;"   # for API e2e tests
pnpm --filter @helix/database db:migrate:deploy
DATABASE_URL="postgresql://helix:helix@localhost:5432/helix_test?schema=public" \
  pnpm --filter @helix/database db:migrate:deploy
```

### Try an investigation
With everything running, sign up at http://localhost:3000, create an
organization and project, upload `tests/fixtures/orders.csv` under Data
sources, then ask "Why did revenue drop last week?" The Coordinator and
Analytics Agent should name the seeded 2026-10-08 revenue drop as the root
cause within a few seconds. "Why did refunds spike?" finds the seeded refund
spike. API docs are at http://localhost:4000/docs.

### Demo mode
`HELIX_DEMO=1` on the API (`pnpm --filter @helix/api dev:demo`) and the web
app serves fixture data with no Postgres, Redis or login.

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
pnpm --filter @helix/api test:e2e        # API e2e tests (needs the helix_test database)
pnpm --filter @helix/api openapi:export  # regenerate docs/api/openapi.json
```

## Environment variables

See `.env.example` at the repo root for the full list with defaults. It
covers Postgres/Redis connection info, each service's port, `WEB_APP_URL` /
`NEXT_PUBLIC_API_URL`, auth (`JWT_SECRET`, `JWT_EXPIRES_IN`), credential
encryption (`HELIX_SECRETS_KEY`, see ADR-006), CSV storage
(`HELIX_UPLOAD_DIR`), and service-to-service settings
(`HELIX_INTERNAL_TOKEN`, `HELIX_API_URL`, `INGESTION_SERVICE_URL`,
`AGENT_RUNTIME_URL`, `ANALYTICS_ENGINE_URL`). `ANTHROPIC_API_KEY` is a
placeholder: agent reasoning is deterministic today (ADR-007). The API
refuses the dev-default secrets when `NODE_ENV=production`. Never commit
`.env`; only `.env.example` (placeholders only) is tracked.

## Database schema

Owned entirely by `packages/database/prisma/schema.prisma`, applied via
Prisma migrations — never hand-edit the database. Current entities: `User`,
`Organization`, `OrganizationMember`, `Project`, `DataSource`,
`DataSourceSchema`, `DataSourceCredential`, `Investigation`, `InvestigationStep`,
`InvestigationEvent`, `Agent`, `AgentTask`, `AgentMessage`, `Evidence`,
`Finding` (+ `FindingEvidence` join), `Recommendation` (+
`RecommendationFinding` join), `Metric`, `Anomaly`, `ContextSnapshot`,
`AuditLog`, `Notification`. See `docs/architecture/system-overview.md` for what each owns.

## What has been implemented (Phases 0 to 5)

**Phase 0, foundation.** Monorepo tooling (pnpm, Turborepo, ESLint, Prettier,
Ruff, pytest), every app and service skeleton, shared zod and Pydantic
contracts, the full Prisma schema, Docker Compose, architecture docs and ADRs.

**Phase 1, core platform** (`apps/api`, `apps/web`).
- Email/password auth: argon2 hashing and JWTs, with a global guard.
- Organizations and members with OWNER/ADMIN/MEMBER/VIEWER roles.
- Tenant isolation through a validated `X-Organization-Id` header.
- Projects, data source records, and investigation CRUD.
- In-app notifications, and an `AuditLog` row for every mutation.
- Swagger at `/docs` (exported to `docs/api/openapi.json`).
- Web: login, signup, onboarding and an org switcher. The dashboard shows
  real counts.

**Phase 2, data ingestion** (`services/ingestion-service`).
- `PostgresAdapter` and `CsvAdapter`: connect, schema discovery, preview,
  profiling with semantic types, and extract.
- Credentials are encrypted at rest and CSV uploads stored on disk (ADR-006).
- Web: Data Sources pages to connect, inspect schemas, preview and profile.

**Phase 3, analytics engine** (`services/analytics-engine`,
`analytics/anomaly-detection`, `analytics/forecasting`).
- KPIs with Welch t-test p-values, column statistics, trends.
- Anomaly detection (robust z-score, IQR, STL seasonal).
- ETS/ARIMA forecasts with a backtest.
- Every result carries `computationMethod`.
- Ground-truth tests on the seeded `tests/fixtures/orders.csv` dataset.

**Phase 4, Analytics Agent** (`agents/analytics`).
- Rule-based tool selection over the engine's endpoints.
- Evidence and findings whose confidence is derived from the statistics
  (p-values, z-scores, backtest error). The agent never computes numbers
  itself (ADR-005).
- Failures come back as a FAILED task, never an exception.

**Phase 5, Coordinator Agent** (`agents/coordinator`,
`services/agent-runtime`).
- `POST /investigations` runs for real: plan, dispatch, synthesis.
- Root cause, overall confidence, summary and recommendations.
- Live status and an `InvestigationEvent` timeline.
- Partial or failed runs are handled.
- Web: the investigation page auto-refreshes while running and shows
  findings, evidence, recommendations, plan steps and the timeline.
- How execution is split between services is in ADR-007.

## What has deliberately NOT been implemented yet

- **LLM reasoning.** Agent planning and synthesis are deterministic. They live
  in isolated modules so an LLM can replace them later (ADR-007).
- **Phase 6: context engine.** Agent context is still hand-assembled from the
  question plus connected schemas, and `ContextSnapshot` rows are not written
  yet.
- **Later phases:**
  - Phase 7: Finance/Customer/Product agents and real A2A routing.
  - Phase 8: MCP adapters.
  - Phase 9: autonomous, anomaly-triggered investigations.
  - Phase 10: replay UI, root-cause correlation and the full evaluation run.
- **Smaller gaps:**
  - A durable job queue for investigation runs.
  - Password reset/SSO.
  - Notifications UI.
  - Editing data sources, members and projects in the web app (the API
    supports most of it).
  - Observability (`infrastructure/monitoring` is still a placeholder).

## Roadmap

The full phase-by-phase build plan — what ships in each phase, what's
deliberately deferred, where the work lands in this repo, and what unlocks
next — lives in [`docs/roadmap/`](docs/roadmap/README.md), with one file per
phase. That directory's status table is the source of truth for "what phase
are we in"; keep it updated as phases complete.

## Recommended next phase

**[Phase 6: Context Engine](docs/roadmap/phase-06-context-engine.md).**
Replace the hand-assembled agent context with `services/context-engine`, and
persist a `ContextSnapshot` for every task. It should land before Phase 7
adds more agents, so new agents get properly scoped context from day one.

## Contributing

See `CONTRIBUTING.md`.
