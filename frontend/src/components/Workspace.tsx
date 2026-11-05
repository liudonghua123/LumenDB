import { motion } from 'framer-motion'
import {
  Activity, AlertTriangle, BarChart3, BookmarkPlus, Braces, ChevronDown, Code2,
  Download, FileJson, FileSpreadsheet, FileCode2, ListFilter, Play, Wand2,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n'
import { ApiError, api, errorMessage, type QueryResult } from '../lib/api'
import { useApp } from '../lib/store'
import { ChartView } from './ChartView'
import { ResultGrid } from './ResultGrid'
import { formatSql, SqlEditor } from './SqlEditor'
import { ConfirmDialog, Empty, Modal, SectionTitle, Spinner } from './ui'

export function Workspace() {
  const { t } = useI18n()
  const {
    sql, setSql, activeId, connections, result, setResult, charts, activeChart, setActiveChart,
    explain, setExplain, resultView, setResultView, loading, setLoading, error, setError, toast,
  } = useApp()
  const [limit, setLimit] = useState(200)
  const [multi, setMulti] = useState(false)
  const [writePending, setWritePending] = useState<string | null>(null)
  const [saveOpen, setSaveOpen] = useState(false)
  const [queryName, setQueryName] = useState('')
  const [exportOpen, setExportOpen] = useState(false)
  const exportRef = useRef<HTMLDivElement>(null)
  const connection = connections.find((c) => c.id === activeId)

  useEffect(() => {
    if (!exportOpen) return
    const onPointerDown = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) setExportOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExportOpen(false) }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [exportOpen])

  const run = async (statement = sql, confirmWrite = false) => {
    if (!activeId) { toast(t('toast.needConnection'), 'error'); return }
    if (!statement.trim()) return
    // Intercept obvious writes locally: instant confirmation, no doomed request / 403 noise.
    const cleaned = statement.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ').trim()
    if (!confirmWrite && /^(?:insert|update|delete|drop|alter|create|truncate|replace|merge|grant|revoke|attach|detach|vacuum|reindex)\b/i.test(cleaned)) {
      setWritePending(statement)
      return
    }
    setLoading(true); setError(null)
    try {
      const r = await api.execute({
        connection_id: activeId, sql: statement, limit,
        confirm_write: confirmWrite, multi_statement: multi,
      })
      setResult(r)
      setExplain(null)
      toast(t('common.success'), 'ok')
    } catch (e) {
      const err = e as ApiError
      if (err.status === 403 && !confirmWrite) setWritePending(statement)
      else { setError(errorMessage(e)); toast(errorMessage(e), 'error') }
    } finally { setLoading(false) }
  }

  const doExplain = async () => {
    if (!activeId || !sql.trim()) return
    setLoading(true)
    try { setExplain(await api.explain({ connection_id: activeId, sql })) }
    catch (e) { toast(errorMessage(e), 'error') } finally { setLoading(false) }
  }

  const doExport = async (format: 'csv' | 'json' | 'sql') => {
    if (!activeId || !sql.trim()) return
    setExportOpen(false)
    try { await api.downloadExport({ connection_id: activeId, sql, format }); toast(t('common.export'), 'ok') }
    catch (e) { toast(errorMessage(e), 'error') }
  }

  const doSave = async () => {
    try {
      await api.saveQuery(queryName.trim() || sql.slice(0, 36), sql, activeId)
      window.dispatchEvent(new Event('lumendb:saved'))
      setSaveOpen(false); setQueryName(''); toast(t('toast.savedQuery'), 'ok')
    } catch (e) { toast(errorMessage(e), 'error') }
  }

  const chart = charts[activeChart] || null
  const meta = (r: QueryResult) => (
    <span className="text-[11px] text-muted flex items-center gap-2 flex-wrap">
      <span className="chip chip-quiet !py-0.5">{r.row_count} {t('common.rows')}</span>
      <span>{t('work.duration')} {r.duration_ms} ms</span>
      <span className="chip chip-quiet !py-0.5 uppercase">{r.statement_type}</span>
      {r.truncated && <span className="text-danger">{t('work.truncated')}</span>}
    </span>
  )

  return (
    <div className="h-full flex flex-col gap-3 min-h-0">
      {/* editor panel */}
      <div className="panel flex flex-col shrink-0" style={{ height: 'min(38%, 340px)' }}>
        <div className="flex items-center gap-1.5 px-2.5 py-2 border-b divider flex-wrap">
          <button className="btn btn-primary !py-1.5" disabled={loading} onClick={() => void run()}>
            {loading ? <Spinner /> : <Play size={14} />}{loading ? t('common.running') : t('work.execute')}
          </button>
          <button className="btn btn-ghost !py-1.5" onClick={() => void doExplain()} title="Ctrl/⌘ + Enter runs the query">
            <Activity size={14} /> <span className="hide-mobile">{t('work.explain')}</span>
          </button>
          <button className="btn btn-ghost !py-1.5" onClick={() => setSql(formatSql(sql))} title="Format">
            <Wand2 size={14} /> <span className="hide-mobile">{t('work.format')}</span>
          </button>
          <button className="btn btn-ghost !py-1.5" onClick={() => setSaveOpen(true)}>
            <BookmarkPlus size={14} /> <span className="hide-mobile">{t('work.saveQuery')}</span>
          </button>
          <div className="relative" ref={exportRef}>
            <button className="btn btn-ghost !py-1.5" onClick={() => setExportOpen(!exportOpen)}>
              <Download size={14} /><span className="hide-mobile">{t('common.export')}</span><ChevronDown size={12} />
            </button>
            {exportOpen && (
              <div className="card absolute left-0 top-9 z-30 p-1 w-36">
                {(['csv', 'json', 'sql'] as const).map((f) => (
                  <button key={f} onClick={() => void doExport(f)} className="w-full text-left px-2.5 py-1.5 rounded-md text-xs hover:bg-brand/10 flex items-center gap-2">
                    {f === 'csv' ? <FileSpreadsheet size={13} /> : f === 'json' ? <FileJson size={13} /> : <FileCode2 size={13} />}
                    {f.toUpperCase()}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex-1" />
          <label className="hidden sm:flex items-center gap-1 text-[11px] text-muted" title="Multi-statement execution">
            <input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} className="accent-[rgb(var(--brand-rgb))]" />
            {t('work.multiHint')}
          </label>
          <label className="flex items-center gap-1 text-[11px] text-muted">
            <ListFilter size={12} />{t('common.limit')}
            <input type="number" min={1} max={1000} value={limit} onChange={(e) => setLimit(Math.max(1, Number(e.target.value)))}
              className="field !w-16 !py-1 !px-2 text-xs mono" />
          </label>
        </div>
        <div className="flex-1 min-h-0">
          <SqlEditor value={sql} onChange={setSql} onRun={() => void run()} connection={connection} />
        </div>
      </div>

      {/* result panel */}
      <div className="panel flex-1 flex flex-col min-h-0">
        <div className="flex items-center gap-2 px-3 py-2 border-b divider flex-wrap">
          <div className="flex items-center gap-0.5">
            {([['data', t('common.data'), <Code2 size={13} key="a" />], ['chart', t('common.chart'), <BarChart3 size={13} key="b" />], ['plan', t('common.plan'), <Activity size={13} key="c" />]] as const).map(([key, label, icon]) => (
              <button key={key} onClick={() => {
                setResultView(key)
                if (key === 'plan' && !explain && activeId && sql.trim()) void doExplain()
              }} className={`tab !py-1.5 flex items-center gap-1.5 ${resultView === key ? 'tab-active' : ''}`}>
                {icon}{label}
              </button>
            ))}
          </div>
          <div className="flex-1" />
          {result && meta(result)}
        </div>

        {error && (
          <div className="mx-3 mt-2 px-3 py-2 rounded-lg bg-danger/10 border border-danger/25 text-xs flex items-start gap-2 text-danger">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" /><span className="mono">{error}</span>
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-hidden">
          {resultView === 'data' && (result
            ? <ResultGrid result={result} />
            : <Empty icon={<Braces size={20} />} title={t('work.noResult')} />)}

          {resultView === 'chart' && (
            <div className="h-full flex flex-col">
              {charts.length > 0 ? (
                <>
                  <div className="px-3 py-2 flex items-center gap-1.5 overflow-x-auto border-b divider">
                    {charts.map((c, i) => (
                      <button key={`${c.type}-${i}`} onClick={() => setActiveChart(i)}
                        className={`chip whitespace-nowrap cursor-pointer ${i === activeChart ? '' : 'chip-quiet'}`}>{t(`chart.${c.type}`)}</button>
                    ))}
                    <span className="text-[11px] text-muted ml-2 truncate hidden lg:block">{chart?.reason}</span>
                  </div>
                  <div className="flex-1 min-h-0 p-2 overflow-auto"><ChartView chart={chart!} result={result} height={320} /></div>
                </>
              ) : <Empty icon={<BarChart3 size={20} />} title={t('work.chartHint')} hint={t('work.noResult')} />}
            </div>
          )}

          {resultView === 'plan' && (explain ? (
            <div className="h-full overflow-auto p-3">
              {explain.rows && explain.columns ? (
                <div className="mb-3"><ResultGrid result={{
                  columns: explain.columns, rows: explain.rows as QueryResult['rows'], row_count: explain.rows.length,
                  truncated: false, duration_ms: 0, statement_type: 'explain', sql: '', connection_id: '',
                  column_types: explain.columns.map(() => 'text'),
                }} /></div>
              ) : null}
              <pre className="mono text-[11px] whitespace-pre-wrap bg-elevated p-3 rounded-lg border divider overflow-auto">{explain.raw || JSON.stringify(explain.plan, null, 2)}</pre>
            </div>
          ) : <Empty icon={<Activity size={20} />} title={loading ? t('common.loading') : t('work.explainHint')} hint={t('work.noResult')} />)}
        </div>
      </div>

      <ConfirmDialog open={!!writePending} title={t('work.writeWarnTitle')} message={t('work.writeWarn')}
        confirmLabel={t('work.execute')}
        onCancel={() => setWritePending(null)}
        onConfirm={() => { const s = writePending!; setWritePending(null); void run(s, true) }} />

      <Modal open={saveOpen} onClose={() => setSaveOpen(false)} title={t('work.saveQuery')}
        footer={<button className="btn btn-primary" onClick={() => void doSave()}>{t('common.save')}</button>}>
        <label className="label">{t('common.name')}</label>
        <input className="field" autoFocus value={queryName} placeholder={sql.slice(0, 40)} onChange={(e) => setQueryName(e.target.value)} />
        <pre className="mt-3 mono text-[11px] bg-elevated p-3 rounded-lg border divider overflow-auto max-h-40">{sql}</pre>
      </Modal>
    </div>
  )
}
