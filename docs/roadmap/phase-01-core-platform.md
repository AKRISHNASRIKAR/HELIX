# Phase 1: Core Platform

**Status:** ✅ Complete
**Depends on:** [Phase 0](./phase-00-foundation.md) — needs the Prisma schema,
`apps/api` skeleton, and health-check plumbing already in place.

## Goal

Turn `apps/api` into an actually usable multi-tenant platform — auth, orgs,
projects, data source *records* (not yet connections), and real investigation
CRUD — with zero AI involved. This is the platform every later phase (agents,
analytics, autonomy) gets layered onto.

## What ships

- **Auth** — email/password signup + login, JWT access tokens (short-lived)
  issued via `@nestjs/jwt` + Passport, password hashing with argon2. A
  `JwtAuthGuard` protecting every route except `/health` and auth endpoints
  themselves.
- **Users & organizations** — `POST /organizations` (creates the org and an
  `OWNER` `OrganizationMember` row for the creator), invite/add member
  endpoints, role-based checks (`OrganizationRole`: OWNER/ADMIN/MEMBER/VIEWER)
  via a reusable `OrgRolesGuard`.
- **Organization isolation** — every tenant-scoped query filters by
  `organizationId` derived from the authenticated request, never from a
  client-supplied field. This is the concrete implementation of the isolation
  strategy described in `docs/decisions/ADR-002-database.md`.
- **Projects** — CRUD scoped to an organization.
- **Data sources (records only)** — `POST/GET/PATCH/DELETE
  /data-sources` writing `DataSource` rows with `status = PENDING`. No actual
  connection attempt yet — that's [Phase 2](./phase-02-data-ingestion.md).
  Credentials, when added, are never stored in `connectionConfig` (see
  `docs/architecture/data-flow.md`) — this phase should at minimum stub the
  secret-manager interface it'll call into.
- **Investigations (record-only)** — replace today's read-only
  `GET /investigations` with real `POST /investigations` (creates a `PENDING`
  investigation with a `question`, no plan yet), `GET /investigations/:id`,
  and a `PATCH` for cancelling. No agent runs yet — `status` only ever moves
  PENDING → CANCELLED by hand until Phase 5 exists.
- **Notifications** — a minimal in-app notification table/endpoint (e.g. "an
  investigation you created finished") is scoped in but only trivially
  exercised until Phase 5 gives investigations something to notify about.
- **Audit records** — every mutating endpoint writes an `AuditLog` row
  (`action`, `resourceType`, `resourceId`, `userId`, `organizationId`).
- **Dashboard wired to real data** — `apps/web`'s dashboard
  (`apps/web/app/page.tsx`) currently shows static `—` placeholders for
  Active Investigations / Data Sources; this phase replaces those with real
  counts fetched from the endpoints above. Requires a minimal login flow in
  `apps/web` too.
- **API contract docs** — `@nestjs/swagger` decorators on the new
  controllers, exported into `docs/api/` (currently a placeholder).

## What we're deliberately not doing yet

- No actual data source *connection* (schema discovery, preview) — Phase 2.
- No investigation *execution* — no plan, no agents, no evidence. An
  investigation created in this phase just sits at `PENDING`.
- No password reset / SSO / OAuth — plain email+password is enough to prove
  the auth boundary works; revisit if the project needs it.
- No fine-grained per-resource permissions beyond org role — a `VIEWER`
  can't mutate anything, full stop, rather than modeling resource-level ACLs.

## Where the work lands

| What | Where |
|---|---|
| Auth module, guards | `apps/api/src/auth/` (new) |
| Users, orgs, members | `apps/api/src/organizations/`, `apps/api/src/users/` (new) |
| Projects | `apps/api/src/projects/` (new) |
| Data sources (CRUD only) | `apps/api/src/data-sources/` (new) |
| Investigations (real CRUD) | `apps/api/src/investigations/` (existing — extend) |
| Audit logging | `apps/api/src/audit/` (new), likely as a Nest interceptor |
| Swagger/OpenAPI | `apps/api/src/main.ts` (add `SwaggerModule`), output to `docs/api/` |
| Dashboard real data + login | `apps/web/app/` (existing — extend) |
| Schema | `packages/database/prisma/schema.prisma` — schema already covers this; only new migrations if fields are missing (e.g. a `passwordHash` reset token) |

## Definition of done

- A user can sign up, log in, create an organization, create a project,
  register a data source record, and create an investigation — all through
  real API calls, all tenant-isolated, all audited.
- `apps/web`'s dashboard shows real counts, not placeholders.
- Integration tests cover: org isolation (user A cannot see org B's data),
  role enforcement (a VIEWER's mutation attempt is rejected), and audit log
  rows being written on every mutation.

## What's next

[Phase 2: Data Ingestion](./phase-02-data-ingestion.md) — make the
`DataSource` records created here actually connect to something.
