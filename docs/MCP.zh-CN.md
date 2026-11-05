# LumenDB MCP 接入指南

LumenDB 通过 **Streamable HTTP** 把数据库能力以 [Model Context Protocol](https://modelcontextprotocol.io/) 服务的形式对外开放，与 REST API、Web UI 共用同一个端口（`http://localhost:8000/mcp`）。无需独立进程、无需 stdio 桥接、无需额外端口。

端点严格为 `/mcp`（不带尾斜杠）：服务端有一层轻量 ASGI 包装做内部路径归一化，客户端 `POST` 时不会收到 `307` 重定向。

## 握手流程

Streamable HTTP 需要先建立会话：

1. `initialize` → 响应头中返回 `Mcp-Session-Id`。
2. 携带该请求头发送 `notifications/initialized`。
3. 之后的 `tools/list`、`tools/call`、`resources/read` 都带上同一个请求头。

```bash
BASE=http://localhost:8000/mcp
HDR_ACCEPT='Accept: application/json, text/event-stream'
HDR_TYPE='Content-Type: application/json'

# 1. initialize（从响应头里取出会话 id）
curl -s -D /tmp/mcp_headers -o /tmp/mcp_init -X POST "$BASE" \
  -H "$HDR_ACCEPT" -H "$HDR_TYPE" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'
SID=$(awk 'tolower($1)=="mcp-session-id:" {print $2}' /tmp/mcp_headers | tr -d '\r')

# 2. initialized 通知
curl -s -X POST "$BASE" -H "$HDR_ACCEPT" -H "$HDR_TYPE" -H "Mcp-Session-Id: $SID" \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized"}' > /dev/null

# 3. 列出工具
curl -s -X POST "$BASE" -H "$HDR_ACCEPT" -H "$HDR_TYPE" -H "Mcp-Session-Id: $SID" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

# 4. 调用工具
curl -s -X POST "$BASE" -H "$HDR_ACCEPT" -H "$HDR_TYPE" -H "Mcp-Session-Id: $SID" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"run_query","arguments":{"connection_id":"Demo 电商库","query":"SELECT channel, COUNT(*) AS n FROM orders GROUP BY channel","output_format":"toon"}}}'
```

当客户端在 `Accept` 中声明 `text/event-stream` 时，响应以 SSE 帧（`data: {...}` 行）返回。

## 工具清单

| 工具 | 参数 | 返回 |
| --- | --- | --- |
| `list_connections` | `output_format?` | 已保存的连接（绝不包含密码） |
| `list_databases` | `connection_id`、`output_format?` | 服务器上的数据库列表 |
| `list_tables` | `connection_id`、`schema?`、`database?`、`output_format?` | 表与视图，含行数与业务标签 |
| `describe_table` | `connection_id`、`table_name`、`schema?`、`database?`、`output_format?` | 列、类型、主外键、索引、DDL、样例行 |
| `run_query` | `connection_id`、`query`、`limit?`（默认 100）、`output_format?` | 单条只读 SELECT/WITH 的结果集 |
| `ask_data` | `connection_id`、`question`、`limit?`、`output_format?` | 生成的 SQL、执行结果、自然语言解读、图表建议、推荐追问 |
| `recommend_chart` | `connection_id`、`query`、`output_format?` | 针对查询的排序后图表规格 |
| `explain_query` | `connection_id`、`query`、`output_format?` | 数据库执行计划（EXPLAIN） |
| `get_schema_context` | `connection_id` | 注入 AI 提示词的紧凑 Schema 摘要 |
| `list_dashboards` | `output_format?` | 已保存的看板及其图表卡片 |

Web UI 展示的工具与 resource 清单来自运行中的 MCP 注册表（`/api/mcp/info`），始终与 `tools/list` 返回一致。

`connection_id` 既可传稳定 id（`c_...`），也可传**精确**的连接名（例如 `Demo 电商库`）。所有工具都会捕获异常并返回可解析的 `{"error": ...}` JSON，保证 Agent 始终拿到结构化结果。

## Resources

| URI | 内容 |
| --- | --- |
| `lumendb://connections` | 完整连接清单（不含凭据） |
| `lumendb://{connection_id}/schema` | 某个连接的 Schema 摘要 |

```bash
curl -s -X POST "$BASE" -H "$HDR_ACCEPT" -H "$HDR_TYPE" -H "Mcp-Session-Id: $SID" \
  -d '{"jsonrpc":"2.0","id":4,"method":"resources/read","params":{"uri":"lumendb://connections"}}'
```

## 输出格式

所有列表/查询类工具都支持 `output_format`：

| 格式 | 适用场景 |
| --- | --- |
| `json`（默认） | 结构化解析、完整保真 |
| `toon` | 面向 LLM 上下文窗口的省 token 表格格式 |
| `csv` | 表格软件 / 下游工具 |

`run_query` 的 `toon` 输出示例：

```
rows[4]{channel,n}:
  App,108
  Web,102
  小程序,108
  线下,113
```

## 安全策略

- MCP **始终只读**。`run_query` 会显式拒绝写操作、DDL 与多语句，即使 REST 侧开启了 `LUMEN_ALLOW_WRITE=true`。
- 行数受 `LUMEN_MCP_MAX_ROWS` 限制（默认 100）。
- 设置 `LUMEN_API_TOKEN` 可同时保护 `/mcp` 与 `/api/*`：发送 `X-API-Token: <token>` 或 `Authorization: Bearer <token>`。
- 保存的连接密码加密存储，工具与 resources 均不返回。

## 客户端配置

原生支持 Streamable HTTP 的客户端：

```json
{
  "mcpServers": {
    "lumendb": {
      "url": "http://localhost:8000/mcp",
      "headers": { "X-API-Token": "<你的 LUMEN_API_TOKEN>" }
    }
  }
}
```

仅支持 stdio 的客户端（如 Claude Desktop）可用 `mcp-remote` 桥接：

```json
{
  "mcpServers": {
    "lumendb": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote@latest",
        "http://localhost:8000/mcp",
        "--header", "X-API-Token:<你的 LUMEN_API_TOKEN>"
      ]
    }
  }
}
```

Web UI 的 **MCP 服务** 页面会展示实时端点、工具列表、探测命令与可一键复制的客户端配置（设置了 `LUMEN_PUBLIC_BASE_URL` 时会优先使用）。

## 公网访问

用自定义域名隧道暴露这一个端口即可：

```bash
cloudflared tunnel --url http://localhost:8000
```

或在已命名隧道（`my-tunnel`）的 `config.yml` 中增加 ingress 规则：

```yaml
ingress:
  - hostname: db.example.com
    service: http://localhost:8000
  - service: http_status:404
```

随后设置 `LUMEN_PUBLIC_BASE_URL=https://db.example.com`、保持 `LUMEN_API_TOKEN` 开启，并把 MCP 客户端指向 `https://db.example.com/mcp`。

## 故障排查

| 现象 | 原因 / 处理 |
| --- | --- |
| `POST /mcp` 返回 `307` | 代理把路径改写成 `/mcp/`；请请求精确的 `/mcp`（服务端内部已做归一化） |
| `401` | 缺少或错误的 `X-API-Token` / `Authorization: Bearer` 请求头 |
| `tools/call` 返回 `400` | 缺少 `Mcp-Session-Id`，需重新 `initialize` |
| `tools/list` 为空 | 会话未完成初始化，先发 `notifications/initialized` |
| `{"error": "Write/DDL statements are blocked..."}` | 符合预期：MCP 设计上只读 |

相关文档：[ARCHITECTURE.zh-CN.md](ARCHITECTURE.zh-CN.md) · [English](MCP.md) · [根目录 README](../README.zh-CN.md)
