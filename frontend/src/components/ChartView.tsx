import ReactECharts from 'echarts-for-react'
import type { EChartsOption } from 'echarts'
import { BarChart3 } from 'lucide-react'
import { useMemo } from 'react'
import type { ChartSpec, QueryResult } from '../lib/api'
import { useTheme } from '../lib/theme'
import { Empty } from './ui'
import { useI18n } from '../i18n'

const PALETTE = ['#6366f1', '#22d3ee', '#f472b6', '#34d399', '#fbbf24', '#a78bfa', '#fb7185', '#60a5fa']

function resolveData(chart: ChartSpec, result: QueryResult | null) {
  const xIdx = result ? Math.max(0, result.columns.indexOf(chart.x)) : 0
  const categories: string[] = (chart.options?.categories?.length
    ? chart.options.categories
    : result?.rows.map((r) => String(r[xIdx] ?? '')) || []).map(String)
  const series = chart.y.map((name, i) => {
    const cached = chart.series?.find((s) => s.name === name)?.data
    if (cached?.length) return { name, data: cached }
    const idx = result ? result.columns.indexOf(name) : -1
    const data = idx >= 0 && result
      ? result.rows.map((r) => { const v = r[idx]; return typeof v === 'number' ? v : Number(v) || 0 })
      : []
    return { name, data }
  })
  return { categories, series }
}

export function ChartView({ chart, result, height = 300 }: { chart: ChartSpec; result: QueryResult | null; height?: number }) {
  const { resolved } = useTheme()
  const { t } = useI18n()
  const axisColor = resolved === 'dark' ? '#94a3b8' : '#64748b'
  const splitColor = resolved === 'dark' ? 'rgba(148,163,184,.14)' : 'rgba(100,116,139,.14)'
  const { categories, series } = useMemo(() => resolveData(chart, result), [chart, result])

  if (!result || !result.rows.length) return <Empty icon={<BarChart3 size={20} />} title={t('common.empty')} />

  if (chart.type === 'metric') {
    const value = chart.options?.value ?? series[0]?.data?.[0] ?? result.rows[0]?.[0]
    const label = chart.y[0] || result.columns[0]
    const numeric = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''))
    const display = Number.isFinite(numeric)
      ? numeric.toLocaleString(undefined, { maximumFractionDigits: 2 })
      : String(value ?? '—')
    return (
      <div className="h-full min-h-[180px] flex flex-col items-center justify-center gap-2">
        <div className="text-[11px] uppercase tracking-widest text-muted">{chart.title || label}</div>
        <div className="text-4xl sm:text-5xl font-bold tracking-tight bg-clip-text text-transparent"
          style={{ backgroundImage: 'linear-gradient(120deg, rgb(var(--brand-rgb)), rgb(var(--accent-rgb)))' }}>{display}</div>
        <div className="text-xs text-muted mono">{label}</div>
      </div>
    )
  }

  if (chart.type === 'table') return <Empty icon={<BarChart3 size={20} />} title={t('common.data')} hint={chart.reason} />

  const horizontal = !!chart.options?.horizontal && chart.type === 'bar'
  const base = {
    backgroundColor: 'transparent',
    color: PALETTE,
    animationDuration: 520,
    tooltip: { trigger: chart.type === 'pie' ? 'item' : 'axis', backgroundColor: resolved === 'dark' ? '#1e263c' : '#fff', borderWidth: 0, textStyle: { color: resolved === 'dark' ? '#e7edff' : '#161e36', fontSize: 12 } },
    legend: { top: 2, textStyle: { color: axisColor, fontSize: 11 }, show: series.length > 1 || chart.type === 'pie' },
  }

  let option: Record<string, unknown>
  if (chart.type === 'pie') {
    option = {
      ...base,
      series: [{
        type: 'pie', radius: ['40%', '68%'], center: ['50%', '54%'],
        avoidLabelOverlap: true, itemStyle: { borderRadius: 6, borderColor: 'transparent', borderWidth: 2 },
        label: { color: axisColor, fontSize: 11 },
        data: categories.map((c, i) => ({ name: c, value: series[0]?.data[i] ?? 0 })),
      }],
    }
  } else if (chart.type === 'scatter') {
    const xName = chart.x, yName = chart.y[0]
    const xi = result.columns.indexOf(xName), yi = result.columns.indexOf(yName)
    option = {
      ...base,
      grid: { left: 50, right: 24, top: 36, bottom: 42, containLabel: true },
      xAxis: { type: 'value', name: xName, nameTextStyle: { color: axisColor }, axisLabel: { color: axisColor }, splitLine: { lineStyle: { color: splitColor } } },
      yAxis: { type: 'value', name: yName, nameTextStyle: { color: axisColor }, axisLabel: { color: axisColor }, splitLine: { lineStyle: { color: splitColor } } },
      tooltip: { ...base.tooltip, trigger: 'item' },
      series: [{ type: 'scatter', symbolSize: 11, data: result.rows.map((r) => [Number(r[xi]) || 0, Number(r[yi]) || 0]) }],
    }
  } else {
    const kind = chart.type === 'area' ? 'line' : chart.type
    option = {
      ...base,
      grid: { left: 24, right: 24, top: 36, bottom: 24, containLabel: true },
      xAxis: {
        type: horizontal ? 'value' : 'category',
        data: horizontal ? undefined : categories,
        axisLabel: { color: axisColor, fontSize: 10, rotate: !horizontal && categories.length > 8 ? 32 : 0, hideOverlap: true },
        axisLine: { lineStyle: { color: splitColor } }, splitLine: { show: false },
      },
      yAxis: {
        type: horizontal ? 'category' : 'value',
        data: horizontal ? categories : undefined,
        axisLabel: { color: axisColor, fontSize: 10 },
        splitLine: { lineStyle: { color: splitColor } },
      },
      series: series.map((s, i) => ({
        name: s.name, type: kind, data: s.data, smooth: kind === 'line',
        barMaxWidth: 34, itemStyle: { borderRadius: kind === 'bar' ? [5, 5, 0, 0] : 0, color: PALETTE[i % PALETTE.length] },
        areaStyle: chart.type === 'area' ? { opacity: .18 } : undefined,
        lineStyle: kind === 'line' ? { width: 2.5 } : undefined,
        symbolSize: 6,
      })),
    }
  }

  return (
    <ReactECharts
      option={option as EChartsOption}
      notMerge
      lazyUpdate
      opts={{ renderer: 'svg' }}
      style={{ height, width: '100%' }}
      className="fade-in"
    />
  )
}
