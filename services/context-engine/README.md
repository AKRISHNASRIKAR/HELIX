# context-engine

Dedicated Context Engineering subsystem (project brief, section 12), not "RAG".
For one AgentTask it decides what that agent needs, finds it, filters and ranks
it, and returns the `AssembledContext` that becomes the task's `inputContext`
(persisted as a ContextSnapshot, so every finding traces back to what the agent saw).

**Status:** Phase 6.

## Endpoints

- `GET /health` -> `{ status, service }`
- `POST /context/assemble` body `ContextAssembleRequest` -> `AssembledContext` (camelCase JSON,
  see `packages/contracts-py/helix_contracts/context.py`)

## Pipeline (`app/assembler.py`)

Driven by the agent's `ContextRequirements`. Every step appends a `ContextDecision`
`{rule, kept, dropped, reason}`.

1. `data_source_type`: keep sources whose type is in `dataSourceTypes` (when set).
2. `semantic_types`: within them keep tables with at least one column of a wanted semanticType.
3. `table_keywords`: keep tables whose name (2 points) or a column name (1 point) mentions a
   keyword, ranked by hits. If no table matches at all, keyword filtering is skipped. Column
   lists of kept tables are never trimmed.
4. `focus`: `anomalyDates` from `triggerContext.date` first, then upstream `anomaly`/`segment`
   evidence (most severe first: severity, then |deviationScore|, then confidence);
   `metricKeys` and `direction` likewise.
5. `history` (when `includeHistory`): `GET {HELIX_API_URL}/api/v1/internal/organizations/{orgId}/context`
   with `x-helix-internal-token`. Best effort: any failure gives empty history and a decision saying so.
6. `upstream` (when `includeUpstream`): the request's upstream findings/evidence as given.
7. `budget`: `tokenCount = ceil(len(json) / 4)`. Over `maxTokens` it drops history findings, then
   anomalies, then metrics (oldest first), then `data.dimensions` of upstream evidence (oldest
   first), and sets `truncated: true`.

Example:

```bash
curl -s {{base_url}}/context/assemble -H 'content-type: application/json' -d '{
  "investigation": {"id": "…", "organizationId": "…", "projectId": "…",
                    "question": "Why did revenue drop last week?"},
  "agentTaskId": "…", "agentType": "FINANCE",
  "step": {"order": 1, "objective": "Explain refunds and payment failures"},
  "requirements": {"semanticTypes": ["datetime", "currency", "categorical"],
                   "tableKeywords": ["order", "payment", "refund"]},
  "dataSources": [ … ], "upstream": {"findings": [], "evidence": [ … ]}
}'
```

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `HELIX_API_URL` | `http://localhost:4000` | API base URL for the history endpoint |
| `HELIX_INTERNAL_TOKEN` | `dev-internal-token` | sent as `x-helix-internal-token` |
| `REDIS_URL` | `redis://localhost:6379` | reserved (not used yet) |
| `CONTEXT_ENGINE_HISTORY_TIMEOUT_S` | `3` | history request timeout |
| `CONTEXT_ENGINE_HISTORY_LIMIT` | `50` | max rows per history list |

The shared names also accept a `CONTEXT_ENGINE_` prefixed spelling. Dev port: 8003.
