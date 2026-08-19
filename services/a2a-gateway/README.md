# a2a-gateway

Transport layer for agent-to-agent communication — routes `AgentMessage`
envelopes between the Coordinator and domain agents. Deliberately separate
from `agent-runtime` (which executes agents) so the transport can evolve
toward a formal A2A protocol without touching agent execution code. See
`docs/architecture/a2a.md`.

**Status:** Phase 0 foundation only — health check exists; routing arrives in
Phase 7 once there is more than one agent to route between.
