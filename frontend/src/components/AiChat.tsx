import { motion } from 'framer-motion'
import {
  ArrowUp, BarChart3, Bot, Copy, ExternalLink, MessageSquarePlus, Pin, Plus,
  Sparkles, Trash2, User, Wand2,
} from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import { useI18n } from '../i18n'
import { api, errorMessage, type AiMessage, type ChartSpec } from '../lib/api'
import { useApp } from '../lib/store'
import { ChartView } from './ChartView'
import { ResultGrid } from './ResultGrid'
import { CopyButton, Empty, IconButton, SectionTitle, Spinner } from './ui'

function MessageBubble({ msg, onOpenSql, onPin, onFollowup, busy }: {
  msg: AiMessage; onOpenSql: (sql: string) => void; onPin: (msg: AiMessage) => void
  onFollowup: (q: string) => void; busy: boolean
}) {
  const { t } = useI18n()
  const isUser = msg.role === 'user'
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className={`flex gap-2.5 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div className={`w-8 h-8 rounded-xl shrink-0 flex items-center justify-center ${isUser ? 'bg-brand/15 text-brand' : 'bg-gradient-to-br from-brand to-accent text-white'}`}>
        {isUser ? <User size={15} /> : <Bot size={16} />}
      </div>
      <div className={`max-w-[min(90%,780px)] min-w-0 ${isUser ? 'items-end' : 'items-start'} flex flex-col gap-2`}>
        <div className={`rounded-xl2 px-3.5 py-2.5 text-sm leading-relaxed ${isUser ? 'bg-brand/12 border border-brand/20 rounded-tr-sm' : 'card rounded-tl-sm'}`}>
          {isUser ? <span>{msg.content}</span> : (
            <div className="prose-lumen">
              <ReactMarkdown components={{
                pre: ({ children }) => <pre className="mono text-[11px] bg-elevated/80 p-2.5 rounded-lg border divider overflow-auto my-2 whitespace-pre-wrap">{children as ReactNode}</pre>,
                code: ({ children, className }) => <code className={`mono text-[11.5px] ${className || ''}`}>{children as ReactNode}</code>,
              }}>{msg.content}</ReactMarkdown>
            </div>
          )}
        </div>

        {msg.sql && (
          <div className="w-full card !rounded-xl overflow-hidden">
            <div className="flex items-center gap-1.5 px-3 py-1.5 border-b divider bg-elevated/50">
              <Wand2 size={12} className="text-brand" />
              <span className="text-[11px] font-semibold">{t('ai.sql')}</span>
              {msg.meta?.engine ? <span className="chip chip-quiet !py-0 !px-1.5 text-[10px] ml-1">{String(msg.meta.engine)}</span> : null}
              <div className="flex-1" />
              <CopyButton value={msg.sql} label="" className="!py-1 !px-1.5" />
              <IconButton title={t('ai.openInEditor')} onClick={() => onOpenSql(msg.sql!)} className="!p-1"><ExternalLink size={13} /></IconButton>
            </div>
            <pre className="mono text-[11px] p-3 overflow-auto whitespace-pre-wrap text-muted">{msg.sql}</pre>
          </div>
        )}

        {msg.chart && msg.chart.type !== 'table' && (
          <div className="w-full card !rounded-xl p-2">
            <div className="flex items-center gap-1.5 px-2 pb-1 text-[11px] text-muted">
              <BarChart3 size={12} /> {t(`chart.${msg.chart.type}`)}
              <span className="flex-1" />
              <button onClick={() => onPin(msg)} className="btn btn-ghost !py-1 !px-2 text-[11px]"><Pin size={12} />{t('ai.addToDashboard')}</button>
            </div>
            <ChartView chart={msg.chart} result={msg.result || null} height={230} />
          </div>
        )}

        {msg.result && msg.result.rows.length > 0 && (
          <details className="w-full card !rounded-xl overflow-hidden">
            <summary className="px-3 py-2 text-xs cursor-pointer text-muted hover:text-ink select-none">
              {t('common.data')} · {msg.result.row_count} {t('common.rows')} · {msg.result.duration_ms} ms
            </summary>
            <div className="max-h-64 overflow-auto border-t divider"><ResultGrid result={msg.result} /></div>
          </details>
        )}

        {!!msg.followups?.length && !isUser && (
          <div className="flex flex-wrap gap-1.5">
            {msg.followups.map((f, i) => (
              <button key={i} disabled={busy} onClick={() => onFollowup(f)}
                className="chip chip-quiet cursor-pointer hover:text-brand hover:bg-brand/10 !text-[11px] inline-flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed">
                <Sparkles size={10} />{f}
              </button>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  )
}

export function AiChat() {
  const { t } = useI18n()
  const { activeId, setSql, setTab, toast, settings } = useApp()
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<AiMessage[]>([])
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [sessions, setSessions] = useState<{ id: string; title: string; updated_at: string }[]>([])
  const bottom = useRef<HTMLDivElement>(null)

  const loadSessions = () => api.sessions().then(setSessions).catch(() => setSessions([]))
  useEffect(() => { void loadSessions() }, [])
  useEffect(() => {
    if (!activeId) return
    api.aiSuggestions(activeId).then((r) => setSuggestions(r.questions)).catch(() => setSuggestions([]))
  }, [activeId])
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [messages, busy])

  const ask = async (q: string) => {
    const text = q.trim()
    if (!text || busy) return
    if (!activeId) { toast(t('toast.needConnection'), 'error'); return }
    setQuestion(''); setBusy(true)
    setMessages((m) => [...m, { role: 'user', content: text }])
    try {
      const r = await api.aiAsk({ connection_id: activeId, question: text, session_id: sessionId, auto_run: true, limit: 200 })
      setSessionId(r.session_id)
      setMessages((m) => [...m, {
        role: 'assistant', content: r.answer, sql: r.sql, result: r.result, chart: r.chart,
        followups: r.followups, meta: { engine: r.engine }, id: r.message_id,
      }])
      void loadSessions()
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', content: `**${t('common.error')}**: ${errorMessage(e)}` }])
      toast(errorMessage(e), 'error')
    } finally { setBusy(false) }
  }

  const openSession = async (id: string) => {
    try {
      const s = await api.session(id)
      setSessionId(id); setMessages(s.messages || [])
    } catch (e) { toast(errorMessage(e), 'error') }
  }
  const newChat = () => { setSessionId(null); setMessages([]) }
  const deleteSession = async (id: string) => {
    try { await api.deleteSession(id); if (id === sessionId) newChat(); void loadSessions() } catch (e) { toast(errorMessage(e), 'error') }
  }
  const pin = async (msg: AiMessage) => {
    if (!msg.sql || !activeId) return
    try {
      const boards = await api.dashboards()
      const target = boards[0] || await api.createDashboard({ name: 'AI 问数看板', description: 'Pinned from AI 问数', cards: [] })
      const chart: ChartSpec = msg.chart || { type: 'bar', title: '', x: '', y: [], series: [], reason: '', options: {} }
      await api.updateDashboard(target.id, {
        name: target.name, description: target.description,
        cards: [...target.cards, {
          id: `card_${Date.now()}`, title: (msg.sql || '').slice(0, 34), connection_id: activeId,
          sql: msg.sql, chart, width: 6,
        }],
      })
      toast(`${t('ai.pinned')} · ${target.name}`, 'ok')
    } catch (e) { toast(errorMessage(e), 'error') }
  }

  return (
    <div className="h-full flex gap-3 min-h-0">
      <div className="hidden lg:flex panel w-52 shrink-0 flex-col">
        <div className="px-3 py-2.5 border-b divider flex items-center justify-between">
          <span className="label !mb-0">{t('ai.sessions')}</span>
          <IconButton title={t('ai.newChat')} onClick={newChat}><MessageSquarePlus size={14} /></IconButton>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {sessions.map((s) => (
            <div key={s.id} className="group flex items-center gap-0.5">
              <button onClick={() => void openSession(s.id)}
                className={`flex-1 text-left px-2 py-2 rounded-lg text-xs truncate ${s.id === sessionId ? 'bg-brand/12 text-brand' : 'hover:bg-elevated'}`}>{s.title}</button>
              <IconButton className="opacity-0 group-hover:opacity-100 !p-1" title={t('common.delete')} onClick={() => void deleteSession(s.id)}><Trash2 size={12} /></IconButton>
            </div>
          ))}
          {sessions.length === 0 && <div className="text-xs text-muted text-center py-6">{t('common.empty')}</div>}
        </div>
      </div>

      <div className="panel flex-1 flex flex-col min-h-0">
        <div className="px-4 py-3 border-b divider flex items-center gap-2 flex-wrap">
          <div className="p-1.5 rounded-lg bg-gradient-to-br from-brand to-accent text-white"><Sparkles size={15} /></div>
          <div className="min-w-0">
            <h2 className="font-semibold text-sm">{t('ai.title')}</h2>
            <p className="text-[11px] text-muted truncate max-w-[520px]">{t('ai.subtitle')}</p>
          </div>
          <div className="flex-1" />
          <span className="chip chip-quiet !py-1 text-[10px]"><span className="pulse-dot !w-1.5 !h-1.5" />{settings?.llm_provider || 'offline'}</span>
          <button className="btn btn-ghost !py-1.5 lg:hidden" onClick={newChat}><Plus size={13} />{t('ai.newChat')}</button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center gap-4 pb-8">
              <div className="p-4 rounded-2xl bg-brand/10 text-brand"><Sparkles size={26} /></div>
              <div className="text-center">
                <div className="font-semibold">{t('ai.noMessages')}</div>
                <div className="text-xs text-muted mt-1">{t('ai.subtitle')}</div>
              </div>
              <div className="flex flex-wrap gap-2 justify-center max-w-2xl">
                {suggestions.map((s) => (
                  <button key={s} onClick={() => void ask(s)} className="chip cursor-pointer hover:brightness-110 !text-xs !py-1.5">{s}</button>
                ))}
              </div>
            </div>
          ) : messages.map((m, i) => (
            <MessageBubble key={m.id || i} msg={m} onOpenSql={(s) => { setSql(s); setTab('workspace') }}
              onPin={(x) => void pin(x)} onFollowup={(q) => void ask(q)} busy={busy} />
          ))}
          {busy && (
            <div className="flex items-center gap-2 text-xs text-muted"><Spinner /><span>{t('ai.thinking')}</span></div>
          )}
          <div ref={bottom} />
        </div>

        {suggestions.length > 0 && messages.length > 0 && (
          <div className="px-4 pb-1 flex gap-1.5 overflow-x-auto">
            {suggestions.slice(0, 4).map((s) => (
              <button key={s} onClick={() => void ask(s)} className="chip chip-quiet whitespace-nowrap cursor-pointer hover:text-brand !py-1">{s}</button>
            ))}
          </div>
        )}
        <div className="p-3 border-t divider">
          <div className="flex items-end gap-2">
            <textarea
              className="field !py-2.5 resize-none"
              rows={2}
              value={question}
              placeholder={t('ai.placeholder')}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void ask(question) } }}
            />
            <button className="btn btn-primary h-[42px] !px-3.5" disabled={busy || !question.trim()} onClick={() => void ask(question)}>
              {busy ? <Spinner /> : <ArrowUp size={16} />}<span className="hide-mobile">{t('ai.send')}</span>
            </button>
          </div>
          <div className="text-[10px] text-muted mt-1.5 flex items-center gap-1"><Copy size={10} /> Enter ↵ {t('ai.send')} · Shift + Enter ↵ newline</div>
        </div>
      </div>
    </div>
  )
}
