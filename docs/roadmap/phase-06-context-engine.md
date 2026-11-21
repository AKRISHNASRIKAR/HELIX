# Phase 6: Context Engine

**Status:** 🔜 Next up
**Depends on:** [Phase 5](./phase-05-coordinator-agent.md) — context
assembly only matters once there's a real Coordinator/agent flow consuming
it; building it against a manual harness would risk designing it wrong.

## Goal

Replace the manual/trivial context assembly used in Phases 4–5 with the
real subsystem described in `docs/architecture/context-engine.md`: given an
`AgentTask`, decide what that specific agent needs, find it, filter/rank it,
and assemble it — persisting exactly what was handed over.

## What ships

- **Context requirement declarations** — extend `AgentCapability` usage (or
  add a parallel `contextRequirements` shape) so an agent can state, e.g.,
  "I need the last 30 days of the named metric plus its baseline" rather
  than the Coordinator guessing.
- **`services/context-engine`'s first real endpoint** — given an `AgentTask`
  (or its investigation + agent type), returns an assembled context object:
  relevant `DataSourceSchema` info, recent `Metric`/`Anomaly` rows scoped to
  what that agent's capabilities need, filtered by recency.
- **`ContextSnapshot` persistence** — every assembled context is written to
  the `ContextSnapshot` table (already in the schema since Phase 0) before
  being handed to the agent — this is the piece that makes Phase 10 replay
  meaningful ("what did the agent actually see").
- **Coordinator integration** — `agents/coordinator` calls
  `services/context-engine` before dispatching each `AgentTask`, replacing
  the "just pass the DataSource id" placeholder from Phase 4/5.
- **Basic relevance filtering** — for this phase, "relevant" can be
  reasonably simple (same organization/project, matching data source,
  within a configurable recency window) — not a learned ranking model. See
  "What we're deliberately not doing yet."

## What we're deliberately not doing yet

- **No vector database / long-term memory** — the project brief explicitly
  warns against over-engineering memory this early (section 6, Phase 6).
  Context assembly here is a filtering/ranking problem over already-structured
  data (metrics, schemas, recent findings), not a semantic search problem
  over unstructured documents. Revisit if/when unstructured sources (support
  tickets, documents) are added.
- **No cross-investigation memory** — each investigation's context is
  assembled fresh; the Context Engine doesn't yet learn from past
  investigations. That's a candidate for post-Phase-10 work once there's
  enough investigation history to learn from.

## Where the work lands

| What | Where |
|---|---|
| Context assembly logic | `services/context-engine/app/` (extend — currently only `/health`) |
| Context requirement shape | `packages/contracts` / `packages/contracts-py` (extend `AgentCapability` or add a new contract) |
| ContextSnapshot writes | `services/context-engine` or `apps/api`, whichever ends up owning the write — decide and document as an ADR if non-obvious |
| Coordinator integration | `agents/coordinator/` (extend — from Phase 5) |

## Definition of done

- The Analytics Agent's task, in a real investigation run, receives context
  assembled by `services/context-engine` rather than hand-built — verified
  by inspecting the persisted `ContextSnapshot` row and confirming it
  contains only what that agent's declared capabilities actually need (not
  the whole dataset).
- A test asserts that irrelevant data (e.g. a different organization's
  metrics) never appears in an assembled context — the concrete,
  test-enforced version of "no agent should receive the entire enterprise
  dataset" (project brief, section 12).

## What's next

[Phase 7: Multiple Agents + A2A](./phase-07-multi-agent-a2a.md) — now that
one agent gets well-scoped context, add more agents for the Coordinator to
route context and tasks to.
