# Correlation (`helix_correlation`)

Diagnostic helpers for root-cause work: lagged correlation between two daily
metric series, and temporal alignment of discrete events (deploys, incidents)
with target days. Pure functions; called by `services/analytics-engine` from
`POST /correlation` and `POST /events/align`.

```python
from helix_correlation import align_events, correlate

result = correlate(a, b, method="spearman", max_lag=3)   # pd.Series indexed by UTC day
result.coefficient, result.p_value, result.lag, result.n
result.lags                                              # every computed lag
result.description                                       # becomes computationMethod

[aligned] = align_events(times, [(day, "revenue drop")], labels,
                         window_hours_before=24, window_hours_after=24)
aligned.events   # [EventMatch(index, time, labels, hours_before, same_day)]
```

## Correlation

Lags 0..max_lag (max 14) are tried. Lag k shifts b forward by k days (b on day
t is paired with a on day t + k, so b leads a). Pairs are aligned on day and
days missing in either series are dropped. Coefficient and two-sided p-value
come from `scipy.stats.pearsonr` or `scipy.stats.spearmanr`. The lag with the
largest |coefficient| wins (ties: smaller lag). Fewer than 10 overlapping days
at lag 0 raises `ValueError`; lags with fewer than 10 are skipped; a constant
series raises `ValueError`.

## Event alignment

For a target UTC day D an event matches when its time is in
`[D 00:00 - window_hours_before, D 00:00 + 24h + window_hours_after)`.
`hours_before = (D 00:00 - time)` in hours (negative when the event is during
or after the start of D), `same_day` = the event's UTC date is D. Matches are
sorted by |hours_before|, then time. Missing or unparseable times never match.

## Development

```bash
pnpm --filter @helix/correlation test   # or: bash ../../scripts/python-run.sh test
.venv/bin/ruff check .
```
