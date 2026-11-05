import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type ThemeMode = 'light' | 'dark' | 'system'

interface ThemeValue { mode: ThemeMode; resolved: 'light' | 'dark'; setMode: (m: ThemeMode) => void }
const ThemeContext = createContext<ThemeValue>({ mode: 'system', resolved: 'light', setMode: () => {} })

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem('lumendb.theme')
    return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system'
  })
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const resolved: 'light' | 'dark' = mode === 'system' ? (systemDark ? 'dark' : 'light') : mode
  useEffect(() => {
    document.documentElement.dataset.theme = resolved
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', resolved === 'dark' ? '#0a0e1c' : '#eef2ff')
  }, [resolved])

  const setMode = (m: ThemeMode) => { localStorage.setItem('lumendb.theme', m); setModeState(m) }
  const value = useMemo(() => ({ mode, resolved, setMode }), [mode, resolved])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export const useTheme = () => useContext(ThemeContext)
