# Phase 9: Autonomous Investigations

**Status:** Not started
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
