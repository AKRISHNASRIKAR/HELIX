import logging

import httpx
from fastapi import FastAPI, HTTPException
from helix_agent_coordinator import CoordinatorAgent, ProgressReporter
from helix_contracts import AgentTask, AgentType, InvestigationRunRequest

from .agents import BaseAgent  # noqa: F401 (re-exported for agents/* implementations)
from .config import Settings, settings
from .runtime import AgentRuntime, build_runtime

logging.basicConfig(level=settings.log_level.upper())


def create_app(
    app_settings: Settings | None = None,
    *,
    engine_transport: httpx.AsyncBaseTransport | None = None,
    progress: ProgressReporter | None = None,
) -> FastAPI:
    """Build the app with every concrete agent registered at startup.

    `engine_transport` / `progress` let tests swap in a mocked analytics engine
    and an in-memory progress reporter."""
    app_settings = app_settings or settings
    runtime = build_runtime(app_settings, engine_transport=engine_transport, progress=progress)
    app = FastAPI(title="HELIX Agent Runtime", version="0.1.0")
    app.state.runtime = runtime

    @app.get("/health")
    async def health() -> dict:
        return {
            "status": "ok",
            "service": app_settings.service_name,
            "registeredAgents": len(runtime.registry),
        }

    @app.get("/agents")
    async def list_agents() -> list[dict]:
        return [
            {
                "type": agent.agent_type.value,
                "name": agent.name,
                "description": agent.description,
                "version": agent.version,
                "status": runtime.status_of(agent.agent_type).value,
                "capabilities": [
                    {"name": c.name, "description": c.description} for c in agent.capabilities
                ],
            }
            for agent in runtime.registry.values()
        ]

    @app.post("/agents/{agent_type}/execute")
    async def execute(agent_type: AgentType, task: AgentTask) -> dict:
        """Phase 4 manual harness: run one AgentTask on one agent. Agent failures
        come back as a FAILED task (200), never as a 500."""
        if agent_type not in runtime.registry:
            raise HTTPException(404, f"No agent registered for type {agent_type.value}.")
        if task.agent_type != agent_type:
            raise HTTPException(
                422,
                f"Task agentType {task.agent_type.value} does not match path {agent_type.value}.",
            )
        done = await runtime.run(task)
        return done.model_dump(mode="json", by_alias=True)

    @app.post("/investigations/run")
    async def run_investigation(request: InvestigationRunRequest) -> dict:
        """Phase 5: run the Coordinator synchronously and return InvestigationRunResult."""
        coordinator = runtime.registry.get(AgentType.COORDINATOR)
        if not isinstance(coordinator, CoordinatorAgent):
            raise HTTPException(503, "Coordinator agent is not registered.")
        with runtime.busy(AgentType.COORDINATOR):
            result = await coordinator.run_investigation(request)
        return result.model_dump(mode="json", by_alias=True)

    return app


app = create_app()

#: Concrete agents registered at startup (COORDINATOR, ANALYTICS), keyed by AgentType.
AGENT_REGISTRY: dict[AgentType, BaseAgent] = app.state.runtime.registry

__all__ = ["AGENT_REGISTRY", "AgentRuntime", "app", "create_app"]
