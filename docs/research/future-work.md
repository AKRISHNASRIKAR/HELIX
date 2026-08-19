# Future Work

Tracked here so scope decisions made for this foundation aren't mistaken for
permanent limitations. See [`docs/roadmap/`](../roadmap/README.md) for the
authoritative, phase-by-phase sequencing (mirrors the project brief's section
18); this is a shorter "what's explicitly deferred and why" list, plus a few
ideas that sit beyond the ten-phase plan entirely (see
[`docs/roadmap/phase-10-explainability-replay.md`](../roadmap/phase-10-explainability-replay.md#whats-next)).

- **Autonomous investigations** (brief section 16) — anomaly detection
  triggering an investigation without a user asking. Deferred until
  user-triggered investigations work reliably (Phase 1–8 first); an
  autonomous system that investigates the wrong thing confidently is worse
  than no autonomy.
- **Formal A2A protocol adoption** — the `AgentMessage` abstraction
  (`docs/architecture/a2a.md`) is designed so a standard protocol can replace
  `services/a2a-gateway`'s Redis transport later. Not adopted now because
  there's only one agent-runtime and no second agent to route between yet.
- **MCP-based external integrations** (GitHub, CRM, external APIs) — the
  `DataSourceAdapter` interface (`services/ingestion-service/app/adapters/base.py`)
  is the seam this plugs into. Postgres and CSV adapters come first (Phase
  2); MCP adapters come in Phase 8, once there's a real need beyond the two
  simplest source types.
- **Contract codegen** — `packages/contracts` (zod) and
  `packages/contracts-py` (Pydantic) are maintained by hand today (see
  `packages/contracts-py/README.md`). If drift between them becomes a
  recurring bug source, generate one from the other (or both from a shared
  schema format) rather than continuing to hand-sync.
- **Observability** (`infrastructure/monitoring`) — Prometheus/Grafana are
  not wired up; deferred until there are enough moving parts (multiple
  agents, autonomous triggers) for dashboards to earn their maintenance cost.
- **A learned root-cause / forecasting model** — `analytics/forecasting` and
  `analytics/root-cause` start with statistical baselines (statsmodels,
  rule-based correlation). A learned model is future work once there's
  enough real investigation history to train on.
