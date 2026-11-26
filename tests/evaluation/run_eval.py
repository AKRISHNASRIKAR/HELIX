#!/usr/bin/env python3
"""Run the HELIX evaluation against a live local stack (Phase 10).

Creates a throwaway user, organization and project, uploads
tests/fixtures/orders.csv, connects the mcp-demo deployments feed when it is
reachable, asks every question in scenarios.json, then runs the autonomous
monitoring scenario. Scores accuracy against the seeded ground truth,
hallucination (numbers not traceable to evidence) and latency, and writes a
JSON + Markdown report.

Standard library only:

    python3 tests/evaluation/run_eval.py \
        --api http://localhost:4100 --mcp http://localhost:8006/mcp \
        --out docs/research/evaluation-results.md
"""

from __future__ import annotations

import argparse
import json
import secrets
import sys
import time
import urllib.error
import urllib.request
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
from scoring import hallucination_report, percentile, root_cause_finding, score_scenario  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
ORDERS_CSV = ROOT / "tests" / "fixtures" / "orders.csv"
SCENARIOS = Path(__file__).resolve().parent / "scenarios.json"
TERMINAL = {"COMPLETED", "PARTIALLY_COMPLETED", "FAILED", "CANCELLED"}


class Api:
    def __init__(self, base: str):
        self.base = base.rstrip("/") + "/api/v1"
        self.token: str | None = None
        self.org: str | None = None

    def _headers(self, extra: dict[str, str] | None = None) -> dict[str, str]:
        headers = {"Accept": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        if self.org:
            headers["X-Organization-Id"] = self.org
        headers.update(extra or {})
        return headers

    def call(self, method: str, path: str, body: Any = None) -> Any:
        data = None if body is None else json.dumps(body).encode()
        headers = self._headers({"Content-Type": "application/json"} if data else None)
        return self._send(urllib.request.Request(self.base + path, data, headers, method=method))

    def upload_csv(self, path: Path, name: str) -> Any:
        boundary = f"----helix{uuid.uuid4().hex}"
        parts = [
            f'--{boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\n{name}\r\n'.encode(),
            (
                f'--{boundary}\r\nContent-Disposition: form-data; name="file"; '
                f'filename="{path.name}"\r\nContent-Type: text/csv\r\n\r\n'
            ).encode()
            + path.read_bytes()
            + b"\r\n",
            f"--{boundary}--\r\n".encode(),
        ]
        headers = self._headers({"Content-Type": f"multipart/form-data; boundary={boundary}"})
        request = urllib.request.Request(
            self.base + "/data-sources/upload", b"".join(parts), headers, method="POST"
        )
        return self._send(request, timeout=120)

    @staticmethod
    def _send(request: urllib.request.Request, timeout: float = 60) -> Any:
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                raw = response.read()
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode(errors="replace")[:500]
            raise RuntimeError(f"{request.method} {request.full_url} -> {exc.code}: {detail}") from None
        return json.loads(raw) if raw else None


def reachable(url: str) -> bool:
    try:
        urllib.request.urlopen(urllib.request.Request(url, method="GET"), timeout=3)
        return True
    except urllib.error.HTTPError:
        return True  # the server answered, even if not with 200
    except (urllib.error.URLError, OSError):
        return False


def wait_for(fn, *, timeout: float, interval: float = 1.0, what: str = "condition"):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = fn()
        if value:
            return value
        time.sleep(interval)
    raise TimeoutError(f"Timed out after {timeout:.0f}s waiting for {what}")


def setup(api: Api, mcp_url: str | None) -> dict[str, Any]:
    stamp = datetime.now(UTC).strftime("%Y%m%d%H%M%S")
    auth = api.call(
        "POST",
        "/auth/signup",
        {"email": f"eval-{stamp}@helix.test", "name": "Evaluation", "password": secrets.token_urlsafe(16)},
    )
    api.token = auth["accessToken"]
    org = api.call("POST", "/organizations", {"name": f"Evaluation {stamp}"})
    api.org = org["id"]
    project = api.call("POST", "/projects", {"name": "Evaluation"})

    csv = api.upload_csv(ORDERS_CSV, "orders")
    wait_for(
        lambda: api.call("GET", f"/data-sources/{csv['id']}")["status"] == "CONNECTED",
        timeout=120,
        what="orders.csv to connect",
    )

    deployments = None
    if mcp_url and reachable(mcp_url):
        source = api.call(
            "POST",
            "/data-sources",
            {"name": "deployments", "type": "MCP", "config": {"serverUrl": mcp_url}},
        )

        def connected():
            status = api.call("GET", f"/data-sources/{source['id']}")["status"]
            if status == "ERROR":
                raise RuntimeError("The MCP deployments source failed to connect.")
            return status == "CONNECTED"

        wait_for(connected, timeout=60, what="the MCP deployments source to connect")
        deployments = source["id"]
    return {"projectId": project["id"], "csvId": csv["id"], "deploymentsId": deployments}


def run_question(api: Api, project_id: str, question: str) -> dict[str, Any]:
    inv = api.call("POST", "/investigations", {"projectId": project_id, "question": question})
    return finish(api, inv["id"])


def finish(api: Api, investigation_id: str) -> dict[str, Any]:
    final = wait_for(
        lambda: (lambda i: i if i["status"] in TERMINAL else None)(
            api.call("GET", f"/investigations/{investigation_id}")
        ),
        timeout=360,
        interval=2,
        what=f"investigation {investigation_id}",
    )
    trace = api.call("GET", f"/investigations/{investigation_id}/trace")
    started, completed = final.get("createdAt"), final.get("completedAt")
    latency = None
    if started and completed:
        latency = (
            datetime.fromisoformat(completed.replace("Z", "+00:00"))
            - datetime.fromisoformat(started.replace("Z", "+00:00"))
        ).total_seconds()
    return {"investigation": final, "trace": trace, "latencySeconds": latency}


def run_autonomous(api: Api, project_id: str, spec: dict[str, Any]) -> dict[str, Any]:
    suggestions = api.call("GET", "/monitors/suggestions")
    pick = next((s for s in suggestions if s.get("metricKey") == spec["metricKey"]), None)
    if pick is None:
        return {"ok": False, "detail": f"no {spec['metricKey']} monitor suggestion", "checks": []}
    body = {k: v for k, v in pick.items() if k not in ("dataSourceName",) and v is not None}
    monitor = api.call("POST", "/monitors", {**body, "projectId": project_id})
    first = api.call("POST", f"/monitors/{monitor['id']}/run")
    second = api.call("POST", f"/monitors/{monitor['id']}/run")
    checks = []
    inv_id = first.get("investigationId")
    checks.append({"name": "first run opens an investigation", "ok": bool(inv_id), "detail": json.dumps(first)[:300]})
    checks.append(
        {
            "name": "second run is deduplicated",
            # A deduplicated run points back at the investigation the first run opened.
            "ok": second.get("status") == "deduped"
            and second.get("investigationId") in (None, inv_id),
            "detail": json.dumps(second)[:300],
        }
    )
    result: dict[str, Any] = {"monitor": monitor["id"], "first": first, "second": second}
    if inv_id:
        done = finish(api, inv_id)
        trace = done["trace"]
        inv = trace.get("investigation") or {}
        ctx = inv.get("triggerContext") or {}
        checks.append(
            {
                "name": "trigger type",
                "ok": inv.get("triggerType") == spec["expectTriggerType"],
                "detail": str(inv.get("triggerType")),
            }
        )
        checks.append(
            {"name": "trigger date", "ok": ctx.get("date") == spec["expectDate"], "detail": str(ctx.get("date"))}
        )
        root = root_cause_finding(trace)
        checks.append(
            {
                "name": "root cause date",
                "ok": bool(root) and spec["expectDate"] in (root or {}).get("statement", ""),
                "detail": (root or {}).get("statement", "no root cause"),
            }
        )
        result["latencySeconds"] = done["latencySeconds"]
        result["hallucination"] = hallucination_report(trace)
        result["question"] = inv.get("question")
    result["checks"] = checks
    result["passed"] = sum(1 for c in checks if c["ok"])
    result["total"] = len(checks)
    return result


def render_markdown(report: dict[str, Any]) -> str:
    lines = [
        "# HELIX evaluation results",
        "",
        f"Run at {report['ranAt']} against `{report['api']}`. Generated by `tests/evaluation/run_eval.py`;",
        "the method is described in [evaluation.md](./evaluation.md).",
        "",
        f"- Deployments feed (MCP) connected: {'yes' if report['deploymentsConnected'] else 'no'}",
        f"- Planner / summary writer: {report['planners']}",
        f"- Accuracy checks passed: **{report['accuracy']['passed']} / {report['accuracy']['total']}**",
        f"- Numbers checked for traceability: {report['hallucination']['numbersChecked']}, untraced:"
        f" **{report['hallucination']['untracedNumbers']}**"
        f" (rate {report['hallucination']['rate']:.1%})",
        f"- Latency: p50 {fmt_s(report['latency']['p50'])}, p95 {fmt_s(report['latency']['p95'])},"
        f" max {fmt_s(report['latency']['max'])}",
        "",
        "## Scenarios",
        "",
        "| Scenario | Status | Checks | Latency | Root cause |",
        "|---|---|---|---|---|",
    ]
    for s in report["scenarios"]:
        root = (s.get("rootCause") or "none").replace("|", "/")
        lines.append(
            f"| {s['id']} | {s['status']} | {s['score']['passed']}/{s['score']['total']} |"
            f" {fmt_s(s['latencySeconds'])} | {root} |"
        )
    auto = report.get("autonomous")
    if auto:
        lines += [
            "",
            "## Autonomous monitoring",
            "",
            f"Question generated: {auto.get('question') or 'n/a'}",
            "",
            "| Check | Result | Detail |",
            "|---|---|---|",
        ]
        for c in auto.get("checks", []):
            detail = str(c["detail"]).replace("|", "/")[:160]
            lines.append(f"| {c['name']} | {'pass' if c['ok'] else 'FAIL'} | {detail} |")
    failed = [
        (s["id"], c) for s in report["scenarios"] for c in s["score"]["checks"] if not c["ok"]
    ]
    if failed:
        lines += ["", "## Failed checks", ""]
        lines += [f"- {sid}: {c['name']} ({c['detail']})" for sid, c in failed]
    issues = [(s["id"], i) for s in report["scenarios"] for i in s["hallucination"]["issues"]]
    if issues:
        lines += ["", "## Untraced numbers", ""]
        lines += [f"- {sid}: {i['untraced']} in \"{i['text'][:200]}\"" for sid, i in issues]
    return "\n".join(lines) + "\n"


def fmt_s(value: float | None) -> str:
    return "n/a" if value is None else f"{value:.1f}s"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--api", default="http://localhost:4100")
    parser.add_argument("--mcp", default="http://localhost:8006/mcp")
    parser.add_argument("--out", default=str(ROOT / "docs" / "research" / "evaluation-results.md"))
    parser.add_argument("--skip-autonomous", action="store_true")
    args = parser.parse_args()

    spec = json.loads(SCENARIOS.read_text())
    api = Api(args.api)
    env = setup(api, args.mcp)
    deployments = env["deploymentsId"] is not None
    print(f"Setup done (deployments feed {'connected' if deployments else 'not available'}).")

    scenarios, latencies, planners = [], [], set()
    hall = {"numbersChecked": 0, "untracedNumbers": 0}
    for scenario in spec["scenarios"]:
        print(f"- {scenario['id']}: {scenario['question']}")
        done = run_question(api, env["projectId"], scenario["question"])
        trace = done["trace"]
        score = score_scenario(scenario["expect"], trace, deployments_connected=deployments)
        h = hallucination_report(trace)
        hall["numbersChecked"] += h["numbersChecked"]
        hall["untracedNumbers"] += h["untracedNumbers"]
        meta = trace.get("meta") or {}
        planners.add(f"{meta.get('planner', 'rules')}/{meta.get('summaryWriter', 'rules')}")
        if done["latencySeconds"] is not None:
            latencies.append(done["latencySeconds"])
        root = root_cause_finding(trace)
        scenarios.append(
            {
                "id": scenario["id"],
                "question": scenario["question"],
                "investigationId": done["investigation"]["id"],
                "status": done["investigation"]["status"],
                "latencySeconds": done["latencySeconds"],
                "rootCause": (root or {}).get("statement"),
                "score": score,
                "hallucination": h,
            }
        )
        print(f"  {done['investigation']['status']}, {score['passed']}/{score['total']} checks")

    autonomous = None
    if not args.skip_autonomous:
        print("- autonomous monitoring")
        autonomous = run_autonomous(api, env["projectId"], spec["autonomous"])
        if autonomous.get("latencySeconds") is not None:
            latencies.append(autonomous["latencySeconds"])
        if autonomous.get("hallucination"):
            hall["numbersChecked"] += autonomous["hallucination"]["numbersChecked"]
            hall["untracedNumbers"] += autonomous["hallucination"]["untracedNumbers"]
        print(f"  {autonomous.get('passed', 0)}/{autonomous.get('total', 0)} checks")

    passed = sum(s["score"]["passed"] for s in scenarios) + (autonomous or {}).get("passed", 0)
    total = sum(s["score"]["total"] for s in scenarios) + (autonomous or {}).get("total", 0)
    hall["rate"] = hall["untracedNumbers"] / hall["numbersChecked"] if hall["numbersChecked"] else 0.0
    report = {
        "ranAt": datetime.now(UTC).isoformat(timespec="seconds"),
        "api": args.api,
        "deploymentsConnected": deployments,
        "planners": ", ".join(sorted(planners)) or "n/a",
        "accuracy": {"passed": passed, "total": total},
        "hallucination": hall,
        "latency": {
            "p50": percentile(latencies, 0.5),
            "p95": percentile(latencies, 0.95),
            "max": max(latencies) if latencies else None,
        },
        "scenarios": scenarios,
        "autonomous": autonomous,
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(render_markdown(report))
    out.with_suffix(".json").write_text(json.dumps(report, indent=2, default=str))
    print(f"Accuracy {passed}/{total}; untraced numbers {hall['untracedNumbers']}/{hall['numbersChecked']}.")
    print(f"Report written to {out} (+ .json).")
    return 0 if passed == total and hall["untracedNumbers"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
