# Phase 8: MCP Integrations

**Status:** Not started
**Depends on:** [Phase 7](./phase-07-multi-agent-a2a.md) — multiple working
agents make additional data source types worth having; adding MCP before
any agent needs GitHub/CRM/API data would be building ahead of demand.

## Goal

Add MCP-based data connectors where they genuinely help a real agent do its
job — extending the `DataSourceAdapter` abstraction (Phase 2) rather than
introducing a parallel integration path. Reinforces the A2A-vs-MCP boundary
documented in `docs/architecture/a2a.md`: this phase is entirely
agent-↔-tool, never agent-↔-agent.

## What ships

- **An `McpAdapter`** implementing `DataSourceAdapter`
  (`services/ingestion-service/app/adapters/base.py`), wrapping calls to an
  MCP server the same way `PostgresAdapter`/`CsvAdapter` wrap their sources
  — no agent code should need to know or care that a source is MCP-backed
  versus native.
- **First real MCP integrations**, picked by what the existing agents
  (Analytics, Finance, Customer, Product from Phase 7) actually need —
  candidates called out in the project brief: GitHub (for the Product
  Agent's "recent deployments/release notes" evidence), a generic REST API
  connector, file access. Pick based on which domain agent's evidence gap is
  most acute, not all of them at once.
- **DataSource configuration UI updates** — `apps/web`'s Data Sources page
  (Phase 2) gets an "MCP source" option alongside Postgres/CSV.
- **Credential/auth handling for MCP servers** — extends the Phase 2
  decision on secret storage to cover MCP server auth tokens.

## What we're deliberately not doing yet

- **Not every possible MCP integration** — the project brief is explicit:
  add MCP "where it genuinely makes sense," not exhaustively. One or two
  integrations that unblock a real agent's evidence gap, not a general MCP
  marketplace.
- **No agent-facing MCP tool-selection reasoning beyond what already exists**
  — an agent already decides which tool/computation it needs (Phase 4); MCP
  sources just become one more kind of tool behind the same
  `DataSourceAdapter` interface, not a new decision-making layer.

## Where the work lands

| What | Where |
|---|---|
| MCP adapter | `services/ingestion-service/app/adapters/` (extend) |
| DataSource UI | `apps/web/app/data-sources/` (extend — from Phase 2) |
| Credential handling | wherever Phase 2's secret-storage ADR put it |

## Definition of done

- At least one agent (e.g. Product) produces a `Finding` backed by evidence
  pulled through an MCP-backed `DataSource`, exercised the same way any
  other data source is (connect → discover → agent queries it via the
  adapter interface).

## What's next

[Phase 9: Autonomous Investigations](./phase-09-autonomous-investigations.md)
— everything so far has been user-triggered; this is where HELIX starts
investigating on its own.
