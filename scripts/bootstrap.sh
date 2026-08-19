#!/usr/bin/env bash
# First-time local setup: installs Node deps, copies .env, generates the
# Prisma client. Does not start Postgres/Redis — run `docker compose up -d
# postgres redis` (or your own instances) before `pnpm db:migrate`.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example — fill in real values before running services."
fi

echo "Installing Node dependencies..."
pnpm install

echo "Generating Prisma client..."
pnpm db:generate

echo "Done. Next steps:"
echo "  1. docker compose up -d postgres redis"
echo "  2. pnpm db:migrate"
echo "  3. pnpm dev"
