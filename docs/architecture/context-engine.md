# Context Engine

Deliberately not called "RAG" — retrieval is one part of a larger decision
process. Given an `AgentTask`, the Context Engine (`services/context-engine`,
Phase 6) determines:

```
What does the agent need?
        ↓
Where is the information?
        ↓
Which information is relevant?
        ↓
How recent should it be?
        ↓
What should be excluded?
        ↓
How should it be structured?
        ↓
What context should the agent receive?
```

## Why a separate service

No agent should ever receive the entire enterprise dataset. A Finance Agent
investigating a refund spike needs refund/payment/transaction data — not
support tickets, not deployment logs. A Product Agent needs recent
deployments and release notes — not financial data. Centralizing this
decision means:

- Each agent's prompt/context budget stays small and relevant, which is
  cheaper and produces better answers.
- Context construction is inspectable and testable independent of any one
  agent.
- The exact context an agent received is persisted as a `ContextSnapshot`
  row, so a bad finding can be traced back to bad or missing context — not
  just "the LLM was wrong."

## Status

Implemented in Phase 6 (see ADR-008). `services/context-engine` exposes
`POST /context/assemble`. Each agent declares `context_requirements` on its
`BaseAgent` class (semantic types, table keywords, data source types, history
window, token budget). The engine keeps only the relevant data sources and
tables, derives the focus (anomaly days in the question's direction at HIGH or
CRITICAL severity, metric, direction) from the trigger and upstream findings,
adds recent organization history from the API's internal context endpoint,
trims to the token budget and records every choice as a decision. The result
is the task's `inputContext` and is persisted as a `ContextSnapshot` row; the
investigation page's Trace tab shows it. No vector database or long-term
memory, as planned.
