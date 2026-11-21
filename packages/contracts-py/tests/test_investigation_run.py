from uuid import uuid4

import pytest
from helix_contracts import (
    AgentCapability,
    AgentTask,
    AgentType,
    BaseAgent,
    InvestigationRunRequest,
    InvestigationRunResult,
)
from pydantic import ValidationError


def test_run_request_parses_camel_case_wire_shape():
    request = InvestigationRunRequest.model_validate(
        {
            "investigation": {
                "id": str(uuid4()),
                "organizationId": str(uuid4()),
                "projectId": str(uuid4()),
                "question": "Why did revenue drop?",
                "triggerType": "USER_QUESTION",
            },
            "dataSources": [
                {
                    "id": str(uuid4()),
                    "name": "Orders",
                    "type": "CSV",
                    "schemas": [
                        {
                            "tableName": "orders",
                            "columns": [
                                {"name": "created_at", "type": "timestamp", "nullable": False,
                                 "semanticType": "datetime"},
                                {"name": "amount", "type": "float", "nullable": False},
                            ],
                            "rowCountEstimate": 100,
                        }
                    ],
                }
            ],
        }
    )
    table = request.data_sources[0].schemas[0]
    assert table.columns[0].semantic_type == "datetime"
    assert table.columns[1].semantic_type is None


def test_run_result_dumps_camel_case_and_rejects_bad_status():
    result = InvestigationRunResult(
        status="FAILED",
        plan={"steps": [{"order": 1, "agentType": "ANALYTICS", "objective": "x"}]},
        summary="nothing ran",
    )
    dumped = result.model_dump(mode="json", by_alias=True)
    assert dumped["plan"]["steps"][0]["dependsOn"] == []
    assert dumped["overallConfidence"] is None
    assert dumped["rootCauseFindingId"] is None

    with pytest.raises(ValidationError):
        InvestigationRunResult(status="RUNNING", plan={"steps": []})


def test_base_agent_is_implementable_standalone():
    class EchoAgent(BaseAgent):
        agent_type = AgentType.ANALYTICS
        name = "Echo"

        @property
        def capabilities(self) -> list[AgentCapability]:
            return [AgentCapability(name="echo", description="Echoes.")]

        async def execute(self, task: AgentTask) -> AgentTask:
            return task

    agent = EchoAgent()
    assert agent.capabilities[0].name == "echo"
    assert agent.version == "0.1.0"
