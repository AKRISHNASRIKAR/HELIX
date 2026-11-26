"""Request/response models for the analytics engine (camelCase on the wire).

Defined locally rather than in packages/contracts-py: this is the
service-to-service contract with agent-runtime (HELIX build spec, section C).
`MetricOut` mirrors the contract `Metric` minus ids, which the caller assigns.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic.alias_generators import to_camel

Aggregation = Literal["sum", "mean", "count", "count_distinct"]


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class FilterSpec(CamelModel):
    column: str
    op: Literal["eq", "neq", "in"]
    value: Any

    @model_validator(mode="after")
    def _in_needs_list(self) -> FilterSpec:
        if self.op == "in" and not isinstance(self.value, list):
            raise ValueError("filter op 'in' needs a list value")
        return self


class DatasetRef(CamelModel):
    rows: list[dict[str, Any]] | None = None
    data_source_id: str | None = None
    organization_id: str | None = None
    table: str | None = None

    @model_validator(mode="after")
    def _one_source(self) -> DatasetRef:
        if self.rows is None and not (self.data_source_id and self.organization_id and self.table):
            raise ValueError(
                "dataset needs inline `rows` or `dataSourceId` + `organizationId` + `table`"
            )
        return self


class SeriesSpec(CamelModel):
    dataset: DatasetRef
    time_column: str
    value_column: str | None = None
    aggregation: Aggregation = "sum"
    filter: FilterSpec | None = None
    # Not in the base contract: optional unit echoed on MetricOut (e.g. "USD").
    unit: str | None = None

    @model_validator(mode="after")
    def _value_column_needed(self) -> SeriesSpec:
        if self.aggregation != "count" and not self.value_column:
            raise ValueError(f"aggregation '{self.aggregation}' needs a valueColumn")
        return self


class TrendsRequest(SeriesSpec):
    rolling_window: int = Field(7, ge=1, le=365)
    period_days: int = Field(7, ge=1, le=365)


class AnomalyRequest(SeriesSpec):
    method: Literal["auto", "zscore", "iqr", "seasonal"] = "auto"
    threshold: float = Field(3.0, gt=0)
    metric_name: str | None = None


class ForecastRequest(SeriesSpec):
    horizon: int = Field(14, ge=1, le=365)
    method: Literal["auto", "ets", "arima"] = "auto"


class AggSpec(CamelModel):
    aggregation: Aggregation
    column: str | None = None
    filter: FilterSpec | None = None


class KpiSpec(CamelModel):
    name: str
    aggregation: Literal["sum", "mean", "count", "count_distinct", "ratio"]
    column: str | None = None
    filter: FilterSpec | None = None
    unit: str | None = None
    numerator: AggSpec | None = None
    denominator: AggSpec | None = None

    @model_validator(mode="after")
    def _shape(self) -> KpiSpec:
        if self.aggregation == "ratio":
            if self.numerator is None or self.denominator is None:
                raise ValueError(f"KPI '{self.name}': ratio needs numerator and denominator")
            for part in (self.numerator, self.denominator):
                if part.aggregation != "count" and not part.column:
                    raise ValueError(f"KPI '{self.name}': '{part.aggregation}' needs a column")
        elif self.aggregation != "count" and not self.column:
            raise ValueError(f"KPI '{self.name}': aggregation '{self.aggregation}' needs a column")
        return self


class KpiRequest(CamelModel):
    dataset: DatasetRef
    time_column: str
    kpis: list[KpiSpec] = Field(min_length=1)
    window_days: int = Field(7, ge=1, le=366)
    as_of: str | None = None


class StatisticsRequest(CamelModel):
    dataset: DatasetRef
    columns: list[str] | None = None


class SegmentCompareRequest(SeriesSpec):
    # Default: every object/category column with 2..20 distinct values, excluding
    # timeColumn, valueColumn and the filter column.
    dimensions: list[str] | None = Field(None, min_length=1)
    target_date: str
    baseline: Literal["same_weekday", "trailing_mean"] = "same_weekday"
    baseline_periods: int = Field(4, ge=1, le=52)
    metric_name: str | None = None


class NamedSeriesSpec(SeriesSpec):
    # Not in the base contract: optional display name echoed as a.name / b.name.
    name: str | None = None


class CorrelationRequest(CamelModel):
    a: NamedSeriesSpec
    b: NamedSeriesSpec
    method: Literal["pearson", "spearman"] = "spearman"
    max_lag: int = Field(3, ge=0, le=14)


class EventsSpec(CamelModel):
    dataset: DatasetRef
    time_column: str
    # Default: every column except timeColumn.
    label_columns: list[str] | None = None
    filter: FilterSpec | None = None


class AlignTarget(CamelModel):
    date: str
    label: str | None = None


class EventsAlignRequest(CamelModel):
    events: EventsSpec
    targets: list[AlignTarget] = Field(min_length=1)
    window_hours_before: float = Field(24.0, ge=0, le=24 * 365)
    window_hours_after: float = Field(24.0, ge=0, le=24 * 365)


# -- responses -----------------------------------------------------------------


class Point(CamelModel):
    timestamp: str
    value: float | None


class MetricOut(CamelModel):
    name: str
    unit: str | None
    value: float | None
    baseline: float | None
    change_percent: float | None
    series: list[Point]
    computation_method: str = Field(min_length=1)
    computed_at: str


class KpiWindow(CamelModel):
    current_start: str
    current_end: str
    previous_start: str
    previous_end: str


class KpiMetric(MetricOut):
    p_value: float | None
    window: KpiWindow


class KpiResponse(CamelModel):
    metrics: list[KpiMetric]


class ColumnStats(CamelModel):
    name: str
    count: int
    null_rate: float
    mean: float | None
    median: float | None
    std: float | None
    min: float | None
    max: float | None
    p05: float | None
    p25: float | None
    p75: float | None
    p95: float | None


class StatisticsResponse(CamelModel):
    row_count: int
    columns: list[ColumnStats]
    computation_method: str = Field(min_length=1)


class TrendPoint(CamelModel):
    timestamp: str
    value: float | None
    rolling_mean: float | None


class PeriodOverPeriod(CamelModel):
    current: float | None
    previous: float | None
    change_percent: float | None


class TrendsResponse(CamelModel):
    series: list[TrendPoint]
    period_over_period: PeriodOverPeriod
    slope: float | None
    computation_method: str = Field(min_length=1)


class AnomalyOut(CamelModel):
    timestamp: str
    value: float
    expected_value: float
    deviation_score: float
    severity: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]
    direction: Literal["spike", "drop"]
    detection_method: str
    description: str


class AnomalyResponse(CamelModel):
    metric: MetricOut
    method_used: str
    anomalies: list[AnomalyOut]
    computation_method: str = Field(min_length=1)


class ForecastPoint(CamelModel):
    timestamp: str
    value: float
    lower: float
    upper: float


class Backtest(CamelModel):
    mape: float | None
    holdout_days: int


class ForecastResponse(CamelModel):
    history: list[Point]
    forecast: list[ForecastPoint]
    method_used: str
    backtest: Backtest
    computation_method: str = Field(min_length=1)


class Change(CamelModel):
    actual: float
    expected: float
    delta: float
    delta_percent: float | None


class SliceOut(Change):
    value: str
    share_of_delta: float


class TopSliceOut(SliceOut):
    column: str


class DimensionOut(CamelModel):
    column: str
    concentration: float
    slices: list[SliceOut]


class SegmentCompareResponse(CamelModel):
    target_date: str
    metric_name: str
    unit: str | None
    aggregation: Aggregation
    total: Change
    dimensions: list[DimensionOut]
    top_slice: TopSliceOut | None
    computation_method: str = Field(min_length=1)


class SeriesName(CamelModel):
    name: str


class CorrelationResponse(CamelModel):
    coefficient: float
    method: Literal["pearson", "spearman"]
    lag: int
    p_value: float | None
    n: int
    a: SeriesName
    b: SeriesName
    computation_method: str = Field(min_length=1)


class AlignedEvent(CamelModel):
    time: str
    labels: dict[str, Any]
    hours_before: float
    same_day: bool


class AlignMatch(CamelModel):
    target: AlignTarget
    events: list[AlignedEvent]


class EventsAlignResponse(CamelModel):
    matches: list[AlignMatch]
    computation_method: str = Field(min_length=1)
