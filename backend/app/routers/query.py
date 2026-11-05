"""SQL execution, EXPLAIN, history, saved queries and exports."""
from __future__ import annotations

import csv
import io
import json
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel

from ..db.engine import DriverError, PermissionDenied, get_driver
from ..models import ExplainRequest, QueryRequest
from ..services.viz import recommend
from ..store import get_store

router = APIRouter(prefix="/api", tags=["query"])


class ExportRequest(BaseModel):
    connection_id: str
    sql: str
    format: Literal["csv", "json", "sql"] = "csv"
    filename: str = "lumendb-export"
    table_name: str = "exported_result"
    limit: int = 5000


@router.post("/query/execute")
def execute(req: QueryRequest) -> dict:
    try:
        driver = get_driver(req.connection_id)
        result = driver.execute(
            req.sql,
            req.limit,
            confirm_write=req.confirm_write,
            multi_statement=req.multi_statement,
        )
        result["charts"] = recommend(result["columns"], result["rows"], result["column_types"])
        get_store().add_history(
            {
                "connection_id": req.connection_id,
                "connection_name": driver.spec.get("name", ""),
                "sql": req.sql,
                "statement_type": result["statement_type"],
                "row_count": result["row_count"],
                "duration_ms": result["duration_ms"],
                "status": "ok",
            }
        )
        return result
    except PermissionDenied as exc:
        raise HTTPException(403, str(exc)) from exc
    except DriverError as exc:
        get_store().add_history(
            {"connection_id": req.connection_id, "sql": req.sql, "status": "error", "error": str(exc)[:500]}
        )
        raise HTTPException(400, str(exc)) from exc


@router.post("/query/explain")
def explain(req: ExplainRequest) -> dict:
    try:
        return get_driver(req.connection_id).explain(req.sql, req.analyze)
    except (DriverError, PermissionDenied) as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/query/export")
def export(req: ExportRequest) -> Response:
    try:
        result = get_driver(req.connection_id).execute(req.sql, req.limit, enforce_readonly=True)
    except (DriverError, PermissionDenied) as exc:
        raise HTTPException(400, str(exc)) from exc

    cols, rows = result["columns"], result["rows"]
    if req.format == "csv":
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(cols)
        for row in rows:
            writer.writerow(["" if v is None else v for v in row])
        body, media, suffix = buf.getvalue(), "text/csv; charset=utf-8", "csv"
    elif req.format == "json":
        body = json.dumps([dict(zip(cols, r, strict=False)) for r in rows], ensure_ascii=False, indent=2, default=str)
        media, suffix = "application/json; charset=utf-8", "json"
    else:
        def lit(v: Any) -> str:
            if v is None:
                return "NULL"
            if isinstance(v, bool):
                return "1" if v else "0"
            if isinstance(v, (int, float)):
                return str(v)
            return "'" + str(v).replace("'", "''") + "'"

        col_list = ", ".join(cols)
        statements = [f"INSERT INTO {req.table_name} ({col_list}) VALUES ({', '.join(lit(v) for v in row)});" for row in rows]
        body, media, suffix = "\n".join(statements), "application/sql; charset=utf-8", "sql"

    filename = f"{req.filename}.{suffix}"
    return Response(
        content=body,
        media_type=media,
        headers={"Content-Disposition": f'attachment; filename="{filename}"', "X-Row-Count": str(len(rows))},
    )


@router.get("/query/history")
def history(limit: int = Query(100, ge=1, le=500)) -> list[dict]:
    return get_store().list_history(limit)


@router.delete("/query/history")
def clear_history() -> dict:
    get_store().clear_history()
    return {"cleared": True}


@router.get("/saved-queries")
def list_saved() -> list[dict]:
    return get_store().list_saved()


@router.post("/saved-queries", status_code=201)
def create_saved(payload: dict) -> dict:
    name = str(payload.get("name", "")).strip() or "Untitled query"
    sql = str(payload.get("sql", "")).strip()
    if not sql:
        raise HTTPException(400, "SQL is required")
    return get_store().create_saved(name, sql, payload.get("connection_id", ""))


@router.delete("/saved-queries/{sid}")
def delete_saved(sid: str) -> dict:
    if not get_store().delete_saved(sid):
        raise HTTPException(404, "Saved query not found")
    return {"deleted": True}


@router.post("/viz/recommend")
def viz_recommend(payload: dict) -> dict:
    specs = recommend(
        payload.get("columns", []),
        payload.get("rows", []),
        payload.get("column_types", []),
        payload.get("title", ""),
    )
    return {"specs": specs, "recommended": specs[0] if specs else None}
