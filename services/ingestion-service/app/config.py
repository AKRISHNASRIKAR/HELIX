from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="INGESTION_SERVICE_", env_file=".env")

    service_name: str = "ingestion-service"
    port: int = 8004
    database_url: str = "postgresql://helix:helix@localhost:5432/helix"
    log_level: str = "info"

    # Shared with apps/api: used to resolve dataSourceId -> ConnectionSpec via
    # GET /api/v1/internal/data-sources/:id/connection.
    internal_token: str = Field(
        "dev-internal-token",
        validation_alias=AliasChoices("HELIX_INTERNAL_TOKEN", "INGESTION_SERVICE_INTERNAL_TOKEN"),
    )
    api_url: str = Field(
        "http://localhost:4000",
        validation_alias=AliasChoices("HELIX_API_URL", "INGESTION_SERVICE_API_URL"),
    )
    api_timeout_seconds: float = 10.0
    # Postgres connect timeout so an unreachable host fails fast instead of hanging.
    connect_timeout_seconds: int = 5
    # Per-statement timeout for discovery/preview/count queries (extract is exempt).
    statement_timeout_ms: int = 15000
    # Tables above this reltuples estimate use the estimate instead of count(*).
    exact_count_max_rows: int = 100_000
    # When set, CSV `filePath`s must resolve inside this directory (point it at
    # the API's HELIX_UPLOAD_DIR in shared deployments). Unset = any readable path.
    csv_root: str | None = None
    # Rows sampled per table to infer semanticType during /connect.
    connect_sample_rows: int = 500
    # Above this many tables, /connect infers semanticType from names/types only.
    connect_sample_max_tables: int = 50


settings = Settings()
