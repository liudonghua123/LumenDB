import { AnimatePresence, motion } from 'framer-motion'
import {
  ChevronDown, Database, KeyRound, Languages, Menu, Monitor, Moon, Plug,
  Sparkles, Sun, X,
} from 'lucide-react'
import { useState } from 'react'
import { useI18n } from '../i18n'
import { useApp } from '../lib/store'
import { useTheme } from '../lib/theme'
import { IconButton, Modal, StatusDot } from './ui'

function Logo() {
  return (
    <div className="flex items-center gap-2.5 shrink-0">
      <div className="relative w-9 h-9 rounded-xl flex items-center justify-center shadow-glow"
        style={{ background: 'linear-gradient(135deg, rgb(var(--brand-rgb)), rgb(var(--accent-rgb)))' }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
          <ellipse cx="12" cy="6" rx="7.5" ry="3" stroke="white" strokeWidth="1.7" />
          <path d="M4.5 6v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6" stroke="white" strokeWidth="1.7" />
          <path d="M4.5 12v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6" stroke="white" strokeWidth="1.7" opacity=".85" />
        </svg>
      </div>
      <div className="leading-tight hidden sm:block">
        <div className="font-bold text-[15px] tracking-tight">Lumen<span className="text-brand">DB</span></div>
        <div className="text-[10px] text-muted hidden sm:block">AI-native DB workspace</div>
      </div>
    </div>
  )
}

export function TopBar() {
  const { t, lang, setLang } = useI18n()
  const { mode, resolved, setMode } = useTheme()
  const { connections, activeId, setActive, settings, llm, setTab, toast, setMobileNav, mobileNavOpen } = useApp()
  const [tokenOpen, setTokenOpen] = useState(false)
  const [tokenValue, setTokenValue] = useState(() => localStorage.getItem('lumendb.token') || '')
  const [connOpen, setConnOpen] = useState(false)
  const active = connections.find((c) => c.id === activeId)
  const ThemeIcon = mode === 'light' ? Sun : mode === 'dark' ? Moon : Monitor

  const cycleTheme = () => {
    // From "system", jump to the opposite theme so the first click is always visible.
    const next = mode === 'system' ? (resolved === 'dark' ? 'light' : 'dark')
      : mode === 'dark' ? 'light' : 'system'
    setMode(next)
    toast(`${t('top.theme')}: ${t(`theme.${next}`)}`, 'ok')
  }

  return (
    <>
      <header className="relative z-20 shrink-0 glass border-0 border-b divider px-3 sm:px-4 h-14 flex items-center gap-1.5 sm:gap-3">
        <IconButton className="md:hidden" onClick={() => setMobileNav(!mobileNavOpen)} title="Menu">
          {mobileNavOpen ? <X size={18} /> : <Menu size={18} />}
        </IconButton>
        <Logo />

        <div className="relative ml-1 sm:ml-3 min-w-0">
          <button onClick={() => setConnOpen(!connOpen)} className="btn btn-ghost !py-1.5 max-w-[120px] sm:max-w-[260px]">
            <Database size={14} className="text-brand shrink-0" />
            <span className="truncate">{active?.name || t('top.connection')}</span>
            <ChevronDown size={13} className="shrink-0 opacity-60" />
          </button>
          <AnimatePresence>
            {connOpen && (
              <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                className="card absolute left-0 top-11 w-64 p-1.5 z-40 max-h-72 overflow-y-auto">
                {connections.map((c) => (
                  <button key={c.id} onClick={() => { setActive(c.id); setConnOpen(false) }}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center gap-2 hover:bg-brand/10 ${c.id === activeId ? 'bg-brand/10 text-brand' : ''}`}>
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: c.color }} />
                    <span className="truncate flex-1">{c.name}</span>
                    <span className="text-[10px] text-muted uppercase">{c.dialect}</span>
                  </button>
                ))}
                <div className="border-t divider mt-1 pt-1">
                  <button onClick={() => { setTab('connections'); setConnOpen(false) }} className="w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-brand/10 text-brand">
                    + {t('conn.new')}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="flex-1" />

        <div className="!hidden lg:!flex items-center gap-1.5 chip chip-quiet !py-1" title="LLM engine">
          <Sparkles size={12} className="text-brand" />
          <span className="truncate max-w-[160px]">{llm?.provider || settings?.llm_provider || 'offline'}</span>
        </div>
        <button onClick={() => setTab('mcp')} className="!hidden sm:!inline-flex chip !py-1 cursor-pointer hover:brightness-110">
          <Plug size={12} /> MCP <span className="pulse-dot !w-1.5 !h-1.5 ml-0.5" />
        </button>

        <IconButton onClick={cycleTheme} title={`${t('top.theme')}: ${t(`theme.${mode}`)} (${resolved})`}>
          <ThemeIcon size={17} />
        </IconButton>
        <button onClick={() => setLang(lang === 'en' ? 'zh' : 'en')} className="btn btn-ghost !py-1.5 !px-2 text-xs font-semibold" title={t('top.language')}>
          <Languages size={14} className="hidden sm:block" />{lang === 'en' ? 'EN' : '中'}
        </button>
        <IconButton onClick={() => setTokenOpen(true)} title={t('top.token')}><KeyRound size={16} /></IconButton>
        <StatusDot ok={!!settings} />
      </header>

      <Modal open={tokenOpen} onClose={() => setTokenOpen(false)} title={t('top.token')}
        footer={<button className="btn btn-primary" onClick={() => {
          localStorage.setItem('lumendb.token', tokenValue.trim()); setTokenOpen(false); toast(t('common.saved'), 'ok')
        }}>{t('common.save')}</button>}>
        <p className="text-xs text-muted mb-3">Optional shared secret (<code className="mono">LUMEN_API_TOKEN</code>). Sent as <code className="mono">X-API-Token</code> with every request.</p>
        <input className="field mono" type="password" value={tokenValue} placeholder="(empty = no auth)" onChange={(e) => setTokenValue(e.target.value)} />
      </Modal>
    </>
  )
}
