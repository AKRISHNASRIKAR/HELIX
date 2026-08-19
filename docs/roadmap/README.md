# HELIX Roadmap

Phase-by-phase build plan, kept next to the architecture docs (`docs/architecture/`)
and decisions (`docs/decisions/`) rather than buried in one giant backlog. Each
phase file answers the same four questions:

- **What ships** — the concrete features/endpoints/tables added.
- **What we're deliberately not doing yet** — so scope doesn't creep; see
  `docs/decisions/ADR-003-agent-architecture.md` and the project brief's
  repeated instruction not to build everything at once.
- **Where the work lands** — which existing directories it fills in (every
  phase builds into structure that already exists from Phase 0 — nothing
  needs a new top-level folder).
- **What's next** — the phase this unlocks.

This mirrors the ten-phase plan from the original project brief (section 18),
adapted to reference the actual repository as it exists today.

## Status

| Phase | Name | Status | Doc |
|---|---|---|---|
| 0 | Architecture & Foundations | ✅ Complete | [phase-00-foundation.md](./phase-00-foundation.md) |
| 1 | Core Platform | 🔜 Next up | [phase-01-core-platform.md](./phase-01-core-platform.md) |
| 2 | Data Ingestion | Not started | [phase-02-data-ingestion.md](./phase-02-data-ingestion.md) |
| 3 | Analytics Engine | Not started | [phase-03-analytics-engine.md](./phase-03-analytics-engine.md) |
| 4 | First AI Agent (Analytics) | Not started | [phase-04-first-agent.md](./phase-04-first-agent.md) |
| 5 | Coordinator Agent | Not started | [phase-05-coordinator-agent.md](./phase-05-coordinator-agent.md) |
| 6 | Context Engine | Not started | [phase-06-context-engine.md](./phase-06-context-engine.md) |
| 7 | Multiple Agents + A2A | Not started | [phase-07-multi-agent-a2a.md](./phase-07-multi-agent-a2a.md) |
| 8 | MCP Integrations | Not started | [phase-08-mcp.md](./phase-08-mcp.md) |
| 9 | Autonomous Investigations | Not started | [phase-09-autonomous-investigations.md](./phase-09-autonomous-investigations.md) |
| 10 | Explainability + Replay | Not started | [phase-10-explainability-replay.md](./phase-10-explainability-replay.md) |

Update the status column (and each phase file's own status line) as work lands
— this table should always match reality, not the original plan.

## How to use this when picking up work

1. Read the phase whose status is "Next up" — it lists exactly what to build
   and, just as importantly, what *not* to build yet.
2. Check its "Depends on" section against the phases already marked complete.
3. When the phase is done, flip its status here and in the phase file, update
   the root `README.md`'s "What has been implemented" / "Recommended next
   phase" sections to match, and add an ADR under `docs/decisions/` for any
   non-trivial choice made along the way.
4. Move the status marker to the next phase.

## Why phases are ordered this way

Each phase is a real dependency of the next, not an arbitrary checklist:

- **Phase 1** (Core Platform) has to exist before there's anything real to
  investigate — auth, orgs, and data source records.
- **Phase 2** (Ingestion) has to exist before **Phase 3** (Analytics) has any
  real data to compute over.
- **Phase 3** has to exist before **Phase 4** (the Analytics Agent) has a
  real tool to call — see `docs/decisions/ADR-005-structured-analytics.md`.
- **Phase 4** proves the single-agent path before **Phase 5** (Coordinator)
  adds delegation — and before **Phase 6** (Context Engine) is worth building,
  since context assembly only matters once there's more than one consumer.
- **Phase 7** (multi-agent + A2A) only makes sense once the Coordinator
  (Phase 5) exists to delegate to more than one agent.
- **Phase 8** (MCP) is additive — new `DataSourceAdapter` implementations —
  and deliberately deferred until Postgres/CSV (Phase 2) prove the
  abstraction out.
- **Phase 9** (autonomous investigations) requires the full user-triggered
  path (Phases 1–8) to be trustworthy first — an autonomous system that
  investigates confidently and wrongly is worse than no autonomy.
- **Phase 10** (explainability + replay) is last because it surfaces the
  reasoning trail every prior phase has been persisting (`AgentTask`,
  `AgentMessage`, `ContextSnapshot`, `InvestigationEvent`) — there's nothing
  to replay until Phases 4–9 have produced real investigations.
