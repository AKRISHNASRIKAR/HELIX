"""HELIX Analytics Agent (Phase 4, segment step in Phase 7). See README.md.

Also the shared toolkit for the engine-backed domain agents (Finance,
Customer, Product): the engine client, planner column heuristics, record
builders (records.py), inputContext parsing (task_context.py), the
DomainAgent base (domain.py) and the fake engine (testing.py).
"""

__version__ = "0.2.0"

from .agent import CAPABILITIES, AnalyticsAgent  # noqa: E402
from .domain import AgentRun, DomainAgent, Focus  # noqa: E402
from .engine_client import (  # noqa: E402
    DEFAULT_ANALYTICS_ENGINE_URL,
    AnalyticsEngineClient,
    AnalyticsEngineError,
)
from .planner import AnalysisPlan, NoUsableDatasetError, plan_analysis  # noqa: E402
from .records import Outputs, Recorder  # noqa: E402
from .task_context import TaskContext, parse_task_context  # noqa: E402

__all__ = [
    "__version__",
    "CAPABILITIES",
    "DEFAULT_ANALYTICS_ENGINE_URL",
    "AgentRun",
    "AnalysisPlan",
    "AnalyticsAgent",
    "AnalyticsEngineClient",
    "AnalyticsEngineError",
    "DomainAgent",
    "Focus",
    "NoUsableDatasetError",
    "Outputs",
    "Recorder",
    "TaskContext",
    "parse_task_context",
    "plan_analysis",
]
