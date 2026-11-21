"""HELIX ingestion service: connect to a data source, discover its schema,
preview/profile tables and extract rows (see the build spec, section B).

Every endpoint takes an inline `connection` or `dataSourceId` +
`organizationId` (resolved through apps/api). Expected failures never crash
the service: /connect answers `{ok: false, error}`, the others answer 422
with a readable `detail`. Credentials are never logged or echoed back.
"""

from __future__ import annotations

import logging

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .adapters import adapter_for
from .config import settings
from .errors import AdapterError
from .models import (
    ConnectResponse,
    ExtractRequest,
    PreviewRequest,
    ProfileRequest,
    ProfileResponse,
    RowsResponse,
    SourceRequest,
)
from .resolve import resolve_connection

logger = logging.getLogger("helix.ingestion")

app = FastAPI(title="HELIX Ingestion Service", version="0.2.0")


@app.exception_handler(RequestValidationError)
async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    """422 with a readable string `detail` (plus the raw `errors` list).

    Input values are deliberately left out of the response: they may contain
    a password.
    """
    parts = []
    for error in exc.errors():
        location = ".".join(str(p) for p in error.get("loc", ()) if p != "body")
        parts.append(f"{location}: {error.get('msg')}" if location else str(error.get("msg")))
    errors = [{k: v for k, v in e.items() if k in ("loc", "msg", "type")} for e in exc.errors()]
    return JSONResponse(
        status_code=422,
        content={"detail": "Invalid request: " + "; ".join(parts), "errors": errors},
    )


async def _adapter(request: SourceRequest):
    return adapter_for(await resolve_connection(request))


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "service": settings.service_name}


@app.post("/connect", response_model=ConnectResponse, response_model_exclude_none=True)
async def connect(request: SourceRequest) -> ConnectResponse:
    try:
        async with await _adapter(request) as adapter:
            schemas = await adapter.discover_schema()
        return ConnectResponse(ok=True, schemas=schemas)
    except AdapterError as exc:
        return ConnectResponse(ok=False, error=exc.message)
    except Exception:
        logger.exception("unexpected error during /connect")
        return ConnectResponse(ok=False, error="Unexpected error while connecting to the source.")


async def _guarded(coro_fn):
    """Run an adapter operation, mapping failures to 422 with a readable detail."""
    try:
        return await coro_fn()
    except AdapterError as exc:
        raise HTTPException(status_code=422, detail=exc.message) from None
    except Exception:
        logger.exception("unexpected ingestion error")
        raise HTTPException(
            status_code=422, detail="Unexpected error while reading the data source."
        ) from None


@app.post("/preview", response_model=RowsResponse)
async def preview(request: PreviewRequest) -> RowsResponse:
    async def run():
        async with await _adapter(request) as adapter:
            columns, rows = await adapter.preview(request.table, request.limit)
        return RowsResponse(columns=columns, rows=rows)

    return await _guarded(run)


@app.post("/profile", response_model=ProfileResponse)
async def profile(request: ProfileRequest) -> ProfileResponse:
    async def run():
        async with await _adapter(request) as adapter:
            result = await adapter.profile(request.table, request.sample_size)
        return ProfileResponse.model_validate(result)

    return await _guarded(run)


@app.post("/extract", response_model=RowsResponse)
async def extract(request: ExtractRequest) -> RowsResponse:
    async def run():
        async with await _adapter(request) as adapter:
            columns, rows = await adapter.extract(request.table, request.columns, request.limit)
        return RowsResponse(columns=columns, rows=rows)

    return await _guarded(run)
