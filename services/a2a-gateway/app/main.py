"""HELIX A2A Gateway (Phase 7).

Routes AgentMessage envelopes (helix_contracts.AgentMessage) between the
Coordinator and domain agents over Redis pub/sub, the transport behind the
internal A2A abstraction in docs/architecture/a2a.md. A formal A2A protocol can
replace the transport later without changing the AgentMessage shape callers
depend on. See app/routing.py for the channel layout.
"""

import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import UTC, datetime

import redis.asyncio as aioredis
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import JSONResponse
from helix_contracts import AgentMessage, AgentMessageType, AgentType
from redis.asyncio import Redis
from redis.exceptions import RedisError

from .config import Settings, settings
from .routing import NoListenerError, ReplyTimeoutError, agent_channel, request_reply

logging.basicConfig(level=settings.log_level.upper())
logger = logging.getLogger(__name__)


def _now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def create_app(app_settings: Settings | None = None, *, redis: Redis | None = None) -> FastAPI:
    """`redis` lets tests inject a fakeredis client. Without it the app creates a
    lazy redis.asyncio client (no connection until the first command)."""
    app_settings = app_settings or settings
    owns_client = redis is None
    client: Redis = redis or aioredis.from_url(
        app_settings.redis_url, decode_responses=True, socket_connect_timeout=2
    )

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        yield
        if owns_client:
            await client.aclose()

    app = FastAPI(title="HELIX A2A Gateway", version="0.2.0", lifespan=lifespan)
    app.state.redis = client

    @app.get("/health")
    async def health() -> dict:
        """The service is up even when Redis is not; `redis.ok` says which."""
        try:
            ok = bool(await asyncio.wait_for(client.ping(), app_settings.health_timeout_s))
            redis_status: dict = {"ok": ok}
        except (RedisError, OSError, TimeoutError) as exc:
            redis_status = {"ok": False, "error": str(exc) or type(exc).__name__}
        return {"status": "ok", "service": app_settings.service_name, "redis": redis_status}

    @app.get("/agents")
    async def agents() -> list[dict]:
        """Listener count per agent type (PUBSUB NUMSUB on every agent channel)."""
        types = [t.value for t in AgentType]
        try:
            counts = dict(await client.pubsub_numsub(*(agent_channel(t) for t in types)))
        except (RedisError, OSError) as exc:
            raise HTTPException(503, {"error": f"redis unavailable: {exc}"}) from exc
        return [
            {"agentType": t, "listeners": int(counts.get(agent_channel(t), 0))} for t in types
        ]

    @app.post("/messages/request")
    async def request_message(
        message: AgentMessage,
        timeout_ms: int = Query(
            app_settings.default_timeout_ms, alias="timeoutMs", ge=1,
            le=app_settings.max_timeout_ms,
        ),
    ):
        """Route one TASK_REQUEST to its agent and wait for the reply.

        503 when no agent of that type is listening (or Redis is down), 504 when
        the agent does not reply within timeoutMs."""
        if message.type != AgentMessageType.TASK_REQUEST:
            raise HTTPException(422, {"error": "only TASK_REQUEST messages can be routed"})
        if message.to_agent == AgentType.COORDINATOR:
            raise HTTPException(422, {"error": "the Coordinator does not take routed tasks"})
        body = message.model_dump(mode="json", by_alias=True)
        routed_at = _now()
        try:
            reply = await request_reply(client, body, timeout_ms / 1000)
        except NoListenerError as exc:
            return JSONResponse({"error": str(exc)}, status_code=503)
        except ReplyTimeoutError as exc:
            return JSONResponse({"error": str(exc)}, status_code=504)
        except (RedisError, OSError) as exc:
            logger.warning("Redis unavailable while routing %s: %s", body["correlationId"], exc)
            return JSONResponse({"error": f"redis unavailable: {exc}"}, status_code=503)
        return {"request": body, "reply": reply, "routedAt": routed_at, "repliedAt": _now()}

    return app


app = create_app()
