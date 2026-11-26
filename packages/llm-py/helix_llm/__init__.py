"""helix_llm: optional LLM client for HELIX agents. See README.md."""

__version__ = "0.1.0"

from .client import (  # noqa: E402
    DEFAULT_MODEL,
    AnthropicLlm,
    FakeLlm,
    LlmClient,
    LlmError,
    llm_from_env,
)

__all__ = [
    "__version__",
    "DEFAULT_MODEL",
    "AnthropicLlm",
    "FakeLlm",
    "LlmClient",
    "LlmError",
    "llm_from_env",
]
