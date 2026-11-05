import { Clock, ExternalLink, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useI18n } from '../i18n'
import { api, errorMessage, type HistoryItem } from '../lib/api'
import { useApp } from '../lib/store'
import { Empty, IconButton, SectionTitle } from './ui'

export function HistoryView() {
  const { t } = useI18n()
  const { setSql, setTab, toast } = useApp()
  const [items, setItems] = useState<HistoryItem[]>([])
  const load = () => api.history().then(setItems).catch((e) => toast(errorMessage(e), 'error'))
  useEffect(() => { void load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="h-full flex flex-col min-h-0">
      <SectionTitle extra={
        <button className="btn btn-ghost !py-1.5" onClick={async () => {
          await api.clearHistory(); await load(); toast(t('common.success'), 'ok')
        }}><Trash2 size={14} />{t('hist.clear')}</button>
      }>{t('hist.title')}</SectionTitle>
      <p className="text-xs text-muted -mt-1 mb-3">{t('hist.subtitle')}</p>
      <div className="panel flex-1 overflow-auto min-h-0">
        {items.length === 0 ? <Empty icon={<Clock size={20} />} title={t('hist.empty')} /> : (
          <table className="grid-table">
            <thead><tr>
              <th>{t('hist.time')}</th><th>{t('top.connection')}</th><th>{t('hist.status')}</th>
              <th>{t('hist.sql')}</th><th>{t('common.rows')}</th><th>{t('work.duration')}</th><th />
            </tr></thead>
            <tbody>
              {items.map((h) => (
                <tr key={h.id}>
                  <td className="mono text-[11px] text-muted whitespace-nowrap">{h.created_at.replace('T', ' ').slice(0, 19)}</td>
                  <td className="text-[11px]">{h.connection_name || h.connection_id.slice(0, 10)}</td>
                  <td><span className={`chip !py-0 !px-1.5 text-[10px] ${h.status === 'ok' ? '' : 'chip-quiet !text-danger'}`}>{h.status}</span></td>
                  <td className="mono max-w-[420px]" title={h.error || h.sql}>
                    <span className={h.status === 'error' ? 'text-danger' : ''}>{h.sql.length > 90 ? h.sql.slice(0, 90) + '…' : h.sql}</span>
                  </td>
                  <td className="cell-number">{h.row_count}</td>
                  <td className="text-muted">{h.duration_ms} ms</td>
                  <td><IconButton title={t('hist.open')} onClick={() => { setSql(h.sql); setTab('workspace') }}><ExternalLink size={13} /></IconButton></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
