import { create } from 'zustand'
import { api, errorMessage, type Bootstrap, type ChartSpec, type Connection, type ExplainResult, type QueryResult, type TableInfo } from './api'

export type TabKey = 'workspace' | 'ai' | 'dashboards' | 'history' | 'connections' | 'mcp'
export type ToastKind = 'ok' | 'error' | 'info'
export interface Toast { id: number; text: string; kind: ToastKind }

interface AppState {
  ready: boolean
  connections: Connection[]
  activeId: string
  tables: TableInfo[]
  settings: Bootstrap['settings'] | null
  llm: { enabled: boolean; provider: string } | null
  tab: TabKey
  sql: string
  result: QueryResult | null
  charts: ChartSpec[]
  activeChart: number
  explain: ExplainResult | null
  resultView: 'data' | 'chart' | 'plan' | 'schema'
  loading: boolean
  error: string | null
  toasts: Toast[]
  mobileNavOpen: boolean
  schemaModal: { title: string; content: string } | null
  sidebarOpen: boolean

  init: () => Promise<void>
  setActive: (id: string) => void
  setTab: (t: TabKey) => void
  setSql: (s: string) => void
  setResult: (r: QueryResult | null) => void
  setCharts: (c: ChartSpec[]) => void
  setActiveChart: (i: number) => void
  setExplain: (e: ExplainResult | null) => void
  setResultView: (v: 'data' | 'chart' | 'plan' | 'schema') => void
  setLoading: (b: boolean) => void
  setError: (s: string | null) => void
  toast: (text: string, kind?: ToastKind) => void
  dismissToast: (id: number) => void
  openSchemaModal: (title: string, content: string) => void
  closeSchemaModal: () => void
  refreshConnections: () => Promise<void>
  refreshTables: () => Promise<void>
  setMobileNav: (b: boolean) => void
  toggleSidebar: () => void
  loadTable: (table: string) => Promise<void>
}

let toastSeq = 1

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  connections: [],
  activeId: '',
  tables: [],
  settings: null,
  llm: null,
  tab: 'workspace',
  sql: 'SELECT * FROM customers LIMIT 20;',
  result: null,
  charts: [],
  activeChart: 0,
  explain: null,
  resultView: 'data',
  loading: false,
  error: null,
  toasts: [],
  mobileNavOpen: false,
  schemaModal: null,
  sidebarOpen: true,

  init: async () => {
    try {
      const [b, h] = await Promise.all([api.bootstrap(), api.health()])
      const active = b.connections[0]?.id || ''
      set({ ready: true, connections: b.connections, activeId: active, settings: b.settings, llm: h.llm })
      if (active) await get().refreshTables()
    } catch (e) {
      set({ ready: true, error: errorMessage(e) })
    }
  },
  setActive: (id) => { set({ activeId: id, tables: [], result: null, explain: null }); void get().refreshTables() },
  setTab: (tab) => set({ tab, mobileNavOpen: false }),
  setSql: (sql) => set({ sql }),
  setResult: (result) => set({ result, charts: result?.charts || [], activeChart: 0, resultView: 'data' }),
  setCharts: (charts) => set({ charts }),
  setActiveChart: (activeChart) => set({ activeChart }),
  setExplain: (explain) => set({ explain, resultView: explain ? 'plan' : 'data' }),
  setResultView: (resultView) => set({ resultView }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  toast: (text, kind = 'info') => {
    const id = toastSeq++
    set((s) => ({ toasts: [...s.toasts, { id, text, kind }] }))
    setTimeout(() => get().dismissToast(id), 3600)
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  openSchemaModal: (title, content) => set({ schemaModal: { title, content } }),
  closeSchemaModal: () => set({ schemaModal: null }),
  refreshConnections: async () => {
    const connections = await api.connections()
    const activeId = connections.some((c) => c.id === get().activeId) ? get().activeId : (connections[0]?.id || '')
    set({ connections, activeId })
  },
  refreshTables: async () => {
    const id = get().activeId
    if (!id) { set({ tables: [] }); return }
    try { set({ tables: await api.tables(id) }) } catch (e) { set({ error: errorMessage(e), tables: [] }) }
  },
  setMobileNav: (mobileNavOpen) => set({ mobileNavOpen }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  loadTable: async (table) => {
    const id = get().activeId
    if (!id) return
    set({ loading: true, error: null, sql: `SELECT * FROM "${table}" LIMIT 100;`, resultView: 'data', tab: 'workspace' })
    try {
      const r = await api.preview(id, table, 100)
      set({ result: r, charts: r.charts || [], activeChart: 0, explain: null })
    } catch (e) { set({ error: errorMessage(e) }) } finally { set({ loading: false }) }
  },
}))
