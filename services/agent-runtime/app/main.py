import asyncio
import logging
from contextlib import asynccontextmanager
from typing import Any

import httpx
import redis.asyncio as aioredis
from fastapi import FastAPI, HTTPException
from helix_agent_coordinator import CoordinatorAgent, ProgressReporter
from helix_contracts import AgentTask, AgentType, InvestigationRunRequest
from redis.asyncio import Redis

from .a2a import A2AWorker
from .agents import BaseAgent  # noqa: F401 (re-exported for agents/* implementations)
from .config import Settings, settings
from .registry import FROM_ENV, build_runtime
from .runtime import AgentRuntime

logging.basicConfig(level=settings.log_level.upper())
logger = logging.getLogger(__name__)


async def start_worker(
    runtime: AgentRuntime, app_settings: Settings, redis: Redis | None
) -> tuple[A2AWorker | None, Redis | None]:
    """Start the A2A worker when Redis answers a PING; otherwise run without one
    (the gateway then answers 503 and GatewayDispatch falls back to in-process).
    Returns the worker and the Redis client this function created (to close)."""
    owned = None
    if redis is None:
        redis = owned = aioredis.from_url(
            app_settings.redis_url,
            decode_responses=True,
            socket_connect_timeout=app_settings.redis_connect_timeout_s,
        )
    try:
        await asyncio.wait_for(redis.ping(), app_settings.redis_connect_timeout_s)
        worker = A2AWorker(runtime, redis, runtime.domain_agent_types)
        await worker.start()
        return worker, owned
    except Exception as exc:
        logger.warning("A2A worker not started, Redis unreachable at %s: %s",
                       app_settings.redis_url, exc)
        if owned is not None:
            await owned.aclose()
        return None, None


def create_app(
    app_settings: Settings | None = None,
    *,
    engine_transport: httpx.AsyncBaseTransport | None = None,
    progress: ProgressReporter | None = None,
    context_transport: httpx.AsyncBaseTransport | None = None,
    gateway_transport: httpx.AsyncBaseTransport | None = None,
    redis: Redis | None = None,
    llm: Any = FROM_ENV,
) -> FastAPI:
    """Build the app with every concrete agent registered at startup.

    The keyword arguments let tests swap in a mocked analytics engine, context
    engine and gateway, an in-memory progress reporter, a fakeredis client and
    an LLM (or None). In `gateway` mode the lifespan starts the A2A worker."""
    app_settings = app_settings or settings
    runtime = build_runtime(
        app_settings,
        engine_transport=engine_transport,
        progress=progress,
        context_transport=context_transport,
        gateway_transport=gateway_transport,
        llm=llm,
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        owned = None
        if app_settings.a2a_mode == "gateway":
            app.state.a2a_worker, owned = await start_worker(runtime, app_settings, redis)
        try:
            yield
        finally:
            worker = app.state.a2a_worker
            if worker is not None:
                await worker.stop()
                app.state.a2a_worker = None
            if owned is not None:
                await owned.aclose()

    app = FastAPI(title="HELIX Agent Runtime", version="0.2.0", lifespan=lifespan)
    app.state.runtime = runtime
    app.state.a2a_worker = None

    @app.get("/health")
    async def health() -> dict:
        worker: A2AWorker | None = app.state.a2a_worker
        return {
            "status": "ok",
            "service": app_settings.service_name,
            "registeredAgents": len(runtime.registry),
            "a2a": {
                "mode": app_settings.a2a_mode,
                "workerRunning": bool(worker and worker.running),
                "channels": worker.channels if worker else [],
            },
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
                "contextRequirements": agent.context_requirements.model_dump(
                    mode="json", by_alias=True
                ),
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
        """Run the Coordinator synchronously and return InvestigationRunResult."""
        coordinator = runtime.registry.get(AgentType.COORDINATOR)
        if not isinstance(coordinator, CoordinatorAgent):
            raise HTTPException(503, "Coordinator agent is not registered.")
        with runtime.busy(AgentType.COORDINATOR):
            result = await coordinator.run_investigation(request)
        return result.model_dump(mode="json", by_alias=True)

    return app


app = create_app()

#: Concrete agents registered at startup, keyed by AgentType.
AGENT_REGISTRY: dict[AgentType, BaseAgent] = app.state.runtime.registry

__all__ = ["AGENT_REGISTRY", "AgentRuntime", "app", "create_app"]
