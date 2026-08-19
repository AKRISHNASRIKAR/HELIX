from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="A2A_GATEWAY_", env_file=".env")

    service_name: str = "a2a-gateway"
    port: int = 8005
    redis_url: str = "redis://localhost:6379"
    log_level: str = "info"


settings = Settings()
