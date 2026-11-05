import { Plug, ShieldCheck, Terminal, Wrench } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useI18n } from '../i18n'
import { api, errorMessage, type McpInfo } from '../lib/api'
import { useApp } from '../lib/store'
import { CopyButton, Empty, SectionTitle, Spinner } from './ui'

export function McpView() {
  const { t } = useI18n()
  const { toast } = useApp()
  const [info, setInfo] = useState<McpInfo | null>(null)
  const [client, setClient] = useState('claude_desktop')
  useEffect(() => {
    api.mcpInfo().then(setInfo).catch((e) => toast(errorMessage(e), 'error'))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (!info) return <div className="p-8"><Spinner /></div>
  const config = JSON.stringify(info.client_configs[client] ?? info.client_configs.generic, null, 2)

  return (
    <div className="h-full overflow-y-auto min-h-0 pb-6">
      <SectionTitle extra={<span className="chip"><span className="pulse-dot !w-1.5 !h-1.5" />{t('top.online')}</span>}>{t('mcp.title')}</SectionTitle>
      <p className="text-xs text-muted -mt-1 mb-4">{t('mcp.subtitle')}</p>

      <div className="grid md:grid-cols-2 gap-3 mb-3">
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-3 text-brand"><Plug size={16} /><span className="font-semibold text-sm">{t('mcp.endpoint')}</span></div>
          <div className="mono text-[12px] bg-elevated p-3 rounded-lg border divider break-all mb-2">{info.endpoint}</div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="chip chip-quiet !py-0.5">{info.transport}</span>
            <span className="chip chip-quiet !py-0.5">{info.protocol}</span>
            <span className="chip !py-0.5">{t('mcp.readOnly')}</span>
            <CopyButton value={info.endpoint} label={t('common.copy')} />
          </div>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-3 text-positive"><ShieldCheck size={16} /><span className="font-semibold text-sm">{t('mcp.safety')}</span></div>
          <p className="text-xs leading-relaxed text-muted">{t('mcp.safetyText')}</p>
          <div className="mt-3 flex gap-1.5 flex-wrap">
            <span className="chip chip-quiet !py-0.5">max rows {info.max_rows}</span>
            <span className="chip chip-quiet !py-0.5">no credentials</span>
            <span className="chip chip-quiet !py-0.5">fail-closed classifier</span>
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-3 mb-3">
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-3"><Wrench size={15} className="text-brand" /><span className="font-semibold text-sm">{t('mcp.tools')} ({info.tools.length})</span></div>
          <div className="flex flex-wrap gap-1.5">
            {info.tools.map((tool) => <span key={tool} className="chip chip-quiet mono !text-[11px]">{tool}</span>)}
          </div>
          <div className="label mt-4">{t('mcp.resources')}</div>
          <div className="flex flex-wrap gap-1.5">
            {info.resources.map((r) => <span key={r} className="chip chip-quiet mono !text-[11px]">{r}</span>)}
          </div>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-2"><Terminal size={15} className="text-accent" /><span className="font-semibold text-sm">{t('mcp.probe')}</span></div>
          <pre className="mono text-[10.5px] bg-elevated p-3 rounded-lg border divider overflow-auto whitespace-pre-wrap max-h-32">{info.curl_probe}</pre>
          <div className="mt-2"><CopyButton value={info.curl_probe} label={t('common.copy')} /></div>
        </div>
      </div>

      <div className="card p-4">
        <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
          <span className="font-semibold text-sm">{t('mcp.clientConfig')}</span>
          <div className="flex items-center gap-1.5">
            <select className="field !w-auto !py-1.5 text-xs" value={client} onChange={(e) => setClient(e.target.value)}>
              {Object.keys(info.client_configs).map((k) => <option key={k} value={k}>{k.replace('_', ' ')}</option>)}
            </select>
            <CopyButton value={config} label={t('mcp.copyConfig')} />
          </div>
        </div>
        <pre className="mono text-[11px] bg-elevated p-3 rounded-lg border divider overflow-auto whitespace-pre-wrap max-h-72">{config}</pre>
      </div>
    </div>
  )
}
