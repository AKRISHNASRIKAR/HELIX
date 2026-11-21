"""Deterministic investigation planning for the Coordinator.

Phase 5 has exactly one domain agent to delegate to, so every plan is a
single ANALYTICS step. The planner still produces a real InvestigationPlan
(steps + reasoning) so Phase 7 can grow it into multi-agent planning (or swap
in an LLM planner) without changing what the Coordinator does with the plan.
"""

from __future__ import annotations

from helix_contracts import (
    AgentType,
    DataSourceContext,
    InvestigationPlan,
    InvestigationPlanStep,
)


def build_plan(question: str, data_sources: list[DataSourceContext]) -> InvestigationPlan:
    question = question.strip()
    tables = sum(len(source.schemas) for source in data_sources)
    if data_sources:
        names = ", ".join(f"'{source.name}'" for source in data_sources)
        available = (
            f"{len(data_sources)} connected data source(s) ({names}) with {tables} table(s) "
            "are available."
        )
    else:
        available = (
            "No connected data sources are available, so the analysis step will likely fail."
        )

    objective = (
        f'Answer "{question}": pick the relevant metric and table, compute the KPI for the '
        "latest window against the previous one, detect anomalous days in its daily series, "
        "forecast it if the question looks ahead, and report evidence-backed findings."
    )
    reasoning = (
        "The Analytics Agent is the only domain agent registered in this phase, so the plan "
        "delegates the whole question to it in a single step. " + available
    )
    return InvestigationPlan(
        steps=[
            InvestigationPlanStep(
                order=1, agentType=AgentType.ANALYTICS.value, objective=objective, dependsOn=[]
            )
        ],
        reasoning=reasoning,
    )
