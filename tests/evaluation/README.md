# Evaluation (Phase 10)

Scores HELIX against the seeded scenarios in `tests/fixtures` (orders with a
planted web checkout failure on 2026-10-08, plus the deployments feed served
by `services/mcp-demo`). The method is described in
[docs/research/evaluation.md](../../docs/research/evaluation.md).

| File | What it is |
|---|---|
| `scenarios.json` | The questions and what each answer must contain |
| `scoring.py` | Pure scoring: accuracy checks, number traceability (hallucination), percentiles |
| `test_scoring.py` | Unit tests for `scoring.py` (`python3 -m unittest`) |
| `run_eval.py` | Drives a live local stack through the API and writes the report |

## Running it

Start the stack natively (API, web not needed, agent-runtime, analytics-engine,
context-engine, ingestion-service, a2a-gateway, mcp-demo), then:

```bash
python3 tests/evaluation/run_eval.py --api http://localhost:4100 --mcp http://localhost:8006/mcp
```

It creates a throwaway `eval-<timestamp>@helix.test` user and organization,
uploads `orders.csv`, connects the MCP deployments feed when it is reachable,
asks every scenario question, runs the autonomous monitoring scenario, and
writes `docs/research/evaluation-results.md` plus a `.json` with the raw
results. The exit code is 0 only when every check passes and no stated number
is untraced.

Standard library only; no virtualenv needed.
