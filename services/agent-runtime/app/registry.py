"""Which agents this runtime hosts and how the Coordinator is wired (build spec 6.3).

Domain agents (Analytics, Finance, Customer, Product) share one analytics-engine
client. The Coordinator gets:

- `dispatch`: GatewayDispatch in `gateway` mode (in-process fallback), else
  InProcessDispatch; both mark `result["transport"]`;
- `context`: HttpContextProvider when CONTEXT_ENGINE_URL is set, else None
  (the Coordinator hand-assembles contexts);
- `llm`: helix_llm.llm_from_env() (None when HELIX_LLM=off or no API key);
- `available_agents`: the registered domain agent types, so it only plans
  steps someone can run;
- `context_requirements`: each registered agent's own ContextRequirements.
"""

from __future__ import annotations

from typing import Any

import httpx
from helix_agent_analytics import AnalyticsAgent, AnalyticsEngineClient
from helix_agent_coordinator import CoordinatorAgent, NullProgressReporter, ProgressReporter
from helix_agent_customer import CustomerAgent
from helix_agent_finance import FinanceAgent
from helix_agent_product import ProductAgent
from helix_llm import llm_from_env

from .a2a import Dispatch, GatewayDispatch, InProcessDispatch
from .config import Settings
from .context import HttpContextProvider
from .progress import HttpProgressReporter
from .runtime import AgentRuntime

#: Sentinel: "read the LLM client from the environment" (tests pass llm=None).
FROM_ENV: Any = object()


def build_dispatch(
    runtime: AgentRuntime,
    settings: Settings,
    *,
    gateway_transport: httpx.AsyncBaseTransport | None = None,
) -> Dispatch:
    if settings.a2a_mode == "gateway" and settings.a2a_gateway_url:
        return GatewayDispatch(
            runtime,
            settings.a2a_gateway_url,
            reply_margin_ms=settings.a2a_reply_margin_ms,
            transport=gateway_transport,
        )
    return InProcessDispatch(runtime)


def build_runtime(
    settings: Settings,
    *,
    engine_transport: httpx.AsyncBaseTransport | None = None,
    progress: ProgressReporter | None = None,
    context_transport: httpx.AsyncBaseTransport | None = None,
    gateway_transport: httpx.AsyncBaseTransport | None = None,
    llm: Any = FROM_ENV,
) -> AgentRuntime:
    """Register every concrete agent. Transports/reporters/LLM are injectable for tests."""
    runtime = AgentRuntime()
    engine = AnalyticsEngineClient(
        settings.analytics_engine_url,
        timeout=settings.analytics_engine_timeout_s,
        transport=engine_transport,
    )
    for agent_cls in (AnalyticsAgent, FinanceAgent, CustomerAgent, ProductAgent):
        runtime.register(agent_cls(engine))

    if progress is None:
        progress = (
            HttpProgressReporter(
                settings.helix_api_url,
                settings.internal_token,
                timeout=settings.progress_timeout_s,
            )
            if settings.helix_api_url
            else NullProgressReporter()
        )
    context = (
        HttpContextProvider(
            settings.context_engine_url,
            settings.context_engine_timeout_s,
            transport=context_transport,
        )
        if settings.context_engine_url
        else None
    )
    runtime.register(
        CoordinatorAgent(
            build_dispatch(runtime, settings, gateway_transport=gateway_transport),
            progress,
            task_timeout_ms=settings.task_timeout_ms,
            context=context,
            llm=llm_from_env() if llm is FROM_ENV else llm,
            available_agents=set(runtime.domain_agent_types),
            context_requirements={
                t: runtime.registry[t].context_requirements for t in runtime.domain_agent_types
            },
        )
    )
    return runtime
