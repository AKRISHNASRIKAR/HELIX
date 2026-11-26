"""Synthesis: root cause, overall confidence, status, summary, recommendations.

Pure functions over the collected findings/evidence so they are easy to test.
Nothing here computes a new statistic from data (ADR-005): the root cause is
ranked by helix_root_cause from the confidences agents derived, and numbers in
summaries and recommendations are values agents put in evidence.data.

Root cause (Phase 7):
- rank_root_causes() builds one candidate per anchor anomaly, enriched with
  segment / event / co-anomaly evidence. When the top candidate is enriched
  and scores >= ROOT_CAUSE_MIN_SCORE, it becomes a new COORDINATOR DIAGNOSTIC
  finding (isRootCause, confidence = score) linked to all contributing
  evidence plus the `root_cause_ranking` evidence.
- When only a bare anomaly exists (no enrichments), the Phase 5 rule applies:
  the highest-confidence DIAGNOSTIC finding with confidence >= 0.9.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

from helix_contracts import (
    AgentTaskStatus,
    AgentType,
    AnalyticsType,
    EvidenceSourceType,
    RecommendationPriority,
    RunEvidence,
    RunFinding,
    RunRecommendation,
    RunStatus,
    RunTask,
)
from helix_root_cause import METHOD, RootCauseCandidate, rank_root_causes

#: Phase 5: a DIAGNOSTIC finding needs at least this confidence to be called the root cause.
ROOT_CAUSE_MIN_CONFIDENCE = 0.9
#: Phase 7: a synthesized candidate needs at least this score.
ROOT_CAUSE_MIN_SCORE = 0.75
#: A KPI moving the wrong way by more than this many percentage points earns a recommendation.
KPI_CHANGE_THRESHOLD = 10.0

_HIGHER_IS_BETTER = {"revenue", "orders", "aov", "customers"}
_REFUND_METRICS = {"refunds", "refund_rate", "refund_amount"}
_ROLLED_BACK = {"rolled_back", "rollback", "rolled-back"}
_PRIORITY_RANK = {
    RecommendationPriority.CRITICAL: 0,
    RecommendationPriority.HIGH: 1,
    RecommendationPriority.MEDIUM: 2,
    RecommendationPriority.LOW: 3,
}


def select_root_cause(findings: list[RunFinding]) -> RunFinding | None:
    """Phase 5 rule: highest-confidence DIAGNOSTIC finding at or above the bar.
    Ties keep the agent's ordering (the Analytics Agent ranks anomalies first)."""
    best: RunFinding | None = None
    for finding in findings:
        if finding.analytics_type != AnalyticsType.DIAGNOSTIC:
            continue
        if finding.confidence < ROOT_CAUSE_MIN_CONFIDENCE:
            continue
        if best is None or finding.confidence > best.confidence:
            best = finding
    return best


@dataclass
class RootCauseOutcome:
    ranking_evidence: RunEvidence
    candidates: list[RootCauseCandidate] = field(default_factory=list)
    #: The top candidate when it is enriched (Phase 7 path), else None.
    candidate: RootCauseCandidate | None = None
    #: The root cause finding: the new COORDINATOR finding, or (Phase 5
    #: fallback) an existing agent finding. None when nothing qualifies.
    root: RunFinding | None = None
    #: True when `root` was created by the Coordinator (append it to findings).
    synthesized: bool = False
    method: str = "phase5"


def synthesize_root_cause(
    findings: list[RunFinding],
    evidence: list[RunEvidence],
    *,
    synthesis_task_id: UUID,
    metric_key: str | None = None,
) -> RootCauseOutcome:
    candidates = rank_root_causes(findings, evidence, metric_key=metric_key)
    top = candidates[0] if candidates else None
    enriched = top is not None and top.enriched
    selected = top if enriched and top.score >= ROOT_CAUSE_MIN_SCORE else None

    ranking = RunEvidence(
        id=uuid4(),
        agentTaskId=synthesis_task_id,
        sourceType=EvidenceSourceType.METRIC,
        source={
            "agentTaskId": synthesis_task_id,
            "description": "Coordinator root-cause ranking (helix_root_cause)",
        },
        summary=(
            f"Ranked {len(candidates)} root-cause candidate(s)"
            + (f"; selected one at score {selected.formatted['score']}." if selected else ".")
        ),
        data={
            "kind": "root_cause_ranking",
            "candidates": [
                {
                    "id": c.id,
                    "statement": c.statement,
                    "score": c.score,
                    "components": c.components,
                    "contributingEvidenceIds": [str(i) for i in c.contributing_evidence_ids],
                    "contributingFindingIds": [str(i) for i in c.contributing_finding_ids],
                    "formatted": c.formatted,
                }
                for c in candidates
            ],
            "selectedCandidateId": selected.id if selected else None,
            "threshold": ROOT_CAUSE_MIN_SCORE,
            "method": METHOD,
            "formatted": {"score": top.formatted["score"] if top else "n/a"},
        },
        confidence=top.score if top else 0.0,
        collectedAt=datetime.now(UTC),
    )
    outcome = RootCauseOutcome(ranking_evidence=ranking, candidates=candidates)

    if not enriched:
        # Phase 5 fallback: a bare anomaly (or nothing rankable).
        outcome.root = select_root_cause(findings)
        return outcome

    outcome.method = "ranked"
    outcome.candidate = top
    if selected is not None:
        outcome.root = RunFinding(
            id=uuid4(),
            agentTaskId=synthesis_task_id,
            agentType=AgentType.COORDINATOR,
            analyticsType=AnalyticsType.DIAGNOSTIC,
            statement=selected.statement,
            confidence=selected.score,
            isRootCause=True,
            evidenceIds=[*selected.contributing_evidence_ids, ranking.id],
        )
        outcome.synthesized = True
    return outcome


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
    candidate: RootCauseCandidate | None = None,
) -> str:
    """`tasks` are the domain tasks (the synthesis task is not a failure source)."""
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
    elif candidate is not None:
        parts.append(
            f"No root-cause candidate reached the {ROOT_CAUSE_MIN_SCORE:.0%} score needed to "
            f"call a root cause. Strongest candidate (score {candidate.formatted['score']}): "
            f"{candidate.statement}"
        )
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
# LLM summary writer (optional) and its number guard
# ---------------------------------------------------------------------------

LLM_SUMMARY_SYSTEM = (
    "You write the executive summary of a data investigation for business readers. Use "
    "only the facts given. Lead with the root cause (or say that none was established and "
    "name the strongest candidate), then the most important supporting findings and the top "
    "recommendation. Plain prose, 2 to 5 sentences, no markdown, no em dashes. Every number "
    "you write must be copied exactly from the input; never compute, round or invent one."
)

SUMMARY_SCHEMA = {
    "type": "object",
    "properties": {"summary": {"type": "string"}},
    "required": ["summary"],
    "additionalProperties": False,
}

_NUMBER_RE = re.compile(r"\d+(?:[.,]\d+)*")


def _numbers(text: str) -> set[float]:
    out: set[float] = set()
    for token in _NUMBER_RE.findall(text):
        # "13,174.00" -> 13174.0; date parts "2026-10-08" -> 2026, 10, 8.
        cleaned = token.replace(",", "")
        try:
            out.add(round(float(cleaned), 6))
        except ValueError:
            continue
    return out


def _formatted_texts(evidence: list[RunEvidence]) -> list[str]:
    texts: list[str] = []

    def walk(value: Any) -> None:
        if isinstance(value, dict):
            for item in value.values():
                walk(item)
        elif isinstance(value, list):
            for item in value:
                walk(item)
        elif isinstance(value, str):
            texts.append(value)

    for e in evidence:
        walk((e.data or {}).get("formatted") or {})
        for candidate in (e.data or {}).get("candidates") or []:
            walk(candidate.get("formatted") or {})
    return texts


def summary_numbers_ok(summary: str, allowed_texts: list[str]) -> list[str]:
    """Number tokens in `summary` that do not appear (by value) in the allowed
    texts. Empty list = the summary passes the guard."""
    allowed = set().union(*(_numbers(t) for t in allowed_texts)) if allowed_texts else set()
    bad: list[str] = []
    for token in _NUMBER_RE.findall(summary):
        try:
            value = round(float(token.replace(",", "")), 6)
        except ValueError:
            continue
        if value not in allowed and token not in bad:
            bad.append(token)
    return bad


def summary_inputs(
    *,
    question: str,
    status: RunStatus,
    root: RunFinding | None,
    candidate: RootCauseCandidate | None,
    findings: list[RunFinding],
    recommendations: list[RunRecommendation],
    evidence: list[RunEvidence],
) -> tuple[str, list[str]]:
    """(user prompt, allowed texts for the number guard)."""
    statements = [f.statement for f in findings]
    titles = [r.title for r in recommendations]
    lines = [f"Question: {question}", f"Run status: {status}"]
    if root is not None:
        lines.append(f"Root cause (confidence {_pct(root.confidence)}): {root.statement}")
    elif candidate is not None:
        lines.append(
            f"No root cause established. Strongest candidate (score "
            f"{candidate.formatted['score']}): {candidate.statement}"
        )
    else:
        lines.append("No root cause established.")
    lines.append("Findings:")
    lines += [f"- {s}" for s in statements]
    lines.append("Recommendations:")
    lines += [f"- {t}" for t in titles]
    allowed = [question, *statements, *titles, *_formatted_texts(evidence)]
    if root is not None:
        allowed.append(_pct(root.confidence))
    if candidate is not None:
        allowed.append(candidate.formatted["score"])
    return "\n".join(lines), allowed


# ---------------------------------------------------------------------------
# Recommendations
# ---------------------------------------------------------------------------


def _anomaly_recommendation(
    finding: RunFinding, data: dict[str, Any], is_root: bool, links: list[UUID]
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
            findingIds=links,
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
            findingIds=links,
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
            findingIds=links,
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


def _segment_recommendation(data: dict[str, Any], links: list[UUID]) -> RunRecommendation | None:
    top = data.get("topSlice")
    if not isinstance(top, dict) or data.get("direction") not in (None, "drop"):
        return None
    try:
        if float(top.get("deltaPercent")) >= 0:
            return None  # the slice rose: nothing broke in it
    except (TypeError, ValueError):
        pass
    column, value = top.get("column"), top.get("value")
    day = data.get("date") or "the anomalous day"
    label = data.get("metricName") or data.get("metricKey") or "the metric"
    fmt = data.get("formatted") or {}
    actual, expected = fmt.get("actual"), fmt.get("expected")
    numbers = ""
    if actual and expected:
        numbers = f" ({label} was {actual} against an expected {expected})"
    noun = "channel" if column == "channel" else f"{column} = {value} slice"
    subject = f"the {value} channel" if column == "channel" else f"the {column} = {value} slice"
    return RunRecommendation(
        id=uuid4(),
        title=f"Investigate {subject} on {day}",
        description=(
            f"The drop on {day} is concentrated in {column} = {value}{numbers}. Walk the "
            f"checkout and payment funnel for that {noun} step by step (page loads, add to "
            "cart, checkout start, payment authorisation, confirmation) and compare error "
            "rates and conversion with the other slices for the same day."
        ),
        priority=RecommendationPriority.HIGH,
        expectedImpact=(
            f"Pinpoints the broken step in {subject} so the lost {label} can be recovered."
        ),
        findingIds=links,
    )


#: Event alignments below this confidence are context, not a lead worth a recommendation.
EVENT_RECOMMENDATION_MIN_CONFIDENCE = 0.5


def _event_recommendation(
    data: dict[str, Any], links: list[UUID], confidence: float = 1.0
) -> RunRecommendation | None:
    if confidence < EVENT_RECOMMENDATION_MIN_CONFIDENCE or data.get("revert"):
        return None
    labels = (data.get("event") or {}).get("labels") or {}
    name = " ".join(str(x) for x in (labels.get("service"), labels.get("version")) if x)
    name = name or labels.get("description") or "aligned"
    status = str(labels.get("status") or "").lower()
    keyword = bool(data.get("keywordMatch"))
    # Name the deploy's own day, not the anomaly day it was aligned with.
    day = str((data.get("event") or {}).get("time") or data.get("date") or "")[:10]
    day = day or "the anomalous day"
    if keyword and status in _ROLLED_BACK:
        return RunRecommendation(
            id=uuid4(),
            title=f"Review the {name} deploy",
            description=(
                f"The {name} deploy on {day} lines up with the drop and was rolled back. "
                "Confirm the rollback fixed it (the affected metric is back to its expected "
                "range since the rollback), write up what broke, and add a checkout "
                "success-rate alert so a repeat is caught within minutes."
            ),
            priority=RecommendationPriority.CRITICAL,
            expectedImpact="Closes the incident and shortens detection of the next one.",
            findingIds=links,
        )
    return RunRecommendation(
        id=uuid4(),
        title=f"Review the {name} deploy",
        description=(
            f"The {name} deploy on {day} lines up with the anomaly"
            + (f" and touches {', '.join(data['keywordMatch'])}" if keyword else "")
            + ". Check its change log and error rates around the release, and roll it back "
            "if the affected metric has not recovered."
        ),
        priority=RecommendationPriority.HIGH,
        expectedImpact="Rules the release in or out as the trigger and limits further impact.",
        findingIds=links,
    )


def build_recommendations(
    findings: list[RunFinding],
    evidence_by_id: dict[UUID, RunEvidence],
    root: RunFinding | None,
) -> list[RunRecommendation]:
    root_evidence = set(root.evidence_ids) if root is not None else set()
    recommendations: list[RunRecommendation] = []
    seen: set[str] = set()
    for finding in findings:
        if finding.agent_type == AgentType.COORDINATOR:
            continue  # the synthesized finding only links; agents' findings drive rules
        for evidence_id in finding.evidence_ids:
            evidence = evidence_by_id.get(evidence_id)
            if evidence is None:
                continue
            data = evidence.data
            kind = data.get("kind")
            links = [finding.id]
            in_root = evidence_id in root_evidence
            if root is not None and in_root and root.id not in links:
                links.append(root.id)
            rec = None
            if finding.analytics_type == AnalyticsType.DIAGNOSTIC and kind in (
                "anomaly", "co_anomaly"
            ):
                is_root = root is not None and (finding.id == root.id or in_root)
                rec = _anomaly_recommendation(finding, data, is_root, links)
            elif finding.analytics_type == AnalyticsType.DESCRIPTIVE and kind == "kpi":
                rec = _kpi_recommendation(finding, data)
            elif kind in ("segment", "segment_volume"):
                rec = _segment_recommendation(data, links)
            elif kind == "event_alignment":
                rec = _event_recommendation(data, links, evidence.confidence)
            if rec is None:
                continue
            if rec.title in seen:
                continue  # first finding wins, as in Phase 5
            seen.add(rec.title)
            recommendations.append(rec)
    recommendations.sort(key=lambda r: _PRIORITY_RANK[r.priority])
    return recommendations
