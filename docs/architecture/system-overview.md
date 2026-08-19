# System Overview

HELIX is an AI-powered platform that investigates organizational problems —
not just "what happened" (traditional BI) but "what happened, why, what
evidence supports that, what's likely next, and what should we do."

This document describes the system as it exists today (Phase 0: foundation)
and the shape it grows into. See `docs/decisions/` for why each major choice
was made, and the root `README.md` for how to run it.

## Layers

```
                         HELIX
                           │
                    ┌──────┴──────┐
                    │   Web App   │   apps/web (Next.js) — presentation only
                    └──────┬──────┘
                           │
                    apps/api (NestJS)  — auth, orgs, projects, investigations,
                           │              data source config, API gateway
                    Investigation
                     Orchestrator        (lives inside apps/api today;
                           │              may become its own service once
              ┌────────────┼────────────┐ orchestration logic outgrows a
              │            │            │ single Nest module — see ADR-003)
        Context Engine   Agent       Analytics
        (services/      Runtime     Engine
         context-       (services/  (services/
         engine)         agent-     analytics-
              │          runtime)    engine)
              │            │            │
              │      ┌─────┼─────┐      │
              │      │     │     │      │
              ▼      ▼     ▼     ▼      ▼
           Redis   agents/*  (BaseAgent)  analytics/* (algorithm libs)
                         │
                    A2A Gateway (services/a2a-gateway)
                         │
              ┌──────────┼──────────┐
              │          │          │
        ingestion-   PostgreSQL   External
        service      (packages/    Services / MCP
        (DataSource   database)
        Adapters)
```

## Why this shape

Traditional BI systems (and most "AI chatbot on your data" demos) collapse
everything into `Frontend → One API → One LLM → Answer`. That works for a
demo and fails the moment you need:

- **Real numbers, not LLM guesses.** Percentage changes, forecasts, and
  anomaly scores come from `services/analytics-engine` (pandas/numpy/scipy/
  statsmodels), never from the LLM estimating. See
  `docs/architecture/analytics-engine.md`.
- **Multiple domains of evidence.** Revenue, refunds, deployments, and
  support tickets are different data, different owners, different agents.
  One giant agent/prompt can't reason about all of them well — see
  `docs/architecture/agent-architecture.md`.
- **Explainability.** Every finding needs a citable source. That only works
  if evidence, findings, and confidence are first-class database rows
  (`Evidence`, `Finding`), not buried in an LLM transcript.
- **Bounded context per agent.** No agent should receive the entire
  enterprise dataset for every question — see
  `docs/architecture/context-engine.md`.

## Repositories and boundaries

Everything lives in one monorepo (see ADR-001) with hard boundaries enforced
by directory structure, not by convention alone:

| Directory | Owns | Language |
|---|---|---|
| `apps/web` | Presentation, no business logic | TypeScript / Next.js |
| `apps/api` | Auth, orgs, projects, investigations, data source config, permissions, notifications, audit | TypeScript / NestJS |
| `services/agent-runtime` | Hosts and executes agent implementations behind `BaseAgent` | Python / FastAPI |
| `services/analytics-engine` | Real numerical computation | Python / FastAPI |
| `services/context-engine` | Context assembly per agent task | Python / FastAPI |
| `services/ingestion-service` | Data source connection, schema discovery, profiling | Python / FastAPI |
| `services/a2a-gateway` | Agent-to-agent message transport | Python / FastAPI |
| `agents/*` | One directory per agent's domain logic (Coordinator, Analytics, Finance, ...) | Python |
| `analytics/*` | Algorithm libraries (anomaly detection, forecasting, correlation, segmentation, root cause) | Python |
| `packages/*` | Shared, versionless code: types, contracts, config, logger, database, ui | TypeScript |
| `packages/contracts-py` | Pydantic mirror of `packages/contracts`, for Python services | Python |
| `infrastructure/*` | Docker, Postgres, Redis, monitoring config | — |

## What is NOT built yet

Everything in this document describes the target shape. As of Phase 0 only
the following are real: monorepo tooling, health checks on every service, the
Prisma schema/migrations, the shared TS+Python domain contracts, the
`BaseAgent` and `DataSourceAdapter` interfaces, and one read-only
`GET /investigations` endpoint proving Postgres↔NestJS wiring. See the root
`README.md`'s "What has deliberately not been implemented yet" section for
the full list, and [`docs/roadmap/`](../roadmap/README.md) for the detailed,
phase-by-phase build plan (mirrors section 18 of the original project brief).
