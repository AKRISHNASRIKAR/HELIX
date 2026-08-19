# scripts

- `bootstrap.sh` — first-time setup (installs deps, copies `.env`, generates
  the Prisma client). Run once after cloning.
- `python-run.sh` — shared bootstrap + task runner for every Python package
  (services, agents, analytics, `packages/contracts-py`); invoked from each
  package's `package.json` scripts so `turbo run dev/lint/test` works
  uniformly across Node and Python workspaces. See ADR-001.
