from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="CONTEXT_ENGINE_", env_file=".env")

    service_name: str = "context-engine"
    port: int = 8003
    redis_url: str = "redis://localhost:6379"
    log_level: str = "info"


settings = Settings()
