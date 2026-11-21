# Evaluation dataset: orders

A seeded, synthetic e-commerce order log with known, injected anomalies. It
is the ground truth for analytics correctness tests (Phase 3) and for
end-to-end investigation evaluation later (see `docs/research/evaluation.md`).

| File | What it is |
|---|---|
| `generate_orders.py` | Deterministic generator (numpy seed `20261014`). Re-running it reproduces `orders.csv` byte for byte. |
| `orders.csv` | 23,916 orders, 2026-07-17 to 2026-10-14 inclusive (90 UTC days), ~1.7 MB. |
| `ground_truth.json` | The injected anomalies and the intended root cause, machine-readable. |

Regenerate with any Python that has numpy and pandas, for example:

```bash
services/analytics-engine/.venv/bin/python tests/fixtures/generate_orders.py
```

## Columns

| Column | Notes | Expected semanticType |
|---|---|---|
| `order_id` | `ord_000001`... unique | identifier |
| `created_at` | ISO timestamp, UTC (`2026-10-08T14:03:11Z`) | datetime |
| `customer_id` | `cus_00001`..`cus_06000`, repeats | identifier |
| `segment` | `enterprise` / `mid_market` / `smb` (15% / 35% / 50%) | categorical |
| `channel` | `web` / `mobile` / `partner` (55% / 30% / 15%) | categorical |
| `amount` | USD, 2 decimals, lognormal per segment (medians 240 / 110 / 45) | currency |
| `status` | `completed` / `refunded` | categorical |

## Scenario

Baseline behaviour:

- ~250 orders/day at the start, growing ~0.3% per day (mild upward trend),
  between 160 and 370 orders on any normal day.
- Weekly seasonality: Saturday and Sunday volume is ~30% lower than weekdays.
- Refund rate ~3%.

Injected ground truth (all dates are UTC days of `created_at`):

1. **2026-10-08: revenue drop.** Only 15% of that day's `web` orders exist
   (a simulated web checkout failure); mobile and partner are untouched.
   Total revenue (`sum(amount)`) lands ~40% below the expected value for a
   Thursday; completed-only revenue drops further (~50%) because of (2).
2. **2026-10-08 and 2026-10-09: refund spike.** The refund rate jumps from
   ~3% to ~18% (realised 21% and 18%).

Intended root cause for investigations: a web checkout incident on
2026-10-08, visible as the revenue drop concentrated in `channel = web`, with
refunds spiking over the same two days.

How the analytics engine is expected to address it (and what the agent
heuristics use): time column `created_at`, value column `amount`, refunds via
`filter: { column: "status", op: "in", value: ["refunded", "refund", "returned"] }`.

## Tolerances asserted by tests

`services/analytics-engine/tests/test_ground_truth.py` asserts:

- `POST /anomalies/detect` on daily `sum(amount)` flags 2026-10-08 as a
  `drop` with `CRITICAL` severity, and it is the most extreme point in the
  series (robust z-score about -8 with the default `auto` -> STL seasonal).
- The same on daily refund counts flags 2026-10-08 and 2026-10-09 as
  `spike`, `CRITICAL`.
- KPI values (weekly revenue, refund rate) equal an independent pandas
  computation to float rounding (relative tolerance 1e-12).
- `POST /forecast` on daily revenue has a 14-day holdout backtest MAPE
  **under 15%**. Observed: ~10.8% (ETS chosen over ARIMA at ~12.4%). The
  tolerance is loose on purpose: the holdout window contains the injected
  drop, which alone adds ~3 points of MAPE, and day-level revenue noise is
  ~7%.

Known noise: with the default threshold of 3, natural variation also
produces a few `MEDIUM`/`HIGH` revenue flags (2026-07-30, 2026-09-22,
2026-10-02, |score| 3.6 to 4.5). They are real outliers of the random draw,
not injected events; consumers should rank by `deviationScore`/severity, and
the evaluation only treats the `CRITICAL` points above as ground truth.
