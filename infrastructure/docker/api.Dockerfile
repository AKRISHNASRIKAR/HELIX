# Build context is the repo root (see docker-compose.yml) because pnpm
# workspaces need the whole monorepo to resolve `workspace:*` dependencies.
FROM node:20-alpine
RUN corepack enable
WORKDIR /repo

COPY . .
RUN pnpm install --frozen-lockfile=false
RUN pnpm --filter @helix/database db:generate
RUN pnpm --filter @helix/api... build

WORKDIR /repo/apps/api
EXPOSE 4000
CMD ["node", "dist/main.js"]
