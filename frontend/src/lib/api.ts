/* Typed API client. In dev, Vite proxies /api and /mcp to the FastAPI backend. */
import type { ReactNode } from 'react'

export interface Connection {
  id: string
  name: string
  dialect: 'sqlite' | 'postgresql' | 'mysql'
  host: string
  port: number | null
  database: string
  username: string
  readonly: boolean
  color: string
  has_password: boolean
  options: Record<string, unknown>
  created_at?: string
}
export interface ConnectionInput extends Partial<Connection> { password?: string }

export interface ColumnInfo {
  name: string; type: string; nullable: boolean; default: string | null
  primary_key: boolean; autoincrement: boolean; label: string
}
export interface TableInfo { name: string; type: string; schema: string | null; row_count: number | null; label: string }
export interface TableDescription {
  name: string; schema: string | null; label: string
  columns: ColumnInfo[]; primary_key: string[]
  foreign_keys: { columns: string[]; referred_table: string; referred_columns: string[] }[]
  indexes: { name: string | null; columns: string[]; unique: boolean }[]
  ddl: string; sample: QueryResult | null
}
export interface QueryResult {
  columns: string[]
  rows: (string | number | boolean | null)[][]
  row_count: number
  truncated: boolean
  duration_ms: number
  statement_type: string
  sql: string
  connection_id: string
  column_types: string[]
  charts?: ChartSpec[]
  error?: string | null
}
export interface ChartSpec {
  type: 'bar' | 'line' | 'area' | 'pie' | 'scatter' | 'metric' | 'table'
  title: string
  x: string
  y: string[]
  series: { name: string; data: number[] }[]
  reason: string
  options: { categories?: string[]; value?: number; horizontal?: boolean; [k: string]: unknown }
}
export interface ExplainResult { dialect: string; columns?: string[]; rows?: unknown[][]; plan?: unknown; raw?: string }
export interface AiMessage {
  role: 'user' | 'assistant'
  content: string
  sql?: string | null
  result?: QueryResult | null
  chart?: ChartSpec | null
  followups?: string[]
  meta?: Record<string, unknown>
  created_at?: string
  id?: string
}
export interface AiAskResponse {
  session_id: string
  answer: string
  sql: string | null
  result: QueryResult | null
  chart: ChartSpec | null
  followups: string[]
  engine: string
  needs_confirmation: boolean
  message_id: string
}
export interface DashboardCard {
  id: string; title: string; connection_id: string; sql: string
  chart: ChartSpec; width: number
}
export interface Dashboard {
  id: string; name: string; description: string; cards: DashboardCard[]
  created_at?: string; updated_at?: string
}
export interface HistoryItem {
  id: string; connection_id: string; connection_name: string; sql: string
  statement_type: string; row_count: number; duration_ms: number
  status: string; error: string | null; created_at: string
}
export interface SavedQuery { id: string; name: string; sql: string; connection_id: string; created_at: string }
export interface Bootstrap {
  version: string
  connections: Connection[]
  settings: {
    llm_enabled: boolean; llm_provider: string; llm_model: string
    allow_write: boolean; max_rows: number; mcp_path: string; mcp_max_rows: number; auth_required: boolean
  }
  capabilities: string[]
}
export interface McpInfo {
  endpoint: string; transport: string; protocol: string; read_only_by_default: boolean
  max_rows: number; tools: string[]; resources: string[]
  client_configs: Record<string, unknown>; curl_probe: string
}

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}

const token = () => localStorage.getItem('lumendb.token') || ''

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(init.headers as Record<string, string> || {}) }
  if (token()) headers['X-API-Token'] = token()
  const res = await fetch(path, { ...init, headers })
  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try { const body = await res.json(); detail = body.detail || body.error || detail } catch { /* text response */ }
    throw new ApiError(typeof detail === 'string' ? detail : JSON.stringify(detail), res.status)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

const get = <T,>(p: string) => request<T>(p)
const post = <T,>(p: string, body?: unknown) => request<T>(p, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })
const put = <T,>(p: string, body: unknown) => request<T>(p, { method: 'PUT', body: JSON.stringify(body) })
const del = <T,>(p: string) => request<T>(p, { method: 'DELETE' })
const enc = (s: string) => encodeURIComponent(s)

export const api = {
  bootstrap: () => get<Bootstrap>('/api/bootstrap'),
  health: () => get<{ status: string; llm: { enabled: boolean; provider: string } }>('/api/health'),
  mcpInfo: () => get<McpInfo>('/api/mcp/info'),

  connections: () => get<Connection[]>('/api/connections'),
  createConnection: (b: ConnectionInput) => post<Connection>('/api/connections', b),
  updateConnection: (id: string, b: ConnectionInput) => put<Connection>(`/api/connections/${enc(id)}`, b),
  deleteConnection: (id: string) => del<{ deleted: boolean }>(`/api/connections/${enc(id)}`),
  testConnection: (b: ConnectionInput) => post<{ ok: boolean; message: string; server_version: string; latency_ms: number }>('/api/connections/test', b),
  testSaved: (id: string) => post<{ ok: boolean; message: string }>(`/api/connections/${enc(id)}/test`),

  tables: (cid: string) => get<TableInfo[]>(`/api/connections/${enc(cid)}/tables`),
  databases: (cid: string) => get<{ name: string; current: boolean }[]>(`/api/connections/${enc(cid)}/databases`),
  describe: (cid: string, table: string) => get<TableDescription>(`/api/connections/${enc(cid)}/tables/${enc(table)}/describe`),
  preview: (cid: string, table: string, limit = 100) => get<QueryResult>(`/api/connections/${enc(cid)}/tables/${enc(table)}/preview?limit=${limit}`),
  erd: (cid: string) => get<{ nodes: { id: string; label: string; columns: { name: string; type: string; pk: boolean }[] }[]; links: { source: string; target: string; source_column: string; target_column: string }[] }>(`/api/connections/${enc(cid)}/erd`),
  schemaContext: (cid: string) => get<{ context: string }>(`/api/connections/${enc(cid)}/schema-context`),

  execute: (b: { connection_id: string; sql: string; limit?: number; confirm_write?: boolean; multi_statement?: boolean }) =>
    post<QueryResult>('/api/query/execute', b),
  explain: (b: { connection_id: string; sql: string }) => post<ExplainResult>('/api/query/explain', b),
  recommend: (b: { columns: string[]; rows: unknown[][]; column_types?: string[]; title?: string }) =>
    post<{ specs: ChartSpec[] }>('/api/viz/recommend', b),
  history: () => get<HistoryItem[]>('/api/query/history'),
  clearHistory: () => del<{ cleared: boolean }>('/api/query/history'),
  savedQueries: () => get<SavedQuery[]>('/api/saved-queries'),
  saveQuery: (name: string, sql: string, connection_id: string) => post<SavedQuery>('/api/saved-queries', { name, sql, connection_id }),
  deleteSaved: (id: string) => del<{ deleted: boolean }>(`/api/saved-queries/${enc(id)}`),

  aiAsk: (b: { connection_id: string; question: string; session_id?: string | null; auto_run?: boolean; limit?: number }) =>
    post<AiAskResponse>('/api/ai/ask', b),
  aiGenerateSql: (b: { connection_id: string; question: string }) => post<{ sql: string; engine: string; reason: string }>('/api/ai/generate-sql', b),
  aiExplainSql: (b: { connection_id: string; sql: string }) => post<{ explanation: string; engine: string }>('/api/ai/explain-sql', b),
  aiSuggestions: (cid: string) => get<{ questions: string[] }>(`/api/ai/suggestions?connection_id=${enc(cid)}`),
  sessions: () => get<{ id: string; title: string; connection_id: string; updated_at: string }[]>('/api/ai/sessions'),
  session: (id: string) => get<{ id: string; title: string; messages: AiMessage[] }>(`/api/ai/sessions/${enc(id)}`),
  deleteSession: (id: string) => del<{ deleted: boolean }>(`/api/ai/sessions/${enc(id)}`),

  dashboards: () => get<Dashboard[]>('/api/dashboards'),
  createDashboard: (b: { name: string; description: string; cards: DashboardCard[] }) => post<Dashboard>('/api/dashboards', b),
  updateDashboard: (id: string, b: { name: string; description: string; cards: DashboardCard[] }) => put<Dashboard>(`/api/dashboards/${enc(id)}`, b),
  deleteDashboard: (id: string) => del<{ deleted: boolean }>(`/api/dashboards/${enc(id)}`),

  async downloadExport(payload: { connection_id: string; sql: string; format: 'csv' | 'json' | 'sql'; filename?: string }) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token()) headers['X-API-Token'] = token()
    const res = await fetch('/api/query/export', { method: 'POST', headers, body: JSON.stringify(payload) })
    if (!res.ok) {
      const body = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }))
      throw new ApiError(body.detail || `HTTP ${res.status}`, res.status)
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${payload.filename || 'lumendb-export'}.${payload.format}`
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1500)
  },
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message
  if (e instanceof Error) return e.message
  return String(e)
}

export type { ReactNode }
