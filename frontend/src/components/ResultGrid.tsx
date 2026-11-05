import { ArrowDown, ArrowUp, Table2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { QueryResult } from '../lib/api'
import { Empty } from './ui'
import { useI18n } from '../i18n'
import { useApp } from '../lib/store'

type Cell = string | number | boolean | null

function renderCell(v: Cell, type: string) {
  if (v === null || v === undefined) return <span className="cell-null">NULL</span>
  if (typeof v === 'number') return <span className="cell-number">{Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>
  if (typeof v === 'boolean') return <span className="chip chip-quiet !py-0 !px-1.5 text-[10px]">{String(v)}</span>
  const s = String(v)
  if (type === 'date') return <span className="cell-date">{s}</span>
  if (s.length > 120) return <span title={s}>{s.slice(0, 120)}…</span>
  return <span>{s}</span>
}

export function ResultGrid({ result, maxHeight = '100%' }: { result: QueryResult; maxHeight?: string }) {
  const { t } = useI18n()
  const toast = useApp((s) => s.toast)
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null)
  const copyCell = async (v: Cell) => {
    try {
      await navigator.clipboard.writeText(v === null || v === undefined ? '' : String(v))
      toast(t('common.copied'), 'ok')
    } catch { toast(t('common.error'), 'error') }
  }
  const rows = useMemo(() => {
    if (!sort) return result.rows
    const copy = [...result.rows]
    copy.sort((a, b) => {
      const x = a[sort.col], y = b[sort.col]
      if (x === null) return 1
      if (y === null) return -1
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * sort.dir
      return String(x).localeCompare(String(y), 'zh-CN') * sort.dir
    })
    return copy
  }, [result.rows, sort])

  if (!result.rows.length) {
    return <Empty icon={<Table2 size={20} />} title={t('common.empty')} hint={result.error || undefined} />
  }

  const toggleSort = (col: number) => setSort((s) => s?.col === col ? (s.dir === 1 ? { col, dir: -1 } : null) : { col, dir: 1 })

  return (
    <div className="w-full h-full overflow-auto" style={{ maxHeight }}>
      <table className="grid-table">
        <thead>
          <tr>
            <th className="w-10 text-right text-[10px]">#</th>
            {result.columns.map((col, i) => (
              <th key={`${col}-${i}`} onClick={() => toggleSort(i)} className="cursor-pointer select-none group">
                <span className="inline-flex items-center gap-1">
                  {col}
                  <span className="text-[9px] text-muted/70 mono">{result.column_types?.[i] === 'number' ? '123' : result.column_types?.[i] === 'date' ? 'date' : 'Aa'}</span>
                  {sort?.col === i ? (sort.dir === 1 ? <ArrowUp size={11} className="text-brand" /> : <ArrowDown size={11} className="text-brand" />)
                    : <ArrowDown size={11} className="opacity-0 group-hover:opacity-40" />}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              <td className="text-right text-[10px] text-muted mono">{ri + 1}</td>
              {result.columns.map((_, ci) => (
                <td key={ci} title={`${row[ci] === null ? 'NULL' : String(row[ci] ?? '')} · ${t('grid.copyHint')}`}
                  onDoubleClick={() => void copyCell(row[ci] as Cell)}>
                  {renderCell(row[ci] as Cell, result.column_types?.[ci] || 'text')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
