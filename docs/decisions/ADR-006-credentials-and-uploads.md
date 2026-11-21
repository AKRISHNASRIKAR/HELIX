# ADR-006: Data source credentials and CSV upload storage

## Status
Accepted

## Context
Phase 2 makes `DataSource` records connect to real systems, which means
HELIX now holds secrets (database usernames and passwords) and user files
(CSV uploads). ADR-002 and `docs/architecture/data-flow.md` already rule out
storing credentials in `DataSource.connectionConfig`, which is plain JSON
that is returned by the API, logged in places, and copied into agent
context. Several services need to read data from a source:
`services/ingestion-service` (connect, preview, profile, extract) and,
indirectly, `services/analytics-engine` (which loads rows through
ingestion's `/extract`).

A real secret manager (Vault, AWS Secrets Manager) is the right long-term
answer, but adding one now would make local development depend on extra
infrastructure before the platform has a single user.

## Decision
**Credentials** are encrypted at rest in a dedicated `DataSourceCredential`
table (one row per data source) with AES-256-GCM, using a key from the
`HELIX_SECRETS_KEY` environment variable. Only `apps/api` holds the key.
Credentials never appear in `connectionConfig`, API responses, agent
`inputContext`, `ContextSnapshot` rows or logs.

Other services get a decrypted connection only when they need it, through
one internal endpoint:
`GET /api/v1/internal/data-sources/:id/connection?organizationId=...`. It is
guarded by a shared service token (`HELIX_INTERNAL_TOKEN`) instead of a user
JWT, and it checks that the requested `organizationId` owns the data source.
Agents and the analytics engine only ever pass `dataSourceId` +
`organizationId`. `services/ingestion-service` is the only caller that
resolves those into a live connection.

**CSV uploads** are written by `apps/api` to `HELIX_UPLOAD_DIR` (local disk)
under a generated file id. `connectionConfig` stores only
`{ fileId, originalName }`. The internal connection endpoint returns the
absolute `filePath`, and re-reading that file is the CSV's "connection".
Uploads are capped at 50MB.

## Consequences
- The encryption is isolated behind `SecretsService` in `apps/api`, so it can
  later be swapped for a real secret manager without touching callers.
- Rotating `HELIX_SECRETS_KEY` currently requires re-entering credentials.
  There is no key versioning yet.
- `HELIX_INTERNAL_TOKEN` is a single shared secret. That is acceptable on a
  private network between HELIX services, but it is not per-service identity
  (mTLS or signed service tokens would be the upgrade).
- CSV storage on local disk means the API and ingestion service must share a
  filesystem (one machine in dev, a shared volume in Docker Compose). Object
  storage (S3-compatible) is the upgrade path once there is more than one
  host. It slots in behind the same `filePath`/`fileId` indirection.
- `apps/api` refuses to boot with the dev-default `HELIX_SECRETS_KEY` or
  `JWT_SECRET` when `NODE_ENV=production`.

## Alternatives considered
- **Pass decrypted credentials in every request body** (API to ingestion to
  analytics). Rejected because credentials would flow through agent tasks and
  could end up persisted in `AgentTask.inputContext`.
- **Give ingestion-service direct database access to read credentials.**
  Rejected because it would spread the encryption key and Prisma-owned schema
  knowledge across two languages.
- **Postgres `pgcrypto`.** Rejected because the key would have to be sent to
  the database in queries, and it ties the secret store to Postgres.
