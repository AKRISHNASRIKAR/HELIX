"""Deterministic "tool selection" for the Analytics Agent.

Given the investigation question and the connected data sources' discovered
schemas, decide WHAT to compute (which metric, on which table and columns)
and WHICH analytics-engine endpoints to call. This is the part of the agent an
LLM could replace later (Phase 4 roadmap: the LLM only picks tools and
parameters); keeping it in its own pure module, with an explicit AnalysisPlan
output, keeps that swap local. Nothing here computes a number (ADR-005).
"""

from __future__ import annotations

import re
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from typing import Any

from helix_contracts import ColumnSchema, DataSourceContext, TableSchema

#: Values that mark a row as a refund when filtering a status-like column.
REFUND_STATUS_VALUES = ["refunded", "refund", "returned"]

_STATUS_NAMES = ("status", "state", "order_status", "payment_status")
_MONEY_WORDS = ("amount", "revenue", "price", "total", "sales", "gmv", "value", "cost", "subtotal")
_CUSTOMER_WORDS = ("customer", "user", "client", "account", "buyer")
_NUMERIC_TYPE_WORDS = ("int", "float", "double", "numeric", "decimal", "real", "money", "number")
_DATETIME_TYPE_WORDS = ("timestamp", "datetime", "date", "time")


class NoUsableDatasetError(Exception):
    """Raised when no connected table can answer the question."""


@dataclass(frozen=True)
class MetricIntent:
    """What the question is about, independent of any concrete table."""

    key: str  # revenue | orders | refunds | refund_rate | aov | customers
    label: str  # human label used in statements ("revenue", "refund rate")
    kpi_aggregation: str  # aggregation sent in the KpiSpec
    series_aggregation: str  # aggregation for the daily series (anomalies/forecast)
    needs_currency: bool = False  # needs a currency value column
    needs_customer_id: bool = False  # needs a customer identifier column
    needs_refund_filter: bool = False  # needs a status/refund column
    unit: str | None = None  # unit attached to the KpiSpec ("USD", "ratio", None)
    series_label: str | None = None  # label of the daily series if it differs
    series_unit: str | None = None  # unit of the daily series if it differs


INTENTS: dict[str, MetricIntent] = {
    "revenue": MetricIntent("revenue", "revenue", "sum", "sum", needs_currency=True, unit="USD"),
    "orders": MetricIntent("orders", "orders", "count", "count"),
    "refunds": MetricIntent("refunds", "refunds", "count", "count", needs_refund_filter=True),
    "refund_amount": MetricIntent(
        "refund_amount", "refunded amount", "sum", "sum",
        needs_currency=True, needs_refund_filter=True, unit="USD",
    ),
    "refund_rate": MetricIntent(
        "refund_rate", "refund rate", "ratio", "count",
        needs_refund_filter=True, unit="ratio", series_label="refunds", series_unit=None,
    ),
    "aov": MetricIntent(
        "aov", "average order value", "mean", "mean", needs_currency=True, unit="USD"
    ),
    "customers": MetricIntent(
        "customers", "active customers", "count_distinct", "count_distinct",
        needs_customer_id=True,
    ),
}

#: Ordered keyword patterns -> intent key. More specific phrases come first so
#: "refund rate" wins over "refund" and "average order value" over "order".
_KEYWORDS: list[tuple[str, str]] = [
    (r"refund(ed)?\s+(rate|ratio|percentage|share)|return\s+rate", "refund_rate"),
    (r"refund(ed|s)?\s+(amount|value|revenue|dollars)|refunded\s+revenue", "refund_amount"),
    (r"refund|returns?\b|returned|chargeback", "refunds"),
    (r"average\s+order\s+value|\baov\b|basket\s+size|order\s+value", "aov"),
    (r"revenue|sales|\bgmv\b|income|turnover|earnings|bookings", "revenue"),
    (r"\border(s)?\b|order\s+volume|\bvolume\b|transactions?|purchases?", "orders"),
    (r"customers?|buyers?|\busers?\b|clients?", "customers"),
]

_FORECAST_RE = re.compile(
    r"\b(forecast\w*|predict\w*|projection|project(ed)?|next|expect(ed|ing)?|will|outlook|upcoming)\b",
    re.IGNORECASE,
)
_DROP_RE = re.compile(
    r"\b(drop\w*|declin\w*|fall|fell|falling|decreas\w*|down|dip\w*|lower|loss|plung\w*|slump\w*)\b",
    re.IGNORECASE,
)
_SPIKE_RE = re.compile(
    r"\b(spik\w*|surg\w*|increas\w*|jump\w*|rise|rising|rose|higher|grow\w*|soar\w*)\b",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class DatasetChoice:
    data_source_id: str
    data_source_name: str
    table: str
    time_column: str
    value_column: str | None
    filter: dict[str, Any] | None


@dataclass
class AnalysisPlan:
    """Everything the agent needs to call the engine, plus why it chose it."""

    intent: MetricIntent
    dataset: DatasetChoice
    kpi_spec: dict[str, Any]
    series_spec: dict[str, Any]
    forecast: bool
    direction_hint: str | None  # "drop" | "spike" | None
    reasoning: list[str] = field(default_factory=list)

    def summary(self) -> dict[str, Any]:
        """JSON-safe description stored in task.result for auditability."""
        return {
            "metric": self.intent.key,
            "metricLabel": self.intent.label,
            "dataSourceId": self.dataset.data_source_id,
            "table": self.dataset.table,
            "timeColumn": self.dataset.time_column,
            "valueColumn": self.dataset.value_column,
            "filter": self.dataset.filter,
            "forecast": self.forecast,
            "directionHint": self.direction_hint,
            "reasoning": self.reasoning,
        }


# ---------------------------------------------------------------------------
# Question parsing
# ---------------------------------------------------------------------------


def detect_intent(text: str) -> MetricIntent | None:
    """Return the metric mentioned earliest in `text` (None if nothing matches)."""
    best: tuple[int, int, str] | None = None
    for priority, (pattern, key) in enumerate(_KEYWORDS):
        match = re.search(pattern, text, re.IGNORECASE)
        if match is None:
            continue
        candidate = (match.start(), priority, key)
        if best is None or candidate < best:
            best = candidate
    return INTENTS[best[2]] if best else None


def wants_forecast(text: str) -> bool:
    return bool(_FORECAST_RE.search(text))


def direction_hint(text: str) -> str | None:
    drop, spike = _DROP_RE.search(text), _SPIKE_RE.search(text)
    if drop and spike:
        return "drop" if drop.start() < spike.start() else "spike"
    if drop:
        return "drop"
    if spike:
        return "spike"
    return None


# ---------------------------------------------------------------------------
# Column heuristics (semanticType first, then type, then name)
# ---------------------------------------------------------------------------


def _semantic(col: ColumnSchema) -> str | None:
    return (col.semantic_type or "").lower() or None


def _type_has(col: ColumnSchema, words: Iterable[str]) -> bool:
    col_type = col.type.lower()
    return any(word in col_type for word in words)


def _name_has(col: ColumnSchema, words: Iterable[str]) -> bool:
    name = col.name.lower()
    return any(word in name for word in words)


def _first(columns: list[ColumnSchema], *predicates: Callable[[ColumnSchema], bool]):
    """First column matching the earliest predicate that matches anything."""
    for predicate in predicates:
        for col in columns:
            if predicate(col):
                return col
    return None


def pick_time_column(table: TableSchema) -> ColumnSchema | None:
    cols = table.columns
    return _first(
        cols,
        lambda c: _semantic(c) == "datetime" and _name_has(c, ("created", "order", "date")),
        lambda c: _semantic(c) == "datetime",
        lambda c: _semantic(c) is None and _type_has(c, _DATETIME_TYPE_WORDS),
        lambda c: _semantic(c) is None
        and (c.name.lower().endswith("_at") or _name_has(c, ("date", "time"))),
    )


def _is_numeric(col: ColumnSchema) -> bool:
    if _semantic(col) in ("numeric", "currency"):
        return True
    return _semantic(col) is None and _type_has(col, _NUMERIC_TYPE_WORDS)


def pick_currency_column(table: TableSchema) -> ColumnSchema | None:
    cols = table.columns
    return _first(
        cols,
        lambda c: _semantic(c) == "currency",
        lambda c: _is_numeric(c) and _name_has(c, _MONEY_WORDS) and not _name_has(c, ("_id",)),
    )


def pick_customer_column(table: TableSchema) -> ColumnSchema | None:
    return _first(
        table.columns,
        lambda c: _semantic(c) == "identifier" and _name_has(c, _CUSTOMER_WORDS),
        lambda c: _name_has(c, _CUSTOMER_WORDS) and c.name.lower().endswith("id"),
    )


def pick_refund_filter(table: TableSchema) -> dict[str, Any] | None:
    status = _first(
        table.columns,
        lambda c: c.name.lower() in _STATUS_NAMES,
        lambda c: _name_has(c, ("status",)) and _semantic(c) in (None, "categorical", "text"),
    )
    if status is not None:
        return {"column": status.name, "op": "in", "value": list(REFUND_STATUS_VALUES)}
    flag = _first(
        table.columns,
        lambda c: _name_has(c, ("refund", "returned"))
        and (_semantic(c) == "boolean" or _type_has(c, ("bool",))),
    )
    if flag is not None:
        return {"column": flag.name, "op": "eq", "value": True}
    return None


# ---------------------------------------------------------------------------
# Planning
# ---------------------------------------------------------------------------


def _choose_dataset(
    intent: MetricIntent, data_sources: list[DataSourceContext]
) -> DatasetChoice | None:
    """First data source + table that has a datetime column and everything `intent` needs."""
    for source in data_sources:
        for table in source.schemas:
            time_col = pick_time_column(table)
            if time_col is None:
                continue
            value_col: ColumnSchema | None = None
            if intent.needs_currency:
                value_col = pick_currency_column(table)
                if value_col is None:
                    continue
            if intent.needs_customer_id:
                value_col = pick_customer_column(table)
                if value_col is None:
                    continue
            row_filter = None
            if intent.needs_refund_filter:
                row_filter = pick_refund_filter(table)
                if row_filter is None:
                    continue
            return DatasetChoice(
                data_source_id=str(source.id),
                data_source_name=source.name,
                table=table.table_name,
                time_column=time_col.name,
                value_column=value_col.name if value_col else None,
                filter=row_filter,
            )
    return None


def _kpi_spec(intent: MetricIntent, dataset: DatasetChoice) -> dict[str, Any]:
    spec: dict[str, Any] = {"name": intent.key, "aggregation": intent.kpi_aggregation}
    if intent.unit:
        spec["unit"] = intent.unit
    if intent.kpi_aggregation == "ratio":
        # refund_rate: refunded rows / all rows, both computed by the engine.
        spec["numerator"] = {"aggregation": "count", "filter": dataset.filter}
        spec["denominator"] = {"aggregation": "count"}
        return spec
    if dataset.value_column:
        spec["column"] = dataset.value_column
    if dataset.filter:
        spec["filter"] = dataset.filter
    return spec


def _series_spec(intent: MetricIntent, dataset: DatasetChoice) -> dict[str, Any]:
    spec: dict[str, Any] = {
        "timeColumn": dataset.time_column,
        "aggregation": intent.series_aggregation,
    }
    if intent.series_aggregation != "count" and dataset.value_column:
        spec["valueColumn"] = dataset.value_column
    if dataset.filter:
        spec["filter"] = dataset.filter
    return spec


#: Tried, in order, when the question's metric can't be served by any table.
_FALLBACK_INTENTS = ("revenue", "orders")


def plan_analysis(
    question: str, data_sources: list[DataSourceContext], objective: str = ""
) -> AnalysisPlan:
    """Build the AnalysisPlan for `question`. Raises NoUsableDatasetError."""
    text = f"{question}\n{objective}"
    reasoning: list[str] = []

    requested = detect_intent(question) or detect_intent(objective)
    candidates: list[MetricIntent] = []
    if requested is not None:
        reasoning.append(f"Question asks about {requested.label}.")
        candidates.append(requested)
    else:
        reasoning.append("No specific metric named; defaulting to revenue, then order volume.")
    candidates += [INTENTS[key] for key in _FALLBACK_INTENTS if INTENTS[key] not in candidates]

    if not data_sources:
        raise NoUsableDatasetError(
            "No connected data sources were provided, so there is nothing to analyze. "
            "Connect a data source and run the investigation again."
        )

    for intent in candidates:
        dataset = _choose_dataset(intent, data_sources)
        if dataset is None:
            if intent is requested:
                reasoning.append(
                    f"No connected table has the columns needed for {intent.label}; falling back."
                )
            continue
        reasoning.append(
            f"Using table '{dataset.table}' from data source '{dataset.data_source_name}' "
            f"(time column '{dataset.time_column}'"
            + (f", value column '{dataset.value_column}'" if dataset.value_column else "")
            + (f", filter on '{dataset.filter['column']}'" if dataset.filter else "")
            + ")."
        )
        forecast = wants_forecast(text)
        if forecast:
            reasoning.append("Question is forward-looking, so a forecast is included.")
        return AnalysisPlan(
            intent=intent,
            dataset=dataset,
            kpi_spec=_kpi_spec(intent, dataset),
            series_spec=_series_spec(intent, dataset),
            forecast=forecast,
            direction_hint=direction_hint(question),
            reasoning=reasoning,
        )

    tables = sum(len(source.schemas) for source in data_sources)
    raise NoUsableDatasetError(
        f"None of the {tables} table(s) across {len(data_sources)} connected data source(s) "
        "has a datetime column together with a usable metric column, so no time series "
        "could be analyzed."
    )
