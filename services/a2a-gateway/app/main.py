from fastapi import FastAPI

from .config import settings

app = FastAPI(title="HELIX A2A Gateway", version="0.1.0")

"""
Routes AgentMessage envelopes (packages/contracts-py: AgentMessage) between
the Coordinator and domain agents over Redis pub/sub — the transport behind
the internal A2A abstraction described in docs/architecture/a2a.md. Phase 7
adds real routing once there is more than one agent to route between; a
formal A2A protocol can replace the transport later without changing the
AgentMessage shape callers depend on.
"""


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "service": settings.service_name}
