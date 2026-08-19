"""The agent interface every HELIX agent implements (project brief, section 9).

This is intentionally just a contract right now — no concrete agent subclasses
exist yet (see agents/coordinator, agents/analytics, agents/finance for the
planned first three; each currently ships only a README). Phase 4/5 wires a
real subclass in, has agent-runtime discover it, and calls execute() from an
HTTP route.

Agents must not call each other directly. A BaseAgent only ever: (1) receives
an AgentTask with pre-assembled context, (2) does its work, possibly through
DataSourceAdapter/MCP tools, (3) returns an updated AgentTask with a result or
error. Coordination (which agent runs when) is the Coordinator's job, carried
over AgentMessage envelopes — see packages/contracts-py and
docs/architecture/agent-architecture.md.
"""

from __future__ import annotations

from abc import ABC, abstractmethod

from helix_contracts import AgentCapability, AgentTask, AgentType


class BaseAgent(ABC):
    """Every concrete agent (FinanceAgent, AnalyticsAgent, ...) subclasses this."""

    #: Which domain this agent owns. Set by subclasses.
    agent_type: AgentType

    @property
    @abstractmethod
    def capabilities(self) -> list[AgentCapability]:
        """Static list of what this agent can do — published to the Agent Registry."""
        raise NotImplementedError

    @abstractmethod
    async def execute(self, task: AgentTask) -> AgentTask:
        """Run `task.objective` using `task.input_context` and return the task
        with `result` populated (or `error` set — a failed agent must not raise
        past this boundary, so the Coordinator can still assemble a partial
        investigation; see project brief section 20, Reliability Rules)."""
        raise NotImplementedError
