# infrastructure/docker

Dockerfiles referenced by the root `docker-compose.yml`. Node apps
(`api.Dockerfile`, `web.Dockerfile`) build from the repo root because pnpm
workspaces need the full monorepo to resolve `workspace:*` dependencies.
Python services all share `python-service.Dockerfile`, parameterized by a
`SERVICE_PATH` build arg — see how each service is wired up in
`docker-compose.yml`.

These images run production-style builds (`pnpm build` + `node dist/main.js`,
or `uvicorn` without `--reload`... note: Python services do keep `--reload`
via `app/main.py`'s uvicorn invocation only when run through
`scripts/python-run.sh`, not in these images). For active development with
hot reload, prefer `pnpm dev` at the repo root over rebuilding containers —
see the root README's "Running HELIX" section.
