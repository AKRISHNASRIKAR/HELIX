"""Cheap, pandas-based column profiling shared by every adapter.

This is deliberately shallow (Phase 2): enough to tell the Analytics Agent
"this column is a timestamp, this one is money, this one is an id" so it can
pick sensible defaults. Real statistics live in services/analytics-engine.

Also home to `to_json_rows`, which turns a DataFrame into JSON-safe rows
(datetimes as ISO strings, Decimal as float, NaN as null).
"""

from __future__ import annotations

import datetime as dt
import math
import re
import uuid
import warnings
from decimal import Decimal
from typing import Any

import numpy as np
import pandas as pd

from .models import SemanticType

CURRENCY_NAME = re.compile(
    r"(amount|price|revenue|cost|fee|total|subtotal|usd|eur|gbp|salary|spend|payment|"
    r"tax|discount|gmv|mrr|arr|balance|refund|charge|invoice|paid)",
    re.IGNORECASE,
)
ID_NAME = re.compile(r"(^id$|_id$|^id_|uuid|guid|_key$|^key$)")
CAMEL_ID_NAME = re.compile(r"[a-z0-9]Id$")
COUNT_NAME = re.compile(r"(count|qty|quantity|num_|number|_n$)", re.IGNORECASE)
DATETIME_NAME = re.compile(r"(_at$|_on$|date|time|timestamp|^ts$|day$)", re.IGNORECASE)
EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
BOOL_STRINGS = {"true", "false", "t", "f", "yes", "no", "y", "n"}
DATETIME_SQL = ("timestamp", "date", "time")
NUMERIC_SQL = ("int", "numeric", "decimal", "real", "double", "float", "money", "serial")


def _string_values(sample: pd.Series) -> pd.Series:
    return sample.dropna().astype(str).str.strip()


def datetime_parse_rate(sample: pd.Series) -> float:
    """Share of non-null string values pandas can parse as a datetime.

    Requires a date-ish shape (a digit and a - / : separator) so plain
    numbers like "2024" or "17" do not count as dates.
    """
    values = _string_values(sample)
    if values.empty:
        return 0.0
    shaped = values.str.contains(r"\d") & values.str.contains(r"[-/:]")
    if not shaped.any():
        return 0.0
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        parsed = pd.to_datetime(values[shaped], errors="coerce", utc=True, format="mixed")
    return float(parsed.notna().sum()) / len(values)


def _two_decimal_floats(values: pd.Series) -> bool:
    """True when (almost) every value has at most 2 decimals and a meaningful
    share actually uses cents, which is what money columns look like."""
    finite = values[np.isfinite(values)]
    if finite.empty:
        return False
    cents = np.round(finite * 100)
    at_most_two = np.isclose(cents / 100, finite, atol=1e-9)
    fractional = ~np.isclose(finite, np.round(finite))
    return bool(at_most_two.mean() >= 0.98 and fractional.mean() >= 0.3)


def infer_semantic_type(name: str, raw_type: str, sample: pd.Series | None) -> SemanticType:
    """Infer a semanticType from the column name, its physical type and a sample.

    Order matters: booleans, then datetimes, emails, identifiers, currency,
    other numerics, low-cardinality categoricals, and finally free text.
    """
    raw = (raw_type or "").lower()
    sample = sample if sample is not None else pd.Series([], dtype=object)
    non_null = sample.dropna()
    n = len(non_null)

    if raw.startswith("bool") or pd.api.types.is_bool_dtype(sample):
        return "boolean"
    if (
        n
        and sample.dtype == object
        and set(_string_values(non_null).str.lower().unique()) <= BOOL_STRINGS
        and non_null.nunique() <= 2
    ):
        return "boolean"

    if any(raw.startswith(t) for t in DATETIME_SQL) or pd.api.types.is_datetime64_any_dtype(
        sample
    ):
        return "datetime"
    is_numeric_dtype = pd.api.types.is_numeric_dtype(sample) and n > 0
    numeric_sql = any(t in raw for t in NUMERIC_SQL)
    if n and not is_numeric_dtype and not numeric_sql:
        threshold = 0.8 if DATETIME_NAME.search(name) else 0.9
        if datetime_parse_rate(non_null) >= threshold:
            return "datetime"
        strings = _string_values(non_null)
        if (strings.str.match(EMAIL)).mean() >= 0.9:
            return "email"

    if (ID_NAME.search(name.lower()) or CAMEL_ID_NAME.search(name)) and not (
        is_numeric_dtype and CURRENCY_NAME.search(name)
    ):
        return "identifier"

    is_float = pd.api.types.is_float_dtype(sample) or "numeric" in raw or "decimal" in raw
    if is_numeric_dtype or numeric_sql:
        if "money" in raw or (CURRENCY_NAME.search(name) and not COUNT_NAME.search(name)):
            return "currency"
        if re.search(r"numeric\(\d+,\s*2\)", raw):
            return "currency"
        if is_float and is_numeric_dtype and _two_decimal_floats(non_null.astype(float)):
            return "currency"
        if (
            is_numeric_dtype
            and pd.api.types.is_integer_dtype(non_null)
            and n >= 20
            and non_null.nunique() / n >= 0.99
            and non_null.is_monotonic_increasing
        ):
            return "identifier"
        return "numeric"

    if n:
        distinct = non_null.nunique()
        strings = _string_values(non_null)
        if n >= 20 and distinct / n >= 0.95 and strings.str.len().mean() <= 40 and not (
            strings.str.contains(r"\s").mean() > 0.2
        ):
            return "identifier"
        if distinct <= 50 and (n < 10 or distinct / n <= 0.5):
            return "categorical"
    return "text"


def physical_type(series: pd.Series) -> str:
    """Physical type name for a pandas column (CSV sources)."""
    if pd.api.types.is_bool_dtype(series):
        return "boolean"
    if pd.api.types.is_integer_dtype(series):
        return "integer"
    if pd.api.types.is_float_dtype(series):
        return "float"
    if pd.api.types.is_datetime64_any_dtype(series):
        return "timestamp"
    return "text"


def column_types(df: pd.DataFrame) -> dict[str, str]:
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


def profile_frame(df: pd.DataFrame, types: dict[str, str]) -> list[dict[str, Any]]:
    """nullRate, distinctCount and semanticType per column of a sample frame."""
    out = []
    total = len(df)
    for name in df.columns:
        column = df[name]
        nulls = int(column.isna().sum())
        try:
            distinct = int(column.nunique(dropna=True))
        except TypeError:  # unhashable values (json/array columns)
            distinct = int(column.dropna().astype(str).nunique())
        out.append(
            {
                "name": str(name),
                "type": types.get(str(name), physical_type(column)),
                "nullRate": (nulls / total) if total else 0.0,
                "distinctCount": distinct,
                "semanticType": infer_semantic_type(
                    str(name), types.get(str(name), ""), column
                ),
            }
        )
    return out


def json_value(value: Any) -> Any:
    """Convert one scalar to something json.dumps accepts."""
    if value is None or value is pd.NaT or value is pd.NA:
        return None
    if isinstance(value, bool | np.bool_):
        return bool(value)
    if isinstance(value, int | np.integer):
        return int(value)
    if isinstance(value, float | np.floating):
        f = float(value)
        return f if math.isfinite(f) else None
    if isinstance(value, Decimal):
        f = float(value)
        return f if math.isfinite(f) else None
    if isinstance(value, pd.Timestamp):
        if pd.isna(value):
            return None
        if value.tzinfo is not None:
            value = value.tz_convert("UTC")
        return value.isoformat()
    if isinstance(value, dt.datetime):
        if value.tzinfo is not None:
            value = value.astimezone(dt.UTC)
        return value.isoformat()
    if isinstance(value, dt.date | dt.time):
        return value.isoformat()
    if isinstance(value, dt.timedelta):
        return value.total_seconds()
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, bytes | bytearray | memoryview):
        return bytes(value).hex()
    if isinstance(value, dict):
        return {str(k): json_value(v) for k, v in value.items()}
    if isinstance(value, list | tuple):
        return [json_value(v) for v in value]
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    return value if isinstance(value, str) else str(value)


def to_json_rows(df: pd.DataFrame) -> tuple[list[str], list[dict[str, Any]]]:
    """(columns, rows) with every value JSON-safe. Column-wise for speed."""
    columns = [str(c) for c in df.columns]
    converted: list[list[Any]] = []
    for name in df.columns:
        column = df[name]
        if pd.api.types.is_float_dtype(column):
            values = column.to_numpy(dtype=float)
            converted.append([float(v) if math.isfinite(v) else None for v in values])
        elif pd.api.types.is_integer_dtype(column) and not column.isna().any():
            converted.append([int(v) for v in column.to_numpy()])
        else:
            converted.append([json_value(v) for v in column.tolist()])
    rows = [dict(zip(columns, values, strict=True)) for values in zip(*converted, strict=True)]
    return columns, rows
