"""Load a DatasetRef into a pandas DataFrame: inline `rows`, or rows fetched
from the ingestion service's `/extract` (dataSourceId + organizationId +
table). Unreachable/failed ingestion -> 502; a bad reference -> 422.
"""

from __future__ import annotations

import logging

import httpx
import pandas as pd

from .config import settings
from .errors import AnalyticsError, UpstreamUnavailable
from .models import DatasetRef

logger = logging.getLogger(__name__)


async def _extract(ref: DatasetRef, columns: list[str] | None) -> list[dict]:
    body = {
        "dataSourceId": ref.data_source_id,
        "organizationId": ref.organization_id,
        "table": ref.table,
        "limit": settings.extract_limit,
    }
    if columns:
        body["columns"] = columns
    url = f"{settings.ingestion_service_url.rstrip('/')}/extract"
    try:
        async with httpx.AsyncClient(timeout=settings.ingestion_timeout_seconds) as client:
            response = await client.post(url, json=body)
    except httpx.HTTPError as exc:
        logger.warning("ingestion service unreachable: %s", type(exc).__name__)
        raise UpstreamUnavailable(
            f"Ingestion service unreachable at {settings.ingestion_service_url}"
        ) from None
    if response.status_code == 422:
        try:
            detail = response.json().get("detail")
        except ValueError:
            detail = None
        raise AnalyticsError(f"Could not load dataset: {detail or 'ingestion rejected request'}")
    if response.status_code >= 400:
        raise UpstreamUnavailable(f"Ingestion service returned {response.status_code}")
    return response.json().get("rows", [])


async def load_frame(ref: DatasetRef, columns: list[str] | None = None) -> pd.DataFrame:
    """Return the dataset as a DataFrame and check that `columns` exist.

    `columns` (deduplicated, None-free) are requested from ingestion so only
    what the computation needs crosses the wire.
    """
    wanted = list(dict.fromkeys(c for c in (columns or []) if c))
    rows = ref.rows if ref.rows is not None else await _extract(ref, wanted or None)
    if not rows:
        raise AnalyticsError("Dataset has no rows.")
    df = pd.DataFrame.from_records(rows)
    missing = [c for c in wanted if c not in df.columns]
    if missing:
        available = ", ".join(map(str, df.columns[:30]))
        raise AnalyticsError(f"Unknown column(s): {', '.join(missing)}. Available: {available}")
    return df
