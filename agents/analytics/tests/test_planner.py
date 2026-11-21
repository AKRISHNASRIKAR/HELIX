from uuid import uuid4

import pytest
from helix_agent_analytics.planner import (
    NoUsableDatasetError,
    detect_intent,
    direction_hint,
    plan_analysis,
    wants_forecast,
)
from helix_agent_analytics.testing import orders_data_source
from helix_contracts import DataSourceContext


def _sources(*raw):
    return [DataSourceContext.model_validate(r) for r in raw]


@pytest.mark.parametrize(
    ("question", "key"),
    [
        ("Why did revenue drop last week?", "revenue"),
        ("What happened to sales on Thursday?", "revenue"),
        ("Why did order volume fall?", "orders"),
        ("Are refunds spiking?", "refunds"),
        ("What is our refund rate doing?", "refund_rate"),
        ("How much refunded revenue did we lose?", "refund_amount"),
        ("Is average order value going down?", "aov"),
        ("How many active customers did we have?", "customers"),
        ("Why did revenue drop while refunds rose?", "revenue"),
    ],
)
def test_detect_intent(question, key):
    assert detect_intent(question).key == key


def test_detect_intent_none_for_vague_question():
    assert detect_intent("What is going on?") is None


@pytest.mark.parametrize(
    ("question", "expected"),
    [
        ("Forecast revenue for next month", True),
        ("What will revenue be in two weeks?", True),
        ("Predict order volume", True),
        ("Why did revenue drop last week?", False),
    ],
)
def test_wants_forecast(question, expected):
    assert wants_forecast(question) is expected


def test_direction_hint():
    assert direction_hint("Why did revenue drop?") == "drop"
    assert direction_hint("Why did refunds spike?") == "spike"
    assert direction_hint("How is revenue?") is None


def test_revenue_plan_uses_semantic_types():
    ds_id = str(uuid4())
    plan = plan_analysis("Why did revenue drop last week?", _sources(orders_data_source(ds_id)))
    assert plan.dataset.data_source_id == ds_id
    assert plan.dataset.table == "orders"
    assert plan.dataset.time_column == "created_at"
    assert plan.dataset.value_column == "amount"
    assert plan.kpi_spec == {"name": "revenue", "aggregation": "sum", "unit": "USD",
                             "column": "amount"}
    assert plan.series_spec == {"timeColumn": "created_at", "aggregation": "sum",
                                "valueColumn": "amount"}
    assert plan.forecast is False
    assert plan.direction_hint == "drop"


def test_orders_plan_counts_rows_without_value_column():
    plan = plan_analysis("Why did orders fall?", _sources(orders_data_source(str(uuid4()))))
    assert plan.kpi_spec == {"name": "orders", "aggregation": "count"}
    assert plan.series_spec == {"timeColumn": "created_at", "aggregation": "count"}


def test_refund_plan_filters_on_status():
    plan = plan_analysis("Did refunds spike?", _sources(orders_data_source(str(uuid4()))))
    expected_filter = {"column": "status", "op": "in", "value": ["refunded", "refund", "returned"]}
    assert plan.kpi_spec["aggregation"] == "count"
    assert plan.kpi_spec["filter"] == expected_filter
    assert plan.series_spec["filter"] == expected_filter


def test_refund_rate_uses_ratio_kpi_and_refund_count_series():
    plan = plan_analysis("What is the refund rate?", _sources(orders_data_source(str(uuid4()))))
    assert plan.kpi_spec["aggregation"] == "ratio"
    assert plan.kpi_spec["numerator"]["filter"]["column"] == "status"
    assert plan.kpi_spec["denominator"] == {"aggregation": "count"}
    assert plan.series_spec["aggregation"] == "count"


def test_forecast_question_sets_forecast():
    plan = plan_analysis("Forecast revenue", _sources(orders_data_source(str(uuid4()))))
    assert plan.forecast is True


def test_name_and_type_fallback_when_semantic_types_missing():
    source = {
        "id": str(uuid4()),
        "name": "Legacy DB",
        "type": "POSTGRESQL",
        "schemas": [
            {"tableName": "users", "columns": [{"name": "id", "type": "integer"}]},
            {
                "tableName": "sales",
                "columns": [
                    {"name": "id", "type": "integer"},
                    {"name": "sold_on", "type": "timestamp with time zone"},
                    {"name": "total_price", "type": "numeric(12,2)"},
                ],
            },
        ],
    }
    plan = plan_analysis("Why are sales down?", _sources(source))
    assert plan.dataset.table == "sales"
    assert plan.dataset.time_column == "sold_on"
    assert plan.dataset.value_column == "total_price"


def test_falls_back_to_orders_when_no_currency_column():
    source = orders_data_source(str(uuid4()))
    source["schemas"][0]["columns"] = [
        c for c in source["schemas"][0]["columns"] if c["name"] != "amount"
    ]
    plan = plan_analysis("Why did revenue drop?", _sources(source))
    assert plan.intent.key == "orders"
    assert any("falling back" in line for line in plan.reasoning)


def test_no_data_sources_raises():
    with pytest.raises(NoUsableDatasetError, match="No connected data sources"):
        plan_analysis("Why did revenue drop?", [])


def test_no_datetime_column_raises():
    source = {
        "id": str(uuid4()),
        "name": "Lookup",
        "type": "CSV",
        "schemas": [{"tableName": "codes", "columns": [{"name": "code", "type": "string",
                                                         "semanticType": "categorical"}]}],
    }
    with pytest.raises(NoUsableDatasetError, match="datetime column"):
        plan_analysis("Why did revenue drop?", _sources(source))
