import copy
from uuid import uuid4

import pytest
from helix_contracts import RunEvidence, RunFinding
from helix_root_cause import rank_root_causes, score_components
from helix_root_cause.testing import orders_ground_truth


def collect(results: dict, agents=("ANALYTICS", "FINANCE", "CUSTOMER", "PRODUCT")):
    evidence, findings = [], []
    for agent in agents:
        evidence += [RunEvidence.model_validate(e) for e in results[agent]["evidence"]]
        findings += [RunFinding.model_validate(f) for f in results[agent]["findings"]]
    return findings, evidence


def by_kind(evidence, kind):
    return [e for e in evidence if e.data.get("kind") == kind]


def test_ground_truth_root_cause():
    findings, evidence = collect(orders_ground_truth())
    candidates = rank_root_causes(findings, evidence)
    assert len(candidates) == 1
    top = candidates[0]
    assert top.statement == (
        "Revenue dropped 40.0% on Thursday 2026-10-08 because web orders collapsed "
        "(channel = web explains 94.8% of the $13,174.00 shortfall), starting shortly after "
        "the web-checkout v2.14.0 deploy at 08:40 UTC (later rolled back), shipped by carla.m; "
        "refunds also spiked on 2026-10-08 and 2026-10-09. Customer segment mix was ruled out "
        "as the driver."
    )
    assert top.event_evidence_id == by_kind(evidence, "event_alignment")[0].id
    assert top.score >= 0.75
    assert top.score == score_components(0.999, 0.96, 1.0, 0.999)
    assert top.components == {"anomaly": 0.999, "segment": 0.96, "event": 1.0,
                              "coAnomaly": 0.999, "correlation": 0.62}
    assert top.enriched
    anchor = by_kind(evidence, "anomaly")[0]
    assert top.anomaly_evidence_id == anchor.id
    assert top.id == f"anomaly:{anchor.id}"

    # Every contributing kind is linked; the KPI is not.
    linked = {e.data["kind"] for e in evidence if e.id in top.contributing_evidence_ids}
    assert linked == {"anomaly", "segment", "segment_volume", "co_anomaly", "correlation",
                      "segment_neutral", "event_alignment"}
    assert len(top.contributing_evidence_ids) == len(set(top.contributing_evidence_ids))
    linked_findings = {f.statement[:20] for f in findings if f.id in top.contributing_finding_ids}
    assert not any(s.startswith("Revenue was down") for s in linked_findings)
    assert len(top.contributing_finding_ids) == len(findings) - 1
    assert top.formatted["score"] == f"{top.score * 100:.1f}%"


def test_bare_anomaly_caps_at_point_seven():
    findings, evidence = collect(orders_ground_truth(), agents=("ANALYTICS",))
    anomaly_only = [e for e in evidence if e.data["kind"] in ("anomaly", "kpi")]
    [top] = rank_root_causes(findings, anomaly_only)
    assert top.score == round(0.999 * 0.7, 4)
    assert not top.enriched
    assert top.statement == (
        "Revenue dropped on Thursday 2026-10-08 ($19,761.00 against an expected $32,935.00)."
    )


def test_analytics_only_segment_enrichment():
    findings, evidence = collect(orders_ground_truth(), agents=("ANALYTICS",))
    [top] = rank_root_causes(findings, evidence)
    assert top.score == score_components(0.999, 0.948, 0, 0)
    assert top.score >= 0.75
    assert top.statement.startswith(
        "Revenue dropped 40.0% on Thursday 2026-10-08, concentrated in channel = web "
        "(channel = web explains 94.8% of the $13,174.00 shortfall)"
    )


def test_no_anomalies_no_candidates():
    findings, evidence = collect(orders_ground_truth(), agents=("CUSTOMER", "PRODUCT"))
    assert rank_root_causes(findings, evidence) == []
    assert rank_root_causes([], []) == []


def test_other_dates_do_not_enrich():
    results = orders_ground_truth()
    for e in results["PRODUCT"]["evidence"]:
        e["data"]["date"] = "2026-09-01"
    for e in results["FINANCE"]["evidence"]:
        if e["data"]["kind"] == "co_anomaly":
            e["data"]["date"] = "2026-10-11"
            e["data"]["timestamp"] = "2026-10-11T00:00:00+00:00"
    findings, evidence = collect(results)
    [top] = rank_root_causes(findings, evidence)
    assert top.components["event"] == 0 and top.components["coAnomaly"] == 0
    assert top.components["correlation"] == 0  # no co-anomaly metric to link it to
    assert "deploy" not in top.statement and "refunds" not in top.statement


def test_multiple_anchors_ranked_by_score_stable():
    results = orders_ground_truth()
    findings, evidence = collect(results)
    anchor = by_kind(evidence, "anomaly")[0]
    other = anchor.model_copy(deep=True, update={"id": uuid4()})
    other.data["date"] = "2026-09-20"
    other.data["formatted"] = {**other.data["formatted"], "day": "Sunday 2026-09-20"}
    # The weaker anchor comes first in input order but ranks second.
    candidates = rank_root_causes(findings, [other, *evidence])
    assert [c.anomaly_evidence_id for c in candidates] == [anchor.id, other.id]
    assert candidates[1].score == round(0.999 * 0.7, 4)


def test_metric_key_selects_anchor():
    findings, evidence = collect(orders_ground_truth())
    refund_anchor = by_kind(evidence, "co_anomaly")[0].model_copy(deep=True)
    refund_anchor.data["kind"] = "anomaly"
    candidates = rank_root_causes(findings, [refund_anchor, *evidence], metric_key="revenue")
    assert all(c.anomaly_evidence_id != refund_anchor.id for c in candidates)


def test_spike_and_hours_before_wording():
    results = orders_ground_truth()
    event = results["PRODUCT"]["evidence"][0]["data"]
    event.update(sameDay=False, hoursBefore=6.0)
    event["event"]["time"] = "2026-10-07T18:00:00+00:00"
    event["event"]["labels"]["status"] = "failed"
    findings, evidence = collect(results, agents=("ANALYTICS", "PRODUCT"))
    [top] = rank_root_causes(findings, evidence)
    assert ("following the web-checkout v2.14.0 deploy at 18:00 UTC on 2026-10-07 "
            "(the deploy failed), 6.0 hours before that day began, shipped by carla.m"
            ) in top.statement


def test_no_author_no_shipped_by_suffix():
    results = orders_ground_truth()
    data = results["PRODUCT"]["evidence"][0]["data"]
    data["change"]["author"] = None
    del data["event"]["labels"]["author"]
    findings, evidence = collect(results, agents=("ANALYTICS", "PRODUCT"))
    [top] = rank_root_causes(findings, evidence)
    assert "shipped by" not in top.statement
    assert "deploy at 08:40 UTC (later rolled back)." in top.statement


def test_author_from_labels_when_change_is_missing():
    results = orders_ground_truth()
    del results["PRODUCT"]["evidence"][0]["data"]["change"]
    findings, evidence = collect(results, agents=("ANALYTICS", "PRODUCT"))
    [top] = rank_root_causes(findings, evidence)
    assert "(later rolled back), shipped by carla.m." in top.statement


def test_order_volume_breakdown_does_not_explain_a_refund_spike():
    results = orders_ground_truth()
    findings, evidence = collect(results, agents=("ANALYTICS", "FINANCE"))
    refund = by_kind(evidence, "co_anomaly")[0].model_copy(deep=True)
    refund.data.update(kind="anomaly", date="2026-10-08")
    [top] = [
        c for c in rank_root_causes(findings, [refund, *evidence], metric_key="refunds")
        if c.anomaly_evidence_id == refund.id
    ]
    volume_ids = {e.id for e in by_kind(evidence, "segment_volume")}
    assert not volume_ids & set(top.contributing_evidence_ids)
    assert "collapsed" not in top.statement


def test_revert_is_not_chosen_as_the_trigger():
    results = orders_ground_truth()
    real = results["PRODUCT"]["evidence"][0]
    fix = copy.deepcopy(real)
    fix["id"] = str(uuid4())
    fix["confidence"] = 1.0
    fix["data"]["event"]["labels"].update(
        version="v2.14.1", description="Revert payment form changes", status="success"
    )
    results["PRODUCT"]["evidence"].append(fix)
    findings, evidence = collect(results, agents=("ANALYTICS", "PRODUCT"))
    [top] = rank_root_causes(findings, evidence)
    assert "v2.14.0" in top.statement and "v2.14.1" not in top.statement
    assert top.event_evidence_id == uuid_of(real)


def test_only_a_revert_is_never_called_shipped_by():
    results = orders_ground_truth()
    labels = results["PRODUCT"]["evidence"][0]["data"]["event"]["labels"]
    labels.update(version="v2.14.1", description="Revert payment form changes", status="success")
    findings, evidence = collect(results, agents=("ANALYTICS", "PRODUCT"))
    [top] = rank_root_causes(findings, evidence)
    assert "v2.14.1 deploy" in top.statement and "shipped by" not in top.statement


def uuid_of(item: dict):
    from uuid import UUID

    return UUID(item["id"])


def test_share_over_one_is_worded_without_a_percentage_over_100():
    results = orders_ground_truth()
    for item in results["ANALYTICS"]["evidence"]:
        if item["data"].get("kind") == "segment":
            item["data"]["topSlice"]["shareOfDelta"] = 1.151
    findings, evidence = collect(results)
    [top] = rank_root_causes(findings, evidence)
    assert "115.1%" not in top.statement
    assert "alone accounts for more than the full" in top.statement


@pytest.mark.parametrize("component", range(4))
def test_score_is_monotonic(component):
    base = [0.5, 0.5, 0.5, 0.5]
    prev = -1.0
    for step in range(11):
        values = list(base)
        values[component] = step / 10
        score = score_components(*values)
        assert 0 <= score <= 1
        assert score >= prev
        prev = score
    assert score_components(1, 1, 1, 1) == 0.952  # 1 - 0.3 * 0.4 * 0.5 * 0.8
    assert score_components(0, 0, 0, 0) == 0.0
    assert score_components(1, 0, 0, 0) == 0.7
