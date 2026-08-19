# Analytics Agent

Receives an investigation task, determines what analytics are required, calls
`services/analytics-engine` for the actual computation, and produces
structured `Finding`s from the results — KPI analysis, trend analysis,
anomaly detection, statistical analysis, forecasting.

Will implement `BaseAgent` from `services/agent-runtime/app/agents/base.py`.

**Status:** Not yet implemented. This is the first agent built, in Phase 4 —
it needs `services/analytics-engine`'s KPI/anomaly endpoints (Phase 3) first.
