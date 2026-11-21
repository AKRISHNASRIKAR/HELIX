from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="AGENT_RUNTIME_", env_file=".env")

    service_name: str = "agent-runtime"
    port: int = 8001
    redis_url: str = "redis://localhost:6379"
    log_level: str = "info"

    # Shared, unprefixed names (build spec "Global env vars"); the prefixed
    # AGENT_RUNTIME_* spelling is accepted too.
    analytics_engine_url: str = Field(
        "http://localhost:8002",
        validation_alias=AliasChoices("ANALYTICS_ENGINE_URL", "AGENT_RUNTIME_ANALYTICS_ENGINE_URL"),
    )
    helix_api_url: str = Field(
        "http://localhost:4000",
        validation_alias=AliasChoices("HELIX_API_URL", "AGENT_RUNTIME_HELIX_API_URL"),
    )
    internal_token: str = Field(
        "dev-internal-token",
        validation_alias=AliasChoices("HELIX_INTERNAL_TOKEN", "AGENT_RUNTIME_INTERNAL_TOKEN"),
    )

    #: Per-request timeout for analytics-engine calls, in seconds.
    analytics_engine_timeout_s: float = 30.0
    #: Progress reports to the API are best effort and must not slow a run down.
    progress_timeout_s: float = 2.0
    #: Default AgentTask.timeoutMs the Coordinator gives each delegated task.
    task_timeout_ms: int = 60_000


settings = Settings()
