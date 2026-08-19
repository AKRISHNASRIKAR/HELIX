from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="AGENT_RUNTIME_", env_file=".env")

    service_name: str = "agent-runtime"
    port: int = 8001
    redis_url: str = "redis://localhost:6379"
    log_level: str = "info"


settings = Settings()
