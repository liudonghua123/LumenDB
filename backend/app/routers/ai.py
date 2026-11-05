"""AI 问数 endpoints."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from ..db.engine import DriverError
from ..models import AiAskRequest, AiAskResponse, ExplainSqlRequest, FixSqlRequest, GenerateSqlRequest
from ..services.ai import get_ai_service
from ..store import get_store

router = APIRouter(prefix="/api/ai", tags=["ai"])


@router.post("/ask", response_model=AiAskResponse)
async def ask(req: AiAskRequest) -> AiAskResponse:
    try:
        return await get_ai_service().ask(req)
    except DriverError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/generate-sql")
async def generate_sql(req: GenerateSqlRequest) -> dict:
    try:
        return await get_ai_service().generate_sql(req.connection_id, req.question)
    except DriverError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/explain-sql")
async def explain_sql(req: ExplainSqlRequest) -> dict:
    try:
        return await get_ai_service().explain_sql(req.connection_id, req.sql)
    except DriverError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/fix-sql")
async def fix_sql(req: FixSqlRequest) -> dict:
    try:
        return await get_ai_service().fix_sql(req.connection_id, req.sql, req.error)
    except DriverError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get("/suggestions")
async def suggestions(connection_id: str = Query(...)) -> dict:
    try:
        return {"questions": await get_ai_service().suggestions(connection_id)}
    except DriverError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get("/sessions")
def list_sessions() -> list[dict]:
    return get_store().list_sessions()


@router.get("/sessions/{sid}")
def get_session(sid: str) -> dict:
    session = get_store().get_session(sid)
    if not session:
        raise HTTPException(404, "Session not found")
    return session


@router.delete("/sessions/{sid}")
def delete_session(sid: str) -> dict:
    if not get_store().delete_session(sid):
        raise HTTPException(404, "Session not found")
    return {"deleted": True}


@router.delete("/sessions")
def delete_all_sessions() -> dict:
    get_store().delete_all_sessions()
    return {"cleared": True}
