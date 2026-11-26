"""Root-cause candidate ranking.

rank_root_causes() turns the findings and evidence that HELIX agents produced
for one investigation into ranked RootCauseCandidates. It never computes a new
statistic from data (ADR-005): it only combines confidences the agents already
derived and quotes numbers that are present in evidence.data.

Candidates
----------
One candidate per *anchor*: an `anomaly` evidence on the question's metric
(`metric_key`, default: the metricKey of the first `anomaly` evidence, which
is the Analytics Agent's top-ranked anomaly because step 0 is collected
first). Anchors keep their input order, so ties keep the agent's ranking.
Each candidate is enriched with the evidence that explains the same day:

- segment (s): `segment` / `segment_volume` evidence with the same date and a
  non-null topSlice; s = max(concentration), clipped to [0, 1].
- event (e): `event_alignment` evidence with the same date; the event with a
  keywordMatch is preferred, then the highest confidence; e = its confidence
  (the Product Agent already folds keyword relevance into it).
- co-anomaly (c): `co_anomaly` evidence, or `anomaly` evidence on another
  metric, dated within 1 day of the anchor; c = max(confidence).
- correlation: `correlation` evidence linking the anchor metric to a
  co-anomaly metric with |coefficient| >= 0.5. Contributing evidence and an
  informational component only; it does not change the score.
- ruled out: `segment_neutral` evidence on the same date. Mentioned in the
  statement and linked as evidence; it does not change the score.

Score
-----
    a = anomaly confidence * 0.7          (an anomaly alone caps at 0.7)
    score = 1 - (1 - a) * (1 - 0.6 s) * (1 - 0.5 e) * (1 - 0.2 c)

Each factor is in [0, 1] and non-increasing in its component, so the score is
deterministic, in [0, 1], and monotonic (non-decreasing) in a, s, e and c.
Rounded to 4 decimals. Candidates are sorted by score desc (stable).
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from typing import Any
from uuid import UUID

from helix_contracts import RunEvidence, RunFinding
from pydantic import BaseModel, ConfigDict, Field

ANOMALY_WEIGHT = 0.7
SEGMENT_WEIGHT = 0.6
EVENT_WEIGHT = 0.5
CO_ANOMALY_WEIGHT = 0.2
CORRELATION_MIN = 0.5
METHOD = (
    "helix_root_cause v1: score = 1 - (1 - 0.7*anomaly) * (1 - 0.6*segment) "
    "* (1 - 0.5*event) * (1 - 0.2*coAnomaly)"
)

_SEGMENT_KINDS = ("segment", "segment_volume")
#: Metrics an order-volume breakdown (`segment_volume`) can explain. A refund
#: spike is not explained by which channel had more orders that day.
_VOLUME_METRICS = {"revenue", "orders", "aov", "customers", "completed_revenue"}
_REVERT_WORDS = ("revert", "rollback", "roll back", "rolled back", "hotfix", "undo")


class RootCauseCandidate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    statement: str
    score: float = Field(ge=0, le=1)
    #: anomaly, segment, event, coAnomaly (score inputs, each 0..1) plus the
    #: informational correlation component.
    components: dict[str, float] = Field(default_factory=dict)
    contributing_finding_ids: list[UUID] = Field(
        default_factory=list, alias="contributingFindingIds"
    )
    contributing_evidence_ids: list[UUID] = Field(
        default_factory=list, alias="contributingEvidenceIds"
    )
    anomaly_evidence_id: UUID | None = Field(default=None, alias="anomalyEvidenceId")
    #: Display strings for every number quoted in `statement`.
    formatted: dict[str, str] = Field(default_factory=dict)

    @property
    def enriched(self) -> bool:
        """True when anything beyond the bare anomaly contributed to the score."""
        return any(self.components.get(k, 0.0) > 0 for k in ("segment", "event", "coAnomaly"))


def score_components(anomaly: float, segment: float, event: float, co_anomaly: float) -> float:
    """The documented score formula. Inputs are clipped to [0, 1]."""
    a = _clip(anomaly) * ANOMALY_WEIGHT
    s, e, c = _clip(segment), _clip(event), _clip(co_anomaly)
    score = 1 - (1 - a) * (1 - SEGMENT_WEIGHT * s) * (1 - EVENT_WEIGHT * e) * (
        1 - CO_ANOMALY_WEIGHT * c
    )
    return round(_clip(score), 4)


def rank_root_causes(
    findings: list[RunFinding],
    evidence: list[RunEvidence],
    *,
    metric_key: str | None = None,
) -> list[RootCauseCandidate]:
    anomalies = [e for e in evidence if _kind(e) == "anomaly"]
    if not anomalies:
        return []
    metric_key = metric_key or anomalies[0].data.get("metricKey")
    anchors = [e for e in anomalies if e.data.get("metricKey") == metric_key] or anomalies[:1]

    candidates = [_candidate(anchor, findings, evidence) for anchor in anchors]
    candidates.sort(key=lambda c: -c.score)
    return candidates


# ---------------------------------------------------------------------------
# One candidate
# ---------------------------------------------------------------------------


def _candidate(
    anchor: RunEvidence, findings: list[RunFinding], evidence: list[RunEvidence]
) -> RootCauseCandidate:
    data = anchor.data
    day = _day(data.get("date") or data.get("timestamp"))
    metric_key = data.get("metricKey")
    contributing: list[RunEvidence] = [anchor]
    formatted: dict[str, str] = {}

    same_day = [e for e in evidence if e is not anchor and _day(e.data.get("date")) == day]

    # where: segment concentration ------------------------------------------
    segments = [
        e for e in same_day
        if _kind(e) in _SEGMENT_KINDS
        and isinstance(e.data.get("topSlice"), dict)
        and _segment_applies(e, metric_key)
    ]
    segment_score = max((_clip(_num(e.data.get("concentration"))) for e in segments), default=0.0)
    contributing += segments
    primary_segment = _pick_segment(segments, metric_key)

    # trigger: aligned event ------------------------------------------------
    events = [e for e in same_day if _kind(e) == "event_alignment"]
    # A revert or hotfix is a response to the problem, not its trigger.
    events.sort(key=lambda e: (_is_revert(e), not e.data.get("keywordMatch"), -e.confidence))
    event = events[0] if events else None
    event_score = event.confidence if event else 0.0
    if event is not None:
        contributing.append(event)

    # related: co-anomalies on other metrics within 1 day ---------------------
    related = [
        e for e in evidence
        if e is not anchor
        and not _same_anomaly(e, metric_key, day)
        and (
            _kind(e) == "co_anomaly"
            or (_kind(e) == "anomaly" and e.data.get("metricKey") != metric_key)
        )
        and _within_one_day(_day(e.data.get("date") or e.data.get("timestamp")), day)
    ]
    co_score = max((e.confidence for e in related), default=0.0)
    contributing += related
    related_keys = {e.data.get("metricKey") for e in related}

    correlations = [
        e for e in evidence
        if _kind(e) == "correlation"
        and abs(_num(e.data.get("coefficient"))) >= CORRELATION_MIN
        and {e.data.get("metricKey"), e.data.get("otherMetricKey")} & {metric_key}
        and {e.data.get("metricKey"), e.data.get("otherMetricKey")} & related_keys
    ]
    contributing += correlations
    correlation_score = max((abs(_num(e.data.get("coefficient"))) for e in correlations),
                            default=0.0)

    # ruled out: segment_neutral ---------------------------------------------
    neutral = [e for e in same_day if _kind(e) == "segment_neutral"]
    contributing += neutral

    components = {
        "anomaly": round(_clip(anchor.confidence), 4),
        "segment": round(segment_score, 4),
        "event": round(_clip(event_score), 4),
        "coAnomaly": round(_clip(co_score), 4),
        "correlation": round(_clip(correlation_score), 4),
    }
    score = score_components(
        components["anomaly"], components["segment"], components["event"], components["coAnomaly"]
    )

    statement = _statement(
        anchor, day, primary_segment, segments, event, related, neutral, formatted
    )
    formatted["score"] = f"{score * 100:.1f}%"

    evidence_ids = _unique(e.id for e in contributing)
    id_set = set(evidence_ids)
    finding_ids = _unique(f.id for f in findings if id_set.intersection(f.evidence_ids))
    return RootCauseCandidate(
        id=f"anomaly:{anchor.id}",
        statement=statement,
        score=score,
        components=components,
        contributingFindingIds=finding_ids,
        contributingEvidenceIds=evidence_ids,
        anomalyEvidenceId=anchor.id,
        formatted=formatted,
    )


def _segment_applies(e: RunEvidence, metric_key: str | None) -> bool:
    if e.data.get("metricKey") == metric_key:
        return True
    return _kind(e) == "segment_volume" and metric_key in _VOLUME_METRICS


def _same_anomaly(e: RunEvidence, metric_key: str | None, day: date | None) -> bool:
    """Another agent's record of the anchor anomaly itself (same metric, same day)."""
    return e.data.get("metricKey") == metric_key and _day(
        e.data.get("date") or e.data.get("timestamp")
    ) == day


def _is_revert(e: RunEvidence) -> bool:
    labels = (e.data.get("event") or {}).get("labels") or {}
    text = " ".join(str(labels.get(k) or "") for k in ("description", "version", "status")).lower()
    return any(word in text for word in _REVERT_WORDS)


def _pick_segment(segments: list[RunEvidence], metric_key: str | None) -> RunEvidence | None:
    """Prefer a `segment` on the anchor metric, then any segment, by concentration."""
    if not segments:
        return None

    def key(e: RunEvidence):
        return (
            _kind(e) != "segment",
            e.data.get("metricKey") != metric_key,
            -_num(e.data.get("concentration")),
        )

    return sorted(segments, key=key)[0]


# ---------------------------------------------------------------------------
# Statement
# ---------------------------------------------------------------------------


def _statement(
    anchor: RunEvidence,
    day: date | None,
    segment: RunEvidence | None,
    segments: list[RunEvidence],
    event: RunEvidence | None,
    related: list[RunEvidence],
    neutral: list[RunEvidence],
    formatted: dict[str, str],
) -> str:
    data = anchor.data
    fmt = data.get("formatted") or {}
    label = data.get("metricName") or data.get("metricKey") or "The metric"
    unit = data.get("unit")
    direction = data.get("direction") or (
        "drop" if _num(data.get("deviationScore")) < 0 else "spike"
    )
    is_drop = direction == "drop"
    verb = "dropped" if is_drop else "spiked"
    day_text = fmt.get("day") or (_format_day(day) if day else "the anomalous day")
    formatted["day"] = day_text

    # what / when
    total = (segment.data.get("total") if segment is not None else None) or {}
    if segment is not None and segment.data.get("metricKey") == data.get("metricKey") and (
        total.get("deltaPercent") is not None
    ):
        pct = _pct(abs(_num(total.get("deltaPercent"))))
        formatted["changePercent"] = pct
        what = f"{_cap(label)} {verb} {pct} on {day_text}"
    else:
        value = fmt.get("value") or _value(data.get("value"), unit)
        expected = fmt.get("expectedValue") or _value(data.get("expectedValue"), unit)
        formatted["value"], formatted["expectedValue"] = value, expected
        what = f"{_cap(label)} {verb} on {day_text} ({value} against an expected {expected})"

    # where
    where = ""
    if segment is not None:
        top = segment.data["topSlice"]
        column, slice_value = top.get("column"), top.get("value")
        share_value = abs(_num(top.get("shareOfDelta")))
        share = _pct(share_value * 100)
        formatted["shareOfDelta"] = share
        move = "shortfall" if is_drop else "increase"
        amount = ""
        if total.get("delta") is not None:
            seg_unit = segment.data.get("unit") or unit
            amount = _value(abs(_num(total.get("delta"))), seg_unit)
            formatted["totalDelta"] = amount
        whole = f"{amount} {move}" if amount else move
        if share_value > 1:
            # The slice moved more than the total; other slices partly offset it.
            explain = (
                f"{column} = {slice_value} alone accounts for more than the full {whole}, "
                f"while other {column} values moved the other way"
            )
        else:
            explain = f"{column} = {slice_value} explains {share} of the {whole}"
        volume = next(
            (
                s for s in segments
                if _kind(s) == "segment_volume"
                and (s.data.get("topSlice") or {}).get("value") == slice_value
                and _num((s.data.get("topSlice") or {}).get("deltaPercent")) <= -50
            ),
            None,
        )
        if volume is not None and is_drop:
            noun = (volume.data.get("metricName") or volume.data.get("metricKey") or "orders")
            where = f" because {slice_value} {noun.lower()} collapsed ({explain})"
        else:
            where = f", concentrated in {column} = {slice_value} ({explain})"

    # trigger
    trigger = ""
    if event is not None:
        trigger = _event_text(event, formatted)

    # related
    related_text = ""
    if related:
        by_metric: dict[str, list[str]] = {}
        names: dict[str, str] = {}
        verbs: dict[str, str] = {}
        for e in related:
            key = e.data.get("metricKey") or "metric"
            names[key] = (e.data.get("metricName") or key).lower()
            verbs[key] = "dropped" if e.data.get("direction") == "drop" else "spiked"
            d = _day(e.data.get("date") or e.data.get("timestamp"))
            text = d.isoformat() if d else "an adjacent day"
            if text not in by_metric.setdefault(key, []):
                by_metric[key].append(text)
        parts = [
            f"{names[k]} also {verbs[k]} on {_join(sorted(dates))}"
            for k, dates in by_metric.items()
        ]
        related_text = "; " + "; ".join(parts)

    sentence = f"{what}{where}{trigger}{related_text}."

    # ruled out
    if neutral:
        columns: list[str] = []
        for e in neutral:
            dims = e.data.get("dimensions") or []
            cols = [d.get("column") for d in dims if isinstance(d, dict) and d.get("column")]
            if not cols and isinstance(e.data.get("topSlice"), dict):
                cols = [e.data["topSlice"].get("column")]
            for col in cols:
                if col and col not in columns:
                    columns.append(col)
        what_ruled = (
            f"Customer {_join(columns)} mix" if columns else "Customer segment mix"
        )
        sentence += f" {what_ruled} was ruled out as the driver."
    return sentence


def _event_text(event: RunEvidence, formatted: dict[str, str]) -> str:
    data = event.data
    ev = data.get("event") or {}
    labels = ev.get("labels") or {}
    name = " ".join(str(x) for x in (labels.get("service"), labels.get("version")) if x)
    name = name or labels.get("description") or "a change"
    when = _parse_time(ev.get("time"))
    clock = when.strftime("%H:%M UTC") if when else None
    if clock:
        formatted["eventTime"] = clock
    status = str(labels.get("status") or "").lower()
    suffix = ""
    if status in ("rolled_back", "rollback", "rolled-back"):
        suffix = " (later rolled back)"
    elif status in ("failed", "failure"):
        suffix = " (the deploy failed)"

    if data.get("sameDay") or _num(data.get("hoursBefore")) <= 0:
        at = f" at {clock}" if clock else ""
        return f", starting shortly after the {name} deploy{at}{suffix}"
    hours = _num(data.get("hoursBefore"))
    hours_text = f"{hours:.1f}"
    formatted["hoursBefore"] = hours_text
    on = f" on {when.date().isoformat()}" if when else ""
    at = f" at {clock}{on}" if clock else on
    return (
        f", following the {name} deploy{at}{suffix}, {hours_text} hours before that day began"
    )


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------


def _kind(e: RunEvidence) -> str | None:
    return (e.data or {}).get("kind")


def _clip(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


def _num(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _parse_time(value: Any) -> datetime | None:
    if value is None:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)


def _day(value: Any) -> date | None:
    if value is None:
        return None
    text = str(value).strip()
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        parsed = _parse_time(text)
        return parsed.date() if parsed else None


def _within_one_day(a: date | None, b: date | None) -> bool:
    return a is not None and b is not None and abs(a - b) <= timedelta(days=1)


def _format_day(d: date) -> str:
    return f"{d.strftime('%A')} {d.isoformat()}"


def _value(value: Any, unit: str | None) -> str:
    if value is None:
        return "n/a"
    number = _num(value)
    unit_key = (unit or "").lower()
    if unit_key in ("usd", "currency", "$"):
        sign = "-" if number < 0 else ""
        return f"{sign}${abs(number):,.2f}"
    if float(number).is_integer():
        return f"{int(number):,}"
    return f"{number:,.2f}"


def _pct(value: float) -> str:
    return f"{value:.1f}%"


def _cap(text: str) -> str:
    return text[:1].upper() + text[1:]


def _join(items: list[str]) -> str:
    items = [i for i in items if i]
    if len(items) <= 1:
        return "".join(items)
    return ", ".join(items[:-1]) + " and " + items[-1]


def _unique(ids) -> list[UUID]:
    seen: dict[UUID, None] = {}
    for i in ids:
        seen.setdefault(i, None)
    return list(seen)
