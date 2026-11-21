from pathlib import Path

import pytest
from app.adapters.csv import table_name_for
from app.main import app
from fastapi.testclient import TestClient

client = TestClient(app)
FIXTURE = Path(__file__).resolve().parents[3] / "tests" / "fixtures" / "orders.csv"


def _csv(path: Path, original_name: str = "orders.csv") -> dict:
    return {"type": "CSV", "config": {"fileId": "f1", "originalName": original_name},
            "filePath": str(path)}


def test_table_name_is_sanitized_stem():
    assert table_name_for("Orders 2026 (Q3).csv", "/x/abc") == "orders_2026_q3"
    assert table_name_for(None, "/x/data-file.csv") == "data_file"
    assert table_name_for("!!!.csv", "/x/y") == "data"


def test_fixture_connect_infers_semantic_types():
    body = client.post("/connect", json={"connection": _csv(FIXTURE)}).json()
    assert body["ok"] is True, body
    [table] = body["schemas"]
    assert table["tableName"] == "orders"
    assert table["rowCountEstimate"] > 10_000
    semantic = {c["name"]: c["semanticType"] for c in table["columns"]}
    assert semantic == {
        "order_id": "identifier",
        "created_at": "datetime",
        "customer_id": "identifier",
        "segment": "categorical",
        "channel": "categorical",
        "amount": "currency",
        "status": "categorical",
    }


def test_preview_profile_extract_happy_path(tmp_path):
    path = tmp_path / "People.csv"
    path.write_text(
        "id,email,signed_up,score,active,note\n"
        "1,a@example.com,2026-01-01,1.5,true,hello\n"
        "2,b@example.com,2026-01-02,,false,\n"
        "3,c@example.com,2026-01-03,2.25,true,world\n"
    )
    connection = _csv(path, "People.csv")
    preview = client.post("/preview", json={"connection": connection, "table": "people"})
    assert preview.status_code == 200
    assert preview.json()["rows"][1] == {
        "id": 2, "email": "b@example.com", "signed_up": "2026-01-02", "score": None,
        "active": False, "note": None,
    }
    profile = client.post("/profile", json={"connection": connection, "table": "people"}).json()
    assert profile["rowCount"] == 3
    by_name = {c["name"]: c for c in profile["columns"]}
    assert by_name["score"]["nullRate"] == pytest.approx(1 / 3)
    assert by_name["email"]["semanticType"] == "email"
    assert by_name["signed_up"]["semanticType"] == "datetime"
    assert by_name["active"]["semanticType"] == "boolean"
    extract = client.post(
        "/extract",
        json={"connection": connection, "table": "people", "columns": ["id"], "limit": 2},
    ).json()
    assert extract == {"columns": ["id"], "rows": [{"id": 1}, {"id": 2}]}


def test_semicolon_and_latin1_files_are_read(tmp_path):
    path = tmp_path / "eu.csv"
    path.write_bytes("name;city\nJos\xe9;M\xfcnchen\n".encode("latin-1"))
    rows = client.post("/preview", json={"connection": _csv(path, "eu.csv"), "table": "eu"}).json()
    assert rows["rows"] == [{"name": "José", "city": "München"}]


def test_malformed_csv_returns_readable_error(tmp_path):
    path = tmp_path / "bad.csv"
    path.write_text("a,b,c\n1,2,3\n4,5,6,7,8\n")
    body = client.post("/connect", json={"connection": _csv(path, "bad.csv")}).json()
    assert body["ok"] is False
    assert body["error"].startswith("Malformed CSV")
    assert "line 3" in body["error"]


def test_empty_csv_returns_readable_error(tmp_path):
    path = tmp_path / "empty.csv"
    path.write_text("")
    body = client.post("/connect", json={"connection": _csv(path, "empty.csv")}).json()
    assert body == {"ok": False, "error": "The CSV file is empty."}
    path.write_text("\n\n")
    assert client.post("/connect", json={"connection": _csv(path)}).json()["ok"] is False


def test_header_only_csv_is_a_zero_row_table(tmp_path):
    path = tmp_path / "header.csv"
    path.write_text("a,b\n")
    body = client.post("/connect", json={"connection": _csv(path, "header.csv")}).json()
    assert body["ok"] is True
    assert body["schemas"][0]["rowCountEstimate"] == 0


def test_binary_and_missing_files(tmp_path):
    path = tmp_path / "blob.csv"
    path.write_bytes(b"\x89PNG\x00\x00\x01binary")
    body = client.post("/connect", json={"connection": _csv(path)}).json()
    assert body["ok"] is False and "binary" in body["error"]
    missing = client.post("/connect", json={"connection": _csv(tmp_path / "nope.csv")}).json()
    assert missing == {"ok": False, "error": "The uploaded CSV file could not be found."}


def test_unknown_table_is_422(tmp_path):
    response = client.post("/preview", json={"connection": _csv(FIXTURE), "table": "customers"})
    assert response.status_code == 422
    assert "Unknown table 'customers'" in response.json()["detail"]
