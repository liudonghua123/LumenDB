import { Database, Pencil, Plus, PlugZap, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useI18n } from '../i18n'
import { api, errorMessage, type Connection, type ConnectionInput } from '../lib/api'
import { useApp } from '../lib/store'
import { ConfirmDialog, Empty, IconButton, Modal, SectionTitle, Spinner } from './ui'

const blank = (): ConnectionInput => ({
  name: '', dialect: 'sqlite', host: '', port: undefined, database: '', username: '',
  password: '', readonly: true, color: '#6366f1', options: {},
})

export function ConnectionsView() {
  const { t } = useI18n()
  const { connections, refreshConnections, toast, setActive, settings } = useApp()
  const [modal, setModal] = useState(false)
  const [draft, setDraft] = useState<ConnectionInput>(blank())
  const [editing, setEditing] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string; server_version?: string; latency_ms?: number } | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [semantics, setSemantics] = useState('')
  const [semanticsError, setSemanticsError] = useState(false)

  useEffect(() => { void refreshConnections() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const openNew = () => {
    setDraft(blank()); setEditing(null); setSemantics(''); setTestResult(null); setModal(true)
  }
  const openEdit = (c: Connection) => {
    setDraft({ ...c, password: '' }); setEditing(c.id)
    setSemantics(JSON.stringify((c.options?.semantics as object) || {}, null, 2))
    setTestResult(null); setModal(true)
  }
  const doTest = async () => {
    setTesting(true); setTestResult(null)
    try { setTestResult(await api.testConnection(draft)) }
    catch (e) { setTestResult({ ok: false, message: errorMessage(e) }) }
    finally { setTesting(false) }
  }
  const save = async () => {
    let options: Record<string, unknown> = { ...(draft.options || {}) }
    setSemanticsError(false)
    if (semantics.trim()) {
      try { const parsed = JSON.parse(semantics); options.semantics = parsed }
      catch { setSemanticsError(true); toast('Invalid JSON in business glossary', 'error'); return }
    }
    const payload: ConnectionInput = { ...draft, options, port: draft.port ? Number(draft.port) : undefined }
    try {
      if (editing) await api.updateConnection(editing, payload)
      else await api.createConnection(payload)
      await refreshConnections(); setModal(false); toast(t('common.saved'), 'ok')
      if (!editing) { const list = await api.connections(); if (list[0]) setActive(list[0].id) }
    } catch (e) { toast(errorMessage(e), 'error') }
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      <SectionTitle extra={
        <button className="btn btn-primary !py-1.5" onClick={openNew}><Plus size={14} />{t('conn.new')}</button>
      }>{t('conn.title')}</SectionTitle>
      <p className="text-xs text-muted -mt-1 mb-3">{t('conn.subtitle')}</p>

      <div className="flex-1 overflow-y-auto min-h-0 grid sm:grid-cols-2 xl:grid-cols-3 gap-3 pb-4 content-start">
        {connections.map((c) => (
          <div key={c.id} className="card p-4 fade-in">
            <div className="flex items-start gap-2.5">
              <div className="p-2 rounded-xl text-white shrink-0" style={{ background: c.color }}>
                <Database size={17} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-sm truncate">{c.name}</div>
                <div className="text-[11px] text-muted mono truncate">{c.dialect} · {c.host || c.database || 'local'}</div>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <span className="chip chip-quiet !py-0.5">{c.dialect}</span>
              {c.readonly && <span className="chip !py-0.5">{t('conn.readonly')}</span>}
              {c.has_password && <span className="chip chip-quiet !py-0.5">auth</span>}
            </div>
            <div className="mt-3 pt-3 border-t divider flex items-center gap-1">
              <button className="btn btn-ghost !py-1 !px-2 text-xs" onClick={async () => {
                try { const r = await api.testSaved(c.id); toast(`${r.ok ? t('conn.testOk') : t('conn.testFail')}: ${r.message}`, r.ok ? 'ok' : 'error') }
                catch (e) { toast(errorMessage(e), 'error') }
              }}><PlugZap size={12} />{t('common.test')}</button>
              <div className="flex-1" />
              <IconButton title={t('common.edit')} onClick={() => openEdit(c)}><Pencil size={14} /></IconButton>
              <IconButton title={t('common.delete')} onClick={() => setDeleteId(c.id)}><Trash2 size={14} /></IconButton>
            </div>
          </div>
        ))}
        {connections.length === 0 && <div className="sm:col-span-2 xl:col-span-3"><Empty icon={<Database size={22} />} title={t('conn.empty')} /></div>}
      </div>

      {settings && (
        <div className="mt-2 text-[11px] text-muted flex flex-wrap gap-3">
          <span>{t('ai.engine')}: <span className="mono">{settings.llm_provider}</span></span>
          <span>{t('mcp.readOnly')}: <span className="mono">{String(!settings.allow_write)}</span></span>
          <span>{t('common.limit')}: <span className="mono">{settings.max_rows}</span></span>
        </div>
      )}

      <Modal open={modal} onClose={() => setModal(false)} title={editing ? t('conn.edit') : t('conn.new')} wide
        footer={<>
          <button className="btn btn-ghost" onClick={() => void doTest()} disabled={testing}>{testing ? <Spinner /> : <PlugZap size={14} />}{t('conn.test')}</button>
          <button className="btn btn-primary" onClick={() => void save()}>{t('common.save')}</button>
        </>}>
        <div className="grid sm:grid-cols-2 gap-3">
          <div><label className="label">{t('common.name')}</label>
            <input className="field" value={draft.name || ''} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></div>
          <div><label className="label">{t('conn.dialect')}</label>
            <select className="field" value={draft.dialect} onChange={(e) => setDraft({ ...draft, dialect: e.target.value as ConnectionInput['dialect'] })}>
              <option value="sqlite">SQLite</option><option value="postgresql">PostgreSQL</option><option value="mysql">MySQL / MariaDB</option>
            </select></div>
          <div><label className="label">{t('conn.database')}</label>
            <input className="field mono" value={draft.database || ''} placeholder={t('conn.defaultDb')}
              onChange={(e) => setDraft({ ...draft, database: e.target.value })} /></div>
          <div><label className="label">{t('conn.color')}</label>
            <input type="color" className="field !p-1 h-[38px]" value={draft.color || '#6366f1'}
              onChange={(e) => setDraft({ ...draft, color: e.target.value })} /></div>
          {draft.dialect !== 'sqlite' && <>
            <div><label className="label">{t('conn.host')}</label>
              <input className="field" value={draft.host || ''} onChange={(e) => setDraft({ ...draft, host: e.target.value })} /></div>
            <div><label className="label">{t('conn.port')}</label>
              <input className="field" type="number" value={draft.port || ''} placeholder={draft.dialect === 'mysql' ? '3306' : '5432'}
                onChange={(e) => setDraft({ ...draft, port: Number(e.target.value) || undefined })} /></div>
            <div><label className="label">{t('conn.user')}</label>
              <input className="field" value={draft.username || ''} onChange={(e) => setDraft({ ...draft, username: e.target.value })} /></div>
            <div><label className="label">{t('conn.password')}</label>
              <input className="field" type="password" value={draft.password || ''} placeholder={editing ? '(unchanged)' : ''}
                onChange={(e) => setDraft({ ...draft, password: e.target.value })} /></div>
          </>}
          <div className="sm:col-span-2 flex items-center gap-2">
            <input id="ro" type="checkbox" checked={!!draft.readonly} onChange={(e) => setDraft({ ...draft, readonly: e.target.checked })}
              className="accent-[rgb(var(--brand-rgb))]" />
            <label htmlFor="ro" className="text-xs">{t('conn.readonly')} — write statements are blocked at the driver level</label>
          </div>
          <div className="sm:col-span-2">
            <label className="label">{t('conn.semantics')}</label>
            <textarea className={`field mono text-[11px] ${semanticsError ? '!border-danger' : ''}`} rows={4} value={semantics}
              placeholder='{"tables": {"orders": "订单 / 销售"}, "columns": {"orders.total_amount": "销售额 / 金额"}}'
              onChange={(e) => setSemantics(e.target.value)} />
            <p className="text-[10px] text-muted mt-1">Chinese/English aliases injected into AI prompts; improves offline NL2SQL accuracy.</p>
          </div>
        </div>
        {testResult && (
          <div className={`mt-3 px-3 py-2 rounded-lg text-xs mono ${testResult.ok ? 'bg-positive/10 text-positive' : 'bg-danger/10 text-danger'}`}>
            {testResult.ok ? t('conn.testOk') : t('conn.testFail')} — {testResult.message}
            {testResult.server_version ? ` · v${testResult.server_version} · ${testResult.latency_ms} ms` : ''}
          </div>
        )}
      </Modal>

      <ConfirmDialog open={!!deleteId} title={t('common.delete')} message={t('conn.deleteConfirm')}
        onCancel={() => setDeleteId(null)} onConfirm={async () => {
          if (deleteId) { try { await api.deleteConnection(deleteId); await refreshConnections(); toast(t('common.delete'), 'ok') } catch (e) { toast(errorMessage(e), 'error') } }
          setDeleteId(null)
        }} />
    </div>
  )
}
