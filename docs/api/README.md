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
| POST | `/data-sources` | `{ name, type: "POSTGRESQL", config: { host, port = 5432, database, schema?, sslmode? }, credentials: { user, password } }`. Credentials are stored AES-256-GCM encrypted; the API then calls the ingestion service `/connect`. Always 201 with the detail: `CONNECTED` (schemas stored, `lastSyncedAt` set) or `ERROR` (`statusMessage` says why, e.g. bad password or ingestion service unreachable). |
| POST | `/data-sources/upload` | multipart: `file` (.csv, max 50MB), `name?` (defaults to the file name). Stored as `<HELIX_UPLOAD_DIR>/<uuid>.csv`; `config = { fileId, originalName }`. Same connect flow and response. 400 for a missing or non-.csv file, 413 if too large. |
| GET | `/data-sources/:id` | Detail. |
| PATCH | `/data-sources/:id` | `{ name?, config?, credentials? }`. `config` is merged into the existing config. Changing `config`/`credentials` reconnects (POSTGRESQL only; 400 for CSV). Returns detail. |
| POST | `/data-sources/:id/sync` | 200 detail after re-running discovery. |
| GET | `/data-sources/:id/preview?table=&limit=` | Proxied to ingestion `/preview` (`limit` 1-500). Ingestion 4xx -> 422, unreachable/5xx -> 502. |
| GET | `/data-sources/:id/profile?table=` | Proxied to ingestion `/profile`; same error mapping. |
| DELETE | `/data-sources/:id` | 204; also deletes the uploaded CSV. |

### Investigations (tenant-scoped)

Investigation (list item and base of the detail) is the `packages/contracts` `Investigation` shape:
`{ id, organizationId, projectId, createdByUserId, triggerType, question, status, plan, rootCauseFindingId, summary, overallConfidence, startedAt, completedAt, createdAt, updatedAt }`.

| Method | Path | Notes |
|---|---|---|
| GET | `/investigations?projectId=&status=` | Newest first, max 200. Both filters optional. |
| POST | `/investigations` | `{ projectId, question (3-2000 chars) }` -> 201 PENDING investigation (`triggerType: USER_QUESTION`, `createdByUserId` = caller). 404 if the project is not in the org. The runner starts asynchronously (see below). |
| GET | `/investigations/:id` | Investigation + `steps`, `tasks`, `findings`, `recommendations`, `events` (shapes below). |
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

#### Runner

After `POST /investigations` the API (not the request) loads the org's CONNECTED data sources with
their schemas and calls agent-runtime `POST /investigations/run` (120s timeout). The returned
InvestigationRunResult is validated, then persisted in one transaction (steps, tasks, metrics,
anomalies, evidence, findings + links, recommendations + links, and the investigation's
status/plan/summary/overallConfidence/rootCauseFindingId/startedAt/completedAt). References to
unknown ids (e.g. evidence for a task that was not returned, a data source from another org) are
dropped rather than failing the run. If the user cancelled meanwhile, the trail is stored but the
status stays CANCELLED and no notification is sent.

Events written by the API: `investigation.created`, `investigation.completed` (COMPLETED or
PARTIALLY_COMPLETED), `investigation.failed`, `investigation.cancelled`. Progress events come from
the Coordinator through internal endpoint A2. The creator gets a notification titled
"Investigation completed", "Investigation partially completed" or "Investigation failed", with
`link: /investigations/<id>`.

If the agent runtime is unreachable, errors, or returns an invalid result, the investigation ends
FAILED with a `summary` explaining why. The API never crashes on a run.

### Agents, dashboard, notifications

| Method | Path | Notes |
|---|---|---|
| GET | `/agents` | Tenant-scoped. `[{ type, name, description, version, status, tasks, successRate, avgMs, capabilities }]`. Agents come from agent-runtime `GET /agents`; `tasks`/`successRate`/`avgMs` are this org's AgentTask stats (`successRate` = SUCCEEDED / finished, `successRate` and `avgMs` are `null` until a task has finished). If the runtime is down: COORDINATOR and ANALYTICS with status UNAVAILABLE. |
| GET | `/dashboard/summary` | Tenant-scoped. `{ activeInvestigations, totalInvestigations, dataSources, connectedDataSources, projects, unreadNotifications }`. Active = PENDING/PLANNING/IN_PROGRESS/AWAITING_EVIDENCE. Unread counts this org's plus org-less notifications. |
| GET | `/notifications?unread=true` | Current user's, newest first (max 100): `[{ id, userId, organizationId, type, title, body, link, readAt, createdAt }]` |
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

The API reads `apps/api/.env` and then the repo-root `.env`; real environment variables win over both.
