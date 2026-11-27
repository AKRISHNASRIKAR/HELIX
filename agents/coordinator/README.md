# Coordinator Agent

Understands the investigation question, produces an `InvestigationPlan`,
delegates `AgentTask`s to domain agents (concurrently where the plan allows),
collects their results, and synthesizes the final investigation (root cause,
recommendations, summary).

Python package: `helix_agent_coordinator` (pip-installable, `pip install -e agents/coordinator`).
Implements `BaseAgent` from `helix_contracts`. It never imports another
agent: `services/agent-runtime` injects everything it talks to.

**Status:** Phase 7, implemented. Rules by default; an LLM planner and summary
writer are optional and always fall back to rules.

## Constructor

```python
CoordinatorAgent(
    dispatch,                      # async (AgentTask) -> AgentTask (in-process or A2A gateway)
    progress=None,                 # ProgressReporter
    *,
    task_timeout_ms=60_000,
    context=None,                  # ContextProvider: async assemble(ContextAssembleRequest) -> AssembledContext
    llm=None,                      # helix_llm.LlmClient
    available_agents=None,         # set[AgentType]; None = only ANALYTICS (the Phase 5 default)
    context_requirements=None,     # dict[AgentType, ContextRequirements]; defaults per spec section 5
)
```

## `run_investigation(request) -> InvestigationRunResult`

1. Status `PLANNING` + `investigation.planning`.
2. Plan (`planner.py`). Rules: step 0 `ANALYTICS`; `FINANCE` for revenue / order /
   refund / payment questions or triggers; `CUSTOMER` for customer / segment /
   cohort questions or any revenue or order drop; `PRODUCT` when an MCP or GITHUB
   source is connected and the question is diagnostic (or the trigger is
   `ANOMALY_DETECTED`). Each depends on step 0. Only `available_agents` are planned.
   No tabular source: Phase 5 plan (ANALYTICS only). The final step is always
   `COORDINATOR` synthesis depending on every earlier step. With an `llm`, the LLM
   planner proposes the domain steps under a JSON schema; the plan is validated
   (ANALYTICS first, dependencies on earlier steps only, no COORDINATOR) and any
   failure falls back to rules. `plan.reasoning` names the planner.
   `plan.produced`, then status `IN_PROGRESS`.
3. Waves: every step whose dependencies are done runs concurrently
   (`asyncio.gather`). Dependents of an unsuccessful step are `SKIPPED`. Per task:
   - context from the `ContextProvider` (upstream = findings + evidence of the
     steps it depends on); no provider or a provider error gives a locally
     assembled `AssembledContext` (`source="fallback"`, a decision saying why).
     A `RunContextSnapshot` is recorded and `context.assembled`
     `{taskId, agentType, source, tokenCount}` reported.
   - `task.dispatched`, a `TASK_REQUEST` message (COORDINATOR to agent, payload
     `{objective, contextId, transport?}`), dispatch under `timeoutMs`, then a
     `TASK_RESULT` `{status, findings}` or `ERROR` `{error}` message (correlationId =
     task id). `result.transport` is copied into both payloads; RunMessage dicts in
     `result["_messages"]` are appended and the key stripped.
   - `task.completed` or `task.failed`.
4. Synthesis step (a real `COORDINATOR` RunTask, context `source="coordinator"`),
   skipped only when no domain task succeeded (`synthesis.py`):
   - `helix_root_cause.rank_root_causes` ranks candidates; the result is a
     `root_cause_ranking` evidence on the synthesis task.
   - An enriched top candidate with score >= 0.75 becomes a new COORDINATOR
     DIAGNOSTIC finding (`isRootCause`, confidence = score, evidence = all
     contributing evidence + the ranking evidence). Below the bar: no root cause,
     the summary names the strongest candidate. A bare anomaly (single-agent run)
     keeps the Phase 5 rule (DIAGNOSTIC finding with confidence >= 0.9).
   - Status over domain tasks only: `COMPLETED`, `PARTIALLY_COMPLETED`, `FAILED`.
   - Recommendations: Phase 5 rules plus segment topSlice ("Investigate the web
     channel on <day>", HIGH), event alignment ("Review the <service> <version>
     deploy", CRITICAL when keywordMatch and rolled back), refund co-anomalies.
     When the root cause's trigger is a deploy (not a revert), the ranking
     evidence carries `culprit` and a rules-based `fixPlan` (`fix_plan.py`) and
     that deploy's recommendation becomes "Fix the <service> <version> change
     (caused by <author>)" with the first fix steps (CRITICAL).
   - Summary: rules writer leading with the root cause; with an `llm`, an LLM
     writer whose output is rejected (back to rules) if any number in it does not
     appear in the findings, recommendations or evidence formatted values.
5. `result.meta = {planner, summaryWriter, llmModel?, llmCalls, llmErrors, rootCauseMethod}`.
   `investigation.synthesized`.

`execute(task)` wraps the same flow for the generic `BaseAgent` path
(`inputContext` = the run request, `result` = the run result).

## Development

```bash
pnpm --filter @helix/agent-coordinator test
```
