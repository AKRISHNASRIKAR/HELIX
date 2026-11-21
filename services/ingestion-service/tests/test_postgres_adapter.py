"""PostgresAdapter against the real local `helix_test` database.

A throwaway schema is created per test module and dropped afterwards. Skipped
(not failed) when no local Postgres is reachable, so the suite still runs on
machines without the native dev database.
"""

import os
import uuid

import pytest
import sqlalchemy as sa
from app.main import app
from fastapi.testclient import TestClient

PG = {
    "host": os.environ.get("HELIX_TEST_PG_HOST", "localhost"),
    "port": int(os.environ.get("HELIX_TEST_PG_PORT", "5432")),
    "database": os.environ.get("HELIX_TEST_PG_DATABASE", "helix_test"),
    "user": os.environ.get("HELIX_TEST_PG_USER", "helix"),
    "password": os.environ.get("HELIX_TEST_PG_PASSWORD", "helix"),
}
URL = sa.URL.create(
    "postgresql+psycopg2",
    username=PG["user"],
    password=PG["password"],
    host=PG["host"],
    port=PG["port"],
    database=PG["database"],
)

client = TestClient(app)


@pytest.fixture(scope="module")
def schema():
    engine = sa.create_engine(URL, isolation_level="AUTOCOMMIT")
    try:
        with engine.connect() as conn:
            conn.execute(sa.text("SELECT 1"))
    except sa.exc.OperationalError:
        pytest.skip("local Postgres (helix_test) is not reachable")

    name = f"helix_ingest_test_{uuid.uuid4().hex[:8]}"
    with engine.connect() as conn:
        conn.execute(sa.text(f'CREATE SCHEMA "{name}"'))
        conn.execute(
            sa.text(
                f"""
                CREATE TABLE "{name}".orders (
                    order_id integer PRIMARY KEY,
                    created_at timestamptz NOT NULL,
                    customer_email text,
                    amount numeric(10,2) NOT NULL,
                    status text NOT NULL,
                    is_gift boolean
                )
                """
            )
        )
        conn.execute(
            sa.text(
                f"""
                INSERT INTO "{name}".orders
                SELECT g,
                       timestamptz '2026-10-01 00:00:00+00' + (g || ' hours')::interval,
                       'user' || (g % 7) || '@example.com',
                       round((10 + g * 1.25)::numeric, 2),
                       CASE WHEN g % 10 = 0 THEN 'refunded' ELSE 'completed' END,
                       g % 2 = 0
                FROM generate_series(1, 120) g
                """
            )
        )
        conn.execute(sa.text(f'CREATE VIEW "{name}".refunds AS '
                             f"SELECT * FROM \"{name}\".orders WHERE status = 'refunded'"))
        conn.execute(sa.text(f'CREATE TABLE "{name}"."Weird Name" (id int)'))
    yield name
    with engine.connect() as conn:
        conn.execute(sa.text(f'DROP SCHEMA "{name}" CASCADE'))
    engine.dispose()


def _connection(schema, **overrides):
    credentials = {"user": PG["user"], "password": PG["password"]}
    credentials.update(overrides.pop("credentials", {}))
    config = {"host": PG["host"], "port": PG["port"], "database": PG["database"], "schema": schema}
    config.update(overrides)
    return {"type": "POSTGRESQL", "config": config, "credentials": credentials}


def test_connect_discovers_tables_columns_and_counts(schema):
    response = client.post("/connect", json={"connection": _connection(schema)})
    body = response.json()
    assert response.status_code == 200
    assert body["ok"] is True, body
    tables = {t["tableName"]: t for t in body["schemas"]}
    assert set(tables) == {"orders", "refunds", "Weird Name"}
    orders = tables["orders"]
    assert orders["rowCountEstimate"] == 120
    assert tables["refunds"]["rowCountEstimate"] == 12
    columns = {c["name"]: c for c in orders["columns"]}
    assert [c["name"] for c in orders["columns"]][0] == "order_id"
    assert columns["created_at"]["semanticType"] == "datetime"
    assert columns["amount"]["type"] == "numeric(10,2)"
    assert columns["amount"]["semanticType"] == "currency"
    assert columns["customer_email"]["semanticType"] == "email"
    assert columns["status"]["semanticType"] == "categorical"
    assert columns["is_gift"]["semanticType"] == "boolean"
    assert columns["order_id"]["semanticType"] == "identifier"
    assert columns["order_id"]["nullable"] is False
    assert columns["customer_email"]["nullable"] is True


def test_preview_and_extract_are_json_safe(schema):
    response = client.post(
        "/preview", json={"connection": _connection(schema), "table": "orders", "limit": 3}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["columns"][:2] == ["order_id", "created_at"]
    assert len(body["rows"]) == 3
    first = body["rows"][0]
    assert first["amount"] == 11.25  # Decimal -> float
    assert first["created_at"].startswith("2026-10-01T01:00:00")  # datetime -> ISO

    response = client.post(
        "/extract",
        json={"connection": _connection(schema), "table": "orders", "columns": ["amount"]},
    )
    assert response.status_code == 200
    assert response.json()["columns"] == ["amount"]
    assert len(response.json()["rows"]) == 120


def test_quoted_identifier_table_is_readable(schema):
    response = client.post(
        "/preview", json={"connection": _connection(schema), "table": "Weird Name"}
    )
    assert response.status_code == 200
    assert response.json()["columns"] == ["id"]


def test_profile_reports_null_rate_and_distincts(schema):
    response = client.post("/profile", json={"connection": _connection(schema), "table": "orders"})
    assert response.status_code == 200
    body = response.json()
    assert body["rowCount"] == 120
    status = next(c for c in body["columns"] if c["name"] == "status")
    assert status["distinctCount"] == 2
    assert status["nullRate"] == 0.0


def test_unknown_table_and_injection_attempts_are_rejected(schema):
    for table in ("nope", 'orders"; DROP TABLE orders; --'):
        response = client.post("/preview", json={"connection": _connection(schema), "table": table})
        assert response.status_code == 422
        assert "Unknown table" in response.json()["detail"]
    response = client.post(
        "/extract",
        json={"connection": _connection(schema), "table": "orders", "columns": ["amount", "x"]},
    )
    assert response.status_code == 422
    assert "Unknown column" in response.json()["detail"]


def test_missing_schema_is_reported(schema):
    response = client.post("/connect", json={"connection": _connection("no_such_schema_xyz")})
    assert response.json() == {
        "ok": False,
        "error": "Schema 'no_such_schema_xyz' does not exist in database 'helix_test'.",
    }


def test_unknown_role_is_an_authentication_failure(schema):
    connection = _connection(schema, credentials={"user": "no_such_role_xyz", "password": "pw"})
    body = client.post("/connect", json={"connection": connection}).json()
    assert body["ok"] is False
    assert body["error"].startswith("Authentication failed")


def test_bad_password_is_reported_without_leaking_it(schema):
    secret = "definitely-wrong-password-123"
    connection = _connection(schema, credentials={"password": secret})
    body = client.post("/connect", json={"connection": connection}).json()
    if body["ok"]:
        pytest.skip("local Postgres uses trust auth for this role, so passwords are not checked")
    assert body["error"].startswith("Authentication failed")
    assert secret not in body["error"]


def test_unreachable_port_returns_readable_error():
    connection = {
        "type": "POSTGRESQL",
        "config": {"host": "127.0.0.1", "port": 1, "database": "helix_test"},
        "credentials": {"user": "helix", "password": "s3cret-value"},
    }
    response = client.post("/connect", json={"connection": connection})
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is False
    assert "Could not reach PostgreSQL at 127.0.0.1:1" in body["error"]
    assert "s3cret-value" not in response.text

    response = client.post("/preview", json={"connection": connection, "table": "orders"})
    assert response.status_code == 422
    assert "Could not reach PostgreSQL" in response.json()["detail"]


def test_missing_config_fields_are_reported():
    connection = {"type": "POSTGRESQL", "config": {"host": "localhost"}, "credentials": {}}
    body = client.post("/connect", json={"connection": connection}).json()
    assert body == {"ok": False, "error": "PostgreSQL connection needs both `host` and `database`."}


def test_driver_error_translation_never_leaks_the_password():
    """Covers the password-auth path even where the local server uses trust auth."""
    from app.adapters.postgres import PostgresAdapter
    from app.models import ConnectionSpec

    spec = ConnectionSpec.model_validate(_connection("public", credentials={"password": "pw-42"}))
    adapter = PostgresAdapter(spec)
    auth = adapter._translate(
        Exception('FATAL:  password authentication failed for user "helix"')
    )
    assert auth.message == "Authentication failed: check the username and password."
    other = adapter._translate(Exception("weird failure mentioning pw-42 somewhere"))
    assert "pw-42" not in other.message
    assert other.message == "PostgreSQL error: weird failure mentioning *** somewhere"
