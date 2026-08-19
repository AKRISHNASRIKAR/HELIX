# Build context is the repo root (see docker-compose.yml) because pnpm
# workspaces need the whole monorepo to resolve `workspace:*` dependencies.
FROM node:20-alpine
RUN corepack enable
WORKDIR /repo

COPY . .
RUN pnpm install --frozen-lockfile=false
RUN pnpm --filter @helix/web... build

WORKDIR /repo/apps/web
EXPOSE 3000
CMD ["pnpm", "start"]
