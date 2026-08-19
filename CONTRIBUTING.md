# Contributing to HELIX

## Before you start

Read `docs/architecture/system-overview.md` and the ADRs in
`docs/decisions/` first — several architectural boundaries (LLM never
computes numbers, agents never call each other directly, Postgres is the
only source of truth) are load-bearing and not obvious from the code alone.

## Workflow

1. `./scripts/bootstrap.sh` for first-time setup.
2. Create a branch off `main`.
3. Make your change within the relevant domain boundary — see the table in
   `docs/architecture/system-overview.md` for which directory owns what.
4. Update the matching contract in **both** `packages/contracts` (zod) and
   `packages/contracts-py` (Pydantic) if you touch a shared domain shape —
   see `packages/contracts-py/README.md`.
5. If you touch `packages/database/prisma/schema.prisma`, generate a
   migration (`pnpm db:migrate`) and commit it — never hand-edit the
   database.
6. Add or update tests next to the code you changed (unit tests for
   services/agents, integration tests for anything touching Postgres/Redis).
7. `pnpm lint && pnpm typecheck && pnpm test` before opening a PR.
8. If your change is a non-trivial architectural decision (a new dependency
   with broad impact, a new service, a change to a contract's shape used by
   multiple consumers), add an ADR under `docs/decisions/` explaining what
   you chose and why — see the existing ADRs for the format.

## Code style

- TypeScript: ESLint + Prettier (`pnpm lint`, `pnpm format`), enforced
  config in `eslint.config.mjs` / `.prettierrc.json`.
- Python: Ruff (`pnpm lint` runs it per-package via `scripts/python-run.sh`),
  config in the root `pyproject.toml`.
- No commented-out code, no speculative abstractions for features that don't
  exist yet. If a directory isn't implemented, it should say so in a README,
  not contain half-finished code.

## Adding a new Python package/service

Follow the pattern in any existing `services/*` directory: a `package.json`
wrapper calling `scripts/python-run.sh` for `dev`/`lint`/`test`, a
`requirements.txt`, an empty `conftest.py` (so `pytest` can import `app.*`
in tests without a src-layout install — see the comment in any service's
`conftest.py`), and a `README.md` stating what it owns and its current
status. Add its directory to `pnpm-workspace.yaml`'s matching glob if it's
in a new top-level folder.

## Secrets

Never commit `.env`, credentials, or API keys. `.env.example` should only
ever contain placeholders. Data source credentials are never stored in
`DataSource.connectionConfig` — see ADR-002 and
`docs/architecture/data-flow.md`.
