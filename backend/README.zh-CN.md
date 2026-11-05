# LumenDB 后端

[LumenDB](../README.zh-CN.md) 的 FastAPI + fastmcp 后端。单进程同时提供 REST API、MCP Streamable HTTP 端点，以及（可选）构建好的前端 SPA。

## 快速开始

```bash
uv sync                 # 依据 uv.lock 创建 .venv
cp .env.example .env    # 可选 —— 所有变量都有默认值
uv run uvicorn app.main:app --reload --port 8000
```

- REST API：`/api/*`，OpenAPI 文档位于 `/docs`
- MCP Streamable HTTP：`/mcp`（同端口，无需额外进程）
- Web UI：构建 `../frontend/dist/` 后访问 `/`
- 首次启动自动创建 `data/demo.sqlite`（5 张表 + 1 个视图，约 1.5k 行）、演示连接与示例看板，**开箱即用、零配置**。

## 分层

| 模块 | 职责 |
| --- | --- |
| `app/config.py` | 环境变量配置（`LUMEN_*`）、派生路径、LLM 开关 |
| `app/store.py` | SQLite 元数据存储：连接、收藏查询、历史、AI 会话、看板；密码用 Fernet 加密 |
| `app/db/engine.py` | SQLAlchemy 驱动层：SQLite / PostgreSQL / MySQL，Schema 探查、ER 关系图、EXPLAIN、SQL 分类与只读约束 |
| `app/services/nl2sql.py` | 离线规则版 NL2SQL：意图解析、Schema 打分、外键图谱 JOIN 路径、时间 / Top-N / 分组模板 |
| `app/services/llm.py` | OpenAI 兼容 `/chat/completions` 适配器（OpenAI / DeepSeek / Ollama / vLLM） |
| `app/services/viz.py` | 基于结果形状推荐图表（柱 / 线 / 饼 / 指标 / 表格） |
| `app/services/ai.py` | 问数编排、多轮会话、SQL 解释与修复、结果解读 |
| `app/routers/` | REST 路由：meta、connections、query、ai、dashboards |
| `app/mcp_server.py` | 10 个 MCP 工具 + 2 个 resources，支持 JSON / TOON / CSV 输出，强制只读 |
| `app/main.py` | 应用装配、启动引导、令牌鉴权、SPA 托管、MCP 路径归一化 |

## REST API

| 分组 | 端点 |
| --- | --- |
| 元信息 | `GET /api/health`、`/api/bootstrap`、`/api/mcp/info`、`/api/version` |
| 连接 | `GET/POST /api/connections`、`GET/PUT/DELETE /api/connections/{id}`、`POST /api/connections/test`、`POST /api/connections/{id}/test`、`GET .../{id}/databases\|schemas\|tables\|erd\|schema-context`、`GET .../tables/{table}/describe\|preview` |
| 查询 | `POST /api/query/execute\|explain\|export`、`GET/DELETE /api/query/history`、`GET/POST /api/saved-queries`、`DELETE /api/saved-queries/{id}`、`POST /api/viz/recommend` |
| AI | `POST /api/ai/ask\|generate-sql\|explain-sql\|fix-sql`、`GET /api/ai/suggestions`、`GET/DELETE /api/ai/sessions[/{id}]` |
| 看板 | `GET/POST /api/dashboards`、`PUT/DELETE /api/dashboards/{id}` |

## 安全策略

- `POST /api/query/execute` 会对 SQL 分类；写操作 / DDL 需**同时**满足 `LUMEN_ALLOW_WRITE=true` 与请求中的 `confirm_write=true`，前端会弹出二次确认框。
- MCP 工具**始终只读**，不受上述开关影响。
- 行数上限（`LUMEN_MAX_ROWS`、`LUMEN_MCP_MAX_ROWS`）、语句超时，以及可选的共享密钥 `LUMEN_API_TOKEN`（同时保护 `/api` 与 `/mcp`）。

## 配置

参见 [.env.example](./.env.example)。所有变量均可选；未配置 LLM 时使用内置离线 NL2SQL 引擎，**无需任何 API Key**。

## 测试

```bash
uv sync --extra dev
uv run pytest -q        # 7 个冒烟测试：REST、AI、安全、MCP initialize / tools
```

英文文档：[README.md](./README.md) · 架构：[../docs/ARCHITECTURE.zh-CN.md](../docs/ARCHITECTURE.zh-CN.md) · MCP 接入：[../docs/MCP.zh-CN.md](../docs/MCP.zh-CN.md)
