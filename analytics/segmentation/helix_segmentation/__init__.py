"""helix_segmentation: segment comparison for HELIX (no HTTP, no agents).

services/analytics-engine calls `compare_segments()` from POST /segments/compare
to find which slice of which dimension explains a metric's move on one day.
"""

from .compare import (
    MAX_DIMENSION_VALUES,
    MIN_CONCENTRATION,
    MIN_RELATIVE_MOVE,
    Change,
    Dimension,
    SegmentComparison,
    Slice,
    TopSlice,
    baseline_days,
    candidate_dimensions,
    compare_segments,
)

__all__ = [
    "MAX_DIMENSION_VALUES",
    "MIN_CONCENTRATION",
    "MIN_RELATIVE_MOVE",
    "Change",
    "Dimension",
    "SegmentComparison",
    "Slice",
    "TopSlice",
    "baseline_days",
    "candidate_dimensions",
    "compare_segments",
]
