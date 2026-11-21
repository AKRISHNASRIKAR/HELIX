"""Rule-based synthesis: root cause, overall confidence, status, summary, recommendations.

Pure functions over the collected findings/evidence so they are easy to test
and, later, easy to replace with an LLM writer. Nothing here computes a new
statistic from data (ADR-005): numbers in summaries and recommendations are
the pre-formatted values agents put in evidence.data.formatted.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID, uuid4

from helix_contracts import (
    AgentTaskStatus,
    AnalyticsType,
    RecommendationPriority,
    RunEvidence,
    RunFinding,
    RunRecommendation,
    RunStatus,
    RunTask,
)

#: A DIAGNOSTIC finding needs at least this confidence to be called the root cause.
ROOT_CAUSE_MIN_CONFIDENCE = 0.9
#: A KPI moving the wrong way by more than this many percentage points earns a recommendation.
KPI_CHANGE_THRESHOLD = 10.0

_HIGHER_IS_BETTER = {"revenue", "orders", "aov", "customers"}
_REFUND_METRICS = {"refunds", "refund_rate", "refund_amount"}
_PRIORITY_RANK = {
    RecommendationPriority.CRITICAL: 0,
    RecommendationPriority.HIGH: 1,
    RecommendationPriority.MEDIUM: 2,
    RecommendationPriority.LOW: 3,
}


def select_root_cause(findings: list[RunFinding]) -> RunFinding | None:
    """Highest-confidence DIAGNOSTIC finding at or above the bar. Ties keep the
    agent's ordering (the Analytics Agent ranks anomalies by relevance first)."""
    best: RunFinding | None = None
    for finding in findings:
        if finding.analytics_type != AnalyticsType.DIAGNOSTIC:
            continue
        if finding.confidence < ROOT_CAUSE_MIN_CONFIDENCE:
            continue
        if best is None or finding.confidence > best.confidence:
            best = finding
    return best


def overall_confidence(findings: list[RunFinding], root: RunFinding | None) -> float | None:
    if root is not None:
        return root.confidence
    if findings:
        return round(sum(f.confidence for f in findings) / len(findings), 4)
    return None


def run_status(tasks: list[RunTask]) -> RunStatus:
    succeeded = sum(1 for t in tasks if t.status == AgentTaskStatus.SUCCEEDED)
    if tasks and succeeded == len(tasks):
        return "COMPLETED"
    if succeeded > 0:
        return "PARTIALLY_COMPLETED"
    return "FAILED"


def _pct(value: float | None) -> str:
    return "n/a" if value is None else f"{value * 100:.1f}%"


def _agent_label(agent_type: str) -> str:
    return f"{agent_type.capitalize()} Agent"


def build_summary(
    status: RunStatus,
    tasks: list[RunTask],
    findings: list[RunFinding],
    root: RunFinding | None,
    confidence: float | None,
) -> str:
    failed = [t for t in tasks if t.status != AgentTaskStatus.SUCCEEDED]
    failure_text = "; ".join(
        f"{_agent_label(t.agent_type.value)}: {t.error or t.status.value}" for t in failed
    )
    if status == "FAILED":
        if not tasks:
            return "Investigation failed: the plan produced no agent tasks."
        return f"Investigation failed: no agent task completed ({failure_text})."

    parts: list[str] = []
    if status == "PARTIALLY_COMPLETED":
        parts.append(
            f"Partially completed: {len(failed)} of {len(tasks)} agent task(s) failed "
            f"({failure_text})."
        )
    if not findings:
        parts.append("The agents completed but produced no findings for this question.")
        return " ".join(parts)

    descriptive = next(
        (f for f in findings if f.analytics_type == AnalyticsType.DESCRIPTIVE), None
    )
    if root is not None:
        parts.append(f"Root cause: {root.statement}")
        if descriptive is not None:
            parts.append(f"Context: {descriptive.statement}")
    else:
        top = max(findings, key=lambda f: f.confidence)
        parts.append(
            f"No single finding reached the {ROOT_CAUSE_MIN_CONFIDENCE:.0%} confidence needed "
            f"to call a root cause. Strongest finding: {top.statement}"
        )
        if descriptive is not None and descriptive is not top:
            parts.append(f"Context: {descriptive.statement}")
    parts.append(f"{len(findings)} finding(s) in total; overall confidence {_pct(confidence)}.")
    return " ".join(parts)


# ---------------------------------------------------------------------------
# Recommendations
# ---------------------------------------------------------------------------


def _anomaly_recommendation(
    finding: RunFinding, data: dict[str, Any], is_root: bool
) -> RunRecommendation | None:
    key = data.get("metricKey")
    label = data.get("metricName") or key or "metric"
    direction = data.get("direction")
    fmt = data.get("formatted") or {}
    day = data.get("date") or fmt.get("day") or "the anomalous day"
    value, expected = fmt.get("value", "n/a"), fmt.get("expectedValue", "n/a")
    severity = data.get("severity") or "MEDIUM"
    severe = is_root or severity in ("HIGH", "CRITICAL")

    if key in _REFUND_METRICS and direction == "spike":
        return RunRecommendation(
            id=uuid4(),
            title=f"Investigate the refund spike on {day}",
            description=(
                f"{label.capitalize()} reached {value} on {day} against an expected {expected} "
                f"({severity} anomaly). Pull the refunded orders from that day and break them "
                "down by channel, product, and fulfilment partner; check for shipping delays, "
                "quality issues, duplicate charges, or a policy change around that date."
            ),
            priority=RecommendationPriority.HIGH if severe else RecommendationPriority.MEDIUM,
            expectedImpact=(
                f"Bringing {label} back toward the expected {expected} per day protects net "
                "revenue and stops the issue from compounding into churn."
            ),
            findingIds=[finding.id],
        )
    if key in _HIGHER_IS_BETTER and direction == "drop":
        return RunRecommendation(
            id=uuid4(),
            title=f"Investigate the {label} drop on {day}",
            description=(
                f"{label.capitalize()} was {value} on {day} against an expected {expected} "
                f"({severity} anomaly). Break that day down by channel, segment, and region to "
                "find where the shortfall is concentrated, then check releases, checkout or "
                "payment incidents, and tracking changes around that date."
            ),
            priority=RecommendationPriority.HIGH if severe else RecommendationPriority.MEDIUM,
            expectedImpact=(
                f"Recovering the gap between the observed {value} and the expected {expected} "
                f"of {label} on affected days, and catching a repeat within a day."
            ),
            findingIds=[finding.id],
        )
    if key in _HIGHER_IS_BETTER and direction == "spike":
        return RunRecommendation(
            id=uuid4(),
            title=f"Confirm the {label} spike on {day} is genuine",
            description=(
                f"{label.capitalize()} was {value} on {day} against an expected {expected}. "
                "Check for duplicate events, backfills, or a campaign before relying on it."
            ),
            priority=RecommendationPriority.LOW,
            expectedImpact="Keeps baselines and forecasts free of data-quality artefacts.",
            findingIds=[finding.id],
        )
    return None


def _kpi_recommendation(finding: RunFinding, data: dict[str, Any]) -> RunRecommendation | None:
    key = data.get("metricKey")
    change = data.get("changePercent")
    if change is None:
        return None
    label = data.get("metricName") or key or "metric"
    fmt = data.get("formatted") or {}
    pct = fmt.get("changePercent") or f"{abs(change):.1f}%"
    value, baseline = fmt.get("value", "n/a"), fmt.get("baseline", "n/a")
    period = fmt.get("period", "the latest window")

    if key in _HIGHER_IS_BETTER and change < -KPI_CHANGE_THRESHOLD:
        return RunRecommendation(
            id=uuid4(),
            title=f"Address the {pct} decline in {label}",
            description=(
                f"{label.capitalize()} fell {pct} to {value} over {period}, "
                f"from {baseline} in the previous window. Review what changed between the two "
                "windows (pricing, campaigns, product releases, channel mix)."
            ),
            priority=RecommendationPriority.MEDIUM,
            expectedImpact=f"Returning {label} to the previous window's {baseline}.",
            findingIds=[finding.id],
        )
    if key in _REFUND_METRICS and change > KPI_CHANGE_THRESHOLD:
        return RunRecommendation(
            id=uuid4(),
            title=f"Address the {pct} increase in {label}",
            description=(
                f"{label.capitalize()} rose {pct} to {value} over {period}, "
                f"from {baseline} in the previous window. Audit refund reasons for the period."
            ),
            priority=RecommendationPriority.MEDIUM,
            expectedImpact=f"Bringing {label} back to the previous window's {baseline}.",
            findingIds=[finding.id],
        )
    return None


def build_recommendations(
    findings: list[RunFinding],
    evidence_by_id: dict[UUID, RunEvidence],
    root: RunFinding | None,
) -> list[RunRecommendation]:
    recommendations: list[RunRecommendation] = []
    seen_titles: set[str] = set()
    for finding in findings:
        for evidence_id in finding.evidence_ids:
            evidence = evidence_by_id.get(evidence_id)
            if evidence is None:
                continue
            kind = evidence.data.get("kind")
            rec = None
            if finding.analytics_type == AnalyticsType.DIAGNOSTIC and kind == "anomaly":
                rec = _anomaly_recommendation(
                    finding, evidence.data, root is not None and finding.id == root.id
                )
            elif finding.analytics_type == AnalyticsType.DESCRIPTIVE and kind == "kpi":
                rec = _kpi_recommendation(finding, evidence.data)
            if rec is not None and rec.title not in seen_titles:
                seen_titles.add(rec.title)
                recommendations.append(rec)
    recommendations.sort(key=lambda r: _PRIORITY_RANK[r.priority])
    return recommendations
