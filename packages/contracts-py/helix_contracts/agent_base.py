"""The agent interface every HELIX agent implements (project brief, section 9).

Lives in helix_contracts (not in services/agent-runtime) so each agents/*
package can implement it as a standalone, pip-installable package without
depending on the runtime that hosts it. `services/agent-runtime/app/agents/base.py`
re-exports it so existing imports keep working.

Agents must not call each other directly. A BaseAgent only ever: (1) receives
an AgentTask with pre-assembled context, (2) does its work, possibly through
tools such as services/analytics-engine, (3) returns an updated AgentTask with
a result or error. Coordination (which agent runs when) is the Coordinator's
job; see docs/architecture/agent-architecture.md.
"""

from __future__ import annotations

from abc import ABC, abstractmethod

from .context import ContextRequirements
from .enums import AgentType
from .models import AgentCapability, AgentTask


class BaseAgent(ABC):
    """Every concrete agent (AnalyticsAgent, CoordinatorAgent, ...) subclasses this."""

    #: Which domain this agent owns. Set by subclasses.
    agent_type: AgentType

    #: Registry metadata published by agent-runtime's GET /agents.
    name: str = ""
    description: str = ""
    version: str = "0.1.0"

    #: What services/context-engine should assemble for this agent (Phase 6).
    #: Subclasses override; the default asks for every connected table.
    context_requirements: ContextRequirements = ContextRequirements()

    @property
    @abstractmethod
    def capabilities(self) -> list[AgentCapability]:
        """Static list of what this agent can do, published to the Agent Registry."""
        raise NotImplementedError

    @abstractmethod
    async def execute(self, task: AgentTask) -> AgentTask:
        """Run `task.objective` using `task.input_context` and return the task
        with `result` populated (or `error` set). A failed agent must not raise
        past this boundary, so the Coordinator can still assemble a partial
        investigation (project brief section 20, Reliability Rules)."""
        raise NotImplementedError
