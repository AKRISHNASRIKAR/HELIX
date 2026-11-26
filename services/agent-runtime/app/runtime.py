"""Agent registry + in-process task execution.

AgentRuntime is the one place that runs an agent, so it also owns the BUSY/IDLE
bookkeeping GET /agents reports and the last-line guarantee that an agent
failure becomes a FAILED task, never an exception. How a Coordinator task
reaches `run` (directly or over the A2A gateway) lives in app/a2a.py; which
agents get registered lives in app/registry.py.
"""

from __future__ import annotations

import asyncio
import logging
from collections import Counter
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime

from helix_contracts import AgentStatus, AgentTask, AgentTaskStatus, AgentType

from .agents import BaseAgent

logger = logging.getLogger(__name__)


class AgentRuntime:
    def __init__(self) -> None:
        self.registry: dict[AgentType, BaseAgent] = {}
        self._in_flight: Counter[AgentType] = Counter()

    def register(self, agent: BaseAgent) -> None:
        self.registry[agent.agent_type] = agent

    def status_of(self, agent_type: AgentType) -> AgentStatus:
        return AgentStatus.BUSY if self._in_flight[agent_type] > 0 else AgentStatus.IDLE

    @contextmanager
    def busy(self, agent_type: AgentType) -> Iterator[None]:
        self._in_flight[agent_type] += 1
        try:
            yield
        finally:
            self._in_flight[agent_type] -= 1

    async def run(self, task: AgentTask) -> AgentTask:
        """Execute `task` on its registered agent. Never raises."""
        agent = self.registry.get(task.agent_type)
        if agent is None:
            return failed_task(task, f"No agent registered for type {task.agent_type.value}.")
        try:
            with self.busy(task.agent_type):
                return await asyncio.wait_for(agent.execute(task), task.timeout_ms / 1000)
        except TimeoutError:
            done = failed_task(task, f"Task timed out after {task.timeout_ms / 1000:g}s.")
            done.status = AgentTaskStatus.TIMED_OUT
            return done
        except Exception as exc:  # agents shouldn't raise; this is the safety net
            logger.exception("Agent %s raised on task %s", task.agent_type.value, task.id)
            return failed_task(task, f"{task.agent_type.value} agent raised: {exc}")

    @property
    def domain_agent_types(self) -> list[AgentType]:
        """Registered agent types that take delegated tasks (everything but the Coordinator)."""
        return [t for t in self.registry if t != AgentType.COORDINATOR]


def failed_task(
    task: AgentTask, error: str, status: AgentTaskStatus = AgentTaskStatus.FAILED
) -> AgentTask:
    done = task.model_copy(deep=True)
    now = datetime.now(UTC)
    done.status = status
    done.error = error
    done.started_at = done.started_at or now
    done.completed_at = now
    return done
