from fastapi import FastAPI

from .config import settings

app = FastAPI(title="HELIX Context Engine", version="0.1.0")

"""
Phase 6 adds the real subsystem here: given an AgentTask, decide what context
that agent needs, where to find it, filter/rank it for relevance and
recency, and assemble it into `AgentTask.input_context` — persisting a
ContextSnapshot for replay. This is deliberately not "RAG" — see
docs/architecture/context-engine.md for the fuller pipeline (section 12 of
the project brief).
"""


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "service": settings.service_name}
