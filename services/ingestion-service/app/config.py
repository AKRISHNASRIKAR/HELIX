from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="INGESTION_SERVICE_", env_file=".env")

    service_name: str = "ingestion-service"
    port: int = 8004
    database_url: str = "postgresql://helix:helix@localhost:5432/helix"
    log_level: str = "info"


settings = Settings()
