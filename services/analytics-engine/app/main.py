from fastapi import FastAPI

from .config import settings

app = FastAPI(title="HELIX Analytics Engine", version="0.1.0")

"""
Phase 3 adds real endpoints here — KPI calculation, statistical profiling,
anomaly detection, trend analysis, basic forecasting — backed by pandas /
numpy / scipy / statsmodels / duckdb (see analytics/ for the algorithm
implementations this service will call into). Every endpoint must return a
structured, computed Metric/Anomaly (packages/contracts-py), never a
free-text LLM guess — see docs/architecture/analytics-engine.md.
"""


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "service": settings.service_name}
