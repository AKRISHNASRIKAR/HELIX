# agent-runtime

Hosts and executes agent implementations (`agents/*`) behind a single
`BaseAgent` contract (defined in `helix_contracts.agent_base`, re-exported
from `app/agents/base.py`). Registers the Coordinator plus the Analytics,
Finance, Customer and Product agents at startup and exposes them over HTTP.

**Status:** Phases 4 to 7.

## Endpoints

- `GET /health` -> `{ status, service, registeredAgents, a2a: { mode, workerRunning, channels } }`
- `GET /agents` -> `[{ type, name, description, version, status, capabilities: [{ name, description }], contextRequirements }]`
- `POST /agents/{agentType}/execute` body `AgentTask` -> `AgentTask` with `result`/`error`
  (manual harness; agent failures come back as a `FAILED` task, not a 500)
- `POST /investigations/run` body `{ investigation, dataSources }` -> `InvestigationRunResult`
  (runs the Coordinator synchronously, reporting live progress to the API; the result
  carries `messages`, `contextSnapshots` and `meta`)

## Layout

| Module | Role |
|---|---|
| `app/runtime.py` | `AgentRuntime`: registry, BUSY/IDLE bookkeeping, `run(task)` that never raises |
| `app/registry.py` | `build_runtime`: registers agents, wires the Coordinator (`dispatch`, `context`, `llm`, `available_agents`) |
| `app/a2a.py` | `GatewayDispatch`, `InProcessDispatch`, `A2AWorker` |
| `app/context.py` | `HttpContextProvider` for services/context-engine |
| `app/progress.py` | `HttpProgressReporter` for the API's internal progress endpoint |

## A2A (Phase 7)

`HELIX_A2A_MODE=gateway` (default):

- **Dispatch.** Each Coordinator task becomes a TASK_REQUEST posted to
  `{A2A_GATEWAY_URL}/messages/request` (gateway wait = task timeoutMs + 5s). The reply's
  `payload.task` is the finished task. If the gateway is unreachable or answers 503 (no
  worker listening, Redis down) or any other non-200 except 504, the task runs in-process
  instead. A 504 or a read timeout becomes a `TIMED_OUT` task (it may still be running
  remotely, so it is not run twice).
- **Worker.** On startup, if Redis answers a PING, the app subscribes to
  `helix:a2a:agent:{TYPE}` for every registered domain agent, runs each request through
  `AgentRuntime.run` (each in its own asyncio task, so independent plan steps run
  concurrently) and publishes TASK_RESULT (task SUCCEEDED) or ERROR (anything else, or an
  invalid request) to `helix:a2a:reply:{correlationId}`. It unsubscribes on shutdown.
  Without Redis the app runs without a worker and dispatch falls back to in-process.
- **Transport marking.** Every dispatched task with a dict result gets
  `result.transport`: `a2a-gateway`, `in-process`, or `in-process (gateway unavailable: <reason>)`.

`HELIX_A2A_MODE=inprocess`: no worker, tasks run directly (`transport: in-process`).

## Context (Phase 6)

With `CONTEXT_ENGINE_URL` set, the Coordinator asks the context engine to assemble each
task's `inputContext` through `HttpContextProvider` (raises `ContextEngineError` on any
failure, and the Coordinator then hand-assembles a `source: "fallback"` context). Set it to
an empty string to skip the context engine entirely.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `ANALYTICS_ENGINE_URL` | `http://localhost:8002` | analytics-engine base URL |
| `HELIX_API_URL` | `http://localhost:4000` | API base URL for progress reports |
| `HELIX_INTERNAL_TOKEN` | `dev-internal-token` | sent as `x-helix-internal-token` on progress reports |
| `CONTEXT_ENGINE_URL` | `http://localhost:8003` | context-engine base URL (empty = disabled) |
| `A2A_GATEWAY_URL` | `http://localhost:8005` | a2a-gateway base URL |
| `HELIX_A2A_MODE` | `gateway` | `gateway` or `inprocess` |
| `REDIS_URL` | `redis://localhost:6379` | Redis for the A2A worker |
| `HELIX_LLM`, `ANTHROPIC_API_KEY`, `HELIX_LLM_MODEL` | | read by `helix_llm.llm_from_env()` for the Coordinator's optional LLM planner/summary |
| `AGENT_RUNTIME_ANALYTICS_ENGINE_TIMEOUT_S` | `30` | per-call engine timeout |
| `AGENT_RUNTIME_PROGRESS_TIMEOUT_S` | `2` | progress report timeout |
| `AGENT_RUNTIME_TASK_TIMEOUT_MS` | `60000` | timeoutMs the Coordinator gives each task |
| `AGENT_RUNTIME_CONTEXT_ENGINE_TIMEOUT_S` | `10` | context assemble timeout |
| `AGENT_RUNTIME_A2A_REPLY_MARGIN_MS` | `5000` | extra gateway wait beyond a task's timeoutMs |
| `AGENT_RUNTIME_REDIS_CONNECT_TIMEOUT_S` | `2` | startup Redis PING timeout |

The shared names also accept an `AGENT_RUNTIME_` prefixed spelling (e.g.
`AGENT_RUNTIME_A2A_MODE`). Tests are hermetic: fakeredis, httpx MockTransport for the
engine, gateway and context engine, and `llm=None`.
