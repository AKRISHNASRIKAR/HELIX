from fastapi import FastAPI

from .agents import BaseAgent  # noqa: F401 — re-exported for agents/* implementations
from .config import settings

app = FastAPI(title="HELIX Agent Runtime", version="0.1.0")

#: Populated in Phase 4/5 as concrete agents (agents/coordinator, agents/analytics,
#: ...) register themselves at startup. Empty for now — this service only proves
#: out the BaseAgent contract and health-check plumbing in Phase 0.
AGENT_REGISTRY: dict[str, BaseAgent] = {}


@app.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        "service": settings.service_name,
        "registeredAgents": len(AGENT_REGISTRY),
    }
