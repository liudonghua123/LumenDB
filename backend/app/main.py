"""LumenDB application entrypoint: FastAPI + fastmcp on a single port.

- REST API      /api/*
- OpenAPI docs  /docs
- MCP (HTTP)    /mcp
- Web UI        / (serves frontend/dist when built)
"""
from __future__ import annotations

from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.types import ASGIApp, Receive, Scope, Send

from . import __version__
from .config import WORKSPACE_DIR, get_settings
from .mcp_server import mcp
from .seed import build_demo_db
from .store import DEMO_SEMANTICS, get_store, uid


def bootstrap_storage() -> None:
    """Zero-config first boot: demo database, demo connection, sample dashboard."""
    settings = get_settings()
    settings.data_path.mkdir(parents=True, exist_ok=True)
    build_demo_db(str(settings.demo_db_path))
    store = get_store()
    if not store.list_connections():
        store.create_connection(
            {
                "name": "Demo 电商库",
                "dialect": "sqlite",
                "database": str(settings.demo_db_path),
                "readonly": False,
                "color": "#6366f1",
                "options": {"semantics": DEMO_SEMANTICS, "description": "内置演示数据：客户 / 商品 / 订单 / 明细"},
            }
        )
    if not store.list_dashboards():
        demo = store.list_connections()[0]
        cid = demo["id"]
        cards = [
            {
                "id": uid("card_"), "title": "总销售额", "connection_id": cid, "width": 3,
                "sql": "SELECT ROUND(SUM(total_amount), 2) AS total_revenue FROM orders",
                "chart": {"type": "metric", "title": "总销售额", "x": "", "y": ["total_revenue"], "series": [], "reason": "", "options": {}},
            },
            {
                "id": uid("card_"), "title": "月度销售趋势", "connection_id": cid, "width": 6,
                "sql": "SELECT substr(order_date, 1, 7) AS month, ROUND(SUM(total_amount), 2) AS revenue FROM orders WHERE status = '已完成' GROUP BY month ORDER BY month",
                "chart": {"type": "line", "title": "月度销售趋势", "x": "month", "y": ["revenue"], "series": [], "reason": "", "options": {}},
            },
            {
                "id": uid("card_"), "title": "各城市客户数", "connection_id": cid, "width": 6,
                "sql": "SELECT city, COUNT(*) AS customers FROM customers GROUP BY city ORDER BY customers DESC",
                "chart": {"type": "bar", "title": "各城市客户数", "x": "city", "y": ["customers"], "series": [], "reason": "", "options": {}},
            },
            {
                "id": uid("card_"), "title": "渠道销售额占比", "connection_id": cid, "width": 6,
                "sql": "SELECT channel, ROUND(SUM(total_amount), 2) AS revenue FROM orders GROUP BY channel ORDER BY revenue DESC",
                "chart": {"type": "pie", "title": "渠道销售额占比", "x": "channel", "y": ["revenue"], "series": [], "reason": "", "options": {}},
            },
            {
                "id": uid("card_"), "title": "销量 Top 8 商品", "connection_id": cid, "width": 6,
                "sql": "SELECT p.name AS product, SUM(oi.quantity) AS units FROM order_items oi JOIN products p ON p.id = oi.product_id GROUP BY p.name ORDER BY units DESC LIMIT 8",
                "chart": {"type": "bar", "title": "销量 Top 8 商品", "x": "product", "y": ["units"], "series": [], "reason": "", "options": {}},
            },
        ]
        store.save_dashboard(
            {
                "name": "电商经营概览",
                "description": "自动生成的示例看板，展示 LumenDB 的数据可视化能力",
                "cards": cards,
            }
        )


settings = get_settings()
# fastmcp's HTTP app is mounted at /mcp; its internal route is "/" so the final path is exactly /mcp.
mcp_app = mcp.http_app(path="/")


@asynccontextmanager
async def lifespan(app: FastAPI):
    bootstrap_storage()
    async with mcp_app.lifespan(app):
        yield


api = FastAPI(
    title="LumenDB API",
    description="AI-native database workspace: SQL IDE, natural-language querying, visualization and MCP server.",
    version=__version__,
    lifespan=lifespan,
    docs_url="/docs" if settings.docs_enabled else None,
    redoc_url=None,
)

api.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition", "X-Row-Count"],
)


@api.middleware("http")
async def api_token_guard(request: Request, call_next):
    """Optional shared-secret auth protecting both /api and /mcp."""
    token = settings.api_token
    path = request.url.path
    protected = path.startswith("/api") or path.rstrip("/") == settings.mcp_path.rstrip("/")
    if token and protected and path != "/api/health" and request.method != "OPTIONS":
        supplied = (
            request.headers.get("x-api-token")
            or request.headers.get("authorization", "").removeprefix("Bearer ").strip()
        )
        if supplied != token:
            return JSONResponse({"detail": "Invalid or missing API token"}, status_code=401)
    return await call_next(request)


from .routers import ai, connections, dashboards, meta, query  # noqa: E402

for module in (meta, connections, query, ai, dashboards):
    api.include_router(module.router)


@api.get("/api/version", include_in_schema=False)
def version() -> dict:
    return {"name": "LumenDB", "version": __version__}


api.mount(settings.mcp_path, mcp_app)

# Serve the built SPA on the same origin (single-port deployment).
DIST = WORKSPACE_DIR / "frontend" / "dist"
if (DIST / "index.html").exists():
    assets = DIST / "assets"
    if assets.exists():
        api.mount("/assets", StaticFiles(directory=assets), name="assets")

    @api.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str):
        candidate = DIST / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(DIST / "index.html")


class NormalizeMcpPath:
    """Make /mcp resolve inside the mounted fastmcp app without a 307 slash redirect.

    Starlette Mount strips its prefix, leaving an empty path for the child app whose
    route is "/" -> it answers 307 to /mcp/. Most MCP clients do not follow POST
    redirects, so we normalise the internal path before routing while keeping the
    public endpoint exactly /mcp.
    """

    def __init__(self, wrapped: ASGIApp, mcp_path: str) -> None:
        self.wrapped = wrapped
        self.mcp_path = mcp_path.rstrip("/")

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and scope.get("path") == self.mcp_path:
            scope = dict(scope)
            scope["path"] = self.mcp_path + "/"
            scope["raw_path"] = (self.mcp_path + "/").encode()
        await self.wrapped(scope, receive, send)


# ASGI entrypoint (uvicorn app.main:app). `api` remains the plain FastAPI instance.
app = NormalizeMcpPath(api, settings.mcp_path)


def run() -> None:
    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        reload=False,
        log_level="info",
    )


if __name__ == "__main__":
    run()
