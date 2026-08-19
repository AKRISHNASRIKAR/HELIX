# Phase 10: Explainability + Replay

**Status:** Not started
**Depends on:** [Phase 9](./phase-09-autonomous-investigations.md) — needs a
meaningful body of real investigations (user-triggered and autonomous) to
replay; building replay UI against Phase 5's single-agent investigations
would under-exercise it.

## Goal

Surface the reasoning chain every prior phase has been persisting but never
displaying — `InvestigationStep`, `AgentTask`, `AgentMessage`,
`ContextSnapshot`, `InvestigationEvent`, `Evidence`, `Finding` — so a user
can open any investigation and see exactly how HELIX reached its
conclusion, matching the worked example in the project brief (section 14).
This also finally implements diagnostic analytics that needed multiple
agents' evidence to be worth building.

## What ships

- **`analytics/root-cause`'s first real code** — combines correlation and
  anomaly signals *across* agents' findings (e.g. "checkout deployment
  timing correlates with the payment latency spike, which correlates with
  the refund increase") into a candidate root cause with a computed
  confidence score, replacing the simpler single-agent heuristic Phase 5
  used for `rootCauseFindingId`.
- **`analytics/correlation` and `analytics/segmentation`'s first real code**
  — the correlation/dependency analysis and segment-comparison functions
  `analytics/root-cause` (and agents directly) call into.
- **Investigation Replay UI** — the full timeline view described in the
  project brief: question → trigger → each agent's findings in order →
  root cause → recommendation, reconstructed from `InvestigationEvent` +
  `AgentTask` + `AgentMessage` rows, not from a re-run.
- **Evidence graph** — a visual (ECharts-based, per the frontend's chosen
  library) view connecting findings to the specific evidence and
  computation that produced them — the UI expression of the confidence/
  evidence rule from `docs/decisions/ADR-005-structured-analytics.md`.
- **Agent trace and context trace views** — for a given `AgentTask`, show
  exactly what `ContextSnapshot` it received and what `AgentMessage`s it
  exchanged — the debugging/auditing tool this schema was built for since
  Phase 0.
- **Recommendation UI** — render `Recommendation` rows with priority and
  expected impact against the findings that justify them.
- **First real evaluation run** — with replay data available, run the
  evaluation approach from `docs/research/evaluation.md` (accuracy against
  seeded scenarios, hallucination rate via evidence-traceability checks,
  latency/cost) for the first time end-to-end.

## What we're deliberately not doing yet

- **No editing/annotating past investigations** — replay is read-only;
  human feedback loops (e.g. "this root cause was wrong") are future work,
  not required to prove explainability.
- **No cross-investigation trend view** ("show me all investigations about
  checkout") — this phase is about one investigation's internal reasoning,
  not a meta-analytics layer over investigations themselves.

## Where the work lands

| What | Where |
|---|---|
| Root cause / correlation / segmentation | `analytics/root-cause/`, `analytics/correlation/`, `analytics/segmentation/` (first real code — currently READMEs) |
| Replay UI | `apps/web/app/investigations/[id]/` (extend — from Phase 5, now with a full timeline) |
| Evidence graph, agent/context trace views | `apps/web/app/investigations/[id]/` (extend), likely new components in `packages/ui` |
| Evaluation run | `tests/fixtures/` (finally populated), a results write-up under `docs/research/evaluation.md` |

## Definition of done

- Opening any completed investigation in `apps/web` shows the full
  question → evidence → findings → root cause → recommendation chain, with
  every claim traceable to a specific agent, computation, and timestamp —
  the concrete fulfillment of "never a black box" (project brief, section
  15).
- The Phase 3 evaluation dataset's known scenarios are run through the full
  pipeline and scored against the metrics in `docs/research/evaluation.md`,
  with results recorded (not just a plan to record them).

## What's next

The original ten-phase plan ends here. Candidates for what comes after are
tracked in `docs/research/future-work.md` (a formal A2A protocol, a learned
root-cause model, cross-investigation memory, human feedback loops on past
investigations) — pull the next piece of work from there once Phase 10 is
solid, rather than starting new work without updating this roadmap first.
