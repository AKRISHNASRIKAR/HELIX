"""Culprit and fix plan for a root cause triggered by a deploy (rules only, no LLM).

When the selected root-cause candidate's trigger is an `event_alignment`
that is not a revert, the Coordinator names the change that caused it (the
`culprit`, copied from the Product Agent's `change` + `history`) and a short,
ordered `fixPlan`. Every name, version, time and commit in the plan comes
from the deploy feed or from evidence already in the run; nothing is
invented and nothing new is computed from data (ADR-005).

state:
    failed          the deploy's status says it failed
    rolled_back     the feed marks it rolled back, or a later revert/fix exists
    needs_rollback  otherwise: the change may still be live

recovered (no new statistic, only the anomaly evidence the run already has):
    reference day = the rollback's day (rolled_back with a rollback deploy),
                    else the anomaly day
    through       = the last day of the metric's data (its KPI window end)
    recovered     = no anomaly on the investigated metric in the same
                    direction dated after the reference day and on or before
                    `through`; null when `through` is unknown or not after
                    the reference day.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from helix_contracts import RunEvidence

_ROLLED_BACK = {"rolled_back", "rollback", "rolled-back", "reverted", "rolledback"}
_FAILED = {"failed", "failure", "error", "errored"}
_REVERT_WORDS = ("revert", "rollback", "roll back", "rolled back", "hotfix", "undo")
_SEGMENT_KINDS = ("segment", "segment_volume")


# ---------------------------------------------------------------------------
# Culprit
# ---------------------------------------------------------------------------


def _text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def is_revert(data: dict[str, Any]) -> bool:
    if data.get("revert"):
        return True
    labels = (data.get("event") or {}).get("labels") or {}
    text = " ".join(str(labels.get(k) or "") for k in ("description", "version")).lower()
    return any(word in text for word in _REVERT_WORDS)


def change_from_labels(data: dict[str, Any]) -> dict[str, Any]:
    """Older Product Agent evidence has no `change`: read the same fields from labels."""
    event = data.get("event") or {}
    labels = event.get("labels") or {}
    sha = _text(labels.get("commit_sha") or labels.get("sha") or labels.get("commit"))
    return {
        "id": _text(labels.get("id")),
        "author": _text(labels.get("author")),
        "service": _text(labels.get("service")),
        "version": _text(labels.get("version")),
        "environment": _text(labels.get("environment")),
        "status": _text(labels.get("status")),
        "description": _text(labels.get("description")),
        "commitSha": sha,
        "commitUrl": None,
        "deployedAt": event.get("time"),
    }


def culprit_from_event(event: RunEvidence) -> dict[str, Any] | None:
    """{...change, history, evidenceId} of a non-revert event, else None."""
    data = event.data or {}
    if data.get("kind") != "event_alignment" or is_revert(data):
        return None
    change = data.get("change") if isinstance(data.get("change"), dict) else None
    culprit = dict(change) if change else change_from_labels(data)
    history = data.get("history") if isinstance(data.get("history"), dict) else None
    culprit["history"] = history
    culprit["evidenceId"] = str(event.id)
    return culprit


# ---------------------------------------------------------------------------
# Small formatting helpers (display only)
# ---------------------------------------------------------------------------


def _parse(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def _day(value: Any) -> date | None:
    if value is None:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def format_when(value: Any) -> str | None:
    """'06:15 UTC on 2026-10-09' from an ISO timestamp."""
    parsed = _parse(value)
    if parsed is None:
        return None
    return f"{parsed.strftime('%H:%M')} UTC on {parsed.date().isoformat()}"


def _short_sha(sha: Any) -> str | None:
    text = _text(sha)
    return text[:7] if text else None


def _cap(text: str) -> str:
    return text[:1].upper() + text[1:]


def _join(items: list[str]) -> str:
    items = [i for i in items if i]
    if len(items) <= 1:
        return "".join(items)
    return ", ".join(items[:-1]) + " and " + items[-1]


def _name(change: dict[str, Any]) -> str:
    name = " ".join(x for x in (change.get("service"), change.get("version")) if x)
    return name or change.get("description") or "the change"


# ---------------------------------------------------------------------------
# Recovery
# ---------------------------------------------------------------------------


def data_through(evidence: list[RunEvidence], metric_key: str | None) -> date | None:
    """Last day of the metric's data: the end of its KPI window."""
    days = []
    for e in evidence:
        data = e.data or {}
        if data.get("kind") != "kpi" or data.get("metricKey") != metric_key:
            continue
        end = _day((data.get("window") or {}).get("currentEnd"))
        if end is not None:
            days.append(end)
    return max(days) if days else None


def recovery(
    evidence: list[RunEvidence],
    *,
    metric_key: str | None,
    direction: str | None,
    after: date | None,
) -> tuple[bool | None, date | None, list[str]]:
    """(recovered, through, later anomaly days) per the module docstring."""
    through = data_through(evidence, metric_key)
    if after is None or through is None or through <= after:
        return None, through, []
    later: list[str] = []
    for e in evidence:
        data = e.data or {}
        if data.get("kind") != "anomaly" or data.get("metricKey") != metric_key:
            continue
        if direction and data.get("direction") and data.get("direction") != direction:
            continue
        day = _day(data.get("date") or data.get("timestamp"))
        if day is not None and after < day <= through and day.isoformat() not in later:
            later.append(day.isoformat())
    return not later, through, sorted(later)


# ---------------------------------------------------------------------------
# Plan
# ---------------------------------------------------------------------------


def _step(kind: str, title: str, detail: str) -> dict[str, str]:
    return {"kind": kind, "title": title, "detail": detail}


def _affected(evidence: list[RunEvidence], metric_key: str | None, day: date | None):
    """(column, value, volume noun) of the slice the root cause is concentrated in."""
    segments = [
        e for e in evidence
        if (e.data or {}).get("kind") in _SEGMENT_KINDS
        and isinstance(e.data.get("topSlice"), dict)
        and _day(e.data.get("date")) == day
    ]
    if not segments:
        return None, None, None
    segments.sort(key=lambda e: (e.data.get("kind") != "segment",
                                 e.data.get("metricKey") != metric_key))
    top = segments[0].data["topSlice"]
    column, value = _text(top.get("column")), _text(top.get("value"))
    volume = next(
        (
            e for e in segments
            if e.data.get("kind") == "segment_volume"
            and _text((e.data.get("topSlice") or {}).get("value")) == value
        ),
        None,
    )
    noun = None
    if volume is not None:
        noun = _text(volume.data.get("metricName") or volume.data.get("metricKey"))
    return column, value, noun.lower() if noun else None


def _area(change: dict[str, Any], keyword_match: list[str], slice_value: str | None) -> str:
    """'web checkout and payment' from the service name plus matched keywords."""
    service = change.get("service") or ""
    words = service.replace("-", " ").replace("_", " ").split()
    seen = {w.lower() for w in words}
    extra = [
        k for k in keyword_match
        if k.lower() not in seen and k.lower() != (slice_value or "").lower()
    ]
    base = " ".join(words) or "changed"
    return f"{base} and {_join(extra)}" if extra else base


def build_fix_plan(
    culprit: dict[str, Any],
    *,
    evidence: list[RunEvidence],
    anchor: RunEvidence,
    event: RunEvidence,
) -> dict[str, Any]:
    anchor_data = anchor.data or {}
    metric_key = anchor_data.get("metricKey")
    metric = (anchor_data.get("metricName") or metric_key or "the metric").lower()
    direction = anchor_data.get("direction")
    move = "drop" if direction == "drop" else "spike" if direction == "spike" else "anomaly"
    anomaly_day = _day(anchor_data.get("date") or anchor_data.get("timestamp"))

    history = culprit.get("history") or {}
    previous = history.get("previous") if isinstance(history, dict) else None
    rollback = history.get("rollback") if isinstance(history, dict) else None
    status = str(culprit.get("status") or "").lower()
    if status in _FAILED:
        state = "failed"
    elif status in _ROLLED_BACK or rollback:
        state = "rolled_back"
    else:
        state = "needs_rollback"

    rollback_day = _day(rollback.get("deployedAt")) if rollback else None
    reference = rollback_day if state == "rolled_back" and rollback_day else anomaly_day
    recovered, through, later = recovery(
        evidence, metric_key=metric_key, direction=direction, after=reference
    )

    name = _name(culprit)
    service = culprit.get("service") or "the service"
    version = culprit.get("version")
    author = culprit.get("author")
    column, value, noun = _affected(evidence, metric_key, anomaly_day)
    keyword_match = list((event.data or {}).get("keywordMatch") or [])
    ref_text = reference.isoformat() if reference else "the anomaly day"
    through_text = through.isoformat() if through else None

    # -- steps ---------------------------------------------------------------
    def review_step(title: str) -> dict[str, str]:
        sha = _short_sha(culprit.get("commitSha"))
        what = f"commit {sha}" if sha else f"the {name} change"
        desc = culprit.get("description")
        detail = f"Review {what}"
        if desc:
            detail += f' ("{desc}")'
        if author:
            detail += f" by {author}"
        if value and column:
            detail += f"; the affected path is the {value} {column}"
        return _step("review", title, detail + ".")

    def recovery_step() -> dict[str, str]:
        if recovered is True:
            return _step(
                "verify",
                f"Confirm {metric} is back to normal",
                f"No further {metric} {move} was detected after {ref_text} "
                f"(data checked through {through_text}). Keep watching it for a few days.",
            )
        if recovered is False:
            again = "dropped" if move == "drop" else "moved"
            return _step(
                "verify",
                f"{_cap(metric)} is still not back to expected",
                f"{_cap(metric)} {again} again on {_join(later)} after {ref_text} (data checked "
                f"through {through_text}), so the fix so far has not been enough. Check what "
                "else changed.",
            )
        return _step(
            "verify",
            f"Check that {metric} recovers",
            f"There is no {metric} data after {ref_text} yet, so recovery cannot be confirmed. "
            "Check again once newer data is in.",
        )

    def test_step() -> dict[str, str]:
        area = _area(culprit, keyword_match, value)
        detail = "Ship the fix as a new version"
        if version:
            detail += f" (not {version} again)"
        if value and column:
            detail += f" only once the {value} {column} path passes"
        return _step(
            "test",
            f"Test the {area} flow end to end in staging before re-releasing",
            detail + ".",
        )

    def prevent_step() -> dict[str, str]:
        target = f"{value} {noun or metric}" if value else metric
        return _step(
            "prevent",
            f"Add a monitor on {target}",
            f"A HELIX monitor on {target} flags a repeat {move} within one monitor interval "
            "instead of at the next review.",
        )

    steps: list[dict[str, str]] = []
    if state == "rolled_back":
        if rollback:
            rb_name = " ".join(x for x in (service, rollback.get("version")) if x)
            detail = rb_name
            if rollback.get("description"):
                detail += f' "{rollback["description"]}"'
            if rollback.get("author"):
                detail += f" by {rollback['author']}"
            when = format_when(rollback.get("deployedAt"))
            if when:
                detail += f" went out at {when}"
            if version:
                detail += f", replacing {version}"
            steps.append(_step("verify", "Rollback is in place", detail + "."))
        else:
            target = previous.get("version") if previous else None
            detail = (
                f"The deploy feed marks {name} as rolled back, but the rollback deploy is not in "
                "the feed. Confirm "
                + (f"{service} {target}" if target else "the previous version")
                + " is what is serving."
            )
            steps.append(_step("verify", "Confirm the rollback is in place", detail))
        steps.append(recovery_step())
        steps.append(review_step("Fix the change before re-shipping"))
        steps.append(test_step())
        steps.append(prevent_step())
    elif state == "needs_rollback":
        if previous and previous.get("version"):
            title = f"Roll back {service} to {previous['version']}"
            by = []
            if previous.get("author"):
                by.append(f"shipped by {previous['author']}")
            prev_day = _day(previous.get("deployedAt"))
            if prev_day:
                by.append(f"on {prev_day.isoformat()}")
            if by:
                title += f" ({' '.join(by)})"
            detail = (
                f"{previous['version']} is the last {service} deploy before {version or name} "
                "that did not fail and was not rolled back."
            )
        else:
            title = f"Roll back {name}"
            sha = _short_sha(culprit.get("commitSha"))
            detail = (
                f"No earlier good {service} deploy is in the feed, so revert "
                + (f"commit {sha}" if sha else "the change")
                + " instead."
            )
        steps.append(_step("rollback", title, detail))
        steps.append(review_step("Fix the change before re-shipping"))
        steps.append(recovery_step())
        steps.append(prevent_step())
    else:  # failed
        when = format_when(culprit.get("deployedAt"))
        if previous and previous.get("version"):
            title = f"Confirm {service} {previous['version']} is still serving"
        else:
            title = f"Confirm which {service} version is serving"
        detail = f"The {name} deploy failed" + (f" at {when}" if when else "")
        detail += "; check whether it partly reached users before it failed."
        steps.append(_step("verify", title, detail))
        steps.append(review_step("Find out why the deploy failed"))
        steps.append(recovery_step())
        steps.append(prevent_step())

    return {
        "state": state,
        "recovered": recovered,
        "recoveredThrough": through_text,
        "steps": steps,
    }


__all__ = ["build_fix_plan", "culprit_from_event", "format_when", "is_revert", "recovery"]
