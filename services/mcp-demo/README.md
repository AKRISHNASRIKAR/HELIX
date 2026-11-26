# mcp-demo

A local MCP server that stands in for a deploy tracker. It serves the
deployments feed in `tests/fixtures/deployments.json` (see
`tests/fixtures/README.md`) as one tool, so an investigation can line a metric
anomaly up against deploys through a real MCP connection (build spec, section 7).

Built with the official `mcp` Python SDK (`mcp==1.30.0`, FastMCP), streamable
HTTP transport, stateless with JSON responses.

Port 8006 (`pnpm --filter @helix/mcp-demo dev`, or set `MCP_DEMO_PORT`).

## Endpoints

| Path | What |
|---|---|
| `POST /mcp` | MCP endpoint (streamable HTTP). Needs `Authorization: Bearer <MCP_DEMO_TOKEN>` when that variable is set. |
| `GET /health` | `{ status: "ok", service: "mcp-demo" }`, never needs a token. |

## Tool

`list_deployments(since?: str, until?: str, service?: str) -> list[dict]`

Production deploys, oldest first: `{id, service, version, environment,
deployed_at, author, description, status, commit_sha}`. `since` and `until`
are inclusive ISO dates or datetimes (UTC when no offset; a bare date as
`until` covers that whole day); `service` matches case-insensitively. A bad
timestamp comes back as a tool error with a readable message.

The tool has no required arguments, so the ingestion service's `McpAdapter`
(type `MCP`) exposes it as a table named `deployments`.

```bash
curl -s -X POST localhost:8006/mcp \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_deployments","arguments":{"service":"web-checkout","since":"2026-10-08"}}}'
```

Connect it as a HELIX data source with
`{ type: "MCP", config: { serverUrl: "http://localhost:8006/mcp", transport: "streamable_http" }, credentials: { token } }`.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `MCP_DEMO_PORT` | `8006` | Port for `pnpm dev` |
| `MCP_DEMO_TOKEN` | unset | When set, `/mcp` requires this bearer token |
| `MCP_DEMO_FIXTURE_PATH` | `tests/fixtures/deployments.json` (repo root) | Deployments file served by the tool |

FastMCP's DNS rebinding protection is on, so requests must use a `localhost`
or `127.0.0.1` Host header.

## Tests

`pnpm --filter @helix/mcp-demo test`: the tool over the SDK's in-memory
transport, over real streamable HTTP (uvicorn in a thread on port 18006,
stopped after the module), the token check, and the fixture invariants
(required deploys, the quiet window before 2026-10-08, the generator
reproducing the committed file, `rootCause.trigger` in `ground_truth.json`).
