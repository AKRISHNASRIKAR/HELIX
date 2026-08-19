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

Not implemented — only the service's health check exists (Phase 0). Phase 6
adds context requirement declarations (likely sourced from
`AgentCapability.inputSchema`), retrieval against Postgres/data sources,
filtering/ranking, and assembly into `AgentTask.inputContext`. Deliberately
not over-engineered with a vector database or long-term memory system at
this stage — the project brief explicitly asks not to over-engineer memory
this early (section 6, Phase 6).
