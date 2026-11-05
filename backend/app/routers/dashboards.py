"""Saved visualization dashboards."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..models import DashboardCreate
from ..store import get_store

router = APIRouter(prefix="/api/dashboards", tags=["dashboards"])


@router.get("")
def list_dashboards() -> list[dict]:
    return get_store().list_dashboards()


@router.post("", status_code=201)
def create_dashboard(payload: DashboardCreate) -> dict:
    return get_store().save_dashboard(payload.model_dump())


@router.put("/{did}")
def update_dashboard(did: str, payload: DashboardCreate) -> dict:
    if not get_store().get_dashboard(did):
        raise HTTPException(404, "Dashboard not found")
    return get_store().save_dashboard(payload.model_dump(), did)


@router.delete("/{did}")
def delete_dashboard(did: str) -> dict:
    if not get_store().delete_dashboard(did):
        raise HTTPException(404, "Dashboard not found")
    return {"deleted": True}
