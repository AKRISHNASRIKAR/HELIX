"""Pure scoring helpers for the HELIX evaluation (Phase 10).

Kept separate from run_eval.py (which talks to a live stack) so they can be
unit tested with the standard library alone: `python3 -m unittest` from this
directory.

Two measures from docs/research/evaluation.md:
- accuracy: does the root cause match the seeded ground truth?
- hallucination: every number a finding or summary states must be traceable
  to computed evidence. Numbers that appear nowhere in the evidence count as
  untraced.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from typing import Any

_DATE_RE = re.compile(r"\b\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?\b")
_TIME_RE = re.compile(r"\b\d{1,2}:\d{2}(?::\d{2})?\b")
_VERSION_RE = re.compile(r"\bv?\d+\.\d+\.\d+\b")
_NUMBER_RE = re.compile(r"-?\$?\d[\d,]*(?:\.\d+)?%?")
#: Bookkeeping counts in summaries ("18 finding(s)", "1 of 4 agent task(s)") are not claims about data.
_COUNT_RE = re.compile(r"\b\d+(?: of \d+)? (?:finding|agent task|task|step)s?(?:\(s\))?", re.IGNORECASE)

#: Small integers ("5 findings", "1 step", "0 hours") are too common to trace.
SMALL_INT_EXEMPT = 10


def _to_float(token: str) -> float | None:
    cleaned = token.replace("$", "").replace(",", "").replace("%", "")
    try:
        return float(cleaned)
    except ValueError:
        return None


def extract_numbers(text: str) -> list[float]:
    """Numbers stated in `text`, ignoring dates, clock times and version strings."""
    stripped = _COUNT_RE.sub(" ", text or "")
    stripped = _VERSION_RE.sub(" ", _TIME_RE.sub(" ", _DATE_RE.sub(" ", stripped)))
    numbers: list[float] = []
    for token in _NUMBER_RE.findall(stripped):
        value = _to_float(token)
        if value is None:
            continue
        if value == int(value) and abs(value) <= SMALL_INT_EXEMPT and "." not in token:
            continue
        numbers.append(value)
    return numbers


def collect_numbers(value: Any) -> set[float]:
    """Every number found anywhere in a JSON value (numbers and numbers inside strings)."""
    found: set[float] = set()
    if isinstance(value, bool) or value is None:
        return found
    if isinstance(value, (int, float)):
        found.add(float(value))
    elif isinstance(value, str):
        found.update(extract_numbers(value))
    elif isinstance(value, dict):
        for item in value.values():
            found |= collect_numbers(item)
    elif isinstance(value, (list, tuple)):
        for item in value:
            found |= collect_numbers(item)
    return found


def is_traceable(number: float, pool: Iterable[float]) -> bool:
    """True if `number` matches a pool value, allowing display rounding, sign
    wording ("-40%" vs "40% below") and fraction/percent forms (0.96 vs 96%)."""
    target = abs(number)
    tolerance = max(0.051, 0.005 * target)
    for candidate in pool:
        for form in (abs(candidate), abs(candidate) * 100):
            if abs(form - target) <= tolerance:
                return True
    return False


def untraced_numbers(text: str, pool: set[float]) -> list[float]:
    return [n for n in extract_numbers(text) if not is_traceable(n, pool)]


def hallucination_report(trace: dict[str, Any]) -> dict[str, Any]:
    """Untraced numbers per finding statement and in the summary."""
    pool: set[float] = set()
    for evidence in trace.get("evidence") or []:
        pool |= collect_numbers(evidence.get("data"))
        pool |= collect_numbers(evidence.get("summary"))
    checked = 0
    issues: list[dict[str, Any]] = []
    texts = [(f.get("id"), f.get("statement") or "") for f in trace.get("findings") or []]
    summary = (trace.get("investigation") or {}).get("summary")
    if summary:
        texts.append(("summary", summary))
    for ident, text in texts:
        numbers = extract_numbers(text)
        checked += len(numbers)
        missing = [n for n in numbers if not is_traceable(n, pool)]
        if missing:
            issues.append({"id": ident, "text": text, "untraced": missing})
    untraced = sum(len(i["untraced"]) for i in issues)
    return {
        "numbersChecked": checked,
        "untracedNumbers": untraced,
        "rate": (untraced / checked) if checked else 0.0,
        "issues": issues,
    }


def root_cause_finding(trace: dict[str, Any]) -> dict[str, Any] | None:
    for finding in trace.get("findings") or []:
        if finding.get("isRootCause"):
            return finding
    return None


def score_scenario(
    expect: dict[str, Any], trace: dict[str, Any], *, deployments_connected: bool
) -> dict[str, Any]:
    """Checks one scenario's trace against its expectations. Returns {checks, passed, total}."""
    inv = trace.get("investigation") or {}
    checks: list[dict[str, Any]] = []

    def check(name: str, ok: bool, detail: str) -> None:
        checks.append({"name": name, "ok": bool(ok), "detail": detail})

    status = inv.get("status")
    check("status", status in expect.get("status", []), f"status {status}")

    root = root_cause_finding(trace)
    statement = (root or {}).get("statement") or ""
    if "rootCauseDate" in expect:
        dates = expect["rootCauseDate"]
        check(
            "root cause date",
            root is not None and any(d in statement for d in dates),
            f"expected one of {dates}; got: {statement or 'no root cause'}",
        )
    mentions = list(expect.get("rootCauseMentions") or [])
    if deployments_connected:
        mentions += expect.get("rootCauseMentionsWithDeployments") or []
    for word in mentions:
        check(
            f"root cause mentions '{word}'",
            word.lower() in statement.lower(),
            statement or "no root cause",
        )

    ran = {t.get("agentType") for t in trace.get("tasks") or [] if t.get("status") == "SUCCEEDED"}
    agents = list(expect.get("agents") or [])
    if deployments_connected:
        agents += expect.get("agentsWithDeployments") or []
    for agent in agents:
        check(f"{agent} agent succeeded", agent in ran, f"succeeded: {sorted(a for a in ran if a)}")

    for kind in expect.get("findingTypes") or []:
        types = {f.get("analyticsType") for f in trace.get("findings") or []}
        check(f"has {kind} finding", kind in types, f"types: {sorted(t for t in types if t)}")

    passed = sum(1 for c in checks if c["ok"])
    return {"checks": checks, "passed": passed, "total": len(checks)}


def percentile(values: list[float], pct: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    k = (len(ordered) - 1) * pct
    lo, hi = int(k), min(int(k) + 1, len(ordered) - 1)
    return ordered[lo] + (ordered[hi] - ordered[lo]) * (k - lo)
