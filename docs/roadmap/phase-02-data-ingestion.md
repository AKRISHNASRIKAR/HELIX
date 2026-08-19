# Phase 2: Data Ingestion

**Status:** Not started
**Depends on:** [Phase 1](./phase-01-core-platform.md) — needs real
`DataSource` records and an authenticated API to attach them to.

## Goal

Make a `DataSource` record actually connect to something — starting with the
two simplest source types — and produce the schema/profiling metadata later
phases (analytics, agents) rely on.

## What ships

- **`PostgresAdapter` and `CsvAdapter`**, the first concrete implementations
  of `DataSourceAdapter` (`services/ingestion-service/app/adapters/base.py`).
  Each implements `connect`, `discover_schema`, `preview`, `disconnect`.
- **Connection flow** — `apps/api` calls `services/ingestion-service` when a
  `DataSource` is created/updated; on success the adapter's discovered
  columns are persisted as `DataSourceSchema` rows and `DataSource.status`
  moves `PENDING → CONNECTED` (or `ERROR` with a stored reason).
- **CSV upload path** — since a CSV has no persistent "connection," this
  needs a small decision: store the file (local disk for dev, object storage
  later) and treat re-reading it as the "connection." Document this as an
  ADR if the chosen approach has real tradeoffs (e.g. file size limits).
- **Basic profiling** — row count, column null-rates, and inferred types
  beyond raw SQL/CSV types (e.g. "looks like a currency column") — cheap
  pandas-based profiling, not full statistical analysis (that's
  [Phase 3](./phase-03-analytics-engine.md)'s job).
- **Data Sources UI** — `apps/web` gets a real Data Sources page: connect a
  source, see status, see discovered schema, preview a sample of rows. This
  is the first `apps/web` page with real interactivity beyond the dashboard.
- **Credential handling** — resolve how `DataSource` credentials are actually
  stored (a secret manager, or at minimum encrypted-at-rest in a dedicated
  table, never in `DataSource.connectionConfig` — see ADR-002). This is
  security-sensitive enough to warrant its own ADR before implementation.

## What we're deliberately not doing yet

- No REST API, GitHub, or MCP-based sources — only Postgres and CSV, per the
  project brief's explicit "do not implement 20 integrations" instruction.
  Those come in [Phase 8](./phase-08-mcp.md).
- No scheduled/incremental sync — every "sync" is a full re-discovery for
  now. Incremental sync is future work if a real use case needs it (see
  `docs/research/future-work.md`).
- No agent consumes this data yet — `services/analytics-engine` and
  `agents/*` don't exist as working code until Phases 3–4.

## Where the work lands

| What | Where |
|---|---|
| Adapters | `services/ingestion-service/app/adapters/` (extend — `postgres.py`, `csv.py`) |
| Ingestion endpoints | `services/ingestion-service/app/main.py` (extend) |
| API orchestration (calls ingestion-service, persists results) | `apps/api/src/data-sources/` (from Phase 1 — extend) |
| Data Sources UI | `apps/web/app/data-sources/` (new) |
| Credential storage decision | `docs/decisions/ADR-006-*.md` (new, if warranted) |

## Definition of done

- A user can connect a real Postgres database or upload a CSV, see its
  discovered schema and a row preview in `apps/web`, and the `DataSource`
  status reflects reality (`CONNECTED` or `ERROR` with a reason).
- Adapter unit tests cover connection failure (bad credentials, malformed
  CSV) without crashing the ingestion service — first real exercise of the
  "one failed component shouldn't take down the system" rule (project brief,
  section 20).

## What's next

[Phase 3: Analytics Engine](./phase-03-analytics-engine.md) — compute real
numbers over the data this phase can now reach.
