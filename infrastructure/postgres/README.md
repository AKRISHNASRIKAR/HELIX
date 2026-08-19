# infrastructure/postgres

Postgres is provisioned by `docker-compose.yml` using the stock `postgres:16-alpine`
image — no custom image needed yet. Schema is owned entirely by
`packages/database/prisma/schema.prisma` and applied via Prisma migrations
(`pnpm db:migrate`), never by hand-editing the database.

`init/` holds one-time init scripts the official Postgres image runs on first
boot of an empty data directory (via `/docker-entrypoint-initdb.d`). Empty for
now — add scripts here only for things Prisma migrations can't express (e.g.
enabling `pg_stat_statements` for monitoring in a later phase).
