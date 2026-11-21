"""DataSourceAdapter: the abstraction referenced in the project brief
(section 11, MCP Architecture): agents and this service talk to data through
one interface, whether the underlying source is Postgres, a CSV upload, a
REST API, GitHub, or a future MCP-based connector.

Concrete adapters implement the blocking `_sync` methods; the public async
methods run them in a worker thread (`asyncio.to_thread`) so a slow database
or a large CSV never blocks the event loop. Expected failures (bad
credentials, unreachable host, malformed file, unknown table) are raised as
`AdapterError` with a readable, secret-free message.
"""

from __future__ import annotations

import asyncio
from abc import ABC, abstractmethod
from typing import Any

from ..errors import AdapterError
from ..models import ConnectionSpec


class DataSourceAdapter(ABC):
    """One adapter instance wraps one ConnectionSpec for one request."""

    type: str

    def __init__(self, spec: ConnectionSpec) -> None:
        self.spec = spec
        self._tables: dict[str, dict[str, Any]] | None = None

    # -- public async API ----------------------------------------------------

    async def connect(self) -> None:
        """Validate credentials/connectivity. Must not log or persist secrets."""
        await asyncio.to_thread(self._connect_sync)

    async def discover_schema(self) -> list[dict[str, Any]]:
        """Return `[{tableName, columns: [{name, type, nullable, semanticType}],
        rowCountEstimate}]`, persisted by apps/api as DataSourceSchema rows."""
        return await asyncio.to_thread(self._discover_sync)

    async def preview(self, table: str, limit: int = 50) -> tuple[list[str], list[dict]]:
        """A small sample of rows for the Data Sources UI."""
        return await asyncio.to_thread(self._preview_sync, table, limit)

    async def profile(self, table: str, sample_size: int = 10_000) -> dict[str, Any]:
        return await asyncio.to_thread(self._profile_sync, table, sample_size)

    async def extract(
        self, table: str, columns: list[str] | None = None, limit: int = 200_000
    ) -> tuple[list[str], list[dict]]:
        return await asyncio.to_thread(self._extract_sync, table, columns, limit)

    async def disconnect(self) -> None:
        await asyncio.to_thread(self._disconnect_sync)

    async def __aenter__(self) -> DataSourceAdapter:
        await self.connect()
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.disconnect()

    # -- helpers ---------------------------------------------------------------

    def check_columns(self, table: str, columns: list[str] | None) -> None:
        """Reject column names that were not discovered on `table`."""
        if not columns:
            return
        known = {c["name"] for c in self._tables_sync()[table]["columns"]}
        unknown = [c for c in columns if c not in known]
        if unknown:
            raise AdapterError(f"Unknown column(s) on table '{table}': {', '.join(unknown)}")

    def require_table(self, table: str) -> str:
        """Validate `table` against discovered tables before it goes near SQL."""
        tables = self._tables_sync()
        if table not in tables:
            available = ", ".join(sorted(tables)[:20]) or "none"
            raise AdapterError(f"Unknown table '{table}'. Available tables: {available}")
        return table

    def _tables_sync(self) -> dict[str, dict[str, Any]]:
        if self._tables is None:
            self._tables = {t["tableName"]: t for t in self._discover_sync(sample=False)}
        return self._tables

    # -- implemented by each adapter ---------------------------------------

    @abstractmethod
    def _connect_sync(self) -> None: ...

    @abstractmethod
    def _discover_sync(self, sample: bool = True) -> list[dict[str, Any]]:
        """`sample=False` skips data sampling (used only to validate names)."""

    @abstractmethod
    def _preview_sync(self, table: str, limit: int) -> tuple[list[str], list[dict]]: ...

    @abstractmethod
    def _profile_sync(self, table: str, sample_size: int) -> dict[str, Any]: ...

    @abstractmethod
    def _extract_sync(
        self, table: str, columns: list[str] | None, limit: int
    ) -> tuple[list[str], list[dict]]: ...

    @abstractmethod
    def _disconnect_sync(self) -> None: ...
