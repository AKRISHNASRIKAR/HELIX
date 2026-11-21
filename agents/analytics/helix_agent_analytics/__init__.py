"""HELIX Analytics Agent (Phase 4). See README.md."""

__version__ = "0.1.0"

from .agent import CAPABILITIES, AnalyticsAgent  # noqa: E402
from .engine_client import (  # noqa: E402
    DEFAULT_ANALYTICS_ENGINE_URL,
    AnalyticsEngineClient,
    AnalyticsEngineError,
)
from .planner import AnalysisPlan, NoUsableDatasetError, plan_analysis  # noqa: E402

__all__ = [
    "__version__",
    "CAPABILITIES",
    "DEFAULT_ANALYTICS_ENGINE_URL",
    "AnalysisPlan",
    "AnalyticsAgent",
    "AnalyticsEngineClient",
    "AnalyticsEngineError",
    "NoUsableDatasetError",
    "plan_analysis",
]
