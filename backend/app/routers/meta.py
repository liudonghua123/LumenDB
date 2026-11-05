"""Health, bootstrap, settings and MCP integration information."""
from __future__ import annotations

import time

from fastapi import APIRouter

from .. import __version__
from ..config import get_settings
from ..mcp_server import mcp
from ..store import get_store

router = APIRouter(prefix="/api", tags=["meta"])
_STARTED = time.time()


@router.get("/health")
def health() -> dict:
    settings = get_settings()
    return {
        "status": "ok",
        "version": __version__,
        "uptime_seconds": round(time.time() - _STARTED, 1),
        "llm": {"enabled": settings.llm_enabled, "provider": settings.llm_provider_label, "model": settings.effective_llm_model},
        "mcp_path": settings.mcp_path,
        "allow_write": settings.allow_write,
        "max_rows": settings.max_rows,
    }


@router.get("/bootstrap")
def bootstrap() -> dict:
    settings = get_settings()
    return {
        "version": __version__,
        "connections": get_store().list_connections(),
        "settings": {
            "llm_enabled": settings.llm_enabled,
            "llm_provider": settings.llm_provider_label,
            "llm_model": settings.effective_llm_model,
            "allow_write": settings.allow_write,
            "max_rows": settings.max_rows,
            "mcp_path": settings.mcp_path,
            "mcp_max_rows": settings.mcp_max_rows,
            "auth_required": bool(settings.api_token),
        },
        "capabilities": [
            "connections", "schema-explorer", "sql-editor", "explain", "erd",
            "query-history", "saved-queries", "export", "ai-ask", "ai-explain",
            "visualization", "dashboards", "mcp-server",
        ],
    }


@router.get("/mcp/info")
async def mcp_info() -> dict:
    settings = get_settings()
    base = settings.public_base_url.rstrip("/") or "http://localhost:8000"
    endpoint = f"{base}{settings.mcp_path}"
    token = settings.api_token
    header = {"Authorization": f"Bearer {token}"} if token else {}
    try:
        tool_names = sorted(t.name for t in await mcp.list_tools())
        resource_uris = sorted(
            [str(r.uri) for r in await mcp.list_resources()]
            + [str(t.uri_template) for t in await mcp.list_resource_templates()]
        )
    except Exception:  # defensive fallback if the MCP registry is unavailable
        tool_names = [
            "list_connections", "list_databases", "list_tables", "describe_table",
            "run_query", "ask_data", "recommend_chart", "explain_query",
            "get_schema_context", "list_dashboards",
        ]
        resource_uris = ["lumendb://connections", "lumendb://{connection_id}/schema"]
    return {
        "endpoint": endpoint,
        "transport": "streamable-http",
        "protocol": "MCP 2025-06-18",
        "read_only_by_default": True,
        "max_rows": settings.mcp_max_rows,
        "tools": tool_names,
        "resources": resource_uris,
        "client_configs": {
            "claude_desktop": {"mcpServers": {"lumendb": {"type": "http", "url": endpoint, **({"headers": header} if header else {})}}},
            "cursor": {"mcpServers": {"lumendb": {"type": "http", "url": endpoint, **({"headers": header} if header else {})}}},
            "generic": {"type": "http", "url": endpoint, **({"headers": header} if header else {})},
        },
        "curl_probe": (
            f'curl -X POST {endpoint} -H "Content-Type: application/json" '
            f'-H "Accept: application/json, text/event-stream" '
            + (f'-H "Authorization: Bearer {token}" ' if token else "")
            + '-d \'{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}\''
        ),
    }
