import { AnimatePresence, motion } from 'framer-motion'
import { Code2, Database, History, LayoutDashboard, Plug, Sparkles } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { AiChat } from './components/AiChat'
import { AnimatedBackground } from './components/AnimatedBackground'
import { ConnectionsView } from './components/ConnectionsView'
import { DashboardView } from './components/DashboardView'
import { HistoryView } from './components/HistoryView'
import { McpView } from './components/McpView'
import { Sidebar } from './components/Sidebar'
import { TopBar } from './components/TopBar'
import { Modal, Toasts } from './components/ui'
import { Workspace } from './components/Workspace'
import { useI18n } from './i18n'
import { useApp, type TabKey } from './lib/store'

const TABS: { key: TabKey; icon: typeof Code2; label: string }[] = [
  { key: 'workspace', icon: Code2, label: 'nav.workspace' },
  { key: 'ai', icon: Sparkles, label: 'nav.ai' },
  { key: 'dashboards', icon: LayoutDashboard, label: 'nav.dashboards' },
  { key: 'history', icon: History, label: 'nav.history' },
  { key: 'connections', icon: Database, label: 'nav.connections' },
  { key: 'mcp', icon: Plug, label: 'nav.mcp' },
]

export default function App() {
  const { t } = useI18n()
  const { init, ready, tab, setTab, schemaModal, closeSchemaModal, error } = useApp()
  const navRef = useRef<HTMLElement>(null)
  useEffect(() => { void init() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // On narrow screens the tab strip scrolls horizontally; keep the active tab in view.
  useEffect(() => {
    const nav = navRef.current
    const active = nav?.querySelector<HTMLElement>('[data-active="true"]')
    if (nav && active) {
      nav.scrollTo({ left: Math.max(0, active.offsetLeft - nav.clientWidth / 2 + active.clientWidth / 2), behavior: 'smooth' })
    }
  }, [tab])

  return (
    <div className="relative h-full flex flex-col">
      <AnimatedBackground />
      <TopBar />

      <div className="relative z-10 flex-1 flex min-h-0">
        <Sidebar />
        <main className="flex-1 min-w-0 min-h-0 flex flex-col gap-2.5 p-2 sm:p-3">
          <nav ref={navRef} className="glass rounded-xl2 shadow-soft px-1.5 py-1.5 flex items-center gap-0.5 overflow-x-auto shrink-0">
            {TABS.map(({ key, icon: Icon, label }) => (
              <button key={key} data-active={tab === key} onClick={() => setTab(key)}
                className={`tab whitespace-nowrap flex items-center gap-1.5 !py-1.5 ${tab === key ? 'tab-active' : ''}`}>
                <Icon size={14} />{t(label)}
              </button>
            ))}
          </nav>

          {error && (
            <div className="px-3 py-2 rounded-lg bg-danger/10 border border-danger/25 text-xs text-danger shrink-0">{error}</div>
          )}

          <div className="flex-1 min-h-0">
            <AnimatePresence mode="wait">
              <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }} transition={{ duration: .18 }} className="h-full">
                {tab === 'workspace' && <Workspace />}
                {tab === 'ai' && <AiChat />}
                {tab === 'dashboards' && <DashboardView />}
                {tab === 'history' && <HistoryView />}
                {tab === 'connections' && <ConnectionsView />}
                {tab === 'mcp' && <McpView />}
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>

      <Toasts />
      <Modal open={!!schemaModal} onClose={closeSchemaModal} title={schemaModal?.title || ''} wide>
        <pre className="mono text-[11px] whitespace-pre-wrap bg-elevated p-3 rounded-lg border divider max-h-[60vh] overflow-auto">
          {schemaModal?.content}
        </pre>
      </Modal>
      {!ready && (
        <div className="absolute inset-0 z-50 flex items-center justify-center glass">
          <div className="text-sm text-muted">LumenDB…</div>
        </div>
      )}
    </div>
  )
}
