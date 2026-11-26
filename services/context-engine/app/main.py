"""HELIX Context Engine (Phase 6).

Given one AgentTask (ContextAssembleRequest), decide what context that agent
needs, find it, filter and rank it, and return the AssembledContext that becomes
the task's inputContext (persisted as a ContextSnapshot by the API). This is
deliberately not "RAG"; see app/assembler.py and docs/architecture/context-engine.md.
"""

import logging

import httpx
from fastapi import FastAPI, HTTPException
from helix_contracts import ContextAssembleRequest
from pydantic import ValidationError

from .assembler import assemble
from .config import Settings, settings
from .history import HistorySource, HttpHistoryClient

logging.basicConfig(level=settings.log_level.upper())


def create_app(
    app_settings: Settings | None = None,
    *,
    api_transport: httpx.AsyncBaseTransport | None = None,
    history: HistorySource | None = None,
) -> FastAPI:
    """`api_transport` / `history` let tests mock the API's internal history endpoint."""
    app_settings = app_settings or settings
    if history is None and app_settings.helix_api_url:
        history = HttpHistoryClient(
            app_settings.helix_api_url,
            app_settings.internal_token,
            timeout=app_settings.history_timeout_s,
            limit=app_settings.history_limit,
            transport=api_transport,
        )
    app = FastAPI(title="HELIX Context Engine", version="0.2.0")

    @app.get("/health")
    async def health() -> dict:
        return {"status": "ok", "service": app_settings.service_name}

    @app.post("/context/assemble")
    async def assemble_context(request: ContextAssembleRequest) -> dict:
        try:
            context = await assemble(request, history=history)
        except ValidationError as exc:
            # request.investigation is a free-form dict in the contract; validate it here.
            details = exc.errors(include_url=False, include_context=False)
            raise HTTPException(
                422, {"error": "invalid investigation", "details": details}
            ) from exc
        return context.model_dump(mode="json", by_alias=True)

    return app


app = create_app()
