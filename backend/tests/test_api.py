"""Smoke tests for the LumenDB REST + MCP surface.

Run with:  uv sync --extra dev && uv run pytest -q
No external services or LLM API keys are required (the offline NL2SQL engine is used).
"""
from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from app.main import app

CONN = "Demo 电商库"


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_connections_and_schema(client):
    r = client.get("/api/connections")
    assert r.status_code == 200
    assert r.json(), "first boot should seed a demo connection"
    cid = r.json()[0]["id"]
    assert client.get(f"/api/connections/{cid}/tables").status_code == 200
    erd = client.get(f"/api/connections/{cid}/erd")
    assert erd.status_code == 200 and erd.json()["links"]
    ctx = client.get(f"/api/connections/{cid}/schema-context")
    assert ctx.status_code == 200 and ctx.json()["context"]


def test_execute_and_chart_recommendation(client):
    r = client.post(
        "/api/query/execute",
        json={
            "connection_id": CONN,
            "sql": "SELECT city, COUNT(*) AS n FROM customers GROUP BY city ORDER BY n DESC LIMIT 5",
            "limit": 50,
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["row_count"] == 5
    assert body["charts"], "chart specs should be recommended from the result shape"


def test_write_requires_confirmation(client):
    r = client.post(
        "/api/query/execute",
        json={"connection_id": CONN, "sql": "DELETE FROM customers WHERE id = 99999"},
    )
    assert r.status_code == 403


def test_ai_ask_offline(client):
    r = client.post("/api/ai/ask", json={"connection_id": CONN, "question": "按月统计销售额趋势"})
    assert r.status_code == 200
    body = r.json()
    assert body["sql"].upper().startswith("SELECT")
    assert body["result"]["row_count"] > 0
    assert body["answer"]


def test_dashboards_seeded(client):
    r = client.get("/api/dashboards")
    assert r.status_code == 200 and r.json()


def test_mcp_initialize_and_tools(client):
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
    }
    init = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2025-06-18",
            "capabilities": {},
            "clientInfo": {"name": "pytest", "version": "1"},
        },
    }
    r = client.post("/mcp", json=init, headers=headers)
    assert r.status_code == 200
    sid = r.headers.get("mcp-session-id")
    assert sid, "initialize must return an Mcp-Session-Id header"
    headers["Mcp-Session-Id"] = sid
    client.post("/mcp", json={"jsonrpc": "2.0", "method": "notifications/initialized"}, headers=headers)
    r = client.post("/mcp", json={"jsonrpc": "2.0", "id": 2, "method": "tools/list"}, headers=headers)
    assert r.status_code == 200
    payload = next(
        (json.loads(line[5:].strip()) for line in r.text.splitlines() if line.startswith("data:")),
        {},
    )
    names = {tool["name"] for tool in payload.get("result", {}).get("tools", [])}
    assert {"list_connections", "list_tables", "run_query", "ask_data"} <= names
