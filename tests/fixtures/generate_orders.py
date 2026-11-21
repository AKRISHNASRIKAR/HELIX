"""Generate the HELIX evaluation dataset: tests/fixtures/orders.csv + ground_truth.json.

Deterministic (fixed numpy seed), so re-running it reproduces the committed
files byte for byte. Scenario (see README.md in this directory):

- 90 days of e-commerce orders ending 2026-10-14 (inclusive, UTC).
- Weekly seasonality (Saturday/Sunday volume is lower), mild upward trend.
- 2026-10-08: revenue drops ~40% vs expected, concentrated in channel=web
  (most web orders that day never complete checkout and are missing).
- 2026-10-08 and 2026-10-09: refund rate jumps from ~3% to ~18%.

Usage: python tests/fixtures/generate_orders.py   (needs numpy + pandas)
"""

from __future__ import annotations

import json
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

SEED = 20261014
END_DATE = date(2026, 10, 14)
DAYS = 90
START_DATE = END_DATE - timedelta(days=DAYS - 1)

BASE_ORDERS_PER_DAY = 250
TREND_PER_DAY = 0.003  # +0.3% volume per day, ~+30% over the window
WEEKDAY_FACTOR = {0: 1.05, 1: 1.08, 2: 1.06, 3: 1.04, 4: 1.0, 5: 0.72, 6: 0.68}

SEGMENTS = ["enterprise", "mid_market", "smb"]
SEGMENT_P = [0.15, 0.35, 0.50]
# Lognormal order value per segment: (median USD, sigma).
SEGMENT_AMOUNT = {"enterprise": (240.0, 0.30), "mid_market": (110.0, 0.30), "smb": (45.0, 0.30)}

CHANNELS = ["web", "mobile", "partner"]
CHANNEL_P = [0.55, 0.30, 0.15]

BASE_REFUND_RATE = 0.03
SPIKE_REFUND_RATE = 0.18

DROP_DATE = date(2026, 10, 8)
# Share of web orders kept on the drop date. Web is ~55% of orders, so keeping
# 15% of it removes ~0.55 * 0.85 = ~47% of that day's orders; with order-value
# noise the realised revenue drop vs the same weekday a week earlier is ~40%.
DROP_WEB_KEEP = 0.15
REFUND_SPIKE_DATES = {date(2026, 10, 8), date(2026, 10, 9)}

N_CUSTOMERS = 6000

OUT_DIR = Path(__file__).resolve().parent


def generate() -> pd.DataFrame:
    rng = np.random.default_rng(SEED)
    frames: list[pd.DataFrame] = []
    order_seq = 0

    for offset in range(DAYS):
        day = START_DATE + timedelta(days=offset)
        trend = 1 + TREND_PER_DAY * offset
        expected = BASE_ORDERS_PER_DAY * trend * WEEKDAY_FACTOR[day.weekday()]
        n = int(rng.poisson(expected))
        if day == DROP_DATE:
            # Pin the pre-drop volume to its expectation so the injected ~40% drop
            # is not diluted or exaggerated by that day's Poisson noise.
            n = round(expected)

        segment = rng.choice(SEGMENTS, size=n, p=SEGMENT_P)
        channel = rng.choice(CHANNELS, size=n, p=CHANNEL_P)
        medians = np.array([SEGMENT_AMOUNT[s][0] for s in segment])
        sigmas = np.array([SEGMENT_AMOUNT[s][1] for s in segment])
        amount = np.round(medians * np.exp(rng.normal(0.0, 1.0, size=n) * sigmas), 2)
        seconds = np.sort(rng.integers(0, 86400, size=n))
        customer = rng.integers(1, N_CUSTOMERS + 1, size=n)
        refund_rate = SPIKE_REFUND_RATE if day in REFUND_SPIKE_DATES else BASE_REFUND_RATE
        refunded = rng.random(n) < refund_rate

        keep = np.ones(n, dtype=bool)
        if day == DROP_DATE:
            keep = (channel != "web") | (rng.random(n) < DROP_WEB_KEEP)

        midnight = datetime(day.year, day.month, day.day, tzinfo=UTC)
        created = [
            (midnight + timedelta(seconds=int(s))).strftime("%Y-%m-%dT%H:%M:%SZ") for s in seconds
        ]
        frame = pd.DataFrame(
            {
                "created_at": created,
                "customer_id": [f"cus_{c:05d}" for c in customer],
                "segment": segment,
                "channel": channel,
                "amount": amount,
                "status": np.where(refunded, "refunded", "completed"),
            }
        )[keep]
        ids = [f"ord_{order_seq + i + 1:06d}" for i in range(len(frame))]
        order_seq += len(frame)
        frame.insert(0, "order_id", ids)
        frames.append(frame)

    return pd.concat(frames, ignore_index=True)


def ground_truth() -> dict:
    return {
        "dataset": "orders.csv",
        "timeColumn": "created_at",
        "valueColumn": "amount",
        "dateRange": {"start": START_DATE.isoformat(), "end": END_DATE.isoformat()},
        "anomalies": [
            {
                "metric": "revenue",
                "definition": "sum(amount), all orders",
                "date": DROP_DATE.isoformat(),
                "direction": "drop",
                "magnitude": "~40% below expected",
                "segment": {"channel": "web"},
            },
            {
                "metric": "completed_revenue",
                "definition": "sum(amount) where status = completed",
                "date": DROP_DATE.isoformat(),
                "direction": "drop",
                "magnitude": "~50% below expected (drop plus refund spike)",
                "segment": {"channel": "web"},
            },
            {
                "metric": "refunds",
                "definition": "count(*) where status in (refunded)",
                "date": "2026-10-08",
                "direction": "spike",
                "magnitude": "refund rate ~18% vs ~3% baseline",
            },
            {
                "metric": "refunds",
                "definition": "count(*) where status in (refunded)",
                "date": "2026-10-09",
                "direction": "spike",
                "magnitude": "refund rate ~18% vs ~3% baseline",
            },
            {
                "metric": "refund_rate",
                "definition": "count(status = refunded) / count(*)",
                "date": "2026-10-08",
                "direction": "spike",
            },
            {
                "metric": "refund_rate",
                "definition": "count(status = refunded) / count(*)",
                "date": "2026-10-09",
                "direction": "spike",
            },
        ],
        "rootCause": {
            "summary": (
                "Web checkout failure on 2026-10-08: most web orders that day never completed, "
                "while refunds spiked on 2026-10-08 and 2026-10-09."
            ),
            "segment": {"channel": "web"},
        },
        "notes": (
            f"Generated by generate_orders.py with seed {SEED}. {DAYS} days of orders, "
            f"~{BASE_ORDERS_PER_DAY} orders/day baseline with weekly seasonality (weekends ~30% "
            "lower) and +0.3%/day trend. On 2026-10-08 only 15% of web orders survive "
            "(~40% total revenue drop). Refund rate is 3% except 18% on 2026-10-08 and "
            "2026-10-09. All dates are UTC days of created_at."
        ),
    }


def main() -> None:
    df = generate()
    df.to_csv(OUT_DIR / "orders.csv", index=False, float_format="%.2f")
    (OUT_DIR / "ground_truth.json").write_text(json.dumps(ground_truth(), indent=2) + "\n")
    print(f"wrote {len(df)} orders to {OUT_DIR / 'orders.csv'}")


if __name__ == "__main__":
    main()
