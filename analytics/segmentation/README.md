# Segmentation (`helix_segmentation`)

Segment comparison for one day of a daily metric: which slice of which
dimension (e.g. `channel = web`) explains the move. Pure functions over a
DataFrame; called by `services/analytics-engine` from `POST /segments/compare`.

```python
from helix_segmentation import compare_segments

result = compare_segments(
    frame, day, target_day,              # rows (already filtered) + their UTC day
    aggregation="sum", value_column="amount",
    dimensions=None,                     # default: candidate_dimensions(frame)
    baseline="same_weekday", baseline_periods=4,
)
result.total                             # Change(actual, expected, delta, delta_percent)
result.dimensions                        # [Dimension(column, concentration, slices=[Slice...])]
result.top_slice                         # TopSlice(column, slice) | None
result.baseline_days, result.description # description becomes computationMethod
```

## Method

- **Baseline days**: `same_weekday` = the same weekday in the previous N weeks;
  `trailing_mean` = the previous N*7 days. Days before the data starts are dropped.
- **Per slice**: actual = aggregate on the target day, expected = mean of the
  daily aggregate over the baseline days (a day with no rows counts as 0),
  delta = actual - expected, deltaPercent = delta / |expected| * 100 (None when
  expected is 0), shareOfDelta = delta / total delta (0 when the total did not
  move). For sum and count the shares of a dimension sum to 1.
- **Concentration** of a dimension = the largest share among slices that moved
  in the same direction as the total, clipped to [0, 1]. Dimensions are ranked
  by concentration; ties (several dimensions clip to 1) go to the one whose
  best slice has the larger |deltaPercent|. Slices are sorted by |delta|.
- **Top slice** = the best slice of the top dimension, only when concentration
  >= 0.5 and the slice's |deltaPercent| >= 1.5x the total's.
- **Default dimensions**: object/category/string columns with 2..20 distinct values.

`aggregation` is `sum`, `count`, `mean` or `count_distinct` (`count` without a
value column counts rows). For `mean` and `count_distinct` slice shares do not
have to sum to 1.

## Development

```bash
pnpm --filter @helix/segmentation test   # or: bash ../../scripts/python-run.sh test
.venv/bin/ruff check .
```
