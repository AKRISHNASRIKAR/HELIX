"""DataSourceAdapter — the abstraction referenced in the project brief
(section 11, MCP Architecture): agents and this service talk to data through
one interface, whether the underlying source is Postgres, a CSV upload, a
REST API, GitHub, or a future MCP-based connector. Concrete adapters
(PostgresAdapter, CsvAdapter, ...) arrive in Phase 2; this module only fixes
the shape they must implement.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from helix_contracts import DataSource, DataSourceType


class DataSourceAdapter(ABC):
    """One adapter instance wraps one connected DataSource."""

    type: DataSourceType

    @abstractmethod
    async def connect(self, data_source: DataSource) -> None:
        """Validate credentials/connectivity. Must not log or persist secrets."""
        raise NotImplementedError

    @abstractmethod
    async def discover_schema(self) -> list[dict[str, Any]]:
        """Return table/column metadata — persisted as DataSourceSchema rows."""
        raise NotImplementedError

    @abstractmethod
    async def preview(self, table_name: str, limit: int = 50) -> list[dict[str, Any]]:
        """Return a small sample of rows for the Data Sources UI."""
        raise NotImplementedError

    @abstractmethod
    async def disconnect(self) -> None:
        raise NotImplementedError
