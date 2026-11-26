import pytest
from conftest import DOMAIN, deployments_source, make_request, orders_source, succeed_with
from helix_agent_coordinator import (
    SYNTHESIS_OBJECTIVE,
    CoordinatorAgent,
    PlanValidationError,
    build_plan,
    validate_llm_plan,
)
from helix_contracts import AgentType, DataSourceContext
from helix_llm import FakeLlm, LlmError

A = AgentType


def sources(*builders):
    return [DataSourceContext.model_validate(b()) for b in builders]


def shape(plan):
    return [(s.order, s.agent_type, s.depends_on) for s in plan.steps]


def test_revenue_drop_with_deploy_source_plans_all_four():
    plan = build_plan("Why did revenue drop last week?",
                      sources(orders_source, deployments_source), available_agents=DOMAIN)
    assert shape(plan) == [
        (0, "ANALYTICS", []), (1, "FINANCE", [0]), (2, "CUSTOMER", [0]), (3, "PRODUCT", [0]),
        (4, "COORDINATOR", [0, 1, 2, 3]),
    ]
    assert plan.steps[-1].objective == SYNTHESIS_OBJECTIVE
    assert plan.reasoning.startswith("Planner: rules.")
    for agent in ("FINANCE", "CUSTOMER", "PRODUCT"):
        assert f"{agent} (after step 0, concurrently)" in plan.reasoning
    assert "event source 'Deployments' (MCP) is connected" in plan.reasoning


def test_no_event_source_skips_product():
    plan = build_plan("Why did revenue drop last week?", sources(orders_source),
                      available_agents=DOMAIN)
    assert [s.agent_type for s in plan.steps] == ["ANALYTICS", "FINANCE", "CUSTOMER",
                                                  "COORDINATOR"]
    assert "Skipped PRODUCT: no MCP or GITHUB event source is connected." in plan.reasoning


def test_customer_question_plans_customer_only():
    plan = build_plan("How is customer retention trending?",
                      sources(orders_source, deployments_source), available_agents=DOMAIN)
    assert [s.agent_type for s in plan.steps] == ["ANALYTICS", "CUSTOMER", "COORDINATOR"]
    assert "Skipped FINANCE" in plan.reasoning
    assert "Skipped PRODUCT: the question is not diagnostic" in plan.reasoning


def test_non_drop_revenue_question_skips_customer():
    plan = build_plan("What will revenue look like next month?", sources(orders_source),
                      available_agents=DOMAIN)
    assert [s.agent_type for s in plan.steps] == ["ANALYTICS", "FINANCE", "COORDINATOR"]


def test_anomaly_trigger_plans_product_and_uses_trigger_metric():
    plan = build_plan(
        "Daily revenue anomaly on 2026-10-08", sources(orders_source, deployments_source),
        trigger_type="ANOMALY_DETECTED",
        trigger_context={"metricKey": "revenue", "date": "2026-10-08", "direction": "drop"},
        available_agents=DOMAIN,
    )
    assert [s.agent_type for s in plan.steps] == [
        "ANALYTICS", "FINANCE", "CUSTOMER", "PRODUCT", "COORDINATOR",
    ]
    assert "triggered by an anomaly" in plan.reasoning


def test_availability_filter():
    plan = build_plan("Why did revenue drop last week?",
                      sources(orders_source, deployments_source),
                      available_agents={A.ANALYTICS, A.PRODUCT})
    assert [s.agent_type for s in plan.steps] == ["ANALYTICS", "PRODUCT", "COORDINATOR"]
    assert "no FINANCE agent is registered" in plan.reasoning
    # None (the Phase 5 default) means only ANALYTICS is known.
    plan = build_plan("Why did revenue drop last week?",
                      sources(orders_source, deployments_source))
    assert [s.agent_type for s in plan.steps] == ["ANALYTICS", "COORDINATOR"]


def test_no_tabular_source_keeps_phase5_plan():
    plan = build_plan("Why did revenue drop?", sources(deployments_source),
                      available_agents=DOMAIN)
    assert shape(plan) == [(0, "ANALYTICS", []), (1, "COORDINATOR", [0])]
    assert "No tabular data source" in plan.reasoning
    plan = build_plan("Why did revenue drop?", [], available_agents=DOMAIN)
    assert shape(plan) == [(0, "ANALYTICS", []), (1, "COORDINATOR", [0])]


# ---------------------------------------------------------------------------
# LLM planner
# ---------------------------------------------------------------------------

AVAILABLE = [A.ANALYTICS, A.FINANCE, A.PRODUCT]


def step(agent, deps=(), objective="do it"):
    return {"agentType": agent, "objective": objective, "dependsOn": list(deps)}


def test_validate_llm_plan_accepts_good_plan():
    steps = validate_llm_plan(
        {"steps": [step("ANALYTICS"), step("FINANCE", [0]), step("PRODUCT", [0, 1])],
         "reasoning": "x"}, AVAILABLE)
    assert [(s.order, s.agent_type, s.depends_on) for s in steps] == [
        (0, "ANALYTICS", []), (1, "FINANCE", [0]), (2, "PRODUCT", [0, 1]),
    ]


@pytest.mark.parametrize(("steps", "match"), [
    ([], "no steps"),
    ([step("FINANCE")], "step 0 must be ANALYTICS"),
    ([step("ANALYTICS"), step("COORDINATOR", [0])], "COORDINATOR"),
    ([step("ANALYTICS"), step("CUSTOMER", [0])], "unavailable"),
    ([step("ANALYTICS"), step("FINANCE", [1])], "not earlier"),
    ([step("ANALYTICS"), step("FINANCE", [2]), step("PRODUCT", [0])], "not earlier"),
    ([step("ANALYTICS", [0])], "not earlier"),
    ([step("ANALYTICS"), step("FINANCE", [0], objective=" ")], "no objective"),
    ([step("ANALYTICS"), step("ANALYTICS", [0])], "repeats ANALYTICS"),
])
def test_validate_llm_plan_rejects(steps, match):
    with pytest.raises(PlanValidationError, match=match):
        validate_llm_plan({"steps": steps, "reasoning": ""}, AVAILABLE)


async def test_llm_plan_used_when_valid():
    llm = FakeLlm(responses=[
        {"steps": [step("ANALYTICS", objective="find it"),
                   step("PRODUCT", [0], objective="check deploys")],
         "reasoning": "Deploys are the likely trigger."},
        LlmError("no summary today"),
    ], model="claude-opus-5-5")
    agent = CoordinatorAgent(succeed_with(), llm=llm, available_agents=DOMAIN)
    result = await agent.run_investigation(make_request())
    assert [(s.order, s.agent_type, s.depends_on) for s in result.steps] == [
        (0, A.ANALYTICS, []), (1, A.PRODUCT, [0]), (2, A.COORDINATOR, [0, 1]),
    ]
    assert result.plan.reasoning == (
        "Planner: llm:claude-opus-5-5. Deploys are the likely trigger."
    )
    assert result.meta["planner"] == "llm"
    assert result.meta["summaryWriter"] == "rules"
    assert result.meta["llmModel"] == "claude-opus-5-5"
    assert result.meta["llmCalls"] == 2
    assert result.meta["llmErrors"] == ["summary: no summary today"]

    # The schema constrains agentType to the available domain agents.
    schema = llm.calls[0]["schema"]
    enum = schema["properties"]["steps"]["items"]["properties"]["agentType"]["enum"]
    assert enum == ["ANALYTICS", "FINANCE", "CUSTOMER", "PRODUCT"]
    assert '"question": "Why did revenue drop last week?"' in llm.calls[0]["user"]
    assert "refund_analysis" in llm.calls[0]["user"]


@pytest.mark.parametrize("response", [
    LlmError("API error 529: overloaded"),
    {"steps": [step("FINANCE")], "reasoning": "bad"},
])
async def test_llm_plan_falls_back_to_rules(response):
    llm = FakeLlm(responses=[response, LlmError("off")])
    agent = CoordinatorAgent(succeed_with(), llm=llm, available_agents=DOMAIN)
    result = await agent.run_investigation(make_request())
    assert result.meta["planner"] == "rules"
    assert result.plan.reasoning.startswith("Planner: rules.")
    assert [s.agent_type for s in result.steps] == [
        A.ANALYTICS, A.FINANCE, A.CUSTOMER, A.PRODUCT, A.COORDINATOR,
    ]
    assert result.meta["llmErrors"][0].startswith("planner: ")
