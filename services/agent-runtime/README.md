# agent-runtime

Hosts and executes agent implementations (see `agents/*`) behind a single
`BaseAgent` contract (`app/agents/base.py`). Exposes each agent's capabilities
and results over HTTP so the Coordinator (and eventually `services/a2a-gateway`)
can delegate work to it.

**Status:** Phase 0 foundation only — health check and the `BaseAgent` interface
exist; no concrete agent is registered yet. Phase 4 adds the Analytics Agent,
Phase 5 wires in the Coordinator.
