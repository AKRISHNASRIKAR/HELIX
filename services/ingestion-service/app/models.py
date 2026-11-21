"""Request/response models for the ingestion service (camelCase on the wire).

Defined locally rather than in packages/contracts-py: these are the
service-to-service contract with apps/api and analytics-engine (see the
HELIX build spec, section B), not shared domain models.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic.alias_generators import to_camel

SemanticType = Literal[
    "datetime", "currency", "numeric", "identifier", "categorical", "boolean", "email", "text"
]


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class ConnectionSpec(CamelModel):
    type: Literal["POSTGRESQL", "CSV"]
    config: dict[str, Any] = Field(default_factory=dict)
    credentials: dict[str, Any] | None = None
    file_path: str | None = None


class SourceRequest(CamelModel):
    """Every request carries an inline `connection` OR `dataSourceId` + `organizationId`."""

    connection: ConnectionSpec | None = None
    data_source_id: str | None = None
    organization_id: str | None = None

    @model_validator(mode="after")
    def _one_source(self) -> SourceRequest:
        if self.connection is None and not (self.data_source_id and self.organization_id):
            raise ValueError("provide either `connection` or `dataSourceId` + `organizationId`")
        return self


class PreviewRequest(SourceRequest):
    table: str
    limit: int = Field(50, ge=1, le=500)


class ProfileRequest(SourceRequest):
    table: str
    sample_size: int = Field(10_000, ge=1, le=1_000_000)


class ExtractRequest(SourceRequest):
    table: str
    columns: list[str] | None = None
    limit: int = Field(200_000, ge=1, le=1_000_000)


class ColumnSchema(CamelModel):
    name: str
    type: str
    nullable: bool
    semantic_type: SemanticType


class TableSchema(CamelModel):
    table_name: str
    columns: list[ColumnSchema]
    row_count_estimate: int


class ConnectResponse(CamelModel):
    ok: bool
    schemas: list[TableSchema] | None = None
    error: str | None = None


class RowsResponse(CamelModel):
    columns: list[str]
    rows: list[dict[str, Any]]


class ColumnProfile(CamelModel):
    name: str
    type: str
    null_rate: float
    distinct_count: int
    semantic_type: SemanticType


class ProfileResponse(CamelModel):
    table: str
    row_count: int
    columns: list[ColumnProfile]
