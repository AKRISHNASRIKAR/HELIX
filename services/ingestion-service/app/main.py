from fastapi import FastAPI

from .adapters import DataSourceAdapter  # noqa: F401 — re-exported for adapter implementations
from .config import settings

app = FastAPI(title="HELIX Ingestion Service", version="0.1.0")

"""
Phase 2 adds real connection, schema discovery, metadata, preview, and basic
profiling here for Postgres and CSV sources first (see
app/adapters/base.py for the DataSourceAdapter interface every connector
implements).
"""


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "service": settings.service_name}
