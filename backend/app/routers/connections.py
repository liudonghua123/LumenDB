"""Connection CRUD, testing and schema exploration."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query

from ..config import get_settings
from ..db.engine import DatabaseDriver, DriverError, EnginePool, get_driver
from ..models import ConnectionCreate, ConnectionUpdate
from ..store import get_store, uid

router = APIRouter(prefix="/api", tags=["connections"])


def _spec_from_payload(payload: dict[str, Any], cid: str = "") -> dict[str, Any]:
    spec = {
        "id": cid or uid("tmp_"),
        "name": payload.get("name", "ad-hoc"),
        "dialect": payload.get("dialect", "sqlite"),
        "host": payload.get("host", ""),
        "port": payload.get("port"),
        "database": payload.get("database", ""),
        "username": payload.get("username", ""),
        "password": payload.get("password", ""),
        "readonly": bool(payload.get("readonly", True)),
        "color": payload.get("color", "#6366f1"),
        "options": payload.get("options") or {},
    }
    if spec["dialect"] == "sqlite" and not spec["database"]:
        spec["database"] = str(get_settings().demo_db_path)
    return spec


@router.get("/connections")
def list_connections() -> list[dict]:
    return get_store().list_connections()


@router.post("/connections", status_code=201)
def create_connection(payload: ConnectionCreate) -> dict:
    data = payload.model_dump()
    if payload.password == "":
        data["password"] = ""
    try:
        return get_store().create_connection(data)
    except Exception as exc:
        if "UNIQUE" in str(exc):
            raise HTTPException(409, "A connection with this name already exists") from exc
        raise HTTPException(400, str(exc)) from exc


@router.get("/connections/{cid}")
def get_connection(cid: str) -> dict:
    conn = get_store().get_connection(cid)
    if not conn:
        raise HTTPException(404, "Connection not found")
    return conn


@router.put("/connections/{cid}")
def update_connection(cid: str, patch: ConnectionUpdate) -> dict:
    current = get_store().get_connection(cid)
    if not current:
        raise HTTPException(404, "Connection not found")
    data = patch.model_dump(exclude_none=True)
    if data.get("password") == "":
        data.pop("password")  # blank password in the edit form means "keep existing"
    updated = get_store().update_connection(cid, data)
    EnginePool.dispose(cid)
    return updated  # type: ignore[return-value]


@router.delete("/connections/{cid}")
def delete_connection(cid: str) -> dict:
    ok = get_store().delete_connection(cid)
    if not ok:
        raise HTTPException(404, "Connection not found")
    EnginePool.dispose(cid)
    return {"deleted": True, "id": cid}


@router.post("/connections/test")
def test_unsaved(payload: ConnectionCreate) -> dict:
    driver = DatabaseDriver(_spec_from_payload(payload.model_dump()))
    return driver.test()


@router.post("/connections/{cid}/test")
def test_saved(cid: str) -> dict:
    try:
        return get_driver(cid).test()
    except DriverError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.get("/connections/{cid}/databases")
def list_databases(cid: str) -> list[dict]:
    try:
        return get_driver(cid).list_databases()
    except Exception as exc:
        raise HTTPException(400, str(exc)[:400]) from exc


@router.get("/connections/{cid}/schemas")
def list_schemas(cid: str) -> list[str]:
    try:
        return get_driver(cid).list_schemas()
    except Exception as exc:
        raise HTTPException(400, str(exc)[:400]) from exc


@router.get("/connections/{cid}/tables")
def list_tables(cid: str, schema: str | None = None, database: str | None = None) -> list[dict]:
    try:
        return get_driver(cid).list_tables(schema=schema, database=database)
    except Exception as exc:
        raise HTTPException(400, str(exc)[:400]) from exc


@router.get("/connections/{cid}/tables/{table}/describe")
def describe_table(
    cid: str, table: str, schema: str | None = None, database: str | None = None
) -> dict:
    try:
        return get_driver(cid).describe_table(table, schema=schema, database=database)
    except Exception as exc:
        raise HTTPException(400, str(exc)[:400]) from exc


@router.get("/connections/{cid}/tables/{table}/preview")
def preview_table(
    cid: str, table: str, limit: int = Query(100, ge=1, le=1000), schema: str | None = None
) -> dict:
    try:
        result = get_driver(cid).preview(table, limit, schema=schema)
        from ..services.viz import recommend

        result["charts"] = recommend(result["columns"], result["rows"], result["column_types"])
        return result
    except Exception as exc:
        raise HTTPException(400, str(exc)[:400]) from exc


@router.get("/connections/{cid}/erd")
def erd(cid: str) -> dict:
    try:
        return get_driver(cid).erd()
    except Exception as exc:
        raise HTTPException(400, str(exc)[:400]) from exc


@router.get("/connections/{cid}/schema-context")
def schema_context(cid: str) -> dict:
    """Show exactly what is injected into the LLM prompt (transparency / debugging)."""
    try:
        return {"context": get_driver(cid).schema_context()}
    except Exception as exc:
        raise HTTPException(400, str(exc)[:400]) from exc
