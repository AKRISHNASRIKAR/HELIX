import asyncio
import json
from uuid import uuid4

import httpx
import pytest
from app.assembler import apply_budget, assemble, estimate_tokens
from app.config import Settings
from app.history import HttpHistoryClient
from app.main import create_app
from fastapi.testclient import TestClient
from helix_contracts import AssembledContext, ContextAssembleRequest

ORG = str(uuid4())
INV = str(uuid4())
CSV_ID = str(uuid4())
MCP_ID = str(uuid4())


def _col(name, type_, semantic):
    return {"name": name, "type": type_, "semanticType": semantic}


def _sources():
    return [
        {
            "id": CSV_ID,
            "name": "orders.csv",
            "type": "CSV",
            "schemas": [
                {
                    "tableName": "orders",
                    "columns": [
                        _col("order_id", "text", "identifier"),
                        _col("created_at", "timestamp", "datetime"),
                        _col("customer_id", "text", "identifier"),
                        _col("segment", "text", "categorical"),
                        _col("channel", "text", "categorical"),
                        _col("amount", "numeric", "currency"),
                        _col("status", "text", "categorical"),
                    ],
                },
                {"tableName": "notes", "columns": [_col("body", "text", "text")]},
                {
                    "tableName": "page_views",
                    "columns": [
                        _col("viewed_at", "timestamp", "datetime"),
                        _col("path", "text", "categorical"),
                    ],
                },
            ],
        },
        {
            "id": MCP_ID,
            "name": "deploys",
            "type": "MCP",
            "schemas": [
                {
                    "tableName": "deployments",
                    "columns": [
                        _col("deployed_at", "timestamp", "datetime"),
                        _col("service", "text", "categorical"),
                        _col("version", "text", "categorical"),
                    ],
                }
            ],
        },
    ]


def _evidence(kind, date, *, severity=None, deviation=None, metric="revenue", direction="drop",
              confidence=0.9, dimensions=None, collected="2026-10-14T00:00:00Z"):
    data = {"kind": kind, "metricKey": metric, "date": date, "direction": direction}
    if severity:
        data["severity"] = severity
    if deviation is not None:
        data["deviationScore"] = deviation
    if dimensions is not None:
        data["dimensions"] = dimensions
    return {
        "id": str(uuid4()),
        "agentTaskId": str(uuid4()),
        "sourceType": "ANOMALY" if kind == "anomaly" else "METRIC",
        "source": {"description": "test"},
        "summary": f"{kind} on {date}",
        "data": data,
        "confidence": confidence,
        "collectedAt": collected,
    }


def _request(requirements=None, *, upstream=None, trigger_context=None, agent="FINANCE"):
    investigation = {
        "id": INV,
        "organizationId": ORG,
        "projectId": str(uuid4()),
        "question": "Why did revenue drop last week?",
        "triggerType": "ANOMALY_DETECTED" if trigger_context else "USER_QUESTION",
    }
    if trigger_context:
        investigation["triggerContext"] = trigger_context
    return {
        "investigation": investigation,
        "agentTaskId": str(uuid4()),
        "agentType": agent,
        "step": {"order": 1, "objective": "Explain the revenue drop"},
        "requirements": requirements or {},
        "dataSources": _sources(),
        "upstream": upstream or {"findings": [], "evidence": []},
    }


def _history_body(n=3):
    return {
        "metrics": [
            {"id": str(uuid4()), "name": "revenue", "value": 100 + i,
             "computedAt": f"2026-10-{10 + i:02d}T00:00:00Z", "dataSourceId": CSV_ID}
            for i in range(n)
        ],
        "anomalies": [
            {"id": str(uuid4()), "description": f"anomaly {i}", "severity": "HIGH",
             "detectedAt": f"2026-10-{10 + i:02d}T00:00:00Z"}
            for i in range(n)
        ],
        "findings": [
            {"id": str(uuid4()), "statement": f"finding {i} " + "x" * 200,
             "createdAt": f"2026-10-{10 + i:02d}T00:00:00Z"}
            for i in range(n)
        ],
    }


class Api:
    """Mock of the API's internal history endpoint."""

    def __init__(self, body=None, status=200, down=False):
        self.body = body if body is not None else _history_body()
        self.status = status
        self.down = down
        self.requests: list[httpx.Request] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.down:
            raise httpx.ConnectError("refused", request=request)
        return httpx.Response(self.status, json=self.body)

    @property
    def transport(self):
        return httpx.MockTransport(self.handler)


def _client(api: Api) -> TestClient:
    settings = Settings(HELIX_API_URL="http://api.test", HELIX_INTERNAL_TOKEN="secret")
    return TestClient(create_app(settings, api_transport=api.transport))


def _decision(ctx, rule):
    return next(d for d in ctx["decisions"] if d["rule"] == rule)


# ---------------------------------------------------------------------------


def test_assemble_returns_valid_camelcase_context():
    api = Api()
    response = _client(api).post("/context/assemble", json=_request())
    assert response.status_code == 200
    ctx = response.json()
    parsed = AssembledContext.model_validate(ctx)
    assert parsed.source == "context-engine"
    assert ctx["agentType"] == "FINANCE"
    assert ctx["investigationId"] == INV and ctx["organizationId"] == ORG
    assert ctx["question"] == "Why did revenue drop last week?"
    assert ctx["step"] == {"order": 1, "objective": "Explain the revenue drop"}
    assert ctx["tokenCount"] == estimate_tokens(parsed.model_copy(update={"token_count": None}))
    assert ctx["truncated"] is False
    rules = [d["rule"] for d in ctx["decisions"]]
    assert rules == ["focus", "history", "upstream", "budget"]


def test_no_requirements_keeps_everything():
    ctx = _client(Api()).post("/context/assemble", json=_request()).json()
    tables = [(s["name"], [t["tableName"] for t in s["schemas"]]) for s in ctx["dataSources"]]
    assert tables == [
        ("orders.csv", ["orders", "notes", "page_views"]),
        ("deploys", ["deployments"]),
    ]


def test_finance_requirements_filter_and_rank_tables():
    req = {
        "semanticTypes": ["datetime", "currency", "categorical"],
        "tableKeywords": ["order", "payment", "refund"],
    }
    ctx = _client(Api()).post("/context/assemble", json=_request(req)).json()
    assert [s["name"] for s in ctx["dataSources"]] == ["orders.csv"]
    orders = ctx["dataSources"][0]["schemas"]
    assert [t["tableName"] for t in orders] == ["orders"]
    assert len(orders[0]["columns"]) == 7  # column lists are kept whole
    semantic = _decision(ctx, "semantic_types")
    assert "orders.csv.notes" in semantic["dropped"]
    keywords = _decision(ctx, "table_keywords")
    assert keywords["kept"] == ["orders.csv.orders"]
    assert set(keywords["dropped"]) == {"orders.csv.page_views", "deploys.deployments"}


def test_keyword_filter_never_drops_everything():
    req = {"semanticTypes": ["datetime"], "tableKeywords": ["invoice"]}
    ctx = _client(Api()).post("/context/assemble", json=_request(req)).json()
    kept = [f"{s['name']}.{t['tableName']}" for s in ctx["dataSources"] for t in s["schemas"]]
    assert kept == ["orders.csv.orders", "orders.csv.page_views", "deploys.deployments"]
    assert "skipped" in _decision(ctx, "table_keywords")["reason"]


def test_product_requirements_keep_only_mcp_events():
    req = {
        "dataSourceTypes": ["MCP", "GITHUB"],
        "tableKeywords": ["deploy", "release", "commit", "change"],
        "semanticTypes": ["datetime"],
    }
    ctx = _client(Api()).post("/context/assemble", json=_request(req, agent="PRODUCT")).json()
    assert [s["name"] for s in ctx["dataSources"]] == ["deploys"]
    decision = _decision(ctx, "data_source_type")
    assert decision["kept"] == ["deploys"] and decision["dropped"] == ["orders.csv"]


def test_keyword_ranking_puts_best_table_first():
    req = {"tableKeywords": ["page", "view", "order"]}
    ctx = _client(Api()).post("/context/assemble", json=_request(req)).json()
    tables = ctx["dataSources"][0]["schemas"]
    assert [t["tableName"] for t in tables] == ["page_views", "orders"]


def test_focus_from_upstream_evidence_most_severe_first():
    upstream = {
        "findings": [],
        "evidence": [
            _evidence("kpi", None, metric="orders"),
            _evidence("anomaly", "2026-10-09", severity="MEDIUM", deviation=-2.1),
            _evidence("anomaly", "2026-10-08", severity="CRITICAL", deviation=-6.0),
            _evidence("segment", "2026-10-08"),
            _evidence("anomaly", "2026-09-01", severity="HIGH", deviation=3.0, direction="spike",
                      metric="refunds"),
        ],
    }
    ctx = _client(Api()).post("/context/assemble", json=_request(upstream=upstream)).json()
    # The spike (other direction) and the MEDIUM drop are left out of the focus.
    assert ctx["focus"]["anomalyDates"] == ["2026-10-08"]
    assert ctx["focus"]["metricKeys"] == ["revenue", "refunds", "orders"]
    assert ctx["focus"]["direction"] == "drop"
    focus_decision = next(d for d in ctx["decisions"] if d["rule"] == "focus")
    assert focus_decision["dropped"] == ["2026-09-01", "2026-10-09"]
    assert len(ctx["upstream"]["evidence"]) == 5


def test_focus_from_trigger_context_comes_first():
    trigger = {"metricKey": "orders", "date": "2026-10-08T00:00:00Z", "direction": "drop"}
    upstream = {"findings": [], "evidence": [
        _evidence("anomaly", "2026-10-09", severity="HIGH", direction="spike"),
    ]}
    ctx = _client(Api()).post(
        "/context/assemble", json=_request(upstream=upstream, trigger_context=trigger)
    ).json()
    assert ctx["focus"] == {
        "anomalyDates": ["2026-10-08"],
        "metricKeys": ["orders", "revenue"],
        "direction": "drop",
    }
    assert ctx["triggerContext"] == trigger
    assert ctx["triggerType"] == "ANOMALY_DETECTED"


def test_empty_focus_without_trigger_or_upstream():
    ctx = _client(Api()).post("/context/assemble", json=_request()).json()
    # The direction still comes from the question's wording ("drop").
    assert ctx["focus"] == {"anomalyDates": [], "metricKeys": [], "direction": "drop"}
    assert "picks its own focus" in _decision(ctx, "focus")["reason"]


def test_history_fetch_uses_internal_endpoint():
    api = Api()
    req = {"historyDays": 14, "dataSourceTypes": ["CSV"]}
    ctx = _client(api).post("/context/assemble", json=_request(req)).json()
    assert len(api.requests) == 1
    sent = api.requests[0]
    assert sent.url.path == f"/api/v1/internal/organizations/{ORG}/context"
    assert sent.url.params["dataSourceIds"] == CSV_ID
    assert sent.url.params["sinceDays"] == "14"
    assert sent.url.params["excludeInvestigationId"] == INV
    assert sent.url.params["limit"] == "50"
    assert sent.headers["x-helix-internal-token"] == "secret"
    history = ctx["history"]
    assert len(history["recentMetrics"]) == 3
    assert len(history["recentAnomalies"]) == 3
    assert len(history["pastFindings"]) == 3
    # newest first
    assert history["pastFindings"][0]["createdAt"] == "2026-10-12T00:00:00Z"


@pytest.mark.parametrize("api", [Api(down=True), Api(status=500), Api(body=[1, 2])])
def test_history_is_best_effort(api):
    ctx = _client(api).post("/context/assemble", json=_request()).json()
    assert ctx["history"] == {"recentMetrics": [], "recentAnomalies": [], "pastFindings": []}
    assert "unavailable" in _decision(ctx, "history")["reason"]


def test_history_and_upstream_can_be_excluded():
    api = Api()
    upstream = {"findings": [], "evidence": [_evidence("anomaly", "2026-10-08", severity="HIGH")]}
    req = {"includeHistory": False, "includeUpstream": False}
    ctx = _client(api).post("/context/assemble", json=_request(req, upstream=upstream)).json()
    assert api.requests == []
    assert ctx["upstream"] == {"findings": [], "evidence": []}
    assert _decision(ctx, "upstream")["dropped"] == ["0 findings", "1 evidence"]
    # Focus still uses upstream evidence even when it is not handed over verbatim.
    assert ctx["focus"]["anomalyDates"] == ["2026-10-08"]


def test_budget_drops_history_findings_oldest_first():
    api = Api(body=_history_body(n=20))
    req = {"maxTokens": 2500}
    ctx = _client(api).post("/context/assemble", json=_request(req)).json()
    assert ctx["truncated"] is True
    assert ctx["tokenCount"] <= 2500 + 100  # decision text added after trimming
    history = ctx["history"]
    assert len(history["pastFindings"]) < 20
    kept_days = [f["createdAt"] for f in history["pastFindings"]]
    assert kept_days == sorted(kept_days, reverse=True)
    if history["pastFindings"]:
        # oldest dropped first: what remains is the newest block
        assert kept_days[0] == "2026-10-29T00:00:00Z"
    budget = _decision(ctx, "budget")
    assert budget["dropped"][0].endswith("history findings")


def test_budget_strips_upstream_dimensions_last():
    dims = [{"column": f"c{i}", "slices": [{"value": "v" * 400}]} for i in range(10)]
    upstream = {"findings": [], "evidence": [
        _evidence("segment", "2026-10-08", dimensions=dims, collected="2026-10-14T00:00:00Z"),
        _evidence("segment", "2026-10-09", dimensions=dims, collected="2026-10-13T00:00:00Z"),
    ]}
    request = ContextAssembleRequest.model_validate(
        _request({"maxTokens": 2000, "includeHistory": False}, upstream=upstream)
    )
    ctx = asyncio.run(assemble(request))
    assert ctx.truncated is True
    # The older evidence (collected 10-13) loses its dimensions first.
    assert "dimensions" not in ctx.upstream.evidence[1].data
    budget = next(d for d in ctx.decisions if d.rule == "budget")
    assert any("dimension details" in d for d in budget.dropped)


def test_apply_budget_within_limit_records_decision():
    request = ContextAssembleRequest.model_validate(_request({"includeHistory": False}))
    ctx = asyncio.run(assemble(request))
    assert ctx.truncated is False
    again = apply_budget(ctx.model_copy(deep=True), 200_000)
    assert again.decisions[-1].rule == "budget" and "within" in again.decisions[-1].reason


def test_malformed_requests_are_422():
    client = _client(Api())
    assert client.post("/context/assemble", json={"investigation": {}}).status_code == 422
    body = _request()
    body["investigation"] = {"id": "nope"}
    response = client.post("/context/assemble", json=body)
    assert response.status_code == 422
    json.dumps(response.json())


@pytest.mark.asyncio
async def test_history_client_omits_empty_params():
    seen: list[httpx.Request] = []

    def handler(request):
        seen.append(request)
        return httpx.Response(200, json={"metrics": [{"id": "m"}, "junk"]})

    client = HttpHistoryClient("http://api.test/", "t", transport=httpx.MockTransport(handler))
    body = await client.fetch(uuid4(), data_source_ids=[], since_days=30,
                              exclude_investigation_id=None)
    assert body == {"metrics": [{"id": "m"}], "anomalies": [], "findings": []}
    assert "dataSourceIds" not in seen[0].url.params
    assert "excludeInvestigationId" not in seen[0].url.params


def test_settings_accept_global_unprefixed_names(monkeypatch):
    monkeypatch.setenv("HELIX_API_URL", "http://api:4100")
    monkeypatch.setenv("HELIX_INTERNAL_TOKEN", "tok")
    monkeypatch.setenv("REDIS_URL", "redis://r:6379")
    s = Settings()
    assert (s.helix_api_url, s.internal_token, s.redis_url) == (
        "http://api:4100", "tok", "redis://r:6379",
    )


def test_focus_keeps_milder_days_when_nothing_is_serious():
    upstream = {"findings": [], "evidence": [
        _evidence("anomaly", "2026-07-30", severity="MEDIUM", deviation=-3.8),
        _evidence("anomaly", "2026-10-02", severity="MEDIUM", deviation=4.5, direction="spike"),
    ]}
    ctx = _client(Api()).post("/context/assemble", json=_request(upstream=upstream)).json()
    assert ctx["focus"]["anomalyDates"] == ["2026-07-30"]
