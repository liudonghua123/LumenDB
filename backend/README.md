# LumenDB Backend

FastAPI + fastmcp backend for [LumenDB](../README.md). One process serves the REST API, the MCP Streamable HTTP endpoint and (optionally) the built SPA.

## Quick start

```bash
uv sync                 # creates .venv from uv.lock
cp .env.example .env    # optional — every variable has a default
uv run uvicorn app.main:app --reload --port 8000
```

- REST API: `/api/*`, OpenAPI docs at `/docs`
- MCP Streamable HTTP: `/mcp` (same port, no extra process)
- Web UI: `/` once `../frontend/dist/` has been built
- First boot creates `data/demo.sqlite` (5 tables + 1 view, ~1.5k rows), a demo connection and a sample dashboard. **Zero configuration required.**

## Layers

| Module | Responsibility |
| --- | --- |
| `app/config.py` | Env-driven settings (`LUMEN_*`), derived paths, LLM flags |
| `app/store.py` | SQLite metadata store: connections, saved queries, history, AI sessions, dashboards; Fernet-encrypted passwords |
| `app/db/engine.py` | SQLAlchemy driver layer: SQLite / PostgreSQL / MySQL, schema introspection, ER graph, EXPLAIN, SQL classification, read-only enforcement |
| `app/services/nl2sql.py` | Offline rule-based NL2SQL: intent parsing, schema scoring, FK-graph JOIN paths, time / Top-N / grouping templates |
| `app/services/llm.py` | OpenAI-compatible `/chat/completions` adapter (OpenAI / DeepSeek / Ollama / vLLM) |
| `app/services/viz.py` | Result-shape based chart recommendation (bar / line / pie / metric / table) |
| `app/services/ai.py` | Ask-data orchestration, multi-turn sessions, SQL explain/fix, answer generation |
| `app/routers/` | REST routes: meta, connections, query, ai, dashboards |
| `app/mcp_server.py` | 10 MCP tools + 2 resources, JSON / TOON / CSV output, strict read-only |
| `app/main.py` | App assembly, lifespan bootstrap, token guard, SPA hosting, MCP path normalization |

## REST API

| Group | Endpoints |
| --- | --- |
| Meta | `GET /api/health`, `/api/bootstrap`, `/api/mcp/info`, `/api/version` |
| Connections | `GET/POST /api/connections`, `GET/PUT/DELETE /api/connections/{id}`, `POST /api/connections/test`, `POST /api/connections/{id}/test`, `GET .../{id}/databases\|schemas\|tables\|erd\|schema-context`, `GET .../tables/{table}/describe\|preview` |
| Query | `POST /api/query/execute\|explain\|export`, `GET/DELETE /api/query/history`, `GET/POST /api/saved-queries`, `DELETE /api/saved-queries/{id}`, `POST /api/viz/recommend` |
| AI | `POST /api/ai/ask\|generate-sql\|explain-sql\|fix-sql`, `GET /api/ai/suggestions`, `GET/DELETE /api/ai/sessions[/{id}]` |
| Dashboards | `GET/POST /api/dashboards`, `PUT/DELETE /api/dashboards/{id}` |

## Safety

- `POST /api/query/execute` classifies SQL. Writes/DDL require **both** `LUMEN_ALLOW_WRITE=true` and `confirm_write=true` in the request; the front-end shows an explicit confirmation dialog.
- MCP tools are **always read-only**, regardless of that flag.
- Row caps (`LUMEN_MAX_ROWS`, `LUMEN_MCP_MAX_ROWS`), statement timeouts, and an optional shared secret (`LUMEN_API_TOKEN`) applied to both `/api` and `/mcp`.

## Configuration

See [.env.example](./.env.example). All variables are optional. Without an LLM configured, LumenDB uses the built-in offline NL2SQL engine — no API key needed.

## Tests

```bash
uv sync --extra dev
uv run pytest -q        # 7 smoke tests: REST, AI, safety, MCP initialize/tools
```

Chinese docs: [README.zh-CN.md](./README.zh-CN.md) · Architecture: [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) · MCP guide: [../docs/MCP.md](../docs/MCP.md)
