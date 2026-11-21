# Coordinator Agent

Understands the investigation question, produces an `InvestigationPlan`,
delegates `AgentTask`s to domain agents, collects their results, and
assembles the final investigation (summary, root cause, recommendations).

Python package: `helix_agent_coordinator` (pip-installable, `pip install -e agents/coordinator`).
Implements `BaseAgent` from `helix_contracts`. It never imports another
agent: `services/agent-runtime` injects a `dispatch(task) -> task` callable
(Phase 5: in-process call to the registered agent) and a progress reporter
(POSTs to the API's internal progress endpoint).

**Status:** Phase 5, implemented. Rule-based (no LLM).

## `run_investigation(request) -> InvestigationRunResult`

1. Report status `PLANNING` + event `investigation.planning`.
2. Plan (`planner.py`): exactly one `ANALYTICS` step in this phase. Report `plan.produced`, then status `IN_PROGRESS`.
3. Per step: build an `AgentTask` with a hand-assembled `inputContext`
   (`question`, `organizationId`, `investigationId`, `projectId`, `dataSources`),
   report `task.dispatched`, dispatch under `asyncio.wait_for(timeoutMs)`
   (timeout -> `TIMED_OUT`), then report `task.completed` or `task.failed`.
4. Synthesize (`synthesis.py`):
   - root cause = highest-confidence DIAGNOSTIC finding with confidence >= 0.9;
   - overallConfidence = root cause confidence, else mean finding confidence, else null;
   - status = `COMPLETED` (all tasks succeeded), `PARTIALLY_COMPLETED` (some), `FAILED` (none);
   - templated summary and rule-based recommendations linked to findings
     (drop anomaly -> HIGH, refund spike -> HIGH, KPI decline > 10% -> MEDIUM, ...).
5. Report `investigation.synthesized` and return the result.

`execute(task)` wraps the same flow for the generic `BaseAgent` path
(`inputContext` = the run request, `result` = the run result).

## Development

```bash
pnpm --filter @helix/agent-coordinator test
```
