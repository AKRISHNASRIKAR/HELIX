# ADR-001: Monorepo with pnpm workspaces + Turborepo

## Status
Accepted

## Context
HELIX spans a Next.js frontend, a NestJS backend, five Python FastAPI
services, several Python agent/algorithm packages, and shared TypeScript
libraries (types, contracts, config, logger, database client, UI). These
pieces change together constantly during early development — a new domain
entity touches the Prisma schema, the zod contract, the Pydantic mirror, and
an API endpoint in the same commit.

## Decision
One monorepo (`helix/`), using pnpm workspaces for dependency management and
Turborepo for task orchestration (`build`, `dev`, `lint`, `test`,
`typecheck`) across every TypeScript package. Python packages are included in
the same pnpm workspace via thin `package.json` wrappers (see
`scripts/python-run.sh`) so `turbo run dev` / `test` / `lint` operate
uniformly across both ecosystems from one command.

## Consequences
- A single `pnpm install` and a single `.env` file cover the whole system.
- Shared contracts (`packages/contracts`, `packages/contracts-py`) can be
  updated once and consumed everywhere, with the compiler/type checker
  catching drift in TypeScript consumers immediately.
- Python services still need their own virtualenvs (`.venv` per package,
  bootstrapped by `scripts/python-run.sh`) — pnpm workspaces don't manage
  Python dependency resolution, only task orchestration.
- Turborepo's remote caching is not configured yet (no team account); local
  caching only. Revisit once CI is set up.

## Alternatives considered
- **Separate repositories per app/service** — rejected per the project
  brief; would require a coordinated multi-repo release process for what is,
  at this stage, one evolving system with one team.
- **Nx instead of Turborepo** — both are reasonable; Turborepo was chosen for
  its lighter configuration surface and first-class Next.js/Vercel alignment,
  given the frontend is Next.js.
