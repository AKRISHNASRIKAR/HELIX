"""Generate tests/fixtures/deployments.json: the production deploy log that the
local MCP demo server (services/mcp-demo) serves next to orders.csv.

Deterministic (fixed `random.Random` seed, stdlib only), so re-running it
reproduces the committed file byte for byte. Scenario (see README.md here):

- ~40 production deploys, 2026-07-17 to 2026-10-14, across six services,
  weekdays during working hours (UTC).
- 2026-10-08T08:40:00Z: `web-checkout` v2.14.0 ("New payment form and address
  validation for web checkout"), later rolled back. This is the trigger of
  the web checkout incident injected into orders.csv.
- 2026-10-09T06:15:00Z: `web-checkout` v2.14.1, the revert.
- Nothing else ships from 2026-10-06T12:00Z (36h before 2026-10-08) to the end
  of 2026-10-09, except one unrelated, low-impact `search` deploy on
  2026-10-07, so a deploy-ranking step has a real decoy to reject.

It also stamps `rootCause.trigger` into ground_truth.json (run it after
generate_orders.py, which rewrites that file).

Usage: python tests/fixtures/generate_deployments.py   (any Python 3.11+)
"""

from __future__ import annotations

import hashlib
import json
import random
from datetime import UTC, datetime, timedelta
from pathlib import Path

SEED = 20261008
START = datetime(2026, 7, 17, tzinfo=UTC)
END = datetime(2026, 10, 14, 23, 59, 59, tzinfo=UTC)
RANDOM_DEPLOYS = 37

# Quiet window around the incident: only the fixed deploys below land in it.
QUIET_START = datetime(2026, 10, 6, 12, 0, tzinfo=UTC)
QUIET_END = datetime(2026, 10, 10, 0, 0, tzinfo=UTC)

SERVICES = ["web-checkout", "mobile-api", "partner-gateway", "search", "catalog", "notifications"]
SERVICE_WEIGHTS = [5, 4, 2, 3, 3, 2]
# (major, minor) each service starts the window at; web-checkout is derived so
# its last pre-incident deploy is v2.13.x.
START_VERSION = {
    "mobile-api": (5, 2),
    "partner-gateway": (1, 7),
    "search": (3, 11),
    "catalog": (4, 4),
    "notifications": (0, 18),
}
AUTHORS = ["aisha.k", "ben.t", "carla.m", "dev.r", "emeka.o", "fiona.l", "gus.w", "hana.s"]
DESCRIPTIONS = {
    "web-checkout": [
        "Cart summary layout tweaks",
        "Upgrade payment SDK to latest minor",
        "Improve coupon code error messages",
        "Lazy load shipping estimates",
        "Fix tax rounding for multi-currency carts",
        "Add saved-card selector",
        "Refactor checkout analytics events",
    ],
    "mobile-api": [
        "Add pagination to order history endpoint",
        "Reduce cold start time of product feed",
        "Push token refresh fix",
        "New wishlist sync endpoint",
        "Rate limit tuning for login",
        "Return delivery ETA in order detail",
    ],
    "partner-gateway": [
        "Rotate partner webhook signing keys",
        "Bulk order import validation",
        "Retry policy for partner callbacks",
        "Add partner SLA metrics",
    ],
    "search": [
        "Tune ranking weights for seasonal items",
        "Update synonym dictionary",
        "Typo tolerance for brand names",
        "Faster autocomplete index rebuild",
        "Boost in-stock items in results",
    ],
    "catalog": [
        "Image CDN cache headers",
        "Variant price import job fix",
        "New product attribute schema",
        "Category tree caching",
        "Backfill missing product dimensions",
    ],
    "notifications": [
        "Order shipped email template refresh",
        "Batch push notifications by timezone",
        "Unsubscribe link fix",
        "SMS provider failover",
    ],
}

FIXED = [
    {
        "service": "search",
        "deployed_at": datetime(2026, 10, 7, 15, 20, tzinfo=UTC),
        "author": "dev.r",
        "description": "Update synonym dictionary for autumn catalog terms",
        "status": "success",
    },
    {
        "service": "web-checkout",
        "version": "v2.14.0",
        "deployed_at": datetime(2026, 10, 8, 8, 40, tzinfo=UTC),
        "author": "carla.m",
        "description": "New payment form and address validation for web checkout",
        "status": "rolled_back",
    },
    {
        "service": "web-checkout",
        "version": "v2.14.1",
        "deployed_at": datetime(2026, 10, 9, 6, 15, tzinfo=UTC),
        "author": "carla.m",
        "description": "Revert payment form changes",
        "status": "success",
    },
]


def _random_time(rng: random.Random) -> datetime:
    """A weekday, working-hours (07:00 to 17:59 UTC) minute outside the quiet window."""
    span_days = (END.date() - START.date()).days
    while True:
        day = START + timedelta(days=rng.randrange(span_days + 1))
        if day.weekday() >= 5:
            continue
        moment = day.replace(hour=rng.randrange(7, 18), minute=rng.randrange(0, 60, 5))
        if not (QUIET_START <= moment < QUIET_END):
            return moment


def _status(rng: random.Random) -> str:
    roll = rng.random()
    if roll < 0.06:
        return "failed"
    if roll < 0.10:
        return "rolled_back"
    return "success"


def build() -> list[dict]:
    rng = random.Random(SEED)
    drafts: list[dict] = []
    seen: set[datetime] = {d["deployed_at"] for d in FIXED}
    for _ in range(RANDOM_DEPLOYS):
        service = rng.choices(SERVICES, weights=SERVICE_WEIGHTS)[0]
        moment = _random_time(rng)
        while moment in seen:
            moment = _random_time(rng)
        seen.add(moment)
        drafts.append(
            {
                "service": service,
                "deployed_at": moment,
                "author": rng.choice(AUTHORS),
                "description": rng.choice(DESCRIPTIONS[service]),
                # The incident deploy is the only web-checkout rollback.
                "status": "success" if service == "web-checkout" else _status(rng),
            }
        )
    drafts.extend(dict(d) for d in FIXED)
    drafts.sort(key=lambda d: (d["deployed_at"], d["service"]))

    # Versions, per service in time order.
    checkout = [d for d in drafts if d["service"] == "web-checkout" and "version" not in d]
    before = [d for d in checkout if d["deployed_at"] < QUIET_START]
    after = [d for d in checkout if d["deployed_at"] >= QUIET_END]
    for i, d in enumerate(before):
        d["version"] = f"v2.{14 - len(before) + i}.0"
    for i, d in enumerate(after):
        d["version"] = f"v2.14.{2 + i}"
    for service, (major, minor) in START_VERSION.items():
        patch = 0
        for d in (d for d in drafts if d["service"] == service):
            if rng.random() < 0.35:
                minor, patch = minor + 1, 0
            else:
                patch += 1
            d["version"] = f"v{major}.{minor}.{patch}"

    out = []
    for i, d in enumerate(drafts, start=1):
        deployed_at = d["deployed_at"].strftime("%Y-%m-%dT%H:%M:%SZ")
        sha = hashlib.sha1(f"{d['service']}:{d['version']}:{deployed_at}".encode()).hexdigest()
        out.append(
            {
                "id": f"dep_{i:04d}",
                "service": d["service"],
                "version": d["version"],
                "environment": "production",
                "deployed_at": deployed_at,
                "author": d["author"],
                "description": d["description"],
                "status": d["status"],
                "commit_sha": sha,
            }
        )
    return out


TRIGGER = {
    "type": "deployment",
    "service": "web-checkout",
    "version": "v2.14.0",
    "deployedAt": "2026-10-08T08:40:00Z",
}


def stamp_ground_truth(path: Path) -> None:
    """Add `rootCause.trigger` to ground_truth.json (idempotent). generate_orders.py
    rewrites that file without it, so run this generator after it."""
    truth = json.loads(path.read_text())
    truth["rootCause"]["trigger"] = TRIGGER
    path.write_text(json.dumps(truth, indent=2) + "\n")


def main() -> None:
    here = Path(__file__).resolve().parent
    path = here / "deployments.json"
    path.write_text(json.dumps(build(), indent=2) + "\n")
    stamp_ground_truth(here / "ground_truth.json")
    print(f"wrote {path} and stamped rootCause.trigger in ground_truth.json")


if __name__ == "__main__":
    main()
