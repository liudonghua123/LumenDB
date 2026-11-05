import { AnimatePresence, motion } from 'framer-motion'
import {
  ChevronDown, ChevronRight, Database, FileCode2, GitBranch, Layers, Network,
  Plus, RefreshCw, Search, Table2, Trash2,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useI18n } from '../i18n'
import { api, errorMessage, type SavedQuery } from '../lib/api'
import { useApp } from '../lib/store'
import { Empty, IconButton, Modal, SectionTitle, Spinner } from './ui'

function ErdDiagram({ nodes, links }: { nodes: string[]; links: { source: string; target: string }[] }) {
  const r = 128
  const cx = 170, cy = 150
  const pos: Record<string, [number, number]> = {}
  nodes.forEach((n, i) => {
    const a = (i / Math.max(nodes.length, 1)) * Math.PI * 2 - Math.PI / 2
    pos[n] = [cx + r * Math.cos(a), cy + r * Math.sin(a)]
  })
  return (
    <svg viewBox="0 0 340 300" className="w-full max-w-sm mx-auto">
      <defs>
        <linearGradient id="erdFill" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="rgb(var(--brand-rgb))" stopOpacity=".16" />
          <stop offset="1" stopColor="rgb(var(--accent-rgb))" stopOpacity=".08" />
        </linearGradient>
      </defs>
      {links.map((l, i) => {
        const a = pos[l.source], b = pos[l.target]
        if (!a || !b) return null
        return <line key={i} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="rgb(var(--brand-rgb))" strokeOpacity=".45" strokeWidth="1.5" strokeDasharray="4 3" />
      })}
      {nodes.map((n, i) => {
        const [x, y] = pos[n]
        return (
          <g key={n}>
            <rect x={x - 44} y={y - 13} width="88" height="26" rx="8" fill="url(#erdFill)" stroke="rgb(var(--brand-rgb))" strokeOpacity=".5" />
            <text x={x} y={y + 4} textAnchor="middle" fontSize="10" fill="rgb(var(--ink-rgb))" className="mono">{n}</text>
          </g>
        )
      })}
    </svg>
  )
}

export function Sidebar() {
  const { t } = useI18n()
  const {
    connections, activeId, setActive, tables, refreshTables, loadTable, setTab, setSql,
    toast, openSchemaModal, mobileNavOpen, setMobileNav, sidebarOpen, toggleSidebar,
    refreshConnections,
  } = useApp()
  const [filter, setFilter] = useState('')
  const [objectsOpen, setObjectsOpen] = useState(true)
  const [savedOpen, setSavedOpen] = useState(true)
  const [saved, setSaved] = useState<SavedQuery[]>([])
  const [erdOpen, setErdOpen] = useState(false)
  const [erdData, setErdData] = useState<{ nodes: { id: string }[]; links: { source: string; target: string }[] } | null>(null)
  const [busy, setBusy] = useState(false)

  const loadSaved = () => api.savedQueries().then(setSaved).catch(() => setSaved([]))
  useEffect(() => { void loadSaved() }, [activeId])
  useEffect(() => {
    const refresh = () => { void loadSaved() }
    window.addEventListener('lumendb:saved', refresh)
    return () => window.removeEventListener('lumendb:saved', refresh)
  }, [])

  const filtered = tables.filter((tb) => tb.name.toLowerCase().includes(filter.toLowerCase()))
  const views = filtered.filter((tb) => tb.type === 'view')
  const realTables = filtered.filter((tb) => tb.type !== 'view')

  const openErd = async () => {
    if (!activeId) return
    setBusy(true)
    try { setErdData(await api.erd(activeId)); setErdOpen(true) }
    catch (e) { toast(errorMessage(e), 'error') } finally { setBusy(false) }
  }
  const openContext = async () => {
    if (!activeId) return
    try { const r = await api.schemaContext(activeId); openSchemaModal(t('side.schemaContext'), r.context) }
    catch (e) { toast(errorMessage(e), 'error') }
  }

  const content = (
    <div className="h-full flex flex-col gap-3 p-3 overflow-y-auto">
      <div>
        <div className="flex items-center justify-between mb-1.5 px-1">
          <span className="label !mb-0">{t('side.connections')}</span>
          <div className="flex gap-0.5">
            <IconButton title={t('common.refresh')} onClick={() => void refreshConnections()}><RefreshCw size={13} /></IconButton>
            <IconButton title={t('conn.new')} onClick={() => setTab('connections')}><Plus size={14} /></IconButton>
          </div>
        </div>
        <div className="space-y-1">
          {connections.map((c) => (
            <button key={c.id} onClick={() => { setActive(c.id); setMobileNav(false) }}
              className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm transition-all text-left group ${c.id === activeId ? 'bg-brand/12 text-brand border border-brand/25' : 'hover:bg-elevated border border-transparent'}`}>
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: c.color }} />
              <span className="truncate flex-1">{c.name}</span>
              <span className="text-[10px] text-muted uppercase mono">{c.dialect.slice(0, 4)}</span>
            </button>
          ))}
          {connections.length === 0 && <div className="text-xs text-muted px-2 py-3">{t('conn.empty')}</div>}
        </div>
      </div>

      <div className="border-t divider pt-3">
        <button onClick={() => setObjectsOpen(!objectsOpen)} className="w-full flex items-center gap-1.5 px-1 mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
          {objectsOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          {t('side.objects')}
          <span className="ml-auto chip chip-quiet !py-0 !px-1.5 text-[10px]">{tables.length}</span>
        </button>
        {objectsOpen && (
          <>
            <div className="relative mb-2">
              <Search size={13} className="absolute left-2.5 top-2.5 text-muted" />
              <input className="field !py-1.5 !pl-8 text-xs" placeholder={t('common.search')} value={filter} onChange={(e) => setFilter(e.target.value)} />
            </div>
            <div className="space-y-0.5 max-h-[38vh] overflow-y-auto pr-1">
              {realTables.map((tb) => (
                <button key={tb.name} onClick={() => { void loadTable(tb.name); setMobileNav(false) }}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[13px] hover:bg-brand/10 text-left group">
                  <Table2 size={13} className="text-brand/70 shrink-0" />
                  <span className="truncate flex-1">{tb.name}</span>
                  {tb.label && <span className="text-[10px] text-muted truncate max-w-[70px] hidden xl:inline">{tb.label.split('/')[0]}</span>}
                  <span className="text-[10px] text-muted mono">{tb.row_count ?? ''}</span>
                </button>
              ))}
              {views.map((tb) => (
                <button key={tb.name} onClick={() => { void loadTable(tb.name); setMobileNav(false) }}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[13px] hover:bg-brand/10 text-left">
                  <Layers size={13} className="text-accent/70 shrink-0" />
                  <span className="truncate flex-1">{tb.name}</span>
                </button>
              ))}
              {filtered.length === 0 && <div className="text-xs text-muted px-2 py-4 text-center">{t('side.noTables')}</div>}
            </div>
            <div className="flex gap-1.5 mt-2">
              <button onClick={openErd} className="btn btn-ghost !text-xs !py-1 flex-1"><Network size={13} />{t('side.erd')}</button>
              <button onClick={openContext} className="btn btn-ghost !text-xs !py-1 flex-1"><GitBranch size={13} />{t('side.schemaContext')}</button>
            </div>
            <div className="mt-1.5 flex justify-end">
              <IconButton title={t('common.refresh')} onClick={() => void refreshTables()}><RefreshCw size={12} /></IconButton>
            </div>
          </>
        )}
      </div>

      <div className="border-t divider pt-3">
        <button onClick={() => setSavedOpen(!savedOpen)} className="w-full flex items-center gap-1.5 px-1 mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
          {savedOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}{t('side.saved')}
        </button>
        {savedOpen && (
          <div className="space-y-0.5">
            {saved.map((q) => (
              <div key={q.id} className="flex items-center gap-1 group">
                <button onClick={() => { setSql(q.sql); setTab('workspace'); setMobileNav(false) }}
                  className="flex-1 flex items-center gap-2 px-2 py-1.5 rounded-lg text-[13px] hover:bg-brand/10 text-left truncate">
                  <FileCode2 size={13} className="text-muted shrink-0" /><span className="truncate">{q.name}</span>
                </button>
                <IconButton className="opacity-0 group-hover:opacity-100" title={t('common.delete')}
                  onClick={async () => { await api.deleteSaved(q.id); void loadSaved() }}><Trash2 size={12} /></IconButton>
              </div>
            ))}
            {saved.length === 0 && <div className="text-xs text-muted px-2 py-2">{t('common.empty')}</div>}
          </div>
        )}
      </div>
      <div className="mt-auto pt-2 text-[10px] text-muted/70 px-1 flex items-center gap-1"><Database size={11} /> LumenDB · MIT</div>
    </div>
  )

  return (
    <>
      {/* desktop */}
      <AnimatePresence initial={false}>
        {sidebarOpen && (
          <motion.aside initial={{ width: 0, opacity: 0 }} animate={{ width: 246, opacity: 1 }} exit={{ width: 0, opacity: 0 }}
            transition={{ duration: .22 }} className="hidden md:block shrink-0 h-full overflow-hidden glass border-0 border-r divider z-10">
            <div className="w-[246px] h-full">{content}</div>
          </motion.aside>
        )}
      </AnimatePresence>
      {/* mobile drawer */}
      <AnimatePresence>
        {mobileNavOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-30 bg-slate-950/40 md:hidden" onClick={() => setMobileNav(false)} />
            <motion.aside initial={{ x: -280 }} animate={{ x: 0 }} exit={{ x: -280 }} transition={{ type: 'spring', damping: 26, stiffness: 260 }}
              className="fixed left-0 top-14 bottom-0 w-[270px] z-40 glass border-r divider md:hidden">{content}</motion.aside>
          </>
        )}
      </AnimatePresence>

      <Modal open={erdOpen} onClose={() => setErdOpen(false)} title={t('side.erd')} wide>
        {busy ? <Spinner /> : erdData && (
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <ErdDiagram nodes={erdData.nodes.map((n) => n.id)} links={erdData.links} />
            </div>
            <div className="space-y-1.5 text-xs">
              <div className="label">{t('side.tables')} ({erdData.nodes.length})</div>
              {erdData.nodes.map((n) => <div key={n.id} className="chip chip-quiet w-fit mono">{n.id}</div>)}
              <div className="label mt-3">Foreign keys ({erdData.links.length})</div>
              {erdData.links.map((l, i) => (
                <div key={i} className="p-2 rounded-lg bg-elevated mono text-[11px]">
                  {l.source} <span className="text-brand">→</span> {l.target}
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}
