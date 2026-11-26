# ingestion-service

Connects to external data (Postgres, CSV, MCP servers and GitHub), discovers schema, previews,
profiles and extracts rows, behind the `DataSourceAdapter` interface
(`app/adapters/base.py`) so agents and the ingestion pipeline never hard-code
a specific source type (project brief, section 11).

Port 8004 (`pnpm --filter @helix/ingestion-service dev`).

## Endpoints

Every body carries either an inline `connection`
(`{ type: "POSTGRESQL"|"CSV"|"MCP"|"GITHUB", config, credentials?, filePath? }`) or
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

- **McpAdapter** (`app/adapters/mcp.py`): the official `mcp` client SDK over
  streamable HTTP. Config `{ serverUrl, transport: "streamable_http", toolPrefixes?: ["list_", "get_"] }`,
  credentials `{ token? }` (sent as `Authorization: Bearer`). Every tool whose
  name starts with a prefix and that has no required arguments becomes a
  table named after the tool minus the prefix (`list_deployments` ->
  `deployments`). Rows come from calling the tool with no arguments
  (`structuredContent`, including FastMCP's `{ result: [...] }`, or JSON text
  content); nested values are JSON strings. Each operation opens one short
  session (`anyio.run` in the worker thread) under `INGESTION_SERVICE_MCP_TIMEOUT_SECONDS`.
- **GithubAdapter** (`app/adapters/github.py`): REST API via sync httpx.
  Config `{ owner, repo, apiUrl? }` (default `https://api.github.com`),
  credentials `{ token? }`. Tables `deployments` (100 most recent, `status` =
  latest deployment status), `releases` and `commits` (300 most recent).
  Column names match the MCP deployments feed where they mean the same thing
  (`service` = repo name, `version` = ref or tag, `deployed_at`, `author`,
  `description`, `status`, `commit_sha`). Empty tables keep their columns.

MCP and GitHub share `RowSourceAdapter` (`app/adapters/rows.py`): rows are
fetched once per request, held as a DataFrame and profiled exactly like a CSV
(capped at `INGESTION_SERVICE_API_SOURCE_MAX_ROWS`). Their errors (bad token,
unreachable host, 404, rate limit, tool error, non-JSON output) are readable
and never contain the token.

Against the demo server (`services/mcp-demo`) discovery returns one table,
`deployments`, 40 rows: `id` identifier, `service` categorical, `version`
identifier, `environment` categorical, `deployed_at` datetime (type
`timestamp`), `author` categorical, `description` text, `status` categorical,
`commit_sha` identifier.

All blocking work runs in `asyncio.to_thread`.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `HELIX_INTERNAL_TOKEN` (or `INGESTION_SERVICE_INTERNAL_TOKEN`) | `dev-internal-token` | Sent to apps/api's internal endpoint |
| `HELIX_API_URL` (or `INGESTION_SERVICE_API_URL`) | `http://localhost:4000` | apps/api base URL |
| `INGESTION_SERVICE_CSV_ROOT` | unset | If set, CSV `filePath`s must resolve inside it |
| `INGESTION_SERVICE_CONNECT_TIMEOUT_SECONDS` | `5` | Postgres connect timeout |
| `INGESTION_SERVICE_STATEMENT_TIMEOUT_MS` | `15000` | Discovery/preview/profile statement timeout |
| `INGESTION_SERVICE_MCP_TIMEOUT_SECONDS` | `20` | Whole-operation timeout for one MCP session |
| `INGESTION_SERVICE_GITHUB_TIMEOUT_SECONDS` | `15` | Per-request GitHub timeout |
| `INGESTION_SERVICE_API_SOURCE_MAX_ROWS` | `100000` | Row cap per MCP/GitHub table |

## Tests

`pnpm --filter @helix/ingestion-service test`. The Postgres tests create and
drop a throwaway schema in the local `helix_test` database (override with
`HELIX_TEST_PG_*`); they skip if it is unreachable. The wrong-password test
skips when the local server uses `trust` auth (passwords are not checked);
the unknown-role and error-translation tests still cover that path.

The MCP tests load `services/mcp-demo`'s ASGI app in-process (as
`mcp_demo_app`) and serve it with uvicorn in a thread on an ephemeral port,
stopped after the module. The GitHub tests use `httpx.MockTransport`; no test
touches the network.
