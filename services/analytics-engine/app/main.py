"""HELIX analytics engine: real computation behind every number an agent
reports (see docs/architecture/analytics-engine.md and the build spec,
section C). Endpoints load a dataset (inline rows or ingestion /extract),
compute with pandas / numpy / scipy / statsmodels (via analytics/*), and
return structured results that each carry a `computationMethod`.

Errors: 422 `{detail}` for bad specs or unusable data, 502 `{detail}` when
the ingestion service is unreachable.
"""

from __future__ import annotations

import asyncio

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .analyses import (
    compute_anomalies,
    compute_forecast,
    compute_kpis,
    compute_statistics,
    compute_trends,
)
from .config import settings
from .dataset import load_frame
from .errors import AnalyticsError
from .models import (
    AnomalyRequest,
    AnomalyResponse,
    ForecastRequest,
    ForecastResponse,
    KpiRequest,
    KpiResponse,
    SeriesSpec,
    StatisticsRequest,
    StatisticsResponse,
    TrendsRequest,
    TrendsResponse,
)

app = FastAPI(title="HELIX Analytics Engine", version="0.2.0")


@app.exception_handler(AnalyticsError)
async def _analytics_error(_: Request, exc: AnalyticsError) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


@app.exception_handler(RequestValidationError)
async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    """422 with a readable string `detail` (plus the structured `errors` list)."""
    parts = []
    for error in exc.errors():
        location = ".".join(str(p) for p in error.get("loc", ()) if p != "body")
        parts.append(f"{location}: {error.get('msg')}" if location else str(error.get("msg")))
    errors = [{k: v for k, v in e.items() if k in ("loc", "msg", "type")} for e in exc.errors()]
    return JSONResponse(
        status_code=422,
        content={"detail": "Invalid request: " + "; ".join(parts), "errors": errors},
    )


def _series_columns(spec: SeriesSpec) -> list[str]:
    return [spec.time_column, spec.value_column, spec.filter.column if spec.filter else None]


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "service": settings.service_name}


@app.post("/kpis", response_model=KpiResponse)
async def kpis(request: KpiRequest) -> dict:
    columns = [request.time_column]
    for kpi in request.kpis:
        for part in (kpi, kpi.numerator, kpi.denominator):
            if part is not None:
                columns += [part.column, part.filter.column if part.filter else None]
    df = await load_frame(request.dataset, columns)
    return await asyncio.to_thread(compute_kpis, df, request)


@app.post("/statistics", response_model=StatisticsResponse)
async def statistics(request: StatisticsRequest) -> dict:
    df = await load_frame(request.dataset, request.columns)
    return await asyncio.to_thread(compute_statistics, df, request)


@app.post("/trends", response_model=TrendsResponse)
async def trends(request: TrendsRequest) -> dict:
    df = await load_frame(request.dataset, _series_columns(request))
    return await asyncio.to_thread(compute_trends, df, request)


@app.post("/anomalies/detect", response_model=AnomalyResponse)
async def anomalies(request: AnomalyRequest) -> dict:
    df = await load_frame(request.dataset, _series_columns(request))
    return await asyncio.to_thread(compute_anomalies, df, request)


@app.post("/forecast", response_model=ForecastResponse)
async def forecast(request: ForecastRequest) -> dict:
    df = await load_frame(request.dataset, _series_columns(request))
    return await asyncio.to_thread(compute_forecast, df, request)
