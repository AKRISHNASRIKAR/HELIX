from uuid import uuid4

from helix_contracts import Agent, AgentCapability, AgentStatus, AgentType


def test_agent_round_trips_camel_case_alias():
    agent = Agent(
        id=uuid4(),
        type=AgentType.ANALYTICS,
        name="Analytics Agent",
        description="Computes KPIs, trends, and anomalies.",
        version="0.1.0",
        status=AgentStatus.IDLE,
        capabilities=[AgentCapability(name="kpi_analysis", description="Computes KPI values.")],
        endpoint="http://agent-runtime:8001/agents/analytics",
    )

    dumped = agent.model_dump(by_alias=True)
    assert dumped["type"] == "ANALYTICS"
    assert dumped["capabilities"][0]["name"] == "kpi_analysis"
