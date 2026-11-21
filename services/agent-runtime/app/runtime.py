"""Agent registry + in-process task execution.

Phase 5 dispatch is an in-process call to the registered agent (no A2A
routing yet, see docs/roadmap/phase-05). AgentRuntime is the one place that
runs an agent, so it also owns the BUSY/IDLE bookkeeping GET /agents reports
and the last-line guarantee that an agent failure becomes a FAILED task,
never an exception.
"""

from __future__ import annotations

import asyncio
import logging
from collections import Counter
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime

import httpx
from helix_agent_analytics import AnalyticsAgent, AnalyticsEngineClient
from helix_agent_coordinator import CoordinatorAgent, NullProgressReporter, ProgressReporter
from helix_contracts import AgentStatus, AgentTask, AgentTaskStatus, AgentType

from .agents import BaseAgent
from .config import Settings
from .progress import HttpProgressReporter

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
            return _failed(task, f"No agent registered for type {task.agent_type.value}.")
        try:
            with self.busy(task.agent_type):
                return await asyncio.wait_for(agent.execute(task), task.timeout_ms / 1000)
        except TimeoutError:
            done = _failed(task, f"Task timed out after {task.timeout_ms / 1000:g}s.")
            done.status = AgentTaskStatus.TIMED_OUT
            return done
        except Exception as exc:  # agents shouldn't raise; this is the safety net
            logger.exception("Agent %s raised on task %s", task.agent_type.value, task.id)
            return _failed(task, f"{task.agent_type.value} agent raised: {exc}")

    async def dispatch(self, task: AgentTask) -> AgentTask:
        """The Coordinator's dispatch hook (Phase 5: in-process)."""
        return await self.run(task)


def _failed(task: AgentTask, error: str) -> AgentTask:
    done = task.model_copy(deep=True)
    now = datetime.now(UTC)
    done.status = AgentTaskStatus.FAILED
    done.error = error
    done.started_at = done.started_at or now
    done.completed_at = now
    return done


def build_runtime(
    settings: Settings,
    *,
    engine_transport: httpx.AsyncBaseTransport | None = None,
    progress: ProgressReporter | None = None,
) -> AgentRuntime:
    """Register every concrete agent. Transports/reporters are injectable for tests."""
    runtime = AgentRuntime()
    runtime.register(
        AnalyticsAgent(
            AnalyticsEngineClient(
                settings.analytics_engine_url,
                timeout=settings.analytics_engine_timeout_s,
                transport=engine_transport,
            )
        )
    )
    if progress is None:
        progress = (
            HttpProgressReporter(
                settings.helix_api_url,
                settings.internal_token,
                timeout=settings.progress_timeout_s,
            )
            if settings.helix_api_url
            else NullProgressReporter()
        )
    runtime.register(
        CoordinatorAgent(runtime.dispatch, progress, task_timeout_ms=settings.task_timeout_ms)
    )
    return runtime
