# @helix/contracts-py

Pydantic mirrors of [`packages/contracts`](../contracts) (the zod schemas). Python
services (`services/agent-runtime`, `services/analytics-engine`, `agents/*`) install
this package locally (`pip install -e ../../packages/contracts-py`) so that a
`Finding`, `Metric`, `AgentTask`, etc. means the same thing whether it was produced
by NestJS or by a Python agent.

There is no codegen step yet — when you change a schema in `packages/contracts/src`,
update the matching model in `helix_contracts/models.py` by hand. If this becomes
a recurring source of drift, revisit with an ADR (candidates: generate Python from
zod via JSON Schema, or move to a single schema language like protobuf).
