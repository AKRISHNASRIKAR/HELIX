"""Resolve a request's ConnectionSpec: inline `connection`, or fetched from
apps/api's internal endpoint (spec A1) using dataSourceId + organizationId.

The internal token is sent as `x-helix-internal-token`; the response carries
decrypted credentials, which only ever live in memory for this request.
"""

from __future__ import annotations

import logging

import httpx

from .config import settings
from .errors import AdapterError
from .models import ConnectionSpec, SourceRequest

logger = logging.getLogger(__name__)


async def resolve_connection(request: SourceRequest) -> ConnectionSpec:
    if request.connection is not None:
        return request.connection

    url = (
        f"{settings.api_url.rstrip('/')}/api/v1/internal/data-sources/"
        f"{request.data_source_id}/connection"
    )
    try:
        async with httpx.AsyncClient(timeout=settings.api_timeout_seconds) as client:
            response = await client.get(
                url,
                params={"organizationId": request.organization_id},
                headers={"x-helix-internal-token": settings.internal_token},
            )
    except httpx.HTTPError as exc:
        logger.warning("could not reach HELIX API to resolve data source: %s", type(exc).__name__)
        raise AdapterError("Could not reach the HELIX API to resolve the data source.") from None

    if response.status_code == 404:
        raise AdapterError("Data source not found for this organization.")
    if response.status_code == 401:
        raise AdapterError(
            "The ingestion service is not authorized against the HELIX API "
            "(check HELIX_INTERNAL_TOKEN)."
        )
    if response.status_code >= 400:
        raise AdapterError(
            f"The HELIX API returned {response.status_code} while resolving the data source."
        )
    try:
        return ConnectionSpec.model_validate(response.json())
    except ValueError:
        raise AdapterError("The HELIX API returned an invalid connection spec.") from None
