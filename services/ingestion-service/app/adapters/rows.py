"""RowSourceAdapter: shared base for API-backed sources (MCP tools, GitHub)
whose "tables" are lists of JSON objects fetched over the network.

A subclass names its tables (`_table_names_sync`, cheap, no data) and fetches
one table's rows (`_fetch_rows_sync`). This base turns rows into a pandas
frame (nested values JSON-stringified, columns in first-seen key order) and
serves discovery, preview, profile and extract from it with the same
profiling as CSV sources. Rows are fetched at most once per adapter instance,
which lives for one request.
"""

from __future__ import annotations

import json
from abc import abstractmethod
from typing import Any

import pandas as pd

from ..errors import AdapterError
from ..profiling import column_types, infer_semantic_type, profile_frame, to_json_rows
from .base import DataSourceAdapter


def normalize_rows(
    rows: list[dict[str, Any]], columns_hint: list[str] | None = None
) -> pd.DataFrame:
    """Rows of JSON objects -> DataFrame. Dicts and lists become JSON strings
    so every cell is a scalar the profiler and `to_json_rows` understand.
    `columns_hint` fixes the leading columns (so an empty table keeps them)."""
    columns: dict[str, None] = dict.fromkeys(columns_hint or [])
    for row in rows:
        for key in row:
            columns.setdefault(str(key), None)
    records = [
        {
            str(k): json.dumps(v, sort_keys=True, default=str) if isinstance(v, dict | list) else v
            for k, v in row.items()
        }
        for row in rows
    ]
    return pd.DataFrame.from_records(records, columns=list(columns))


class RowSourceAdapter(DataSourceAdapter):
    def __init__(self, spec) -> None:
        super().__init__(spec)
        self._frames: dict[str, tuple[pd.DataFrame, dict[str, str]]] = {}

    @abstractmethod
    def _table_names_sync(self) -> list[str]:
        """Table names this source exposes (no data fetched)."""

    @abstractmethod
    def _fetch_rows_sync(self, table: str) -> list[dict[str, Any]]:
        """All rows of one table (already capped by the subclass)."""

    def _known_columns(self, table: str) -> list[str] | None:
        """Columns a table always has, even when it is empty (None = unknown)."""
        return None

    def _frame_from_rows(
        self, table: str, rows: list[dict[str, Any]]
    ) -> tuple[pd.DataFrame, dict[str, str]]:
        df = normalize_rows(rows, self._known_columns(table))
        return df, column_types(df)

    def _frame(self, table: str) -> tuple[pd.DataFrame, dict[str, str]]:
        if table not in self._frames:
            self._frames[table] = self._frame_from_rows(table, self._fetch_rows_sync(table))
        return self._frames[table]

    def _discover_sync(self, sample: bool = True) -> list[dict[str, Any]]:
        result = []
        for table in self._table_names_sync():
            if not sample:
                result.append({"tableName": table, "columns": [], "rowCountEstimate": 0})
                continue
            df, types = self._frame(table)
            columns = [
                {
                    "name": name,
                    "type": types[name],
                    "nullable": bool(df[name].isna().any()),
                    "semanticType": infer_semantic_type(name, types[name], df[name]),
                }
                for name in df.columns
            ]
            result.append({"tableName": table, "columns": columns, "rowCountEstimate": len(df)})
        return result

    def require_table(self, table: str) -> str:
        names = self._table_names_sync()
        if table not in names:
            available = ", ".join(sorted(names)[:20]) or "none"
            raise AdapterError(f"Unknown table '{table}'. Available tables: {available}")
        return table

    def check_columns(self, table: str, columns: list[str] | None) -> None:
        if not columns:
            return
        known = set(self._frame(table)[0].columns)
        unknown = [c for c in columns if c not in known]
        if unknown:
            raise AdapterError(f"Unknown column(s) on table '{table}': {', '.join(unknown)}")

    def _preview_sync(self, table: str, limit: int) -> tuple[list[str], list[dict]]:
        self.require_table(table)
        df, _ = self._frame(table)
        return to_json_rows(df.head(limit))

    def _profile_sync(self, table: str, sample_size: int) -> dict[str, Any]:
        self.require_table(table)
        df, types = self._frame(table)
        return {
            "table": table,
            "rowCount": len(df),
            "columns": profile_frame(df.head(sample_size), types),
        }

    def _extract_sync(
        self, table: str, columns: list[str] | None, limit: int
    ) -> tuple[list[str], list[dict]]:
        self.require_table(table)
        self.check_columns(table, columns)
        df, _ = self._frame(table)
        subset = df[columns] if columns else df
        return to_json_rows(subset.head(limit))
