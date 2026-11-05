"""MCP server exposed over Streamable HTTP on the same port as the REST API.

Tool surface follows the Tabularis convention (list_connections / list_databases /
list_tables / describe_table / run_query) and extends it with AI 问数, chart
recommendation, EXPLAIN, schema context and dashboards.

Safety: read-only by default, hard row cap, no credentials ever returned.
"""
from __future__ import annotations

import csv
import io
import json
from typing import Any, Literal

from fastmcp import FastMCP

from .config import get_settings
from .db.engine import DriverError, get_driver
from .services.ai import get_ai_service
from .services.viz import recommend
from .store import get_store

OutputFormat = Literal["json", "toon", "csv"]

mcp = FastMCP(
    name="LumenDB",
    instructions=(
        "LumenDB is a database workspace. Discover connections first, inspect the schema, "
        "then run read-only SQL. Use ask_data for natural-language questions. "
        "Never expose credentials. Results are capped and read-only by default."
    ),
)


def _json(data: Any) -> str:
    return json.dumps(data, ensure_ascii=False, indent=2, default=str)


def _toon(columns: list[str], rows: list[list[Any]]) -> str:
    """Compact Token-Oriented Object Notation for tabular payloads."""
    def cell(v: Any) -> str:
        if v is None:
            return ""
        s = str(v)
        if any(ch in s for ch in (",", "\n", '"')):
            return '"' + s.replace('"', '""') + '"'
        return s

    lines = [f"rows[{len(rows)}]{{{','.join(columns)}}}:"] if columns else [f"rows[{len(rows)}]:"]
    for row in rows:
        lines.append("  " + ",".join(cell(v) for v in row))
    return "\n".join(lines)


def _csv(columns: list[str], rows: list[list[Any]]) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    if columns:
        w.writerow(columns)
    for r in rows:
        w.writerow(["" if v is None else v for v in r])
    return buf.getvalue()


def format_payload(data: Any, fmt: OutputFormat, *, columns: list[str] | None = None, rows: list[list[Any]] | None = None) -> str:
    if fmt == "json":
        return _json(data)
    cols = columns or []
    rws = rows or []
    if fmt == "toon":
        if isinstance(data, dict) and "rows" in data:
            return _toon(data.get("columns", cols), data["rows"])
        return _toon(cols, rws)
    if isinstance(data, dict) and "rows" in data:
        return _csv(data.get("columns", cols), data["rows"])
    if cols:
        return _csv(cols, rws)
    return _json(data)


def _safe(fn, *args: Any, **kwargs: Any) -> str:
    try:
        return fn(*args, **kwargs)
    except (DriverError, ValueError, KeyError) as exc:
        return _json({"error": str(exc)[:600]})
    except Exception as exc:  # pragma: no cover - defensive
        return _json({"error": f"Unexpected error: {type(exc).__name__}: {str(exc)[:400]}"})


@mcp.tool
def list_connections(output_format: OutputFormat = "json") -> str:
    """List all saved database connections (credentials are never included).
    Args:
        output_format: json (default), toon, or csv.
    """
    def run() -> str:
        conns = get_store().list_connections()
        safe = [
            {k: c.get(k) for k in ("id", "name", "dialect", "host", "port", "database", "username", "readonly", "color")}
            for c in conns
        ]
        if output_format == "json":
            return _json({"count": len(safe), "connections": safe})
        return format_payload(
            {"connections": safe}, output_format,
            columns=list(safe[0].keys()) if safe else [],
            rows=[list(c.values()) for c in safe],
        )
    return _safe(run)


@mcp.tool
def list_databases(connection_id: str, output_format: OutputFormat = "json") -> str:
    """List databases available on a connection. connection_id accepts an id or an exact name."""
    def run() -> str:
        dbs = get_driver(connection_id).list_databases()
        if output_format == "json":
            return _json({"connection_id": connection_id, "databases": dbs})
        return format_payload(
            {"databases": dbs}, output_format,
            columns=["name", "current"],
            rows=[[d.get("name"), d.get("current", False)] for d in dbs],
        )
    return _safe(run)


@mcp.tool
def list_tables(
    connection_id: str,
    schema: str | None = None,
    database: str | None = None,
    output_format: OutputFormat = "json",
) -> str:
    """List tables and views. Optional schema/database filter (PostgreSQL defaults to public)."""
    def run() -> str:
        tables = get_driver(connection_id).list_tables(schema=schema, database=database)
        if output_format == "json":
            return _json({"connection_id": connection_id, "tables": tables})
        return format_payload(
            {"tables": tables}, output_format,
            columns=["name", "type", "schema", "row_count"],
            rows=[[t["name"], t["type"], t.get("schema"), t.get("row_count")] for t in tables],
        )
    return _safe(run)


@mcp.tool
def describe_table(
    connection_id: str,
    table_name: str,
    schema: str | None = None,
    database: str | None = None,
    output_format: OutputFormat = "json",
) -> str:
    """Get full schema for one table: columns, types, primary key, foreign keys, indexes, DDL and sample rows."""
    def run() -> str:
        desc = get_driver(connection_id).describe_table(table_name, schema=schema, database=database)
        if output_format == "json":
            return _json(desc)
        return format_payload(
            {"columns": desc["columns"]}, output_format,
            columns=["name", "type", "nullable", "primary_key", "label"],
            rows=[[c["name"], c["type"], c["nullable"], c["primary_key"], c["label"]] for c in desc["columns"]],
        )
    return _safe(run)


@mcp.tool
def run_query(
    connection_id: str,
    query: str,
    limit: int = 100,
    output_format: OutputFormat = "json",
) -> str:
    """Execute a READ-ONLY SQL query and return the result set.
    Args:
        connection_id: Connection id or exact name.
        query: A single SELECT / WITH statement. Write and DDL statements are refused.
        limit: Max rows (capped by server configuration, default 100).
        output_format: json (default), toon (compact for LLM context), or csv.
    """
    def run() -> str:
        settings = get_settings()
        cap = settings.mcp_max_rows
        effective = max(1, min(int(limit or cap), cap))
        result = get_driver(connection_id).execute(
            query, effective, enforce_readonly=True, allow_write=False
        )
        get_store().add_history(
            {
                "connection_id": connection_id,
                "sql": query,
                "statement_type": "read",
                "row_count": result["row_count"],
                "duration_ms": result["duration_ms"],
                "status": "ok",
                "error": "via MCP",
            }
        )
        payload = {
            "connection_id": connection_id,
            "columns": result["columns"],
            "rows": result["rows"],
            "row_count": result["row_count"],
            "truncated": result["truncated"],
            "duration_ms": result["duration_ms"],
            "limit": effective,
        }
        return format_payload(payload, output_format, columns=result["columns"], rows=result["rows"])
    return _safe(run)


@mcp.tool
async def ask_data(
    connection_id: str,
    question: str,
    limit: int = 100,
    output_format: OutputFormat = "json",
) -> str:
    """AI 问数: ask a natural-language question, get SQL, executed results, an interpretation and a chart suggestion.
    Works offline with the built-in rule engine, or with any configured OpenAI-compatible LLM.
    """
    try:
        from .models import AiAskRequest

        cap = get_settings().mcp_max_rows
        response = await get_ai_service().ask(
            AiAskRequest(connection_id=connection_id, question=question, limit=max(1, min(limit, cap)))
        )
        result = response.result
        payload = {
            "session_id": response.session_id,
            "question": question,
            "sql": response.sql,
            "answer": response.answer,
            "engine": response.engine,
            "chart": response.chart.model_dump() if response.chart else None,
            "followups": response.followups,
            "result": (
                {"columns": result.columns, "rows": result.rows, "row_count": result.row_count, "truncated": result.truncated}
                if result else None
            ),
        }
        return format_payload(
            payload, output_format,
            columns=result.columns if result else [],
            rows=result.rows if result else [],
        )
    except Exception as exc:  # pragma: no cover
        return _json({"error": f"ask_data failed: {type(exc).__name__}: {str(exc)[:400]}"})


@mcp.tool
def recommend_chart(connection_id: str, query: str, output_format: OutputFormat = "json") -> str:
    """Run a read-only query and return ranked chart specifications (bar/line/pie/metric/table)."""
    def run() -> str:
        result = get_driver(connection_id).execute(query, get_settings().mcp_max_rows, enforce_readonly=True, allow_write=False)
        specs = recommend(result["columns"], result["rows"], result["column_types"], title="Query result")
        return _json({"recommended": specs[0] if specs else None, "candidates": specs}) if output_format == "json" else format_payload(
            {"charts": specs}, output_format,
            columns=["type", "x", "y", "reason"],
            rows=[[s["type"], s["x"], ",".join(s["y"]), s["reason"]] for s in specs],
        )
    return _safe(run)


@mcp.tool
def explain_query(connection_id: str, query: str, output_format: OutputFormat = "json") -> str:
    """Return the database query plan (EXPLAIN) for a read-only statement."""
    def run() -> str:
        plan = get_driver(connection_id).explain(query)
        if output_format == "json":
            return _json(plan)
        return plan.get("raw", "")
    return _safe(run)


@mcp.tool
def get_schema_context(connection_id: str) -> str:
    """Return the compact schema digest that is injected into AI prompts (tables, columns, labels, FK graph, samples)."""
    return _safe(lambda: get_driver(connection_id).schema_context())


@mcp.tool
def list_dashboards(output_format: OutputFormat = "json") -> str:
    """List saved visualization dashboards and their chart cards."""
    def run() -> str:
        boards = get_store().list_dashboards()
        if output_format == "json":
            return _json({"dashboards": boards})
        return format_payload(
            {"dashboards": boards}, output_format,
            columns=["id", "name", "cards"],
            rows=[[b["id"], b["name"], len(b.get("cards", []))] for b in boards],
        )
    return _safe(run)


@mcp.resource("lumendb://connections")
def connections_resource() -> str:
    """All saved connections (safe fields only)."""
    return _json(get_store().list_connections())


@mcp.resource("lumendb://{connection_id}/schema")
def schema_resource(connection_id: str) -> str:
    """Full schema digest for a connection."""
    try:
        return get_driver(connection_id).schema_context()
    except DriverError as exc:
        return f"Error: {exc}"
