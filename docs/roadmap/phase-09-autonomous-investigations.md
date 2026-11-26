# Phase 9: Autonomous Investigations

**Status:** ✅ Complete
**Depends on:** [Phase 8](./phase-08-mcp.md) — and, more importantly, on
every prior phase's user-triggered path being demonstrably reliable.
Autonomy is deliberately the second-to-last phase: an autonomous system that
investigates the wrong thing confidently is worse than no autonomy (see
`docs/research/future-work.md`).

## Goal

Add the second investigation trigger the project brief describes —
`InvestigationTriggerType.ANOMALY_DETECTED` — so HELIX can open an
investigation without a user asking first, closing the loop described in
section 16 of the original brief:

```
Event → Anomaly Detection → Investigation Created → Coordinator → Agents →
Analytics → Evidence → Root Cause → Recommendation → Alert
```

## What ships

- **Background anomaly monitoring** — a scheduled job (or event-driven
  trigger off ingestion syncs) runs `services/analytics-engine`'s anomaly
  detection (Phase 3) against tracked metrics on a cadence, independent of
  any user request.
- **Auto-created investigations** — a detected anomaly above a configurable
  severity threshold creates an `Investigation` with
  `triggerType = ANOMALY_DETECTED` and a system-generated `question` (e.g.
  "Investigate the 24% refund increase detected at 03:00 UTC"), then runs
  the exact same Coordinator → agents → findings pipeline as a user-triggered
  investigation — no separate code path for autonomous vs. manual execution.
- **Deduplication** — the same underlying anomaly shouldn't spawn a new
  investigation every monitoring cycle; track "already investigating this
  anomaly" state (Redis, given its short-lived-state role — see
  `docs/architecture/data-flow.md`).
- **Alerts/notifications** — when an autonomous investigation completes, the
  Phase 1 notification system (previously barely exercised) gets its first
  real use: notify relevant org members that HELIX found something.
- **Rate limiting / noise control** — a threshold and cooldown so autonomous
  monitoring doesn't flood the system with low-confidence investigations;
  this is as much a product decision as an engineering one and should be
  configurable per organization.

## What we're deliberately not doing yet

- **No autonomous *action*** — HELIX investigates and recommends, it does
  not execute the recommendation (e.g. it does not auto-rollback a
  deployment). The project brief's "eventually autonomous actions" framing
  is explicitly out of scope until investigations have a track record.
- **No cross-organization anomaly correlation** — monitoring and
  investigation stay scoped per organization, consistent with the isolation
  model established in Phase 1.

## Where the work lands

| What | Where |
|---|---|
| Anomaly monitoring job | `services/analytics-engine/app/` (extend) or a new lightweight scheduler — decide based on how the monitoring cadence is actually implemented (cron, queue-based) |
| Auto investigation creation | `apps/api/src/investigations/` (extend) |
| Deduplication state | Redis, via `apps/api/src/redis/` (existing `RedisService`) |
| Notifications | `apps/api/src/notifications/` (from Phase 1 — finally exercised) |

## Definition of done

- A seeded anomaly (from the Phase 3 evaluation dataset) is detected by the
  background job, an investigation is auto-created and completes with a
  correct root cause, and a notification is generated — with zero user
  interaction.
- Running the same seeded anomaly through two consecutive monitoring cycles
  produces exactly one investigation, not two.

## What's next

[Phase 10: Explainability + Replay](./phase-10-explainability-replay.md) —
now that both user-triggered and autonomous investigations exist and
produce real reasoning chains, surface that reasoning to users.

## Implementation notes

- Monitoring lives in the API (`apps/api/src/monitors/`), not the analytics
  engine. A `Monitor` row names a data source table, time column, value
  column, aggregation and filter. The background loop is a `setInterval`
  every `HELIX_MONITOR_INTERVAL_MS` (default 15 minutes, 0 disables) that
  never overlaps or throws. `POST /monitors/:id/run` and `POST /monitors/run`
  run monitors on demand.
- Each cycle calls the engine's `/anomalies/detect` and only considers
  anomalies within `lookbackDays` of the series' last day (not the wall
  clock), at or above `minSeverity`.
- Dedupe is two layers: a unique `Investigation.dedupeKey`
  (`monitorId:date:direction`) and a Redis `SET NX EX` lock for the cooldown.
  `HELIX_MONITOR_MAX_PER_DAY` caps autonomous investigations per
  organization. Schema changes are in migration
  `20261126000000_autonomous_monitoring` (`Monitor`, `Investigation.monitorId`,
  `triggerContext`, `dedupeKey`).
- Autonomous investigations have no creator, so every org member is notified
  when one opens and when it finishes. The web app has `/monitoring`
  (monitors, suggestions, recent anomalies, autonomous investigations) and
  `/notifications`.
- Deviation from the plan: runs are still in-process in the API with no
  durable queue (a deliberate choice for now). An API restart mid-run leaves
  that investigation in a non-terminal status. See
  [ADR-009](../decisions/ADR-009-autonomous-monitoring.md).
- Verified: a monitor on daily revenue opens one ANOMALY_DETECTED
  investigation for 2026-10-08 ("Investigate the 39.8% drop in Daily revenue
  detected on Thursday 2026-10-08"), a second run is deduplicated, and the
  investigation finds the same root cause as the user-triggered question.
