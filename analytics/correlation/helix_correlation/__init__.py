"""helix_correlation: correlation and temporal event alignment for HELIX
(no HTTP, no agents).

services/analytics-engine calls `correlate()` from POST /correlation and
`align_events()` from POST /events/align.
"""

from .correlate import MAX_LAG, MIN_OVERLAP, CorrelationResult, LagResult, correlate
from .events import EventMatch, TargetAlignment, align_events

__all__ = [
    "MAX_LAG",
    "MIN_OVERLAP",
    "CorrelationResult",
    "EventMatch",
    "LagResult",
    "TargetAlignment",
    "align_events",
    "correlate",
]
