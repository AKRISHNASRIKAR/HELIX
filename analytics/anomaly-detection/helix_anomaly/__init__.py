"""helix_anomaly: anomaly detection algorithms for HELIX (no HTTP, no agents).

Pure functions over a daily metric series; services/analytics-engine turns the
results into contract-shaped Anomaly objects.
"""

from .detect import (
    MIN_POINTS,
    AnomalyPoint,
    DetectionResult,
    detect,
    iqr,
    robust_scale,
    robust_zscore,
    seasonal,
    seasonal_strength,
    severity_for,
)

__all__ = [
    "MIN_POINTS",
    "AnomalyPoint",
    "DetectionResult",
    "detect",
    "iqr",
    "robust_scale",
    "robust_zscore",
    "seasonal",
    "seasonal_strength",
    "severity_for",
]
