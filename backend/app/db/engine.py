"""Unified multi-database driver layer built on SQLAlchemy.

Responsibilities: connection pooling, schema introspection, safe SQL execution,
EXPLAIN, ERD extraction and compact schema-context generation for LLM prompts.
"""
from __future__ import annotations

import base64
import json
import math
import re
import threading
import time
from contextlib import suppress
from datetime import date, datetime
from datetime import time as dtime
from decimal import Decimal
from typing import Any, ClassVar
from uuid import UUID

import sqlparse
from sqlalchemy import create_engine, event, inspect
from sqlalchemy.engine import URL, Engine

from ..config import get_settings
from ..store import DEMO_SEMANTICS

WRITE_FIRST = {
    "INSERT", "UPDATE", "DELETE", "REPLACE", "MERGE", "UPSERT", "DROP", "CREATE",
    "ALTER", "TRUNCATE", "GRANT", "REVOKE", "VACUUM", "ATTACH", "DETACH",
    "REINDEX", "SET", "USE", "CALL", "EXEC", "EXECUTE", "LOAD", "COPY", "IMPORT",
}
READ_FIRST = {"SELECT", "SHOW", "EXPLAIN", "DESCRIBE", "DESC", "PRAGMA", "VALUES", "TABLE", "WITH"}
DDL_FIRST = {"DROP", "CREATE", "ALTER", "TRUNCATE"}


class DriverError(Exception):
    """User-facing database error."""


class PermissionDenied(DriverError):
    pass


def jsonable(value: Any) -> Any:
    """Convert DB-returned values into JSON-safe primitives."""
    if value is None or isinstance(value, (str, int, bool)):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else str(value)
    if isinstance(value, Decimal):
        f = float(value)
        return f if math.isfinite(f) else str(value)
    if isinstance(value, (datetime, date, dtime)):
        return value.isoformat()
    if isinstance(value, (bytes, bytearray, memoryview)):
        raw = bytes(value)
        try:
            return raw.decode("utf-8")
        except UnicodeDecodeError:
            return "base64:" + base64.b64encode(raw).decode()
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, dict):
        return {str(k): jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [jsonable(v) for v in value]
    return str(value)


def strip_sql_comments(sql: str) -> str:
    return sqlparse.format(sql, strip_comments=True, strip_whitespace=True).strip()


def split_sql(sql: str) -> list[str]:
    parts = []
    for part in sqlparse.split(sql):
        cleaned = strip_sql_comments(part).strip().rstrip(";").strip()
        if cleaned:
            parts.append(cleaned)
    return parts


def classify_sql(statement: str) -> str:
    """Fail-closed statement classifier: read / write / ddl."""
    cleaned = strip_sql_comments(statement)
    if not cleaned:
        return "read"
    m = re.match(r"^\s*([A-Za-z]+)", cleaned)
    first = m.group(1).upper() if m else ""
    if first == "WITH":
        tail = re.search(r"\)\s*(SELECT|INSERT|UPDATE|DELETE|MERGE)\b", cleaned, re.IGNORECASE)
        first = tail.group(1).upper() if tail else "SELECT"
        if first != "SELECT":
            return "ddl" if first in DDL_FIRST else "write"
    if first in WRITE_FIRST:
        return "ddl" if first in DDL_FIRST else "write"
    if first not in READ_FIRST:
        return "write"  # unknown statements are treated as writes
    # Reads that actually write (SELECT ... INTO, locking clauses, side effects)
    if re.search(r"\bINTO\s+\w+", cleaned, re.IGNORECASE) and not re.search(r"\bFROM\b.*\bINTO\b", cleaned, re.IGNORECASE):
        return "write"
    if re.search(r"\bFOR\s+UPDATE\b|\bLOCK\s+IN\s+SHARE\s+MODE\b", cleaned, re.IGNORECASE):
        return "write"
    return "read"


def build_url(spec: dict[str, Any]) -> URL:
    dialect = spec["dialect"]
    if dialect == "sqlite":
        path = spec.get("database") or str(get_settings().demo_db_path)
        return URL.create("sqlite+pysqlite", database=str(path))
    if dialect == "postgresql":
        return URL.create(
            "postgresql+psycopg",
            username=spec.get("username") or None,
            password=spec.get("password") or None,
            host=spec.get("host") or "localhost",
            port=int(spec.get("port") or 5432),
            database=spec.get("database") or "postgres",
        )
    if dialect == "mysql":
        return URL.create(
            "mysql+pymysql",
            username=spec.get("username") or None,
            password=spec.get("password") or None,
            host=spec.get("host") or "localhost",
            port=int(spec.get("port") or 3306),
            database=spec.get("database") or None,
        )
    raise DriverError(f"Unsupported dialect: {dialect}")


class EnginePool:
    _lock = threading.Lock()
    _engines: ClassVar[dict[str, tuple[str, Engine]]] = {}

    @classmethod
    def get(cls, spec: dict[str, Any]) -> Engine:
        key = spec.get("id") or spec.get("name") or "adhoc"
        fingerprint = json.dumps(
            {k: spec.get(k) for k in ("dialect", "host", "port", "database", "username", "password", "readonly")},
            sort_keys=True,
            default=str,
        )
        with cls._lock:
            cached = cls._engines.get(key)
            if cached and cached[0] == fingerprint:
                return cached[1]
            if cached:
                with suppress(Exception):  # best-effort dispose before replacing the engine
                    cached[1].dispose()
            engine = cls._create(spec)
            cls._engines[key] = (fingerprint, engine)
            return engine

    @staticmethod
    def _create(spec: dict[str, Any]) -> Engine:
        dialect = spec["dialect"]
        kwargs: dict[str, Any] = {"pool_pre_ping": True, "pool_recycle": 3600, "future": True}
        if dialect == "sqlite":
            kwargs["connect_args"] = {"check_same_thread": False, "timeout": 15}
        elif dialect == "postgresql" or dialect == "mysql":
            kwargs["connect_args"] = {"connect_timeout": 10}
            kwargs["pool_size"] = 5
            kwargs["max_overflow"] = 5
        engine = create_engine(build_url(spec), **kwargs)

        if dialect == "sqlite":
            readonly = bool(spec.get("readonly", False))

            @event.listens_for(engine, "connect")
            def _sqlite_setup(dbapi_conn, _record):
                cur = dbapi_conn.cursor()
                cur.execute("PRAGMA foreign_keys=ON")
                cur.execute("PRAGMA busy_timeout=15000")
                if readonly:
                    cur.execute("PRAGMA query_only=ON")
                cur.close()

        return engine

    @classmethod
    def dispose(cls, key: str) -> None:
        with cls._lock:
            cached = cls._engines.pop(key, None)
        if cached:
            with suppress(Exception):  # best-effort dispose
                cached[1].dispose()


class DatabaseDriver:
    def __init__(self, spec: dict[str, Any]):
        self.spec = spec
        self.dialect: str = spec["dialect"]
        self.engine = EnginePool.get(spec)

    # ------------------------------------------------------------------ basics
    def test(self) -> dict[str, Any]:
        t0 = time.perf_counter()
        try:
            with self.engine.connect() as conn:
                if self.dialect == "postgresql":
                    version = conn.exec_driver_sql("SHOW server_version").scalar()
                elif self.dialect == "mysql":
                    version = conn.exec_driver_sql("SELECT VERSION()").scalar()
                else:
                    version = conn.exec_driver_sql("SELECT sqlite_version()").scalar()
            return {
                "ok": True,
                "dialect": self.dialect,
                "server_version": str(version),
                "latency_ms": round((time.perf_counter() - t0) * 1000, 2),
                "message": "Connection successful",
            }
        except Exception as exc:
            return {
                "ok": False,
                "dialect": self.dialect,
                "latency_ms": round((time.perf_counter() - t0) * 1000, 2),
                "message": str(exc)[:500],
            }

    def list_databases(self) -> list[dict[str, Any]]:
        if self.dialect == "postgresql":
            q = "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY 1"
        elif self.dialect == "mysql":
            q = "SHOW DATABASES"
        else:
            with self.engine.connect() as conn:
                rows = conn.exec_driver_sql("PRAGMA database_list").fetchall()
            return [{"name": r[1], "file": r[2] or "", "current": r[1] == "main"} for r in rows]
        with self.engine.connect() as conn:
            rows = conn.exec_driver_sql(q).fetchall()
        current = self.spec.get("database", "")
        return [{"name": r[0], "current": r[0] == current} for r in rows]

    def list_schemas(self) -> list[str]:
        if self.dialect == "postgresql":
            with self.engine.connect() as conn:
                return [r[0] for r in conn.exec_driver_sql(
                    "SELECT schema_name FROM information_schema.schemata "
                    "WHERE schema_name NOT LIKE 'pg_%' AND schema_name <> 'information_schema' ORDER BY 1"
                ).fetchall()]
        if self.dialect == "mysql":
            return [d["name"] for d in self.list_databases()]
        return ["main"]

    # --------------------------------------------------------------- schema api
    def _schema_arg(self, schema: str | None) -> str | None:
        if self.dialect == "sqlite":
            return None
        if self.dialect == "postgresql":
            return schema or "public"
        return schema  # mysql: database name or None

    def list_tables(self, schema: str | None = None, database: str | None = None) -> list[dict[str, Any]]:
        target = database or schema
        sch = self._schema_arg(target)
        insp = inspect(self.engine)
        try:
            tables = insp.get_table_names(schema=sch)
            views = insp.get_view_names(schema=sch)
        except Exception:
            sch = None
            tables = insp.get_table_names()
            views = insp.get_view_names()
        semantics = self._semantics()
        labels = semantics.get("tables", {})
        out = [{"name": t, "type": "table", "schema": sch, "label": labels.get(t, ""), "row_count": None} for t in tables]
        out += [{"name": v, "type": "view", "schema": sch, "label": labels.get(v, ""), "row_count": None} for v in views]
        if self.dialect == "sqlite" and len(out) <= 30:
            for item in out:
                try:
                    with self.engine.connect() as conn:
                        item["row_count"] = conn.exec_driver_sql(
                            f'SELECT COUNT(*) FROM "{item["name"]}"'
                        ).scalar()
                except Exception:
                    pass
        return sorted(out, key=lambda x: x["name"])

    def describe_table(self, table: str, schema: str | None = None, database: str | None = None) -> dict[str, Any]:
        sch = self._schema_arg(database or schema)
        insp = inspect(self.engine)
        try:
            columns = insp.get_columns(table, schema=sch)
        except Exception:
            sch = None
            columns = insp.get_columns(table)
        semantics = self._semantics()
        col_labels = semantics.get("columns", {})
        out_columns = []
        for col in columns:
            ctype = str(col.get("type") or "")
            out_columns.append(
                {
                    "name": col["name"],
                    "type": ctype,
                    "nullable": bool(col.get("nullable", True)),
                    "default": jsonable(col.get("default")),
                    "primary_key": False,
                    "autoincrement": bool(col.get("autoincrement", False)),
                    "label": col_labels.get(f"{table}.{col['name']}", ""),
                }
            )
        try:
            pk = insp.get_pk_constraint(table, schema=sch) or {}
        except Exception:
            pk = {}
        pk_cols = pk.get("constrained_columns") or []
        for c in out_columns:
            if c["name"] in pk_cols:
                c["primary_key"] = True
        try:
            fks = [
                {
                    "columns": fk.get("constrained_columns", []),
                    "referred_table": fk.get("referred_table"),
                    "referred_columns": fk.get("referred_columns", []),
                    "name": fk.get("name"),
                }
                for fk in insp.get_foreign_keys(table, schema=sch)
            ]
        except Exception:
            fks = []
        try:
            indexes = [
                {"name": ix.get("name"), "columns": ix.get("column_names", []), "unique": bool(ix.get("unique"))}
                for ix in insp.get_indexes(table, schema=sch)
            ]
        except Exception:
            indexes = []
        ddl = self._pseudo_ddl(table, out_columns, pk_cols, fks)
        try:
            quoted = self._quote(table)
            sample = self.execute_raw(f"SELECT * FROM {quoted} LIMIT 3", limit=3)
        except Exception:
            sample = None
        return {
            "name": table,
            "schema": sch,
            "label": semantics.get("tables", {}).get(table, ""),
            "columns": out_columns,
            "primary_key": pk_cols,
            "foreign_keys": fks,
            "indexes": indexes,
            "ddl": ddl,
            "sample": sample,
        }

    def _quote(self, identifier: str) -> str:
        if self.dialect == "mysql":
            return f"`{identifier}`"
        return f'"{identifier}"'

    def _pseudo_ddl(self, table: str, columns: list[dict], pk: list[str], fks: list[dict]) -> str:
        lines = [f"CREATE TABLE {table} ("]
        defs = []
        for c in columns:
            piece = f"  {c['name']} {c['type']}"
            if c["primary_key"]:
                piece += " PRIMARY KEY"
            if not c["nullable"] and not c["primary_key"]:
                piece += " NOT NULL"
            if c["label"]:
                piece += f"  -- {c['label']}"
            defs.append(piece)
        for fk in fks:
            defs.append(
                f"  FOREIGN KEY ({', '.join(fk['columns'])}) "
                f"REFERENCES {fk['referred_table']} ({', '.join(fk['referred_columns'])})"
            )
        lines.append(",\n".join(defs))
        lines.append(");")
        return "\n".join(lines)

    def _semantics(self) -> dict[str, Any]:
        custom = (self.spec.get("options") or {}).get("semantics")
        if custom:
            return custom
        if "demo" in str(self.spec.get("database", "")).lower() or "demo" in self.spec.get("name", "").lower():
            return DEMO_SEMANTICS
        return {}

    def erd(self) -> dict[str, Any]:
        tables = self.list_tables()
        nodes, links = [], []
        for t in tables:
            if t["type"] != "table":
                continue
            desc = self.describe_table(t["name"])
            nodes.append(
                {
                    "id": t["name"],
                    "label": t["label"],
                    "columns": [{"name": c["name"], "type": c["type"], "pk": c["primary_key"]} for c in desc["columns"]],
                }
            )
            for fk in desc["foreign_keys"]:
                if fk["referred_table"]:
                    links.append(
                        {
                            "source": t["name"],
                            "target": fk["referred_table"],
                            "source_column": (fk["columns"] or [""])[0],
                            "target_column": (fk["referred_columns"] or [""])[0],
                        }
                    )
        return {"nodes": nodes, "links": links}

    def schema_context(self, max_tables: int | None = None) -> str:
        """Compact, LLM-friendly schema digest (table/column labels + FK graph + samples)."""
        settings = get_settings()
        max_tables = max_tables or settings.llm_max_schema_tables
        tables = [t for t in self.list_tables() if t["type"] == "table"][:max_tables]
        semantics = self._semantics()
        table_labels = semantics.get("tables", {})
        lines = [
            f"Database dialect: {self.dialect}",
            f"Database: {self.spec.get('database') or self.spec.get('name')}",
            "Use ONLY the tables and columns listed below. Quote identifiers when needed.",
        ]
        for t in tables:
            try:
                desc = self.describe_table(t["name"])
            except Exception:
                continue
            head = f"\nTABLE {t['name']}"
            if table_labels.get(t["name"]):
                head += f"  -- {table_labels[t['name']]}"
            lines.append(head + " (")
            for c in desc["columns"][:30]:
                flags = []
                if c["primary_key"]:
                    flags.append("PK")
                if c["label"]:
                    flags.append(c["label"])
                suffix = f"  -- {','.join(flags)}" if flags else ""
                lines.append(f"  {c['name']} {c['type']}{suffix}")
            lines.append(")")
            for fk in desc["foreign_keys"][:6]:
                if fk["referred_table"]:
                    lines.append(
                        f"  FK {','.join(fk['columns'] or [])} -> {fk['referred_table']}.{','.join(fk['referred_columns'] or [])}"
                    )
            sample = desc.get("sample")
            if sample and sample.get("rows"):
                sample_row = dict(zip(sample["columns"], sample["rows"][0], strict=False))
                lines.append("  SAMPLE " + json.dumps(sample_row, ensure_ascii=False, default=jsonable)[:400])
        return "\n".join(lines)

    # -------------------------------------------------------------- execution
    def execute_raw(self, sql: str, limit: int = 200, *, _internal: bool = False) -> Any:
        """Execute one statement without safety checks (used internally)."""
        t0 = time.perf_counter()
        with self.engine.connect() as conn:
            cursor = conn.exec_driver_sql(sql)
            if cursor.returns_rows:
                names = list(cursor.keys())
                # de-duplicate column names
                seen: dict[str, int] = {}
                cols = []
                for n in names:
                    if n in seen:
                        seen[n] += 1
                        cols.append(f"{n}_{seen[n]}")
                    else:
                        seen[n] = 0
                        cols.append(n)
                raw = cursor.fetchmany(limit + 1)
                truncated = len(raw) > limit
                raw = raw[:limit]
                rows = [[jsonable(v) for v in row] for row in raw]
                col_types = [self._infer_type([r[i] for r in rows]) for i in range(len(cols))]
                return {
                    "columns": cols,
                    "rows": rows,
                    "row_count": len(rows),
                    "truncated": truncated,
                    "duration_ms": round((time.perf_counter() - t0) * 1000, 2),
                    "column_types": col_types,
                    "sql": sql,
                }
            affected = cursor.rowcount if cursor.rowcount is not None and cursor.rowcount >= 0 else 0
            conn.commit()
            return {
                "columns": ["affected_rows"],
                "rows": [[affected]],
                "row_count": 1,
                "truncated": False,
                "duration_ms": round((time.perf_counter() - t0) * 1000, 2),
                "column_types": ["number"],
                "sql": sql,
            }

    @staticmethod
    def _infer_type(values: list[Any]) -> str:
        non_null = [v for v in values if v is not None]
        if not non_null:
            return "text"
        if all(isinstance(v, bool) for v in non_null):
            return "boolean"
        if all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in non_null):
            return "number"
        sample = str(non_null[0])
        if re.match(r"^\d{4}-\d{2}-\d{2}", sample):
            return "date"
        return "text"

    def execute(
        self,
        sql: str,
        limit: int | None = None,
        *,
        confirm_write: bool = False,
        multi_statement: bool = False,
        enforce_readonly: bool = False,
        allow_write: bool | None = None,
    ) -> dict[str, Any]:
        """Safe SQL execution. Returns a JSON-ready QueryResult dict."""
        settings = get_settings()
        limit = max(1, min(limit or settings.max_rows, settings.max_rows))
        statements = split_sql(sql)
        if not statements:
            raise DriverError("Empty SQL statement")
        if len(statements) > 1 and not multi_statement:
            raise DriverError(
                "Multiple statements detected. Enable 'multi statement' explicitly (stacked statements are blocked by default)."
            )
        kinds = [classify_sql(s) for s in statements]
        is_write = any(k != "read" for k in kinds)
        write_allowed = (allow_write if allow_write is not None else settings.allow_write) and not enforce_readonly
        if is_write:
            if enforce_readonly or not write_allowed or self.spec.get("readonly"):
                raise PermissionDenied(
                    "Write/DDL statements are blocked for this connection. "
                    "Use a writable connection and enable LUMEN_ALLOW_WRITE (MCP stays read-only by default)."
                )
            if not confirm_write:
                raise PermissionDenied("Write statement requires explicit confirmation (confirm_write=true).")
        result: dict[str, Any] = {}
        for stmt in statements:
            try:
                result = self.execute_raw(stmt, limit)
            except PermissionDenied:
                raise
            except Exception as exc:
                raise DriverError(str(exc)[:800]) from exc
        result.update(
            {
                "statement_type": "write" if is_write else "read",
                "connection_id": self.spec.get("id", ""),
                "database": self.spec.get("database") or None,
                "truncated": result.get("truncated", False),
            }
        )
        return result

    def explain(self, sql: str, analyze: bool = False) -> dict[str, Any]:
        stmt = split_sql(sql)
        if not stmt:
            raise DriverError("Empty SQL statement")
        target = stmt[0]
        if self.dialect == "postgresql":
            prefix = "EXPLAIN (ANALYZE, FORMAT JSON)" if analyze else "EXPLAIN (FORMAT JSON)"
            out = self.execute_raw(f"{prefix} {target}", 10)
            plan = jsonable(out["rows"][0][0]) if out["rows"] else []
            return {"dialect": self.dialect, "plan": plan, "raw": json.dumps(plan, ensure_ascii=False, indent=2)[:20000]}
        if self.dialect == "mysql":
            out = self.execute_raw(f"EXPLAIN {target}", 50)
        else:
            out = self.execute_raw(f"EXPLAIN QUERY PLAN {target}", 50)
        rows = [dict(zip(out["columns"], r, strict=False)) for r in out["rows"]]
        return {
            "dialect": self.dialect,
            "columns": out["columns"],
            "rows": out["rows"],
            "plan": rows,
            "raw": "\n".join(" | ".join(str(v) for v in r) for r in out["rows"]),
            "column_types": out["column_types"],
        }

    def preview(self, table: str, limit: int = 100, schema: str | None = None, database: str | None = None) -> dict[str, Any]:
        sch = self._schema_arg(database or schema)
        qualified = f"{self._quote(sch)}.{self._quote(table)}" if sch and self.dialect != "sqlite" else self._quote(table)
        return self.execute(f"SELECT * FROM {qualified} LIMIT {int(limit)}", limit)


def get_driver(id_or_name: str) -> DatabaseDriver:
    from ..store import get_store

    spec = get_store().get_connection(id_or_name, secret=True)
    if not spec:
        raise DriverError(f"Connection not found: {id_or_name}")
    return DatabaseDriver(spec)


def quote_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"
