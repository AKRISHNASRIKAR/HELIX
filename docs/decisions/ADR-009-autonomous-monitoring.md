# ADR-009: Autonomous monitoring (Phase 9)

## Status
Accepted

## Context
Phase 9 lets HELIX open an investigation without anyone asking, when a
tracked metric shows a serious anomaly. That needs a scheduler, a rule for
which anomalies count, protection against opening the same investigation
over and over, and a way to tell people.

## Decision
**Monitors live in the API.** A `Monitor` row describes one daily metric
(data source, table, time column, value column, aggregation, optional filter),
a minimum severity (default HIGH), a lookback (default 7 days) and a cooldown
(default 24 hours). `GET /monitors/suggestions` proposes revenue, orders,
refunds and active customers for each connected CSV or Postgres table, using
the same column heuristics as the Analytics Agent.

**One cycle per interval, inside the API process.** `MonitoringService` runs
every enabled monitor every `HELIX_MONITOR_INTERVAL_MS` (default 15 minutes,
0 disables it) with `setInterval`. Cycles never overlap and never throw. It is
off under tests and in demo mode. Monitors can also be run on demand
(`POST /monitors/:id/run`, `POST /monitors/run`).

**Which anomaly counts.** The API calls the analytics engine's
`/anomalies/detect` for the monitor's series and keeps anomalies within
`lookbackDays` of the series' **last day** (not today, so historical datasets
behave like live ones) at or above the minimum severity. The most severe, then
most recent, wins.

**Open at most one investigation per anomaly.**
- `dedupeKey = <monitorId>:<day>:<direction>` is a unique column on
  `Investigation`, so the database itself prevents duplicates.
- A Redis `SET NX` lock with the monitor's cooldown stops concurrent cycles
  from racing; if Redis is down the unique key still holds.
- At most `HELIX_MONITOR_MAX_PER_DAY` (default 5) autonomous investigations per
  organization per 24 hours; over the cap the run reports `rate_limited` and
  takes no lock, so the anomaly is picked up later.

**Autonomous investigations run the same pipeline.** They are
`ANOMALY_DETECTED` investigations with no creator, a generated question
("Investigate the 39.8% drop in Daily revenue detected on Thursday
2026-10-08") and a `triggerContext` describing the anomaly, which the context
engine uses as the focus. Every organization member is notified when one is
opened and when it finishes.

**Investigate, never act.** HELIX recommends; it does not roll back deploys
or change anything.

## Consequences
- Runs are still in process with no durable queue (chosen to keep local
  development light). If the API restarts mid-run the investigation stays in a
  non-terminal status, and monitors only run while the API is up. A durable
  queue (BullMQ on Redis) is the upgrade path, and it becomes necessary before
  running more than one API instance.
- Monitoring is per organization; there is no cross-organization correlation.
- Every run records `lastRunAt`, `lastStatus` and `lastMessage` on the
  monitor, so the Monitoring page explains what happened.

## Alternatives considered
- **A separate scheduler service.** Rejected for now: one more process to run
  locally for a loop that needs the API's database access anyway.
- **Event-driven triggers on ingestion syncs.** Deferred: CSV uploads do not
  change after upload, so a schedule is enough today.
