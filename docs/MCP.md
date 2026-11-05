# LumenDB MCP Guide

LumenDB exposes its database capabilities as a [Model Context Protocol](https://modelcontextprotocol.io/) server over **Streamable HTTP**, on the same port as the REST API and the web UI (`http://localhost:8000/mcp`). No separate process, no stdio bridge, no second port.

The endpoint is exactly `/mcp` (no trailing slash): a small ASGI wrapper normalizes the internal path so clients never receive a `307` redirect on `POST`.

## Handshake

Streamable HTTP requires a session:

1. `initialize` → response contains `Mcp-Session-Id` in the headers.
2. Send `notifications/initialized` with that header.
3. Use `tools/list`, `tools/call`, `resources/read` with the same header.

```bash
BASE=http://localhost:8000/mcp
HDR_ACCEPT='Accept: application/json, text/event-stream'
HDR_TYPE='Content-Type: application/json'

# 1. initialize (capture the session id from the response headers)
curl -s -D /tmp/mcp_headers -o /tmp/mcp_init -X POST "$BASE" \
  -H "$HDR_ACCEPT" -H "$HDR_TYPE" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'
SID=$(awk 'tolower($1)=="mcp-session-id:" {print $2}' /tmp/mcp_headers | tr -d '\r')

# 2. initialized notification
curl -s -X POST "$BASE" -H "$HDR_ACCEPT" -H "$HDR_TYPE" -H "Mcp-Session-Id: $SID" \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized"}' > /dev/null

# 3. list tools
curl -s -X POST "$BASE" -H "$HDR_ACCEPT" -H "$HDR_TYPE" -H "Mcp-Session-Id: $SID" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

# 4. call a tool
curl -s -X POST "$BASE" -H "$HDR_ACCEPT" -H "$HDR_TYPE" -H "Mcp-Session-Id: $SID" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"run_query","arguments":{"connection_id":"Demo 电商库","query":"SELECT channel, COUNT(*) AS n FROM orders GROUP BY channel","output_format":"toon"}}}'
```

Responses are SSE-framed (`data: {...}` lines) when the client accepts `text/event-stream`.

## Tools

| Tool | Arguments | Returns |
| --- | --- | --- |
| `list_connections` | `output_format?` | Saved connections (never includes passwords) |
| `list_databases` | `connection_id`, `output_format?` | Databases on the server |
| `list_tables` | `connection_id`, `schema?`, `database?`, `output_format?` | Tables and views with row counts and business labels |
| `describe_table` | `connection_id`, `table_name`, `schema?`, `database?`, `output_format?` | Columns, types, PK/FK, indexes, DDL, sample rows |
| `run_query` | `connection_id`, `query`, `limit?` (default 100), `output_format?` | Result set of a single read-only SELECT/WITH statement |
| `ask_data` | `connection_id`, `question`, `limit?`, `output_format?` | Generated SQL, executed result, natural-language interpretation, chart suggestion, follow-ups |
| `recommend_chart` | `connection_id`, `query`, `output_format?` | Ranked chart specifications for a query |
| `explain_query` | `connection_id`, `query`, `output_format?` | Database query plan (EXPLAIN) |
| `get_schema_context` | `connection_id` | Compact schema digest injected into AI prompts |
| `list_dashboards` | `output_format?` | Saved dashboards and their chart cards |

The tool and resource lists shown in the web UI come from the live MCP registry (`/api/mcp/info`), so they always match `tools/list`.

`connection_id` accepts either the stable id (`c_...`) or the **exact** connection name (for example `Demo 电商库`). All tools swallow exceptions and return a JSON `{"error": ...}` payload instead of raising, so an agent always receives a parseable answer.

## Resources

| URI | Content |
| --- | --- |
| `lumendb://connections` | Full connection inventory (credentials excluded) |
| `lumendb://{connection_id}/schema` | Schema digest for one connection |

```bash
curl -s -X POST "$BASE" -H "$HDR_ACCEPT" -H "$HDR_TYPE" -H "Mcp-Session-Id: $SID" \
  -d '{"jsonrpc":"2.0","id":4,"method":"resources/read","params":{"uri":"lumendb://connections"}}'
```

## Output formats

Every list/query tool accepts `output_format`:

| Format | Best for |
| --- | --- |
| `json` (default) | Structured parsing, full fidelity |
| `toon` | Token-efficient tabular output for LLM context windows |
| `csv` | Spreadsheet / downstream tooling |

`toon` example from `run_query`:

```
rows[4]{channel,n}:
  App,108
  Web,102
  小程序,108
  线下,113
```

## Safety

- MCP is **always read-only**. `run_query` refuses writes, DDL and multiple statements with an explicit error, even when `LUMEN_ALLOW_WRITE=true` for the REST API.
- Row count is capped by `LUMEN_MCP_MAX_ROWS` (default 100).
- Set `LUMEN_API_TOKEN` to protect both `/mcp` and `/api/*`: send `X-API-Token: <token>` or `Authorization: Bearer <token>`.
- Saved connection passwords are encrypted at rest and never returned by tools or resources.

## Client configuration

Clients with native Streamable HTTP support:

```json
{
  "mcpServers": {
    "lumendb": {
      "url": "http://localhost:8000/mcp",
      "headers": { "X-API-Token": "<your LUMEN_API_TOKEN>" }
    }
  }
}
```

For clients that only speak stdio (for example Claude Desktop), bridge with `mcp-remote`:

```json
{
  "mcpServers": {
    "lumendb": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote@latest",
        "http://localhost:8000/mcp",
        "--header", "X-API-Token:<your LUMEN_API_TOKEN>"
      ]
    }
  }
}
```

The **MCP Server** page in the web UI shows the live endpoint, tool list, a probe command and a copy-ready config snippet (it uses `LUMEN_PUBLIC_BASE_URL` when set).

## Remote access

Expose the single port with your own tunnel, for example:

```bash
cloudflared tunnel --url http://localhost:8000
```

Or add an ingress rule to a named tunnel (`my-tunnel`) in `config.yml`:

```yaml
ingress:
  - hostname: db.example.com
    service: http://localhost:8000
  - service: http_status:404
```

Then set `LUMEN_PUBLIC_BASE_URL=https://db.example.com`, keep `LUMEN_API_TOKEN` enabled, and point MCP clients at `https://db.example.com/mcp`.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `307` on `POST /mcp` | A proxy rewrote the path to `/mcp/`; call the exact `/mcp` endpoint (the server itself already normalizes internally) |
| `401` | Missing/incorrect `X-API-Token` or `Authorization: Bearer` header |
| `400 Bad Request` on `tools/call` | Missing `Mcp-Session-Id` header — repeat `initialize` first |
| Empty `tools/list` | The session was not initialized; send `notifications/initialized` |
| `{"error": "Write/DDL statements are blocked..."}` | Expected: MCP is read-only by design |

See also: [ARCHITECTURE.md](ARCHITECTURE.md) · [中文](MCP.zh-CN.md) · [root README](../README.md)
