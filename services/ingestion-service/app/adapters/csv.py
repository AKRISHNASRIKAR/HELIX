"""CsvAdapter: one uploaded CSV file exposed as exactly one table.

A CSV has no persistent connection: "connecting" means reading the stored
file (`filePath`, written by apps/api) and checking it parses. The table name
is the sanitized stem of the original upload name (`Orders 2026.csv` ->
`orders_2026`).

Robustness: tries UTF-8 (with BOM), then cp1252, then latin-1; sniffs the
delimiter among , ; tab |; rejects binary content, empty files and rows with
the wrong number of fields with readable messages. Parsed files are cached
by (path, mtime, size) so preview/profile/extract do not re-parse each time.
"""

from __future__ import annotations

import csv
import re
import warnings
from functools import lru_cache
from pathlib import Path
from typing import Any

import pandas as pd

from ..config import settings
from ..errors import AdapterError
from ..profiling import (
    datetime_parse_rate,
    infer_semantic_type,
    physical_type,
    profile_frame,
    to_json_rows,
)
from .base import DataSourceAdapter

ENCODINGS = ("utf-8-sig", "cp1252", "latin-1")
SNIFF_BYTES = 64 * 1024


def table_name_for(original_name: str | None, file_path: str) -> str:
    stem = Path(original_name or file_path).stem.lower()
    name = re.sub(r"[^a-z0-9]+", "_", stem).strip("_")
    return name or "data"


def _sniff_delimiter(head: str) -> str:
    try:
        return csv.Sniffer().sniff(head, delimiters=",;\t|").delimiter
    except csv.Error:
        return ","


def _column_types(df: pd.DataFrame) -> dict[str, str]:
    """Physical types as pandas parsed them; text columns that are almost all
    timestamps are reported as `timestamp` (values are left as strings)."""
    types: dict[str, str] = {}
    for name in df.columns:
        kind = physical_type(df[name])
        if kind == "text":
            sample = df[name].dropna().head(1000)
            if len(sample) and datetime_parse_rate(sample) >= 0.9:
                kind = "timestamp"
        types[str(name)] = kind
    return types


@lru_cache(maxsize=4)
def _load(path: str, _mtime_ns: int, _size: int) -> tuple[pd.DataFrame, dict[str, str]]:
    """Parse the file once per (path, mtime, size). Treat the frame as read-only."""
    with open(path, "rb") as fh:
        head = fh.read(SNIFF_BYTES)
    if not head.strip():
        raise AdapterError("The CSV file is empty.")
    if b"\x00" in head:
        raise AdapterError("The file does not look like a text CSV (binary content detected).")

    last_error: Exception | None = None
    for encoding in ENCODINGS:
        try:
            delimiter = _sniff_delimiter(head.decode(encoding, errors="ignore"))
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                df = pd.read_csv(
                    path, sep=delimiter, encoding=encoding, low_memory=False, on_bad_lines="error"
                )
            break
        except UnicodeDecodeError as exc:
            last_error = exc
            continue
        except pd.errors.EmptyDataError:
            raise AdapterError("The CSV file is empty (no header row).") from None
        except pd.errors.ParserError as exc:
            detail = str(exc).strip().splitlines()[0] if str(exc).strip() else "unknown error"
            detail = detail.replace("Error tokenizing data. C error: ", "")
            raise AdapterError(f"Malformed CSV: {detail}") from None
        except (ValueError, csv.Error) as exc:
            raise AdapterError(f"Could not parse the CSV file: {exc}") from None
    else:  # pragma: no cover - latin-1 decodes any byte sequence
        raise AdapterError(f"Could not decode the CSV file: {last_error}")

    if df.columns.empty:
        raise AdapterError("The CSV file has no columns.")
    df.columns = [str(c).strip() for c in df.columns]
    return df, _column_types(df)


class CsvAdapter(DataSourceAdapter):
    type = "CSV"

    def __init__(self, spec) -> None:
        super().__init__(spec)
        if not spec.file_path:
            raise AdapterError("CSV connection needs a `filePath`.")
        self.path = Path(spec.file_path).expanduser()
        self.table_name = table_name_for((spec.config or {}).get("originalName"), str(self.path))
        if settings.csv_root:
            root = Path(settings.csv_root).expanduser().resolve()
            if not self.path.resolve().is_relative_to(root):
                raise AdapterError("CSV file is outside the allowed upload directory.")

    def _frame(self) -> tuple[pd.DataFrame, dict[str, str]]:
        try:
            stat = self.path.stat()
        except FileNotFoundError:
            raise AdapterError("The uploaded CSV file could not be found.") from None
        except OSError as exc:
            raise AdapterError(f"Could not read the CSV file: {exc.strerror}") from None
        if not self.path.is_file():
            raise AdapterError("The CSV path is not a file.")
        if stat.st_size == 0:
            raise AdapterError("The CSV file is empty.")
        return _load(str(self.path), stat.st_mtime_ns, stat.st_size)

    def _connect_sync(self) -> None:
        self._frame()

    def _disconnect_sync(self) -> None:
        return None

    def _discover_sync(self, sample: bool = True) -> list[dict[str, Any]]:
        df, types = self._frame()
        head = df.head(10_000)
        columns = [
            {
                "name": name,
                "type": types[name],
                "nullable": bool(df[name].isna().any()),
                "semanticType": infer_semantic_type(name, types[name], head[name])
                if sample
                else "text",
            }
            for name in df.columns
        ]
        result = [{"tableName": self.table_name, "columns": columns, "rowCountEstimate": len(df)}]
        if not sample:
            self._tables = {self.table_name: result[0]}
        return result

    def _preview_sync(self, table: str, limit: int) -> tuple[list[str], list[dict]]:
        self.require_table(table)
        df, _ = self._frame()
        return to_json_rows(df.head(limit))

    def _profile_sync(self, table: str, sample_size: int) -> dict[str, Any]:
        self.require_table(table)
        df, types = self._frame()
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
        df, _ = self._frame()
        subset = df[columns] if columns else df
        return to_json_rows(subset.head(limit))

