import { sql, SQLite, PostgreSQL, MySQL } from '@codemirror/lang-sql'
import { EditorView } from '@codemirror/view'
import CodeMirror from '@uiw/react-codemirror'
import { useMemo } from 'react'
import type { Connection } from '../lib/api'
import { useTheme } from '../lib/theme'

const dialectMap = {
  sqlite: SQLite,
  postgresql: PostgreSQL,
  mysql: MySQL,
}

export function SqlEditor({ value, onChange, onRun, connection }: {
  value: string
  onChange: (v: string) => void
  onRun: () => void
  connection?: Connection
}) {
  const { resolved } = useTheme()
  const extensions = useMemo(() => {
    const theme = EditorView.theme({
      '&': { color: 'rgb(var(--ink-rgb))', backgroundColor: 'transparent' },
      '.cm-content': { caretColor: 'rgb(var(--brand-rgb))' },
      '.cm-cursor': { borderLeftColor: 'rgb(var(--brand-rgb))' },
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
        backgroundColor: 'rgb(var(--brand-rgb) / .22)',
      },
      '.cm-gutters': { backgroundColor: 'transparent', color: 'rgb(var(--muted-rgb))', border: 'none' },
      '.cm-activeLine': { backgroundColor: 'rgb(var(--brand-rgb) / .06)' },
      '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'rgb(var(--brand-rgb))' },
      '.cm-line': { padding: '0 8px' },
    }, { dark: resolved === 'dark' })
    return [sql({ dialect: dialectMap[connection?.dialect || 'sqlite'] || SQLite }), theme, EditorView.lineWrapping]
  }, [connection?.dialect, resolved])

  return (
    <div className="h-full w-full overflow-hidden" onKeyDownCapture={(e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); onRun() }
    }}>
      <CodeMirror
        value={value}
        height="100%"
        onChange={onChange}
        extensions={extensions}
        theme={resolved === 'dark' ? 'dark' : 'light'}
        basicSetup={{ foldGutter: false, highlightActiveLine: true, autocompletion: true, bracketMatching: true }}
        className="h-full text-[13px]"
      />
    </div>
  )
}

/** Lightweight SQL pretty-printer (keyword casing + sensible line breaks). */
export function formatSql(input: string): string {
  const keywords = ['LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'UNION ALL', 'GROUP BY', 'ORDER BY', 'INSERT INTO', 'DELETE FROM', 'SELECT', 'FROM', 'WHERE', 'HAVING', 'LIMIT', 'OFFSET', 'JOIN', 'ON', 'AS', 'AND', 'OR', 'VALUES', 'UPDATE', 'SET', 'WITH', 'UNION']
  let out = input.replace(/\s+/g, ' ').trim()
  for (const kw of keywords) {
    const re = new RegExp(`\\b${kw.replace(/ /g, '\\s+')}\\b`, 'gi')
    out = out.replace(re, `\n${kw}`)
  }
  return out.split('\n').map((l) => l.trim()).filter(Boolean).join('\n').replace(/^\n/, '')
}
