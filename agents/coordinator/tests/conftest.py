"""Shared builders: a fake ANALYTICS result shaped like helix_agent_analytics output."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

import pytest
from helix_contracts import AgentTask, AgentTaskStatus, InvestigationRunRequest

NOW = datetime(2026, 10, 15, tzinfo=UTC).isoformat()


def anomaly_items(task_id: str, metric_id: str, *, score: float, confidence: float,
                  direction: str = "drop", metric_key: str = "revenue", date: str = "2026-10-08"):
    anomaly_id, evidence_id, finding_id = str(uuid4()), str(uuid4()), str(uuid4())
    anomaly = {
        "id": anomaly_id, "metricId": metric_id, "dataSourceId": None,
        "description": f"{direction} on {date}", "severity": "CRITICAL",
        "detectedAt": f"{date}T00:00:00Z", "detectionMethod": "seasonal",
        "value": 112480.4, "expectedValue": 191300.0, "deviationScore": score,
    }
    evidence = {
        "id": evidence_id, "agentTaskId": task_id, "sourceType": "ANOMALY",
        "source": {"agentTaskId": task_id, "description": "anomaly"},
        "summary": anomaly["description"],
        "data": {
            "kind": "anomaly", "anomalyId": anomaly_id, "metricId": metric_id,
            "metricKey": metric_key, "metricName": metric_key, "date": date,
            "direction": direction, "severity": "CRITICAL",
            "formatted": {"value": "$112,480.40", "expectedValue": "$191,300.00"},
        },
        "confidence": confidence, "collectedAt": NOW,
    }
    finding = {
        "id": finding_id, "agentTaskId": task_id, "agentType": "ANALYTICS",
        "analyticsType": "DIAGNOSTIC", "statement": f"{metric_key} {direction} on {date}.",
        "confidence": confidence, "isRootCause": False, "evidenceIds": [evidence_id],
    }
    return anomaly, evidence, finding


def analytics_result(task_id: str, *, anomalies=((-7.2, 0.999),), kpi_change=-13.86,
                     kpi_confidence=0.988, metric_key="revenue", direction="drop"):
    metric_id, kpi_metric_id = str(uuid4()), str(uuid4())
    metrics = [
        {"id": kpi_metric_id, "dataSourceId": None, "name": metric_key, "unit": "USD",
         "value": 1204331.25, "baseline": 1398120.5, "changePercent": kpi_change,
         "series": None, "computationMethod": "kpi", "computedAt": NOW},
        {"id": metric_id, "dataSourceId": None, "name": f"{metric_key} (daily)", "unit": "USD",
         "value": 1.0, "series": [{"timestamp": NOW, "value": 1.0}],
         "computationMethod": "daily", "computedAt": NOW},
    ]
    kpi_evidence_id = str(uuid4())
    evidence = [{
        "id": kpi_evidence_id, "agentTaskId": task_id, "sourceType": "METRIC",
        "source": {"agentTaskId": task_id, "description": "kpi"}, "summary": "kpi",
        "data": {"kind": "kpi", "metricId": kpi_metric_id, "metricKey": metric_key,
                 "metricName": metric_key, "changePercent": kpi_change,
                 "formatted": {"value": "$1,204,331.25", "baseline": "$1,398,120.50",
                               "changePercent": f"{abs(kpi_change):.1f}%",
                               "period": "the 7 days ending 2026-10-14"}},
        "confidence": kpi_confidence, "collectedAt": NOW,
    }]
    findings = [{
        "id": str(uuid4()), "agentTaskId": task_id, "agentType": "ANALYTICS",
        "analyticsType": "DESCRIPTIVE", "statement": "Revenue was down 13.9%.",
        "confidence": kpi_confidence, "isRootCause": False, "evidenceIds": [kpi_evidence_id],
    }]
    anomaly_list = []
    for score, confidence in anomalies:
        a, e, f = anomaly_items(task_id, metric_id, score=score, confidence=confidence,
                                direction=direction, metric_key=metric_key)
        anomaly_list.append(a)
        evidence.append(e)
        findings.append(f)
    return {"evidence": evidence, "findings": findings, "metrics": metrics,
            "anomalies": anomaly_list, "toolCalls": []}


def succeed_with(**result_kwargs):
    async def dispatch(task: AgentTask) -> AgentTask:
        task.status = AgentTaskStatus.SUCCEEDED
        task.started_at = datetime.now(UTC)
        task.result = analytics_result(str(task.id), **result_kwargs)
        task.completed_at = datetime.now(UTC)
        return task

    return dispatch


@pytest.fixture
def run_request() -> InvestigationRunRequest:
    return InvestigationRunRequest.model_validate({
        "investigation": {
            "id": str(uuid4()), "organizationId": str(uuid4()), "projectId": str(uuid4()),
            "question": "Why did revenue drop last week?", "triggerType": "USER_QUESTION",
        },
        "dataSources": [{
            "id": str(uuid4()), "name": "Orders", "type": "CSV",
            "schemas": [{"tableName": "orders", "rowCountEstimate": 10, "columns": [
                {"name": "created_at", "type": "timestamp", "nullable": False,
                 "semanticType": "datetime"},
                {"name": "amount", "type": "float", "nullable": False,
                 "semanticType": "currency"},
            ]}],
        }],
    })
