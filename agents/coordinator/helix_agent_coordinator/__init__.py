"""HELIX Coordinator Agent (Phase 5). See README.md."""

__version__ = "0.1.0"

from .agent import CAPABILITIES, CoordinatorAgent, Dispatch  # noqa: E402
from .planner import build_plan  # noqa: E402
from .progress import (  # noqa: E402
    NullProgressReporter,
    ProgressReporter,
    RecordingProgressReporter,
)
from .synthesis import ROOT_CAUSE_MIN_CONFIDENCE  # noqa: E402

__all__ = [
    "__version__",
    "CAPABILITIES",
    "ROOT_CAUSE_MIN_CONFIDENCE",
    "CoordinatorAgent",
    "Dispatch",
    "NullProgressReporter",
    "ProgressReporter",
    "RecordingProgressReporter",
    "build_plan",
]
