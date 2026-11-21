"""PostgresAdapter: SQLAlchemy + psycopg2 against one schema of one database.

- Discovery reads information_schema for the configured schema (default
  "public"), tables and views only.
- Row counts come from pg_class.reltuples (the planner estimate). Small or
  never-analyzed tables and views get an exact count(*) instead, under a
  statement timeout so a huge unanalyzed table cannot stall /connect.
- Table and column names are validated against discovery and quoted with the
  dialect's identifier preparer before they appear in SQL; values are bound.
- Errors are translated into readable messages; the password never appears in
  logs or responses.
"""

from __future__ import annotations

import logging
from typing import Any

import pandas as pd
from sqlalchemy import URL, create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import DBAPIError, SQLAlchemyError
from sqlalchemy.pool import NullPool

from ..config import settings
from ..errors import AdapterError
from ..profiling import infer_semantic_type, profile_frame, to_json_rows
from .base import DataSourceAdapter

logger = logging.getLogger(__name__)

DISCOVER_SQL = text(
    """
    SELECT c.table_name, c.column_name, c.data_type, c.udt_name, c.is_nullable,
           c.numeric_precision, c.numeric_scale
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = :schema AND t.table_type IN ('BASE TABLE', 'VIEW')
    ORDER BY c.table_name, c.ordinal_position
    """
)
RELTUPLES_SQL = text(
    """
    SELECT c.relname, c.reltuples::bigint AS reltuples, c.relkind
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = :schema AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
    """
)
SCHEMA_EXISTS_SQL = text("SELECT 1 FROM information_schema.schemata WHERE schema_name = :schema")


def _type_name(row: Any) -> str:
    data_type = row.data_type
    if data_type == "USER-DEFINED":
        return row.udt_name
    if data_type == "ARRAY":
        return f"{row.udt_name.lstrip('_')}[]"
    if data_type == "numeric" and row.numeric_precision is not None:
        return f"numeric({row.numeric_precision},{row.numeric_scale or 0})"
    return data_type


class PostgresAdapter(DataSourceAdapter):
    type = "POSTGRESQL"

    def __init__(self, spec) -> None:
        super().__init__(spec)
        config = spec.config or {}
        credentials = spec.credentials or {}
        self.host = str(config.get("host") or "").strip()
        self.database = str(config.get("database") or "").strip()
        self.schema = str(config.get("schema") or "public").strip() or "public"
        self.sslmode = config.get("sslmode")
        self.user = credentials.get("user") or credentials.get("username")
        self._password = credentials.get("password")
        try:
            self.port = int(config.get("port") or 5432)
        except (TypeError, ValueError):
            raise AdapterError("Port must be a number.") from None
        if not self.host or not self.database:
            raise AdapterError("PostgreSQL connection needs both `host` and `database`.")
        if not self.user:
            raise AdapterError("PostgreSQL connection needs a `user` in credentials.")
        self._engine: Engine | None = None

    # -- connection ------------------------------------------------------------

    def _make_engine(self) -> Engine:
        query = {"sslmode": str(self.sslmode)} if self.sslmode else {}
        url = URL.create(
            "postgresql+psycopg2",
            username=str(self.user),
            password=None if self._password is None else str(self._password),
            host=self.host,
            port=self.port,
            database=self.database,
            query=query,
        )
        return create_engine(
            url,
            poolclass=NullPool,
            isolation_level="AUTOCOMMIT",
            connect_args={
                "connect_timeout": settings.connect_timeout_seconds,
                "application_name": "helix-ingestion",
            },
        )

    def _translate(self, exc: Exception) -> AdapterError:
        """Map driver errors to readable messages that never include secrets."""
        raw = str(getattr(exc, "orig", None) or exc)
        if self._password:
            raw = raw.replace(str(self._password), "***")
        lower = raw.lower()
        where = f"{self.host}:{self.port}"
        if "password authentication failed" in lower or (
            "role" in lower and "does not exist" in lower
        ):
            return AdapterError("Authentication failed: check the username and password.")
        if "no password supplied" in lower:
            return AdapterError("Authentication failed: the server requires a password.")
        if "database" in lower and "does not exist" in lower:
            return AdapterError(f"Database '{self.database}' does not exist on {where}.")
        if "timeout expired" in lower or "timed out" in lower:
            return AdapterError(f"Timed out connecting to PostgreSQL at {where}.")
        if "canceling statement due to statement timeout" in lower:
            return AdapterError("The query took too long and was cancelled.")
        if (
            "could not connect" in lower
            or "connection refused" in lower
            or "could not translate host name" in lower
            or "name or service not known" in lower
            or "nodename nor servname" in lower
            or "server closed the connection" in lower
        ):
            return AdapterError(f"Could not reach PostgreSQL at {where}. Is the server running?")
        if "permission denied" in lower:
            return AdapterError("Permission denied: the user cannot read this schema or table.")
        if "ssl" in lower:
            return AdapterError("SSL negotiation with PostgreSQL failed; check `sslmode`.")
        first_line = raw.strip().splitlines()[0] if raw.strip() else type(exc).__name__
        return AdapterError(f"PostgreSQL error: {first_line}")

    def _conn(self):
        if self._engine is None:
            raise AdapterError("Not connected.")
        return self._engine.connect()

    def _run(self, fn):
        """Run `fn(connection)` with a per-statement timeout, translating errors."""
        try:
            with self._conn() as conn:
                conn.execute(text(f"SET statement_timeout = {int(settings.statement_timeout_ms)}"))
                return fn(conn)
        except AdapterError:
            raise
        except (DBAPIError, SQLAlchemyError) as exc:
            error = self._translate(exc)
            logger.info("postgres operation failed: %s", error.message)
            raise error from None

    def _connect_sync(self) -> None:
        self._engine = self._make_engine()

        def check(conn):
            if conn.execute(SCHEMA_EXISTS_SQL, {"schema": self.schema}).first() is None:
                raise AdapterError(
                    f"Schema '{self.schema}' does not exist in database '{self.database}'."
                )

        try:
            self._run(check)
        except AdapterError:
            # __aexit__ does not run when connect fails, so release the engine here.
            self._disconnect_sync()
            raise

    def _disconnect_sync(self) -> None:
        if self._engine is not None:
            self._engine.dispose()
            self._engine = None

    # -- helpers ---------------------------------------------------------------

    def _q(self, identifier: str) -> str:
        assert self._engine is not None
        return self._engine.dialect.identifier_preparer.quote(identifier)

    def _qualified(self, table: str) -> str:
        return f"{self._q(self.schema)}.{self._q(table)}"

    def _row_count(self, conn, table: str, reltuples: int | None, relkind: str | None) -> int:
        """Planner estimate for big analyzed tables, exact count(*) otherwise."""
        estimate = int(reltuples) if reltuples is not None else -1
        if relkind in ("r", "p", "m") and estimate >= settings.exact_count_max_rows:
            return estimate
        try:
            sql = text(f"SELECT count(*) FROM {self._qualified(table)}")
            return int(conn.execute(sql).scalar())
        except DBAPIError:
            # Typically the statement timeout on a huge unanalyzed table/view.
            return max(estimate, 0)

    def _sample(self, conn, table: str, limit: int) -> pd.DataFrame:
        sql = text(f"SELECT * FROM {self._qualified(table)} LIMIT :n")
        result = conn.execute(sql, {"n": limit})
        return pd.DataFrame.from_records(result.fetchall(), columns=list(result.keys()))

    # -- discovery / reads ---------------------------------------------------

    def _discover_sync(self, sample: bool = True) -> list[dict[str, Any]]:
        def work(conn):
            rows = conn.execute(DISCOVER_SQL, {"schema": self.schema}).fetchall()
            tables: dict[str, list[Any]] = {}
            for row in rows:
                tables.setdefault(row.table_name, []).append(row)
            if not sample:
                return [
                    {
                        "tableName": name,
                        "columns": [{"name": c.column_name} for c in cols],
                        "rowCountEstimate": 0,
                    }
                    for name, cols in tables.items()
                ]
            stats = {
                r.relname: (r.reltuples, r.relkind)
                for r in conn.execute(RELTUPLES_SQL, {"schema": self.schema})
            }
            do_sample = len(tables) <= settings.connect_sample_max_tables
            sample_rows = settings.connect_sample_rows
            out = []
            for name, cols in tables.items():
                frame = self._sample(conn, name, sample_rows) if do_sample else None
                reltuples, relkind = stats.get(name, (None, None))
                columns = []
                for c in cols:
                    type_name = _type_name(c)
                    values = (
                        frame[c.column_name]
                        if frame is not None and c.column_name in frame
                        else None
                    )
                    columns.append(
                        {
                            "name": c.column_name,
                            "type": type_name,
                            "nullable": c.is_nullable == "YES",
                            "semanticType": infer_semantic_type(c.column_name, type_name, values),
                        }
                    )
                out.append(
                    {
                        "tableName": name,
                        "columns": columns,
                        "rowCountEstimate": self._row_count(conn, name, reltuples, relkind),
                    }
                )
            return out

        result = self._run(work)
        if not sample:
            self._tables = {t["tableName"]: t for t in result}
        return result

    def _types(self, conn, table: str) -> dict[str, str]:
        rows = conn.execute(DISCOVER_SQL, {"schema": self.schema}).fetchall()
        return {r.column_name: _type_name(r) for r in rows if r.table_name == table}

    def _preview_sync(self, table: str, limit: int) -> tuple[list[str], list[dict]]:
        self.require_table(table)
        frame = self._run(lambda conn: self._sample(conn, table, limit))
        return to_json_rows(frame)

    def _profile_sync(self, table: str, sample_size: int) -> dict[str, Any]:
        self.require_table(table)

        def work(conn):
            stats = {
                r.relname: (r.reltuples, r.relkind)
                for r in conn.execute(RELTUPLES_SQL, {"schema": self.schema})
            }
            reltuples, relkind = stats.get(table, (None, None))
            row_count = self._row_count(conn, table, reltuples, relkind)
            return row_count, self._sample(conn, table, sample_size), self._types(conn, table)

        row_count, frame, types = self._run(work)
        return {"table": table, "rowCount": row_count, "columns": profile_frame(frame, types)}

    def _extract_sync(
        self, table: str, columns: list[str] | None, limit: int
    ) -> tuple[list[str], list[dict]]:
        self.require_table(table)
        self.check_columns(table, columns)
        select = ", ".join(self._q(c) for c in columns) if columns else "*"
        sql = text(f"SELECT {select} FROM {self._qualified(table)} LIMIT :n")

        def work(conn):
            # Extraction can legitimately take a while; lift the discovery timeout.
            conn.execute(text("SET statement_timeout = 0"))
            result = conn.execute(sql, {"n": limit})
            return pd.DataFrame.from_records(result.fetchall(), columns=list(result.keys()))

        return to_json_rows(self._run(work))
