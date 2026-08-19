# Problem Statement

## The gap

Traditional BI and analytics dashboards answer "what happened" — a chart of
revenue over time, a KPI that moved. They rarely answer "why," almost never
show the evidence behind an explanation, and never act autonomously. When
something goes wrong (revenue drops, refunds spike, churn increases), a human
analyst still has to manually pull threads across systems — the database, the
support desk, the deployment log — to find the cause. This is slow, requires
specific institutional knowledge of where evidence lives, and the reasoning
behind the eventual conclusion is rarely written down anywhere reviewable.

Meanwhile, most "AI over your data" products stop at a chatbot: a single LLM
call over some retrieved context, producing a fluent but frequently
unverifiable answer, with no distinction between "the model computed this"
and "the model guessed this."

## What HELIX investigates

HELIX targets the second half of that gap: given a question or an
automatically detected anomaly, assemble evidence from multiple domains
(finance, product, customer, operations), compute real statistics rather than
estimate them, identify a most-likely root cause with a stated confidence,
and propose a recommendation — with every step traceable back to its source.

## Why this is a systems problem, not a prompting problem

A single well-crafted prompt cannot solve this because the underlying
requirements are architectural:

- Numbers must be computed, not guessed (see ADR-005).
- Evidence must be attributable to a specific agent, source, and computation
  (project brief, section 15).
- An investigation must be reproducible after the fact (project brief,
  section 14) — which requires persisting the full reasoning chain, not just
  the final answer.
- Different domains need different, bounded context — not the entire
  enterprise dataset stuffed into one prompt (project brief, section 12).

These are the reasons HELIX is built as a multi-service, multi-agent system
with explicit contracts (`packages/contracts`) rather than one large LLM
application — see `docs/architecture/system-overview.md`.

## Scope of this project (final-year project)

Given the size of the full vision (autonomous monitoring, formal A2A/MCP
protocol adoption, a trained root-cause model, etc.), this project is scoped
to prove the architecture end-to-end on a narrow slice — a single-agent,
user-triggered investigation with real computed evidence — before expanding
breadth (more agents, autonomous triggers, more data source types). See the
phase plan in the original project brief, section 18, and
`docs/research/future-work.md`.
