"""Investigation planning for the Coordinator (Phase 7).

Two planners produce the same InvestigationPlan shape:

- build_plan(): deterministic rules (always available).
- build_llm_plan(): optional, asks an LlmClient for the domain steps under a
  JSON schema, validates the answer and raises PlanValidationError (or the
  client's LlmError) so the caller can fall back to the rules.

Plan shape: step 0 is ANALYTICS; FINANCE / CUSTOMER / PRODUCT steps depend on
it and run concurrently; the last step is COORDINATOR synthesis, depending on
every earlier step. Orders are 0-based and equal the step's index.
"""

from __future__ import annotations

import json
import re
from typing import Any

from helix_contracts import (
    AgentType,
    DataSourceContext,
    DataSourceType,
    InvestigationPlan,
    InvestigationPlanStep,
    InvestigationTriggerType,
)

SYNTHESIS_OBJECTIVE = "Synthesize findings into a root cause, recommendations and a summary"

#: Domain agents the planner knows how to use, in plan order.
DOMAIN_AGENTS = (AgentType.ANALYTICS, AgentType.FINANCE, AgentType.CUSTOMER, AgentType.PRODUCT)

#: What each domain agent can do (shown to the LLM planner).
AGENT_CAPABILITIES: dict[AgentType, list[str]] = {
    AgentType.ANALYTICS: ["kpi", "anomaly_detection", "forecasting", "segment_comparison"],
    AgentType.FINANCE: ["refund_analysis", "payment_failure_analysis", "revenue_quality"],
    AgentType.CUSTOMER: ["customer_activity", "segment_mix"],
    AgentType.PRODUCT: ["deployment_correlation", "release_impact"],
}

_TABULAR_TYPES = {DataSourceType.CSV, DataSourceType.POSTGRESQL, DataSourceType.REST_API}
_EVENT_TYPES = {DataSourceType.MCP, DataSourceType.GITHUB}

_FINANCE_RE = re.compile(
    r"\b(revenue|sales|refund|payment|checkout|order|chargeback|gmv|aov|money|income)", re.I
)
_CUSTOMER_RE = re.compile(r"\b(customer|user|churn|retention|segment|cohort)", re.I)
_REVENUE_ORDER_RE = re.compile(r"\b(revenue|sales|order|gmv|income)", re.I)
_DROP_RE = re.compile(r"\b(drop|declin|fall|fell|down|decreas|lower|dip|plunge|slump)", re.I)
_DIAGNOSTIC_RE = re.compile(
    r"\b(why|cause|drop|spike|explain)|what happened|what caused", re.I
)


class PlanValidationError(ValueError):
    """The LLM's plan broke a structural rule."""


def _trigger_text(trigger_context: dict[str, Any] | None) -> str:
    if not trigger_context:
        return ""
    keys = ("metricKey", "metricName", "direction", "table", "description")
    return " ".join(str(trigger_context[k]) for k in keys if trigger_context.get(k))


def _objectives(question: str) -> dict[AgentType, str]:
    q = question.strip()
    return {
        AgentType.ANALYTICS: (
            f'Answer "{q}": pick the relevant metric and table, compute the KPI for the '
            "latest window against the previous one, detect anomalous days in its daily series, "
            "break the top anomaly down by segment, forecast it if the question looks ahead, "
            "and report evidence-backed findings."
        ),
        AgentType.FINANCE: (
            "Check refunds, payment failures and order volume by channel around the anomaly "
            "day(s) from the Analytics step, and whether refunds move with revenue."
        ),
        AgentType.CUSTOMER: (
            "Check whether customer activity or the customer segment mix explains the "
            "anomaly day(s) from the Analytics step."
        ),
        AgentType.PRODUCT: (
            "Align deployments and releases from the connected event sources with the anomaly "
            "day(s) from the Analytics step."
        ),
    }


def _sources_text(data_sources: list[DataSourceContext]) -> str:
    if not data_sources:
        return "No connected data sources are available, so the analysis step will likely fail."
    tables = sum(len(source.schemas) for source in data_sources)
    names = ", ".join(f"'{source.name}' ({source.type.value})" for source in data_sources)
    return (
        f"{len(data_sources)} connected data source(s) ({names}) with {tables} table(s) "
        "are available."
    )


def with_synthesis(steps: list[InvestigationPlanStep]) -> list[InvestigationPlanStep]:
    """Append the COORDINATOR synthesis step, depending on every earlier step."""
    return [
        *steps,
        InvestigationPlanStep(
            order=max((s.order for s in steps), default=-1) + 1,
            agentType=AgentType.COORDINATOR.value,
            objective=SYNTHESIS_OBJECTIVE,
            dependsOn=[s.order for s in steps],
        ),
    ]


def build_plan(
    question: str,
    data_sources: list[DataSourceContext],
    *,
    trigger_type: InvestigationTriggerType = InvestigationTriggerType.USER_QUESTION,
    trigger_context: dict[str, Any] | None = None,
    available_agents: set[AgentType] | None = None,
) -> InvestigationPlan:
    """Rules planner. `available_agents` None means only ANALYTICS is known to be
    registered (the Phase 5 default); ANALYTICS is always planned as step 0."""
    question = question.strip()
    available = set(available_agents) if available_agents is not None else {AgentType.ANALYTICS}
    objectives = _objectives(question)
    text = f"{question} {_trigger_text(trigger_context)}"
    anomaly_trigger = trigger_type == InvestigationTriggerType.ANOMALY_DETECTED

    reasons = ["Planner: rules.", _sources_text(data_sources)]
    steps = [
        InvestigationPlanStep(
            order=0, agentType=AgentType.ANALYTICS.value,
            objective=objectives[AgentType.ANALYTICS], dependsOn=[],
        )
    ]
    reasons.append(
        "Step 0 ANALYTICS: always first; it finds the metric, its anomalies and where they "
        "are concentrated, which every other step builds on."
    )
    if AgentType.ANALYTICS not in available:
        reasons.append("Note: no ANALYTICS agent is registered, so step 0 will likely fail.")

    tabular = any(source.type in _TABULAR_TYPES for source in data_sources)
    if not tabular:
        reasons.append(
            "No tabular data source is connected, so no other domain agent is planned."
        )
        return InvestigationPlan(steps=with_synthesis(steps), reasoning=" ".join(reasons))

    direction_drop = bool(_DROP_RE.search(text)) or (
        (trigger_context or {}).get("direction") == "drop"
    )
    event_source = next((s for s in data_sources if s.type in _EVENT_TYPES), None)
    wanted: list[tuple[AgentType, bool, str]] = [
        (
            AgentType.FINANCE,
            bool(_FINANCE_RE.search(text)),
            "the question or trigger is about revenue, orders, refunds or payments"
            if _FINANCE_RE.search(text)
            else "the question is not about revenue, orders, refunds or payments",
        ),
    ]
    customer_words = bool(_CUSTOMER_RE.search(text))
    revenue_drop = bool(_REVENUE_ORDER_RE.search(text)) and direction_drop
    wanted.append(
        (
            AgentType.CUSTOMER,
            customer_words or revenue_drop,
            "the question mentions customers, users, segments or cohorts"
            if customer_words
            else "a revenue or order drop may be driven by the customer mix"
            if revenue_drop
            else "the question is not about customers and is not a revenue or order drop",
        )
    )
    diagnostic = bool(_DIAGNOSTIC_RE.search(question)) or anomaly_trigger
    if event_source is None:
        product_reason = "no MCP or GITHUB event source is connected"
    elif not diagnostic:
        product_reason = "the question is not diagnostic and the trigger is not an anomaly"
    else:
        product_reason = (
            f"event source '{event_source.name}' ({event_source.type.value}) is connected and "
            + ("the investigation was triggered by an anomaly" if anomaly_trigger
               else "the question asks for a cause")
        )
    wanted.append((AgentType.PRODUCT, event_source is not None and diagnostic, product_reason))

    for agent, include, why in wanted:
        if include and agent not in available:
            reasons.append(f"Skipped {agent.value}: {why}, but no {agent.value} agent is "
                           "registered.")
            continue
        if not include:
            reasons.append(f"Skipped {agent.value}: {why}.")
            continue
        order = len(steps)
        steps.append(
            InvestigationPlanStep(
                order=order, agentType=agent.value, objective=objectives[agent], dependsOn=[0]
            )
        )
        reasons.append(f"Step {order} {agent.value} (after step 0, concurrently): {why}.")

    reasons.append(
        f"Step {len(steps)} COORDINATOR: synthesize every step's findings into a root cause, "
        "recommendations and a summary."
    )
    return InvestigationPlan(steps=with_synthesis(steps), reasoning=" ".join(reasons))


# ---------------------------------------------------------------------------
# LLM planner
# ---------------------------------------------------------------------------

LLM_PLANNER_SYSTEM = (
    "You plan data investigations for HELIX, a multi-agent analytics system. Given a "
    "question, an optional anomaly trigger, the available domain agents with their "
    "capabilities and the connected data sources, choose which agents to run and in what "
    "order. Rules: step 0 must be ANALYTICS with no dependencies. Every other step may only "
    "depend on earlier steps (by 0-based index). Only include agents that can add evidence "
    "for this question and these data sources. Do not include a synthesis or coordinator "
    "step; it is added automatically. Give a short objective per step and explain each "
    "inclusion and exclusion in the reasoning."
)


def llm_plan_schema(available: list[AgentType]) -> dict[str, Any]:
    return {
        "type": "object",
        "properties": {
            "steps": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "agentType": {"type": "string", "enum": [a.value for a in available]},
                        "objective": {"type": "string"},
                        "dependsOn": {"type": "array", "items": {"type": "integer"}},
                    },
                    "required": ["agentType", "objective", "dependsOn"],
                    "additionalProperties": False,
                },
            },
            "reasoning": {"type": "string"},
        },
        "required": ["steps", "reasoning"],
        "additionalProperties": False,
    }


def _planner_input(
    question: str,
    data_sources: list[DataSourceContext],
    trigger_type: InvestigationTriggerType,
    trigger_context: dict[str, Any] | None,
    available: list[AgentType],
) -> str:
    payload = {
        "question": question,
        "triggerType": trigger_type.value,
        "triggerContext": trigger_context,
        "availableAgents": [
            {"agentType": a.value, "capabilities": AGENT_CAPABILITIES.get(a, [])}
            for a in available
        ],
        "dataSources": [
            {
                "name": s.name,
                "type": s.type.value,
                "tables": [
                    {
                        "tableName": t.table_name,
                        "columns": [
                            {"name": c.name, "semanticType": c.semantic_type} for c in t.columns
                        ],
                    }
                    for t in s.schemas
                ],
            }
            for s in data_sources
        ],
    }
    return json.dumps(payload, indent=2, default=str)


def validate_llm_plan(
    raw: dict[str, Any], available: list[AgentType]
) -> list[InvestigationPlanStep]:
    steps = raw.get("steps")
    if not isinstance(steps, list) or not steps:
        raise PlanValidationError("plan has no steps")
    allowed = {a.value for a in available}
    out: list[InvestigationPlanStep] = []
    for index, step in enumerate(steps):
        if not isinstance(step, dict):
            raise PlanValidationError(f"step {index} is not an object")
        agent = step.get("agentType")
        if agent == AgentType.COORDINATOR.value:
            raise PlanValidationError(f"step {index} is a COORDINATOR step")
        if agent not in allowed:
            raise PlanValidationError(f"step {index} uses unavailable agent {agent!r}")
        if index == 0 and agent != AgentType.ANALYTICS.value:
            raise PlanValidationError("step 0 must be ANALYTICS")
        if index > 0 and agent == AgentType.ANALYTICS.value:
            raise PlanValidationError(f"step {index} repeats ANALYTICS")
        deps = step.get("dependsOn") or []
        if not isinstance(deps, list) or not all(isinstance(d, int) for d in deps):
            raise PlanValidationError(f"step {index} has invalid dependsOn")
        if any(d < 0 or d >= index for d in deps):
            raise PlanValidationError(f"step {index} depends on a step that is not earlier")
        if index == 0 and deps:
            raise PlanValidationError("step 0 must not depend on anything")
        objective = str(step.get("objective") or "").strip()
        if not objective:
            raise PlanValidationError(f"step {index} has no objective")
        out.append(
            InvestigationPlanStep(
                order=index, agentType=agent, objective=objective,
                dependsOn=sorted(set(deps)),
            )
        )
    return out


async def build_llm_plan(
    llm: Any,
    question: str,
    data_sources: list[DataSourceContext],
    *,
    trigger_type: InvestigationTriggerType = InvestigationTriggerType.USER_QUESTION,
    trigger_context: dict[str, Any] | None = None,
    available_agents: set[AgentType] | None = None,
) -> InvestigationPlan:
    """LLM planner. Raises LlmError (from the client) or PlanValidationError."""
    pool = set(available_agents) if available_agents is not None else {AgentType.ANALYTICS}
    available = [a for a in DOMAIN_AGENTS if a in pool or a == AgentType.ANALYTICS]
    raw = await llm.complete_json(
        system=LLM_PLANNER_SYSTEM,
        user=_planner_input(question.strip(), data_sources, trigger_type, trigger_context,
                            available),
        schema=llm_plan_schema(available),
        max_tokens=4000,
    )
    steps = validate_llm_plan(raw, available)
    reasoning = str(raw.get("reasoning") or "").strip()
    model = getattr(llm, "model", "unknown")
    return InvestigationPlan(
        steps=with_synthesis(steps),
        reasoning=f"Planner: llm:{model}. {reasoning}".strip(),
    )
