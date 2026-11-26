"""HELIX Coordinator Agent (Phases 5 to 7). See README.md."""

__version__ = "0.2.0"

from .agent import CAPABILITIES, CoordinatorAgent, Dispatch  # noqa: E402
from .context import DEFAULT_REQUIREMENTS, ContextProvider, assemble_locally  # noqa: E402
from .planner import (  # noqa: E402
    SYNTHESIS_OBJECTIVE,
    PlanValidationError,
    build_llm_plan,
    build_plan,
    validate_llm_plan,
)
from .progress import (  # noqa: E402
    NullProgressReporter,
    ProgressReporter,
    RecordingProgressReporter,
)
from .synthesis import (  # noqa: E402
    ROOT_CAUSE_MIN_CONFIDENCE,
    ROOT_CAUSE_MIN_SCORE,
    summary_numbers_ok,
)

__all__ = [
    "__version__",
    "CAPABILITIES",
    "DEFAULT_REQUIREMENTS",
    "ROOT_CAUSE_MIN_CONFIDENCE",
    "ROOT_CAUSE_MIN_SCORE",
    "SYNTHESIS_OBJECTIVE",
    "ContextProvider",
    "CoordinatorAgent",
    "Dispatch",
    "NullProgressReporter",
    "PlanValidationError",
    "ProgressReporter",
    "RecordingProgressReporter",
    "assemble_locally",
    "build_llm_plan",
    "build_plan",
    "summary_numbers_ok",
    "validate_llm_plan",
]
