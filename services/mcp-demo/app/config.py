from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="MCP_DEMO_", env_file=".env")

    service_name: str = "mcp-demo"
    #: MCP_DEMO_PORT. `pnpm dev` passes it to uvicorn; kept here for reference.
    port: int = 8006
    #: MCP_DEMO_TOKEN. When set, /mcp requires `Authorization: Bearer <token>`.
    token: str | None = None
    #: MCP_DEMO_FIXTURE_PATH. The deployments feed served by `list_deployments`.
    fixture_path: Path = REPO_ROOT / "tests" / "fixtures" / "deployments.json"


settings = Settings()
