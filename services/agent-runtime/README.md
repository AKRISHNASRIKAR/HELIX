# agent-runtime

Hosts and executes agent implementations (`agents/*`) behind a single
`BaseAgent` contract (defined in `helix_contracts.agent_base`, re-exported
from `app/agents/base.py`). Registers the Coordinator and Analytics agents at
startup and exposes them over HTTP.

**Status:** Phases 4 and 5.

## Endpoints

- `GET /health` -> `{ status, service, registeredAgents }`
- `GET /agents` -> `[{ type, name, description, version, status, capabilities: [{ name, description }] }]`
- `POST /agents/{agentType}/execute` body `AgentTask` -> `AgentTask` with `result`/`error`
  (Phase 4 manual harness; agent failures come back as a `FAILED` task, not a 500)
- `POST /investigations/run` body `{ investigation, dataSources }` -> `InvestigationRunResult`
  (runs the Coordinator synchronously, reporting live progress to the API)

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `ANALYTICS_ENGINE_URL` | `http://localhost:8002` | analytics-engine base URL |
| `HELIX_API_URL` | `http://localhost:4000` | API base URL for progress reports |
| `HELIX_INTERNAL_TOKEN` | `dev-internal-token` | sent as `x-helix-internal-token` on progress reports |
| `AGENT_RUNTIME_ANALYTICS_ENGINE_TIMEOUT_S` | `30` | per-call engine timeout |
| `AGENT_RUNTIME_PROGRESS_TIMEOUT_S` | `2` | progress report timeout |
| `AGENT_RUNTIME_TASK_TIMEOUT_MS` | `60000` | timeoutMs the Coordinator gives each task |

The three shared names also accept an `AGENT_RUNTIME_` prefixed spelling.
