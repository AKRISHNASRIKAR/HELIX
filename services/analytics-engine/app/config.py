from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="ANALYTICS_ENGINE_", env_file=".env")

    service_name: str = "analytics-engine"
    port: int = 8002
    database_url: str = "postgresql://helix:helix@localhost:5432/helix"
    log_level: str = "info"

    # Where datasets referenced by dataSourceId + table are fetched from (/extract).
    ingestion_service_url: str = Field(
        "http://localhost:8004",
        validation_alias=AliasChoices(
            "INGESTION_SERVICE_URL", "ANALYTICS_ENGINE_INGESTION_SERVICE_URL"
        ),
    )
    ingestion_timeout_seconds: float = 60.0
    # Row cap requested from ingestion /extract.
    extract_limit: int = 200_000


settings = Settings()
