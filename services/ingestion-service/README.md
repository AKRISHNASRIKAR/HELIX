# ingestion-service

Connects to external data (Postgres and CSV), discovers schema, previews,
profiles and extracts rows, behind the `DataSourceAdapter` interface
(`app/adapters/base.py`) so agents and the ingestion pipeline never hard-code
a specific source type (project brief, section 11).

Port 8004 (`pnpm --filter @helix/ingestion-service dev`).

## Endpoints

Every body carries either an inline `connection`
(`{ type: "POSTGRESQL"|"CSV", config, credentials?, filePath? }`) or
`dataSourceId` + `organizationId`, which is resolved through apps/api's
`GET /api/v1/internal/data-sources/:id/connection` with the
`x-helix-internal-token` header.

| Endpoint | Extra body fields | Response |
|---|---|---|
| `POST /connect` | | always 200: `{ ok: true, schemas: [{ tableName, columns: [{ name, type, nullable, semanticType }], rowCountEstimate }] }` or `{ ok: false, error }` |
| `POST /preview` | `table`, `limit?` (50, max 500) | `{ columns, rows }` |
| `POST /profile` | `table`, `sampleSize?` (10000) | `{ table, rowCount, columns: [{ name, type, nullRate, distinctCount, semanticType }] }` |
| `POST /extract` | `table`, `columns?`, `limit?` (200000, max 1000000) | `{ columns, rows }` (JSON-safe: ISO datetimes, Decimal as float, NaN as null) |

Failures in `/preview`, `/profile` and `/extract` (unknown table/column, bad
credentials, unreachable host, malformed CSV) are 422 `{ detail }` with a
readable message. Request validation errors are also 422 with a string
`detail` (input values are never echoed, they may hold a password).

`semanticType` is one of `datetime`, `currency`, `numeric`, `identifier`,
`categorical`, `boolean`, `email`, `text` (`app/profiling.py`: SQL type,
column-name hints, datetime parse rate, 2-decimal floats, uniqueness,
cardinality, email pattern).

## Adapters

- **PostgresAdapter** (`app/adapters/postgres.py`): SQLAlchemy + psycopg2,
  one schema (`config.schema`, default `public`). Discovery via
  `information_schema`; row counts from `pg_class.reltuples`, with an exact
  `count(*)` for tables under 100k estimated rows, never-analyzed tables and
  views. Table and column names are checked against discovery and quoted;
  statements run under a 15s timeout (extract is exempt).
- **CsvAdapter** (`app/adapters/csv.py`): pandas; one table named after the
  sanitized stem of `config.originalName`. Handles UTF-8/BOM, cp1252 and
  latin-1, sniffs `, ; tab |`, rejects empty, binary and malformed files.

All blocking work runs in `asyncio.to_thread`.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `HELIX_INTERNAL_TOKEN` (or `INGESTION_SERVICE_INTERNAL_TOKEN`) | `dev-internal-token` | Sent to apps/api's internal endpoint |
| `HELIX_API_URL` (or `INGESTION_SERVICE_API_URL`) | `http://localhost:4000` | apps/api base URL |
| `INGESTION_SERVICE_CSV_ROOT` | unset | If set, CSV `filePath`s must resolve inside it |
| `INGESTION_SERVICE_CONNECT_TIMEOUT_SECONDS` | `5` | Postgres connect timeout |
| `INGESTION_SERVICE_STATEMENT_TIMEOUT_MS` | `15000` | Discovery/preview/profile statement timeout |

## Tests

`pnpm --filter @helix/ingestion-service test`. The Postgres tests create and
drop a throwaway schema in the local `helix_test` database (override with
`HELIX_TEST_PG_*`); they skip if it is unreachable. The wrong-password test
skips when the local server uses `trust` auth (passwords are not checked);
the unknown-role and error-translation tests still cover that path.
