"""Invariants of tests/fixtures/deployments.json (and its generator) that the
investigation scenario depends on (build spec, section 7.1)."""

import importlib.util
import json
from datetime import UTC, datetime, timedelta

from app.config import REPO_ROOT

FIXTURES = REPO_ROOT / "tests" / "fixtures"
INCIDENT_DAY = datetime(2026, 10, 8, tzinfo=UTC)


def _generator():
    spec = importlib.util.spec_from_file_location(
        "generate_deployments", FIXTURES / "generate_deployments.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _rows():
    return json.loads((FIXTURES / "deployments.json").read_text())


def _at(row):
    return datetime.fromisoformat(row["deployed_at"].replace("Z", "+00:00"))


def test_generator_reproduces_committed_file():
    assert _generator().build() == _rows()


def test_shape_and_window():
    rows = _rows()
    assert 35 <= len(rows) <= 45
    assert len({r["id"] for r in rows}) == len(rows)
    keys = {"id", "service", "version", "environment", "deployed_at", "author", "description",
            "status", "commit_sha"}
    services = {"web-checkout", "mobile-api", "partner-gateway", "search", "catalog",
                "notifications"}
    for row in rows:
        assert set(row) == keys
        assert row["environment"] == "production"
        assert row["service"] in services
        assert row["status"] in {"success", "rolled_back", "failed"}
        assert datetime(2026, 7, 17, tzinfo=UTC) <= _at(row) < datetime(2026, 10, 15, tzinfo=UTC)
    assert {r["service"] for r in rows} == services
    assert [r["deployed_at"] for r in rows] == sorted(r["deployed_at"] for r in rows)


def test_required_deploys_present():
    by_version = {(r["service"], r["version"]): r for r in _rows()}
    trigger = by_version[("web-checkout", "v2.14.0")]
    assert trigger["deployed_at"] == "2026-10-08T08:40:00Z"
    assert trigger["status"] == "rolled_back"
    assert trigger["description"] == "New payment form and address validation for web checkout"
    fix = by_version[("web-checkout", "v2.14.1")]
    assert fix["deployed_at"] == "2026-10-09T06:15:00Z"
    assert fix["status"] == "success"
    assert fix["description"] == "Revert payment form changes"


def test_quiet_window_before_incident():
    """Within 36h before 2026-10-08 (and through 2026-10-09) only the trigger,
    the fix and at most one unrelated deploy appear."""
    start, end = INCIDENT_DAY - timedelta(hours=36), INCIDENT_DAY + timedelta(days=2)
    nearby = [r for r in _rows() if start <= _at(r) < end]
    others = [r for r in nearby if r["service"] != "web-checkout"]
    assert {r["version"] for r in nearby if r["service"] == "web-checkout"} == {
        "v2.14.0", "v2.14.1"
    }
    assert len(others) <= 1
    assert all(r["service"] == "search" for r in others)


def test_ground_truth_trigger():
    truth = json.loads((FIXTURES / "ground_truth.json").read_text())
    assert truth["rootCause"]["trigger"] == {
        "type": "deployment",
        "service": "web-checkout",
        "version": "v2.14.0",
        "deployedAt": "2026-10-08T08:40:00Z",
    }
