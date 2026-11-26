from typing import Literal

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="AGENT_RUNTIME_", env_file=".env")

    service_name: str = "agent-runtime"
    port: int = 8001
    log_level: str = "info"

    # Shared, unprefixed names (build spec section 1.3); the prefixed
    # AGENT_RUNTIME_* spelling is accepted too.
    redis_url: str = Field(
        "redis://localhost:6379",
        validation_alias=AliasChoices("REDIS_URL", "AGENT_RUNTIME_REDIS_URL"),
    )
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
    #: Empty string = no context engine; the Coordinator hand-assembles contexts.
    context_engine_url: str = Field(
        "http://localhost:8003",
        validation_alias=AliasChoices("CONTEXT_ENGINE_URL", "AGENT_RUNTIME_CONTEXT_ENGINE_URL"),
    )
    a2a_gateway_url: str = Field(
        "http://localhost:8005",
        validation_alias=AliasChoices("A2A_GATEWAY_URL", "AGENT_RUNTIME_A2A_GATEWAY_URL"),
    )
    #: "gateway": tasks travel over services/a2a-gateway (in-process fallback when it
    #: is unavailable) and this process runs an A2A worker; "inprocess": direct calls.
    a2a_mode: Literal["gateway", "inprocess"] = Field(
        "gateway",
        validation_alias=AliasChoices("HELIX_A2A_MODE", "AGENT_RUNTIME_A2A_MODE"),
    )

    #: Per-request timeout for analytics-engine calls, in seconds.
    analytics_engine_timeout_s: float = 30.0
    #: Progress reports to the API are best effort and must not slow a run down.
    progress_timeout_s: float = 2.0
    #: Default AgentTask.timeoutMs the Coordinator gives each delegated task.
    task_timeout_ms: int = 60_000
    #: POST /context/assemble timeout, in seconds.
    context_engine_timeout_s: float = 10.0
    #: Extra time the gateway waits beyond a task's own timeoutMs before giving up.
    a2a_reply_margin_ms: int = 5_000
    #: How long startup waits for a Redis PING before running without a worker.
    redis_connect_timeout_s: float = 2.0


settings = Settings()
