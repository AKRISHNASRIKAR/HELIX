# API Documentation

The HELIX public API is served by `apps/api` (NestJS) under `/api/v1`.

- **Live docs:** Swagger UI at `http://localhost:4000/docs`, raw OpenAPI JSON at
  `http://localhost:4000/docs-json` (not served in `HELIX_DEMO=1` mode).
- **Checked-in spec:** [`openapi.json`](./openapi.json). Regenerate it after
  changing a controller with:

  ```bash
  pnpm --filter @helix/api openapi:export
  ```

  The export boots Nest in preview mode (route metadata only, no providers
  instantiated), so it needs neither Postgres nor Redis.

Internal service-to-service endpoints (`/api/v1/internal/*`) are deliberately
left out of the Swagger document; they are described below.

FastAPI services expose their own interactive docs at `/docs` on each service
port (agent-runtime 8001, analytics-engine 8002, ingestion-service 8004).

## Conventions

| Topic | Rule |
|---|---|
| Auth | `Authorization: Bearer <accessToken>` from `POST /auth/signup` or `POST /auth/login`. Every route needs it except `/health`, `/auth/signup`, `/auth/login` and `/internal/*`. |
| Tenant | Tenant-scoped routes need `X-Organization-Id: <uuid>`. Missing or malformed: 400. Not a member: 403. The organization is only ever taken from this validated header (or the `:id` path param on `/organizations/:id/members*`), never from a body or query field. |
| Roles | OWNER > ADMIN > MEMBER > VIEWER. Reads need VIEWER, mutations need MEMBER unless stated otherwise, so a VIEWER can never mutate (403). |
| Cross-tenant ids | A resource id from another organization behaves as if it does not exist (404). |
| Validation | Bodies and queries are validated with zod. Failures are `400 { statusCode, message: "Validation failed", issues: [{ path, message }] }`. |
| JSON | camelCase; timestamps are ISO-8601 UTC strings. |
| Audit | Every successful mutation writes an `audit_logs` row (`action`, `resourceType`, `resourceId`, `userId`, `organizationId`, `ipAddress`). Rejected requests are not audited. |

## Endpoints

### Auth and users

| Method | Path | Notes |
|---|---|---|
| POST | `/auth/signup` | `{ email, name, password (min 8) }` -> 201 `{ accessToken, user: { id, email, name } }`; 409 if the email is taken. Audit `user.signup`. |
| POST | `/auth/login` | `{ email, password }` -> 200, same shape; 401 on bad credentials. Audit `auth.login`. |
| GET | `/auth/me` | `{ user, memberships: [{ organizationId, organizationName, slug, role }] }` |

### Organizations and members

| Method | Path | Notes |
|---|---|---|
| POST | `/organizations` | `{ name, slug? }` -> 201 `{ id, name, slug, role: "OWNER", createdAt, updatedAt }`. Slug is derived from the name when omitted (a random suffix is added on collision); an explicit taken slug is 409. |
| GET | `/organizations` | `[{ id, name, slug, role }]` for the current user. |
| GET | `/organizations/:id/members` | Any member. `[{ userId, email, name, role, createdAt }]` |
| POST | `/organizations/:id/members` | ADMIN+. `{ email, role = MEMBER }` -> 201 member. 404 if no user has that email, 409 if already a member. |
| PATCH | `/organizations/:id/members/:userId` | ADMIN+. `{ role }` -> 200 member. |
| DELETE | `/organizations/:id/members/:userId` | ADMIN+. 204. |

Only an OWNER may grant or revoke OWNER (403). Demoting or removing the last OWNER is 400.

### Projects (tenant-scoped)

`GET /projects`, `POST /projects` `{ name, description? }` (201), `GET /projects/:id`,
`PATCH /projects/:id` `{ name?, description? }`, `DELETE /projects/:id` (204, cascades to investigations).
Shape: `{ id, name, description, createdAt, updatedAt }`.

### Data sources (tenant-scoped)

List item: `{ id, name, type, status, statusMessage, tables, lastSyncedAt, createdAt }`.
Detail: list item + `config` (non-secret connection config) + `schemas: [{ tableName, columns, rowCountEstimate, discoveredAt }]`. Credentials are never returned.

| Method | Path | Notes |
|---|---|---|
| GET | `/data-sources` | Newest first. |
| POST | `/data-sources` | Body by `type` (missing `type` = POSTGRESQL): `POSTGRESQL` `{ name, type, config: { host, port = 5432, database, schema?, sslmode? }, credentials: { user, password } }`; `MCP` `{ name, type, config: { serverUrl, transport = "streamable_http", toolPrefixes? }, credentials?: { token? } }`; `GITHUB` `{ name, type, config: { owner, repo, apiUrl? }, credentials: { token } }`. Credentials are stored AES-256-GCM encrypted (ADR-006); the API then calls the ingestion service `/connect`. Always 201 with the detail: `CONNECTED` (schemas stored, `lastSyncedAt` set) or `ERROR` (`statusMessage` says why, e.g. bad password or ingestion service unreachable). |
| POST | `/data-sources/upload` | multipart: `file` (.csv, max 50MB), `name?` (defaults to the file name). Stored as `<HELIX_UPLOAD_DIR>/<uuid>.csv`; `config = { fileId, originalName }`. Same connect flow and response. 400 for a missing or non-.csv file, 413 if too large. |
| GET | `/data-sources/:id` | Detail. |
| PATCH | `/data-sources/:id` | `{ name?, config?, credentials? }`. `config` is merged into the existing config and the result is validated for the source's type; `credentials` replace the stored ones and must be complete. Changing `config`/`credentials` reconnects (POSTGRESQL, MCP, GITHUB; 400 for CSV). Returns detail. |
| POST | `/data-sources/:id/sync` | 200 detail after re-running discovery. |
| GET | `/data-sources/:id/preview?table=&limit=` | Proxied to ingestion `/preview` (`limit` 1-500). Ingestion 4xx -> 422, unreachable/5xx -> 502. |
| GET | `/data-sources/:id/profile?table=` | Proxied to ingestion `/profile`; same error mapping. |
| DELETE | `/data-sources/:id` | 204; also deletes the uploaded CSV. |

### Investigations (tenant-scoped)

Investigation (list item and base of the detail) is the `packages/contracts` `Investigation` shape:
`{ id, organizationId, projectId, createdByUserId, triggerType, question, status, plan, rootCauseFindingId, summary, overallConfidence, startedAt, completedAt, createdAt, updatedAt }`
plus (Phase 9) `monitorId`, `triggerContext` and `dedupeKey`, which are set on monitor-opened
(`ANOMALY_DETECTED`) investigations and null otherwise.

| Method | Path | Notes |
|---|---|---|
| GET | `/investigations?projectId=&status=&triggerType=` | Newest first, max 200. All filters optional (`triggerType=ANOMALY_DETECTED` lists autonomous investigations). |
| POST | `/investigations` | `{ projectId, question (3-2000 chars) }` -> 201 PENDING investigation (`triggerType: USER_QUESTION`, `createdByUserId` = caller). 404 if the project is not in the org. The runner starts asynchronously (see below). |
| GET | `/investigations/:id` | Investigation + `monitor: { id, name } \| null`, `meta` (run metadata, `{}` before a run), `steps`, `tasks`, `findings`, `recommendations`, `events` (shapes below). |
| GET | `/investigations/:id/trace` | Phase 10 agent and context trace with the evidence graph (shape below). |
| PATCH | `/investigations/:id` | `{ status: "CANCELLED" }` -> 200 investigation. Only from PENDING/PLANNING/IN_PROGRESS/AWAITING_EVIDENCE, else 409. |

Detail extras:

```
steps:           [{ id, order, agentType, objective, dependsOn: number[], createdAt }]   (by order)
tasks:           [{ id, agentType, status, objective, error, startedAt, completedAt, investigationStepId }]
findings:        [{ id, agentType, analyticsType, statement, confidence, isRootCause,
                    evidence: string[] (summaries), evidenceItems: [{ id, sourceType, summary, confidence, data }] }]
                 (root cause first, then by confidence)
recommendations: [{ id, title, action (= title), description, priority, expectedImpact }]
events:          [{ id, type, payload, createdAt }]   (oldest first)
```

Trace (`GET /investigations/:id/trace`):

```
investigation:    { id, question, status, triggerType, triggerContext, summary, overallConfidence,
                    rootCauseFindingId, createdAt, startedAt, completedAt, monitor: { id, name } | null }
plan, meta
steps:            [{ id, order, agentType, objective, dependsOn }]
tasks:            [{ id, stepId, agentType, status, objective, error, startedAt, completedAt, durationMs,
                     contextSnapshotId, findingIds, evidenceIds, result }]
messages:         [{ id, type, agentTaskId, fromAgent, toAgent, payload, correlationId, createdAt }]
contextSnapshots: [{ id, agentTaskId, agentType, tokenCount, createdAt, assembledContext }]
events:           [{ id, type, payload, createdAt }]
evidence:         [{ id, agentTaskId, sourceType, source, summary, data, confidence, collectedAt }]
findings:         [{ id, agentType, analyticsType, statement, confidence, isRootCause, evidenceIds, agentTaskId }]
recommendations:  [{ id, title, description, priority, expectedImpact, findingIds }]
graph:            { nodes: [{ id, type, label, agentType?, confidence? }], edges: [{ from, to, kind }] }
```

A finding's `agentTaskId` is derived: the root cause finding belongs to the Coordinator synthesis
task; any other finding to the single task all its evidence came from (else null). Graph node
types: `question`, `step`, `task`, `evidence`, `finding`, `rootCause` (the root cause finding),
`recommendation`. Edges: question `plans` step, step `runs` task, task `collected` evidence,
evidence `supports` finding, finding `justifies` recommendation, and the synthesis task (else the
question) `selected` the root cause. Labels are capped at 140 characters; full text is in the lists.
`meta` comes from the latest `investigation.completed`/`investigation.failed` event.

#### Runner

After `POST /investigations` (or a monitor opening one) the API, not the request, loads the org's
CONNECTED data sources with their schemas and calls agent-runtime `POST /investigations/run`
(300s timeout, multi-agent runs) with `investigation.triggerContext` included. The returned
InvestigationRunResult is validated, then persisted in one transaction (steps, tasks, metrics,
anomalies, evidence, findings + links, recommendations + links, A2A `messages` as AgentMessage rows,
`contextSnapshots` as ContextSnapshot rows, and the investigation's
status/plan/summary/overallConfidence/rootCauseFindingId/startedAt/completedAt). `meta` is stored
in the `investigation.completed` (or `.failed`) event payload. References to unknown ids (e.g.
evidence for a task that was not returned, a message for an unknown task, a data source from
another org) are dropped or nulled rather than failing the run. If the user cancelled meanwhile,
the trail is stored but the status stays CANCELLED and no notification is sent.

Events written by the API: `investigation.created` (payload `{ question, trigger }` for monitor
runs), `investigation.completed` (COMPLETED or PARTIALLY_COMPLETED), `investigation.failed`,
`investigation.cancelled`. Progress events come from the Coordinator through internal endpoint A2.
The creator gets a notification titled "Investigation completed", "Investigation partially
completed" or "Investigation failed", with `link: /investigations/<id>`. Investigations without a
creator (monitor-opened) notify every org member instead, with types
`investigation.autonomous_opened`, `investigation.autonomous_completed` and
`investigation.autonomous_failed`.

If the agent runtime is unreachable, errors, or returns an invalid result, the investigation ends
FAILED with a `summary` explaining why. The API never crashes on a run.

### Monitors and anomalies (tenant-scoped, Phase 9)

Reads need VIEWER, create/update/run need MEMBER, delete needs ADMIN. Every mutation is audited
(`monitor.create`, `monitor.update`, `monitor.delete`, `monitor.run`, `monitor.run_all`); an opened
investigation also writes `monitor.investigation_opened` (no user).

Monitor: `{ id, projectId, dataSourceId, dataSource: { id, name }, name, metricKey, tableName,
timeColumn, valueColumn, aggregation, filter, unit, minSeverity, lookbackDays, cooldownHours, enabled,
lastRunAt, lastStatus, lastMessage, createdByUserId, createdAt, updatedAt, investigationsCount,
latestInvestigation: { id, status, createdAt } | null }`.

| Method | Path | Notes |
|---|---|---|
| GET | `/monitors` | Newest first. |
| GET | `/monitors/suggestions` | For every CONNECTED POSTGRESQL/CSV table with a datetime column: `Daily revenue` (sum of the currency column), `Daily orders` (count), `Daily refunds` (count where the status column is refunded/refund/returned), `Daily active customers` (count_distinct of the customer id). Same column heuristics as the Analytics planner. Already-monitored (dataSource, table, metricKey) triples are left out. `[{ name, metricKey, dataSourceId, dataSourceName, tableName, timeColumn, valueColumn, aggregation, filter, unit }]` |
| POST | `/monitors` | `{ name, projectId, dataSourceId, metricKey, tableName, timeColumn, valueColumn?, aggregation: sum\|mean\|count\|count_distinct, filter?: { column, op: eq\|neq\|in, value }, unit?, minSeverity = HIGH, lookbackDays = 7, cooldownHours = 24, enabled = true }` -> 201 monitor. 404 for a project/data source outside the org; 400 when the table or a column is not in the discovered schema, or `valueColumn` is missing for a non-count aggregation. |
| GET | `/monitors/:id` | One monitor. |
| PATCH | `/monitors/:id` | `{ name?, enabled?, minSeverity?, lookbackDays?, cooldownHours? }` -> 200 monitor. |
| DELETE | `/monitors/:id` | ADMIN+. 204; its investigations are kept (`monitorId` set to null). |
| POST | `/monitors/:id/run` | Runs the monitor now (even if disabled). 200 `{ monitorId, monitorName, status, message, investigationId?, anomaly? }`. |
| POST | `/monitors/run` | Runs every enabled monitor of the org now. 200 array of the same. |
| GET | `/anomalies?limit=50` | Recent Anomaly rows (1-200, newest first): `[{ id, description, severity, detectedAt, detectionMethod, value, expectedValue, deviationScore, metricId, metricName, unit, dataSource: { id, name } \| null, investigationId, createdAt }]`. `investigationId` is the investigation whose evidence references the anomaly (`data.anomalyId`), else null. |

Example run result:

```json
{
  "monitorId": "7d0c...",
  "monitorName": "Daily revenue",
  "status": "investigation_opened",
  "message": "Opened an investigation for the HIGH drop on 2026-10-08.",
  "investigationId": "c41e...",
  "anomaly": { "date": "2026-10-08", "timestamp": "2026-10-08T00:00:00+00:00", "direction": "drop",
               "severity": "HIGH", "value": 19950, "expectedValue": 33124, "deviationScore": -6.1,
               "detectionMethod": "seasonal", "description": "..." }
}
```

How a run works: the API posts `{ dataset: { dataSourceId, organizationId, table }, timeColumn,
valueColumn, aggregation, filter, method: "auto", metricName }` to analytics-engine
`/anomalies/detect`. It keeps anomalies whose day is within `lookbackDays` of the series' last day
(not today, so historical datasets work) and whose severity is at least `minSeverity`, and picks the
most severe, then the most recent. The dedupe key is `<monitorId>:<YYYY-MM-DD>:<direction>`. Status:

| status | when |
|---|---|
| `ok` | No eligible anomaly. |
| `deduped` | An investigation with that dedupe key already exists (its id is returned), or the Redis lock `helix:monitor:dedupe:<key>` (`SET NX EX cooldownHours*3600`) is held. |
| `rate_limited` | The org already has `HELIX_MONITOR_MAX_PER_DAY` ANOMALY_DETECTED investigations from the last 24h. No lock is taken, so the anomaly is picked up once under the cap. |
| `investigation_opened` | Created a PENDING `ANOMALY_DETECTED` investigation with no creator, `monitorId`, `dedupeKey`, `triggerContext { monitorId, metricKey, metricName, date, direction, severity, value, expectedValue, deviationScore, dataSourceId, table }` and a question like "Investigate the 39.8% drop in Daily revenue detected on Thursday 2026-10-08", notified every org member and started the runner. |
| `error` | Data source not CONNECTED or the analytics engine failed (message says why). |

The outcome is stored on the monitor (`lastRunAt`, `lastStatus`, `lastMessage`). If Redis is down
the run continues; the unique `dedupeKey` column still prevents duplicates.

Background loop: every `HELIX_MONITOR_INTERVAL_MS` the API runs all enabled monitors of all orgs,
one after another. Cycles never overlap and never throw. The loop is off when the interval is 0,
under `NODE_ENV=test` and in `HELIX_DEMO=1` mode.

### Agents, dashboard, notifications

| Method | Path | Notes |
|---|---|---|
| GET | `/agents` | Tenant-scoped. `[{ type, name, description, version, status, tasks, successRate, avgMs, capabilities, contextRequirements }]`. Agents come from agent-runtime `GET /agents` (`contextRequirements` passed through, null when absent); `tasks`/`successRate`/`avgMs` are this org's AgentTask stats (`successRate` = SUCCEEDED / finished, `successRate` and `avgMs` are `null` until a task has finished). If the runtime is down: COORDINATOR, ANALYTICS, FINANCE, CUSTOMER and PRODUCT with status UNAVAILABLE. |
| GET | `/dashboard/summary` | Tenant-scoped. `{ activeInvestigations, totalInvestigations, dataSources, connectedDataSources, projects, unreadNotifications }`. Active = PENDING/PLANNING/IN_PROGRESS/AWAITING_EVIDENCE. Unread counts this org's plus org-less notifications. |
| GET | `/notifications?unread=true` | Current user's, newest first (max 100): `[{ id, userId, organizationId, type, title, body, link, readAt, createdAt }]` |
| GET | `/notifications/unread-count` | `{ count }` of the current user's unread notifications (all orgs). |
| POST | `/notifications/:id/read` | 204 (idempotent; 404 if not the caller's). |
| POST | `/notifications/read-all` | 204. |

### Health

`GET /health` (no prefix, public): Postgres and Redis status via `@nestjs/terminus`.

## Internal endpoints (service-to-service)

Prefix `/api/v1/internal`. No JWT; requires header `x-helix-internal-token: $HELIX_INTERNAL_TOKEN` (401 otherwise).

| Method | Path | Notes |
|---|---|---|
| GET | `/internal/data-sources/:id/connection?organizationId=<uuid>` | `{ id, organizationId, type, config, credentials (decrypted, or null), filePath (absolute, CSV only, else null) }`. 404 if not found or the org does not match. |
| POST | `/internal/investigations/:id/progress` | `{ status?, event?: { type, payload?, at? } }` -> 204. Applies the status unless the investigation is already COMPLETED/PARTIALLY_COMPLETED/FAILED/CANCELLED; sets `startedAt` on the first move to IN_PROGRESS; appends the event (`createdAt = at` when given). Not written to the audit log (it is already the investigation's event trail). |

| GET | `/internal/organizations/:orgId/context?dataSourceIds=a,b&sinceDays=30&excludeInvestigationId=&limit=50` | History for the context engine: `{ metrics: [{ id, name, unit, value, baseline, changePercent, computedAt, dataSourceId }], anomalies: [{ id, description, severity, detectedAt, value, expectedValue, deviationScore, detectionMethod, dataSourceId }], findings: [{ id, investigationId, statement, confidence, isRootCause, agentType, createdAt }] }`. Rows created in the last `sinceDays` (1-365, default 30), newest first, each list capped at `limit` (1-200, default 50). `dataSourceIds` (comma-separated UUIDs) filters metrics and anomalies; findings come from the org's COMPLETED/PARTIALLY_COMPLETED investigations except `excludeInvestigationId`. |

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `JWT_SECRET` | `dev-only-change-me-please-32-chars-min` | HS256 signing key (min 32 chars). Default refused when `NODE_ENV=production`. |
| `JWT_EXPIRES_IN` | `12h` | Access token lifetime. |
| `HELIX_INTERNAL_TOKEN` | `dev-internal-token` | Shared secret for `/internal/*` and sent on outbound calls to Python services. |
| `HELIX_SECRETS_KEY` | dev key (base64, 32 bytes) | AES-256-GCM key for data source credentials. Default refused in production. |
| `HELIX_UPLOAD_DIR` | `.data/uploads` (resolved against the API's cwd) | Where CSV uploads are stored. |
| `INGESTION_SERVICE_URL` | `http://localhost:8004` | Ingestion service base URL. |
| `AGENT_RUNTIME_URL` | `http://localhost:8001` | Agent runtime base URL. |
| `ANALYTICS_ENGINE_URL` | `http://localhost:8002` | Analytics engine base URL (monitors call `/anomalies/detect`). |
| `HELIX_MONITOR_INTERVAL_MS` | `900000` | Background monitoring interval; `0` disables the loop. |
| `HELIX_MONITOR_MAX_PER_DAY` | `5` | Max monitor-opened investigations per org per 24h. |

The API reads `apps/api/.env` and then the repo-root `.env`; real environment variables win over both.
