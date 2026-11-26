# a2a-gateway

Transport layer for agent-to-agent communication: routes `AgentMessage` envelopes
between the Coordinator and domain agents over Redis pub/sub. Deliberately separate
from `agent-runtime` (which executes agents) so the transport can evolve toward a
formal A2A protocol without touching agent execution code. See `docs/architecture/a2a.md`.

**Status:** Phase 7.

## Endpoints

- `GET /health` -> `{ status: "ok", service, redis: { ok, error? } }` (the service reports ok
  even when Redis is down; `redis.ok` says whether routing can work)
- `GET /agents` -> `[{ agentType, listeners }]` for every AgentType (`PUBSUB NUMSUB`)
- `POST /messages/request?timeoutMs=60000` body = TASK_REQUEST `AgentMessage`
  -> `{ request, reply, routedAt, repliedAt }`
  - 422: not a TASK_REQUEST, addressed to COORDINATOR, or malformed
  - 503 `{error: "no agent listening for FINANCE"}`: nobody subscribed (or Redis down)
  - 504: no reply within `timeoutMs`

## Channels

| Channel | Carries |
|---|---|
| `helix:a2a:agent:{AGENT_TYPE}` | TASK_REQUEST for that agent type (agent-runtime's A2A worker subscribes) |
| `helix:a2a:reply:{correlationId}` | the TASK_RESULT or ERROR reply, `payload: {task}` |

The gateway subscribes to the reply channel before it publishes the request, so a fast
reply is never lost. Pub/sub fans out: two runtimes hosting the same agent type would both
run a request (first reply wins). A stream or queue can replace this later without
changing the message shape.

Example:

```bash
curl -s "{{base_url}}/messages/request?timeoutMs=60000" -H 'content-type: application/json' -d '{
  "id": "…", "type": "TASK_REQUEST", "investigationId": "…", "agentTaskId": "<task id>",
  "fromAgent": "COORDINATOR", "toAgent": "FINANCE",
  "payload": {"task": { …AgentTask JSON… }}, "correlationId": "<task id>"
}'
# -> {"request": {…}, "reply": {"type": "TASK_RESULT", "fromAgent": "FINANCE",
#     "toAgent": "COORDINATOR", "payload": {"task": {…, "status": "SUCCEEDED"}}, …},
#     "routedAt": "2026-11-26T10:00:00.000000Z", "repliedAt": "2026-11-26T10:00:01.200000Z"}
```

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `REDIS_URL` | `redis://localhost:6379` | Redis for pub/sub (also `A2A_GATEWAY_REDIS_URL`) |
| `A2A_GATEWAY_DEFAULT_TIMEOUT_MS` | `60000` | reply wait when `timeoutMs` is omitted |
| `A2A_GATEWAY_MAX_TIMEOUT_MS` | `600000` | largest accepted `timeoutMs` |

Dev port: 8005. Tests use `fakeredis`; one optional test talks to a real Redis on
`localhost:6379` and skips when it is unreachable.
