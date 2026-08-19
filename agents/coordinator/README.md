# Coordinator Agent

Understands the investigation question, produces an `InvestigationPlan`,
delegates `AgentTask`s to domain agents, collects their results, detects
missing evidence, and assembles the final investigation (summary, root
cause, recommendations).

Will implement `BaseAgent` from `services/agent-runtime/app/agents/base.py`.

**Status:** Not yet implemented. Planned for Phase 5, after the Analytics
Agent (Phase 4) proves out the single-agent path.
