import { LayoutDashboard, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useI18n } from '../i18n'
import { api, errorMessage, type ChartSpec, type Dashboard, type DashboardCard, type QueryResult } from '../lib/api'
import { useApp } from '../lib/store'
import { ChartView } from './ChartView'
import { Empty, IconButton, Modal, SectionTitle, Spinner } from './ui'

const CHART_TYPES: ChartSpec['type'][] = ['bar', 'line', 'area', 'pie', 'scatter', 'metric', 'table']
const emptyCard = (): DashboardCard => ({
  id: `card_${Date.now()}`, title: '', connection_id: '', sql: '', width: 6,
  chart: { type: 'bar', title: '', x: '', y: [], series: [], reason: '', options: {} },
})

export function DashboardView() {
  const { t } = useI18n()
  const { activeId, toast } = useApp()
  const [boards, setBoards] = useState<Dashboard[]>([])
  const [activeIdBoard, setActiveIdBoard] = useState('')
  const [results, setResults] = useState<Record<string, QueryResult>>({})
  const [specs, setSpecs] = useState<Record<string, ChartSpec>>({})
  const [loadingCards, setLoadingCards] = useState<Record<string, boolean>>({})
  const [boardModal, setBoardModal] = useState(false)
  const [boardName, setBoardName] = useState('')
  const [boardDesc, setBoardDesc] = useState('')
  const [cardModal, setCardModal] = useState(false)
  const [draft, setDraft] = useState<DashboardCard | null>(null)
  const [editing, setEditing] = useState(false)

  const board = boards.find((b) => b.id === activeIdBoard)
  const load = useCallback(async () => {
    try {
      const list = await api.dashboards()
      setBoards(list)
      setActiveIdBoard((cur) => list.some((b) => b.id === cur) ? cur : (list[0]?.id || ''))
    } catch (e) { toast(errorMessage(e), 'error') }
  }, [toast])
  useEffect(() => { void load() }, [load])

  const runCard = useCallback(async (card: DashboardCard) => {
    const cid = card.connection_id || activeId
    if (!cid || !card.sql.trim()) return
    setLoadingCards((s) => ({ ...s, [card.id]: true }))
    try {
      const r = await api.execute({ connection_id: cid, sql: card.sql, limit: 300 })
      setResults((s) => ({ ...s, [card.id]: r }))
      const recommended = (r.charts || [])[0]
      const chosen = card.chart?.type && card.chart.type !== 'table'
        ? card.chart
        : (recommended || card.chart)
      setSpecs((s) => ({ ...s, [card.id]: { ...chosen, title: card.title, series: [] } }))
    } catch (e) {
      toast(`${card.title || card.id}: ${errorMessage(e)}`, 'error')
    } finally { setLoadingCards((s) => ({ ...s, [card.id]: false })) }
  }, [activeId, toast])
  useEffect(() => { if (board) board.cards.forEach((c) => void runCard(c)) }, [board?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const persist = async (updated: Dashboard) => {
    try {
      await api.updateDashboard(updated.id, { name: updated.name, description: updated.description, cards: updated.cards })
      await load(); toast(t('toast.dashboardSaved'), 'ok')
    } catch (e) { toast(errorMessage(e), 'error') }
  }

  const createBoard = async () => {
    try {
      const b = await api.createDashboard({ name: boardName.trim() || 'New dashboard', description: boardDesc, cards: [] })
      setBoardModal(false); setBoardName(''); setBoardDesc(''); setActiveIdBoard(b.id); await load()
      toast(t('toast.dashboardSaved'), 'ok')
    } catch (e) { toast(errorMessage(e), 'error') }
  }
  const openNewCard = () => { setDraft({ ...emptyCard(), connection_id: activeId }); setEditing(false); setCardModal(true) }
  const openEditCard = (c: DashboardCard) => { setDraft({ ...c }); setEditing(true); setCardModal(true) }
  const saveCard = async () => {
    if (!board || !draft?.sql.trim()) return
    const cards = editing ? board.cards.map((c) => c.id === draft.id ? draft : c) : [...board.cards, draft]
    setCardModal(false)
    await persist({ ...board, cards })
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <SectionTitle extra={
          <span className="text-xs text-muted">{boards.length} {t('common.all')}</span>
        }>{t('dash.title')}</SectionTitle>
        <div className="flex-1" />
        {boards.length > 0 && (
          <select className="field !w-auto !py-1.5 text-xs" value={activeIdBoard} onChange={(e) => setActiveIdBoard(e.target.value)}>
            {boards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
        <button className="btn btn-ghost !py-1.5" onClick={() => setBoardModal(true)}><Plus size={14} />{t('dash.new')}</button>
        <button className="btn btn-ghost !py-1.5" onClick={() => board?.cards.forEach((c) => void runCard(c))}><RefreshCw size={14} /><span className="hide-mobile">{t('dash.refreshAll')}</span></button>
        {board && <IconButton title={t('common.delete')} onClick={async () => {
          await api.deleteDashboard(board.id); await load(); toast(t('common.delete'), 'ok')
        }}><Trash2 size={15} /></IconButton>}
      </div>
      {board && <p className="text-xs text-muted -mt-1 mb-3">{board.description || t('dash.subtitle')}</p>}

      <div className="flex-1 overflow-y-auto min-h-0">
        {!board ? <Empty icon={<LayoutDashboard size={22} />} title={t('dash.noBoards')} /> : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 pb-4">
            {board.cards.map((card) => {
              const r = results[card.id]
              const spec = specs[card.id] || card.chart
              return (
                <div key={card.id} className="card flex flex-col min-h-[260px] fade-in">
                  <div className="flex items-center gap-1.5 px-3 py-2 border-b divider">
                    <div className="w-1.5 h-1.5 rounded-full bg-brand" />
                    <span className="text-sm font-medium truncate flex-1">{card.title || card.id}</span>
                    {loadingCards[card.id] && <Spinner size={13} />}
                    <IconButton className="!p-1" title={t('common.refresh')} onClick={() => void runCard(card)}><RefreshCw size={12} /></IconButton>
                    <IconButton className="!p-1" title={t('common.edit')} onClick={() => openEditCard(card)}><Pencil size={12} /></IconButton>
                    <IconButton className="!p-1" title={t('common.delete')} onClick={() => void persist({ ...board, cards: board.cards.filter((c) => c.id !== card.id) })}><Trash2 size={12} /></IconButton>
                  </div>
                  <div className="flex-1 min-h-[190px] p-2 flex items-center justify-center">
                    {r && r.rows.length ? (
                      <ChartView chart={spec} result={r} height={210} />
                    ) : <span className="text-xs text-muted">{loadingCards[card.id] ? t('common.loading') : t('common.empty')}</span>}
                  </div>
                  <div className="px-3 py-1.5 border-t divider text-[10px] text-muted mono truncate">{card.sql}</div>
                </div>
              )
            })}
            <button onClick={openNewCard} className="card min-h-[260px] flex flex-col items-center justify-center gap-2 text-muted hover:text-brand hover:border-brand/40 transition-colors border-dashed">
              <Plus size={22} /><span className="text-sm">{t('dash.addCard')}</span>
            </button>
          </div>
        )}
      </div>

      <Modal open={boardModal} onClose={() => setBoardModal(false)} title={t('dash.new')}
        footer={<button className="btn btn-primary" onClick={() => void createBoard()}>{t('common.create')}</button>}>
        <label className="label">{t('common.name')}</label>
        <input className="field mb-3" autoFocus value={boardName} onChange={(e) => setBoardName(e.target.value)} placeholder="My dashboard" />
        <label className="label">Description</label>
        <input className="field" value={boardDesc} onChange={(e) => setBoardDesc(e.target.value)} />
      </Modal>

      <Modal open={cardModal} onClose={() => setCardModal(false)} title={editing ? t('common.edit') : t('dash.addCard')} wide
        footer={<button className="btn btn-primary" onClick={() => void saveCard()}>{t('common.save')}</button>}>
        {draft && (
          <div className="space-y-3">
            <div className="grid sm:grid-cols-2 gap-3">
              <div><label className="label">{t('dash.cardTitle')}</label>
                <input className="field" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></div>
              <div><label className="label">{t('dash.chartType')}</label>
                <select className="field" value={draft.chart.type} onChange={(e) => setDraft({ ...draft, chart: { ...draft.chart, type: e.target.value as ChartSpec['type'] } })}>
                  {CHART_TYPES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select></div>
            </div>
            <div><label className="label">{t('dash.cardSql')}</label>
              <textarea className="field mono" rows={5} value={draft.sql} onChange={(e) => setDraft({ ...draft, sql: e.target.value })}
                placeholder="SELECT substr(order_date,1,7) AS month, SUM(total_amount) AS revenue FROM orders GROUP BY month" /></div>
            <p className="text-[11px] text-muted">{t('work.chartHint')} · {t('ai.engine')}: {draft.chart.type}</p>
          </div>
        )}
      </Modal>
    </div>
  )
}
