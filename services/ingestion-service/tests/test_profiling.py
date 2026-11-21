import datetime as dt
import uuid
from decimal import Decimal

import numpy as np
import pandas as pd
from app.profiling import infer_semantic_type, to_json_rows


def test_semantic_type_rules():
    s = pd.Series
    assert infer_semantic_type("is_active", "boolean", None) == "boolean"
    assert infer_semantic_type("flag", "text", s(["yes", "no", "yes"])) == "boolean"
    assert infer_semantic_type("created_at", "text", s(["2026-01-01T00:00:00Z"] * 5)) == "datetime"
    assert infer_semantic_type("ts", "timestamp with time zone", None) == "datetime"
    assert infer_semantic_type("contact", "text", s(["a@b.co", "c@d.io"])) == "email"
    assert infer_semantic_type("customerId", "text", s(["x", "y"])) == "identifier"
    assert infer_semantic_type("total_price", "float", s([1.0, 2.0])) == "currency"
    assert infer_semantic_type("order_count", "integer", s([1, 2, 3])) == "numeric"
    assert infer_semantic_type("x", "float", s([1.25, 3.10, 4.99, 2.0] * 10)) == "currency"
    assert infer_semantic_type("ratio", "float", s(np.linspace(0, 1, 40))) == "numeric"
    assert infer_semantic_type("seq", "integer", s(range(100))) == "identifier"
    assert infer_semantic_type("tier", "text", s(["a", "b", "c"] * 20)) == "categorical"
    notes = s([f"note number {i}" for i in range(50)])
    assert infer_semantic_type("comment", "text", notes) == "text"
    assert infer_semantic_type("year", "text", s(["2024", "2025"] * 10)) == "categorical"


def test_to_json_rows_handles_awkward_values():
    df = pd.DataFrame(
        {
            "f": [1.5, np.nan],
            "d": [Decimal("2.50"), None],
            "t": [pd.Timestamp("2026-10-08 12:00", tz="Europe/Berlin"), pd.NaT],
            "u": [uuid.UUID(int=1), None],
            "dt": [dt.date(2026, 1, 2), None],
            "b": [b"\x01\x02", None],
            "i": [1, 2],
            "inf": [float("inf"), 1.0],
        }
    )
    columns, rows = to_json_rows(df)
    assert columns == list(df.columns)
    assert rows[0] == {
        "f": 1.5, "d": 2.5, "t": "2026-10-08T10:00:00+00:00",
        "u": "00000000-0000-0000-0000-000000000001", "dt": "2026-01-02", "b": "0102",
        "i": 1, "inf": None,
    }
    assert rows[1]["f"] is None and rows[1]["t"] is None and rows[1]["d"] is None
