from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="A2A_GATEWAY_", env_file=".env")

    service_name: str = "a2a-gateway"
    port: int = 8005
    log_level: str = "info"

    # Shared, unprefixed name (build spec section 1.3); A2A_GATEWAY_REDIS_URL works too.
    redis_url: str = Field(
        "redis://localhost:6379",
        validation_alias=AliasChoices("REDIS_URL", "A2A_GATEWAY_REDIS_URL"),
    )

    #: Default and maximum wait for a reply, in ms (POST /messages/request?timeoutMs=).
    default_timeout_ms: int = 60_000
    max_timeout_ms: int = 600_000
    #: How long GET /health waits for a Redis PING.
    health_timeout_s: float = 1.0


settings = Settings()
