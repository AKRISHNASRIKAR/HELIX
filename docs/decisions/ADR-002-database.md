# ADR-002: PostgreSQL as sole source of truth, via Prisma

## Status
Accepted

## Context
HELIX needs a relational schema (users, orgs, projects, investigations,
agent tasks, evidence, findings, ...) with real referential integrity — an
`Evidence` row must always point at a real `AgentTask`; a `Finding` must
always cite real `Evidence`. It also needs migrations that are reviewable and
reproducible, not manual `ALTER TABLE` statements someone forgot to write
down.

## Decision
- **PostgreSQL** is the single source of truth for all persistent data (see
  `docs/architecture/data-flow.md`). Redis is cache/queue/ephemeral state
  only.
- **Prisma** (`packages/database`) owns the schema (`prisma/schema.prisma`)
  and all migrations. NestJS consumes the generated `PrismaClient` through a
  thin `PrismaService` (`apps/api/src/prisma`). Python services that need
  direct DB access (e.g. `analytics-engine`, `ingestion-service`) connect
  with their own driver (SQLAlchemy/psycopg2) rather than sharing Prisma's
  client across languages — Prisma's generated client is TypeScript-only.

## Consequences
- Every schema change is a Prisma migration, reviewed in PR diffs, applied
  the same way in every environment (`pnpm db:migrate`).
- Two ORMs touch the same database (Prisma from Node, SQLAlchemy from
  Python) — acceptable because Python services only ever read/write within
  their own domain (metrics, data source schemas) and never own migrations;
  Prisma's schema is the only place table shape is defined.
- The initial schema (see `docs/architecture/system-overview.md` and the
  Prisma schema itself) already includes `ContextSnapshot`, `Evidence`,
  `Finding`, and `InvestigationEvent` — tables with no consumer yet — because
  retrofitting explainability/replay onto an existing investigations table
  later is much more disruptive than including them from the start.

## Alternatives considered
- **TypeORM** — more idiomatic inside NestJS, but Prisma's migration
  workflow and generated types are stronger, and the schema needs to be
  legible to Python developers too (Prisma's schema file is close to
  self-documenting SQL DDL).
- **MongoDB / a document store** — rejected; investigations have real
  relational structure (an investigation has many agent tasks, each with
  many evidence rows, each cited by findings) that benefits from foreign
  keys and joins, not a document shape.
