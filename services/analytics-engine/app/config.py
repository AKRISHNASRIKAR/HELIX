from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="ANALYTICS_ENGINE_", env_file=".env")

    service_name: str = "analytics-engine"
    port: int = 8002
    database_url: str = "postgresql://helix:helix@localhost:5432/helix"
    log_level: str = "info"


settings = Settings()
