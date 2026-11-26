# HELIX

**An Autonomous Enterprise Investigation Platform.**

Traditional BI answers "what happened." HELIX is built to eventually answer:
what happened, why it happened, what evidence supports that conclusion, what
is likely to happen next, and what should be done about it, via multi-agent
AI, real statistical/ML analytics, and an explainable evidence trail, not a
single LLM call over your data.

This repository is a **monorepo** containing the whole system: web app, API,
AI/analytics services, agents, and shared contracts. See
`docs/architecture/system-overview.md` for the full architecture and
`docs/decisions/` for why it's built this way.

> **Status:** Phases 0 to 10 complete. A user connects data (Postgres, CSV,
> MCP servers, GitHub), asks a question, and five agents (Coordinator,
> Analytics, Finance, Customer, Product) work out what happened, where, and
> what changed, with every number traceable to computed evidence. Monitors can
> open investigations on their own, and every investigation can be replayed
> step by step. See "What has been implemented" below.

## Repository structure

```
apps/
  web/            Next.js: presentation only, no business logic
  api/            NestJS: auth, orgs, projects, investigations, data sources

services/
  agent-runtime/    Hosts/executes agents behind a shared BaseAgent contract
  analytics-engine/ Real statistical computation (pandas/numpy/scipy/...)
  context-engine/   Assembles per-agent-task context (not "RAG")
  ingestion-service/ Data source connection (Postgres, CSV, MCP, GitHub), schema discovery, profiling
  a2a-gateway/      Agent-to-agent message routing over Redis pub/sub
  mcp-demo/         Local MCP server serving a seeded deployments feed (for demos and evaluation)

agents/           One package per agent (coordinator, analytics, finance, customer, product implemented;
                  operations and visualization are READMEs)
analytics/        Algorithm libraries (anomaly-detection, forecasting, segmentation, correlation, root-cause)

packages/
  types/            Shared enums
  contracts/         Shared zod schemas + inferred types (TypeScript)
  contracts-py/       Pydantic mirror of contracts/ (Python), plus the context and run-result contracts
  llm-py/             Optional Claude client used by the Coordinator (planning, summaries)
  config/            Typed env loading (Node)
  logger/            Shared structured logger (Node)
  database/          Prisma schema, migrations, typed client
  ui/                Shared React components

infrastructure/   Docker, Postgres, Redis, monitoring config
docs/             Architecture docs, ADRs, research notes, API docs
scripts/          Bootstrap + cross-language task-runner scripts
tests/            Shared fixtures (tests/fixtures) and the evaluation harness (tests/evaluation)
```

## Running HELIX

### Prerequisites
- Node.js ≥ 20, [pnpm](https://pnpm.io) ≥ 9 (`corepack enable` will install
  the pinned version automatically)
- Python 3.11+ available as `python3.12` on your `PATH` (or set
  `HELIX_PYTHON` to point at your interpreter)
- Docker + Docker Compose (for Postgres/Redis, or the whole stack)

### Option A: everything in Docker
```bash
cp .env.example .env   # fill in real values
docker compose up
```
Starts Postgres, Redis, and every app/service as containers. Web:
http://localhost:3000, API: http://localhost:4000/health.

### Option B: infra in Docker, apps via monorepo tooling (recommended for active development)
```bash
./scripts/bootstrap.sh          # installs deps, copies .env, generates Prisma client
docker compose up -d postgres redis
pnpm db:migrate                 # applies migrations (prompts to name the first one)
pnpm dev                        # turbo runs every app/service's dev script in parallel
```
This gives hot reload for `apps/web` (Next.js) and `apps/api` (NestJS
`--watch`), and `uvicorn --reload` for the Python services.

### Option C: no Docker at all
Native Postgres (14+) and Redis work just as well, and this is how the
project is developed day to day. Create the role and database once, then use
Option B without the `docker compose` step:
```bash
psql -d postgres -c "CREATE ROLE helix LOGIN PASSWORD 'helix' CREATEDB;"
psql -d postgres -c "CREATE DATABASE helix OWNER helix;"
psql -d postgres -c "CREATE DATABASE helix_test OWNER helix;"   # for API e2e tests
pnpm --filter @helix/database db:migrate:deploy
DATABASE_URL="postgresql://helix:helix@localhost:5432/helix_test?schema=public" \
  pnpm --filter @helix/database db:migrate:deploy
```
`pnpm dev` then starts everything, including the context engine (8003), the
A2A gateway (8005) and the demo MCP server (8006). To run one service by hand,
use its virtualenv, for example
`cd services/agent-runtime && .venv/bin/uvicorn app.main:app --port 8001`
(`bash ../../scripts/python-run.sh test` creates the virtualenv the first
time). If ports 3000 or 4000 are taken, set `API_PORT`, `WEB_APP_URL`,
`HELIX_API_URL` and `NEXT_PUBLIC_API_URL` to other ports.

### Try an investigation
1. Sign up at http://localhost:3000 and create an organization and project.
2. Under Data sources, upload `tests/fixtures/orders.csv` (CSV), then add an
   MCP server at `http://localhost:8006/mcp` (the seeded deployments feed).
3. Ask "Why did revenue drop last week?" Within a couple of seconds the root
   cause reads: revenue dropped 38.8% on 2026-10-08 because web orders
   collapsed, starting shortly after the `web-checkout` v2.14.0 deploy (later
   rolled back), with refunds spiking on 2026-10-08 and 2026-10-09 and the
   customer segment mix ruled out.
4. Open the Replay, Evidence graph and Trace tabs to see the plan, each
   agent's context and messages, and how every finding is backed.
5. On Monitoring, add the suggested "Daily revenue" monitor and click Run now:
   it opens an autonomous investigation for 2026-10-08 (and only once).

API docs are at http://localhost:4000/docs.

### Evaluation
`python3 tests/evaluation/run_eval.py --api http://localhost:4000` runs the
seeded scenarios against a live stack and writes
[docs/research/evaluation-results.md](docs/research/evaluation-results.md):
root-cause accuracy against `tests/fixtures/ground_truth.json`, numbers in
findings that cannot be traced to evidence, and latency. Latest run: 24 of 24
checks, 0 untraced numbers, about 1.2 seconds per investigation.

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
| mcp-demo | http://localhost:8006/health |

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
`AGENT_RUNTIME_URL`, `ANALYTICS_ENGINE_URL`, `CONTEXT_ENGINE_URL`,
`A2A_GATEWAY_URL`, `HELIX_A2A_MODE`), monitoring
(`HELIX_MONITOR_INTERVAL_MS`, `HELIX_MONITOR_MAX_PER_DAY`, ADR-009) and the
optional LLM (`ANTHROPIC_API_KEY`, `HELIX_LLM`, `HELIX_LLM_MODEL`, ADR-010:
without a key the deterministic rules run). The API
refuses the dev-default secrets when `NODE_ENV=production`. Never commit
`.env`; only `.env.example` (placeholders only) is tracked.

## Database schema

Owned entirely by `packages/database/prisma/schema.prisma`, applied via
Prisma migrations. Never hand-edit the database. Current entities: `User`,
`Organization`, `OrganizationMember`, `Project`, `DataSource`,
`DataSourceSchema`, `DataSourceCredential`, `Investigation`, `InvestigationStep`,
`InvestigationEvent`, `Agent`, `AgentTask`, `AgentMessage`, `Evidence`,
`Finding` (+ `FindingEvidence` join), `Recommendation` (+
`RecommendationFinding` join), `Metric`, `Anomaly`, `ContextSnapshot`,
`Monitor`, `AuditLog`, `Notification`. Since Phase 6 every run also writes
`AgentMessage` and `ContextSnapshot` rows. See `docs/architecture/system-overview.md` for what each owns.

## What has been implemented (Phases 0 to 10)

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

**Phase 6, context engine** (`services/context-engine`).
- Each agent declares what it needs; the engine filters data sources and
  tables, sets the focus (anomaly days in the question's direction), adds
  recent history and trims to a token budget.
- Every task's context is stored as a `ContextSnapshot`, with the reason for
  each filtering choice (ADR-008).

**Phase 7, multiple agents and A2A** (`agents/finance`, `agents/customer`,
`agents/product`, `services/a2a-gateway`).
- Finance: refunds, order volume by channel, refund and revenue correlation.
- Customer: active customers and whether the customer segment mix explains a move.
- Product: deploys and releases aligned with anomaly days.
- Multi-step plans: Analytics first, then the domain agents concurrently, then
  a synthesis step. Tasks travel over Redis pub/sub with an in-process
  fallback, and every message is stored (ADR-008).
- Web: an Agents page with capabilities and context requirements.

**Phase 8, MCP integrations** (`services/ingestion-service`, `services/mcp-demo`).
- `McpAdapter` turns an MCP server's list tools into tables;
  `GithubAdapter` reads deployments, releases and commits.
- Credentials are encrypted like Postgres ones. Web forms for both.

**Phase 9, autonomous investigations** (`apps/api` monitors).
- Monitors run on a schedule and on demand, open one investigation per
  serious anomaly (deduplicated, rate limited) and notify the organization.
- Web: Monitoring page with suggestions, run now, recent anomalies, and a
  notifications page with an unread badge (ADR-009).

**Phase 10, explainability and replay** (`analytics/segmentation`,
`analytics/correlation`, `analytics/root-cause`, `apps/web`).
- Segment comparison, correlation and deploy alignment endpoints.
- Root causes ranked from all agents' evidence: what, when, where and what
  changed (ADR-010). Optional Claude for planning and summaries, with a guard
  against invented numbers.
- `GET /investigations/:id/trace` and the Replay, Evidence graph and Trace tabs.
- The evaluation harness in `tests/evaluation`.

## What has deliberately NOT been implemented yet

- **A durable job queue.** Investigations and monitor cycles run inside the
  API process. An API restart mid-run leaves an investigation unfinished, and
  monitors only run while the API is up (ADR-009).
- **The LLM path in practice.** It is built and tested with a fake client but
  has not been run against the live Claude API here; without a key the rules
  run.
- **Scaling A2A.** Redis pub/sub fans out, so two runtime replicas of one agent
  type would both run a task (ADR-008).
- **Operations and Visualization agents** (READMEs only), cross-organization
  correlation, autonomous actions (HELIX never acts on its own), and
  editing or annotating past investigations.
- **Real-world sources.** The GitHub adapter is tested only against mocked HTTP.
- **Smaller gaps:**
  - Password reset/SSO.
  - Editing data sources, members and projects in the web app (the API
    supports most of it).
  - Observability (`infrastructure/monitoring` is still a placeholder).

## Roadmap

The full phase-by-phase build plan (what ships in each phase, what's
deliberately deferred, where the work lands in this repo, and what unlocks
next) lives in [`docs/roadmap/`](docs/roadmap/README.md), with one file per
phase. That directory's status table is the source of truth for "what phase
are we in"; keep it updated as phases complete.

## Recommended next steps

The ten-phase roadmap is complete. In order of value:
1. **Durable runs:** move investigations and monitor cycles onto a queue
   (BullMQ on Redis) so restarts and multiple API instances are safe.
2. **Real sources:** connect a real GitHub repository and a production-like
   Postgres database, and add evaluation scenarios built from them.
3. **Measure the LLM path:** run the evaluation with `ANTHROPIC_API_KEY` set
   and compare accuracy, untraced numbers, latency and cost against the rules.
4. **Feedback:** let users mark a root cause right or wrong, and use that to
   tune the ranking weights in ADR-010.

## Contributing

See `CONTRIBUTING.md`.
