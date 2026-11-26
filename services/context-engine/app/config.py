from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="CONTEXT_ENGINE_", env_file=".env")

    service_name: str = "context-engine"
    port: int = 8003
    log_level: str = "info"

    # Shared, unprefixed names (build spec section 1.3); the prefixed
    # CONTEXT_ENGINE_* spelling is accepted too.
    redis_url: str = Field(
        "redis://localhost:6379",
        validation_alias=AliasChoices("REDIS_URL", "CONTEXT_ENGINE_REDIS_URL"),
    )
    helix_api_url: str = Field(
        "http://localhost:4000",
        validation_alias=AliasChoices("HELIX_API_URL", "CONTEXT_ENGINE_HELIX_API_URL"),
    )
    internal_token: str = Field(
        "dev-internal-token",
        validation_alias=AliasChoices("HELIX_INTERNAL_TOKEN", "CONTEXT_ENGINE_INTERNAL_TOKEN"),
    )

    #: History is best effort: a slow API must not hold up an investigation.
    history_timeout_s: float = 3.0
    #: Cap on each history list (metrics, anomalies, findings) fetched from the API.
    history_limit: int = 50


settings = Settings()
