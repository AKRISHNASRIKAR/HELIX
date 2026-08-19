# ADR-004: NestJS/TypeScript for the platform, Python/FastAPI for AI & analytics

## Status
Accepted

## Context
HELIX needs both conventional CRUD/platform concerns (auth, orgs, projects,
permissions, notifications, audit) and numerically/ML-heavy work (statistics,
forecasting, anomaly detection, agent reasoning). Forcing either ecosystem to
do both is possible but fights the grain of each.

## Decision
- **NestJS + TypeScript** (`apps/api`) owns platform concerns: auth, users,
  organizations, projects, investigations-as-records, data source
  configuration, permissions, investigation state, notifications, audit
  records. Nest's module system maps cleanly onto these domain boundaries.
- **Python + FastAPI** (`services/agent-runtime`, `analytics-engine`,
  `context-engine`, `ingestion-service`, `a2a-gateway`; and `agents/*`,
  `analytics/*`) owns anything that benefits from Python's data/ML ecosystem
  — pandas, numpy, scipy, scikit-learn, statsmodels, duckdb — and agent
  reasoning.
- **Next.js + TypeScript** (`apps/web`) is presentation only; it talks to
  `apps/api`, never directly to the Python services.

## Consequences
- Two contract definitions must be kept in sync by hand: zod schemas
  (`packages/contracts`) and Pydantic models (`packages/contracts-py`). See
  `packages/contracts-py/README.md` for the tradeoff and a note on revisiting
  with codegen if drift becomes a real problem.
- Two dependency managers (pnpm, pip/venv) and two lint/test toolchains
  (ESLint/Jest/Vitest, Ruff/pytest) — bridged at the task-runner level by
  `scripts/python-run.sh` so `turbo run <task>` still works uniformly (see
  ADR-001).
- `apps/api` is the only service directly exposed to `apps/web`; Python
  services are internal and reached through `apps/api` (or, for agent
  coordination, through each other via `a2a-gateway`) — this keeps
  authentication/authorization in one place.

## Alternatives considered
- **All-Python (e.g. Django/FastAPI for everything)** — rejected; Node/Nest
  has stronger conventions for the auth/permissions/CRUD-heavy platform
  layer and pairs naturally with a TypeScript frontend and shared contracts.
- **All-Node (e.g. TensorFlow.js / JS data libraries)** — rejected; Python's
  data/ML ecosystem (pandas, scikit-learn, statsmodels) is meaningfully more
  mature for the analytics work this project depends on.
