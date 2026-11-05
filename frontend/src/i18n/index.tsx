import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type Lang = 'en' | 'zh'

const en: Record<string, string> = {
  'app.tagline': 'AI-native database workspace',
  'nav.workspace': 'SQL Workspace', 'nav.ai': 'AI Query', 'nav.dashboards': 'Dashboards',
  'nav.history': 'History', 'nav.connections': 'Connections', 'nav.mcp': 'MCP Server',
  'common.run': 'Run', 'common.running': 'Running…', 'common.refresh': 'Refresh', 'common.save': 'Save',
  'common.saved': 'Saved', 'common.delete': 'Delete', 'common.edit': 'Edit', 'common.cancel': 'Cancel',
  'common.confirm': 'Confirm', 'common.create': 'Create', 'common.test': 'Test', 'common.copy': 'Copy',
  'common.copied': 'Copied', 'common.close': 'Close', 'common.search': 'Search', 'common.export': 'Export',
  'common.add': 'Add', 'common.name': 'Name', 'common.type': 'Type', 'common.rows': 'rows',
  'common.empty': 'Nothing here yet', 'common.loading': 'Loading…', 'common.all': 'All',
  'common.sql': 'SQL', 'common.chart': 'Chart', 'common.plan': 'Explain', 'common.data': 'Data',
  'common.schema': 'Schema', 'common.preview': 'Preview', 'common.limit': 'Limit',
  'common.yes': 'Yes', 'common.no': 'No', 'common.error': 'Error', 'common.success': 'Success',
  'common.actions': 'Actions', 'common.back': 'Back', 'common.new': 'New', 'common.open': 'Open',
  'top.connection': 'Connection', 'top.online': 'Online', 'top.offline': 'Offline',
  'top.theme': 'Theme', 'top.language': 'Language', 'top.mcp': 'MCP', 'top.token': 'API Token',
  'side.connections': 'Connections', 'side.objects': 'Database objects', 'side.tables': 'Tables',
  'side.views': 'Views', 'side.saved': 'Saved queries', 'side.noTables': 'No tables found',
  'side.erd': 'ER diagram', 'side.schemaContext': 'Schema context',
  'work.title': 'SQL Workspace', 'work.placeholder': '-- Write SQL here, then press Ctrl/⌘ + Enter\nSELECT * FROM customers LIMIT 20;',
  'work.execute': 'Execute', 'work.explain': 'Explain', 'work.format': 'Format', 'work.saveQuery': 'Save query',
  'work.exportCsv': 'CSV', 'work.exportJson': 'JSON', 'work.exportSql': 'SQL',
  'work.result': 'Result', 'work.noResult': 'Run a query to see results, charts and query plans.',
  'work.duration': 'Duration', 'work.truncated': 'Result truncated by row limit',
  'work.writeWarnTitle': 'Write statement detected', 'work.writeWarn': 'This statement modifies data. Confirm to execute it explicitly.',
  'work.readOnlyHint': 'Read-only mode', 'work.multiHint': 'Multi-statement',
  'work.chartHint': 'Auto chart recommendations', 'work.explainHint': 'Query plan',
  'work.affected': 'affected rows', 'work.statementType': 'statement',
  'ai.title': 'AI Query', 'ai.subtitle': 'Ask questions in natural language. SQL is generated from your live schema, executed, explained and charted.',
  'ai.placeholder': 'Ask a question about your data…', 'ai.send': 'Ask', 'ai.thinking': 'Thinking…',
  'ai.newChat': 'New chat', 'ai.sessions': 'Conversations', 'ai.suggestions': 'Try asking',
  'ai.engine': 'Engine', 'ai.sql': 'Generated SQL', 'ai.answer': 'Answer', 'ai.followups': 'Follow-ups',
  'ai.addToDashboard': 'Pin to dashboard', 'ai.pinned': 'Pinned', 'ai.openInEditor': 'Open in editor',
  'ai.noMessages': 'Start with a question, or pick one below.', 'ai.autoRun': 'Auto execute',
  'ai.emptyQuestion': 'Please enter a question', 'ai.copySql': 'Copy SQL',
  'dash.title': 'Dashboards', 'dash.subtitle': 'Live charts backed by saved SQL queries.',
  'dash.new': 'New dashboard', 'dash.addCard': 'Add card', 'dash.deleteCard': 'Remove card',
  'dash.refreshAll': 'Refresh all', 'dash.noBoards': 'No dashboards yet. Create one to start.',
  'dash.cardTitle': 'Card title', 'dash.cardSql': 'Card SQL', 'dash.chartType': 'Chart type',
  'dash.pickChart': 'Visualization', 'dash.emptyCards': 'No cards yet. Pin a chart from AI Query or add one manually.',
  'hist.title': 'Query history', 'hist.subtitle': 'Every executed statement is recorded locally.',
  'hist.clear': 'Clear history', 'hist.status': 'Status', 'hist.time': 'Time', 'hist.sql': 'Statement',
  'hist.empty': 'No queries executed yet.', 'hist.open': 'Open in editor',
  'conn.title': 'Connections', 'conn.subtitle': 'Manage SQLite, PostgreSQL and MySQL connections.',
  'conn.new': 'New connection', 'conn.edit': 'Edit connection', 'conn.dialect': 'Dialect',
  'conn.host': 'Host', 'conn.port': 'Port', 'conn.database': 'Database / file', 'conn.user': 'User',
  'conn.password': 'Password', 'conn.readonly': 'Read-only', 'conn.color': 'Accent colour',
  'conn.test': 'Test connection', 'conn.testOk': 'Connection successful', 'conn.testFail': 'Connection failed',
  'conn.deleteConfirm': 'Delete this connection?', 'conn.empty': 'No connections configured.',
  'conn.semantics': 'Business glossary (optional JSON)', 'conn.defaultDb': 'Leave empty to use the built-in demo database',
  'mcp.title': 'MCP Server', 'mcp.subtitle': 'Expose your databases to Claude, Cursor and any MCP client over Streamable HTTP.',
  'mcp.endpoint': 'Endpoint', 'mcp.transport': 'Transport', 'mcp.tools': 'Tools', 'mcp.resources': 'Resources',
  'mcp.clientConfig': 'Client configuration', 'mcp.copyConfig': 'Copy config', 'mcp.safety': 'Safety',
  'mcp.safetyText': 'The MCP endpoint is read-only by default: write/DDL statements are refused, results are capped, and credentials are never exposed. Set LUMEN_API_TOKEN to require authentication.',
  'mcp.probe': 'Probe with curl', 'mcp.readOnly': 'Read-only by default',
  'theme.light': 'Light', 'theme.dark': 'Dark', 'theme.system': 'System',
  'toast.savedQuery': 'Query saved', 'toast.dashboardSaved': 'Dashboard saved',
  'toast.needConnection': 'Select a connection first', 'toast.copied': 'Copied to clipboard',
  'toast.writeDone': 'Statement executed', 'toast.errored': 'Something went wrong',
  'chart.bar': 'Bar', 'chart.line': 'Line', 'chart.area': 'Area', 'chart.pie': 'Pie',
  'chart.scatter': 'Scatter', 'chart.metric': 'Metric', 'chart.table': 'Table',
  'grid.copyHint': 'Double-click a cell to copy its value',
}

const zh: Record<string, string> = {
  'app.tagline': 'AI 原生数据库工作台',
  'nav.workspace': 'SQL 工作台', 'nav.ai': 'AI 问数', 'nav.dashboards': '数据看板',
  'nav.history': '查询历史', 'nav.connections': '连接管理', 'nav.mcp': 'MCP 服务',
  'common.run': '运行', 'common.running': '运行中…', 'common.refresh': '刷新', 'common.save': '保存',
  'common.saved': '已保存', 'common.delete': '删除', 'common.edit': '编辑', 'common.cancel': '取消',
  'common.confirm': '确认', 'common.create': '创建', 'common.test': '测试', 'common.copy': '复制',
  'common.copied': '已复制', 'common.close': '关闭', 'common.search': '搜索', 'common.export': '导出',
  'common.add': '添加', 'common.name': '名称', 'common.type': '类型', 'common.rows': '行',
  'common.empty': '暂无内容', 'common.loading': '加载中…', 'common.all': '全部',
  'common.sql': 'SQL', 'common.chart': '图表', 'common.plan': '执行计划', 'common.data': '数据',
  'common.schema': '结构', 'common.preview': '数据预览', 'common.limit': '行数上限',
  'common.yes': '是', 'common.no': '否', 'common.error': '错误', 'common.success': '成功',
  'common.actions': '操作', 'common.back': '返回', 'common.new': '新建', 'common.open': '打开',
  'top.connection': '连接', 'top.online': '在线', 'top.offline': '离线',
  'top.theme': '主题', 'top.language': '语言', 'top.mcp': 'MCP', 'top.token': '访问令牌',
  'side.connections': '数据库连接', 'side.objects': '数据库对象', 'side.tables': '数据表',
  'side.views': '视图', 'side.saved': '收藏查询', 'side.noTables': '未找到数据表',
  'side.erd': 'ER 关系图', 'side.schemaContext': 'Schema 上下文',
  'work.title': 'SQL 工作台', 'work.placeholder': '-- 在此编写 SQL，按 Ctrl/⌘ + Enter 执行\nSELECT * FROM customers LIMIT 20;',
  'work.execute': '执行', 'work.explain': '解释', 'work.format': '格式化', 'work.saveQuery': '收藏查询',
  'work.exportCsv': 'CSV', 'work.exportJson': 'JSON', 'work.exportSql': 'SQL',
  'work.result': '查询结果', 'work.noResult': '执行查询后，这里会显示结果、图表与执行计划。',
  'work.duration': '耗时', 'work.truncated': '结果已按行数上限截断',
  'work.writeWarnTitle': '检测到写操作', 'work.writeWarn': '该语句会修改数据，请明确确认后执行。',
  'work.readOnlyHint': '只读模式', 'work.multiHint': '多语句',
  'work.chartHint': '自动图表推荐', 'work.explainHint': '执行计划',
  'work.affected': '受影响行数', 'work.statementType': '语句类型',
  'ai.title': 'AI 问数', 'ai.subtitle': '用自然语言提问：基于实时 Schema 生成 SQL、执行查询、解读结果并推荐图表。',
  'ai.placeholder': '用自然语言问一个数据问题…', 'ai.send': '提问', 'ai.thinking': '思考中…',
  'ai.newChat': '新建会话', 'ai.sessions': '历史会话', 'ai.suggestions': '试试这样问',
  'ai.engine': '引擎', 'ai.sql': '生成的 SQL', 'ai.answer': '解读', 'ai.followups': '继续追问',
  'ai.addToDashboard': '固定到看板', 'ai.pinned': '已固定', 'ai.openInEditor': '在编辑器打开',
  'ai.noMessages': '输入一个问题，或从下方示例开始。', 'ai.autoRun': '自动执行',
  'ai.emptyQuestion': '请输入问题', 'ai.copySql': '复制 SQL',
  'dash.title': '数据看板', 'dash.subtitle': '由已保存 SQL 驱动的实时图表。',
  'dash.new': '新建看板', 'dash.addCard': '添加卡片', 'dash.deleteCard': '移除卡片',
  'dash.refreshAll': '刷新全部', 'dash.noBoards': '还没有看板，创建一个吧。',
  'dash.cardTitle': '卡片标题', 'dash.cardSql': '卡片 SQL', 'dash.chartType': '图表类型',
  'dash.pickChart': '可视化', 'dash.emptyCards': '暂无卡片，可从 AI 问数固定图表或手动添加。',
  'hist.title': '查询历史', 'hist.subtitle': '所有执行过的语句都记录在本地。',
  'hist.clear': '清空历史', 'hist.status': '状态', 'hist.time': '时间', 'hist.sql': '语句',
  'hist.empty': '还没有执行过查询。', 'hist.open': '在编辑器打开',
  'conn.title': '连接管理', 'conn.subtitle': '管理 SQLite、PostgreSQL 与 MySQL 连接。',
  'conn.new': '新建连接', 'conn.edit': '编辑连接', 'conn.dialect': '数据库类型',
  'conn.host': '主机', 'conn.port': '端口', 'conn.database': '数据库 / 文件路径', 'conn.user': '用户名',
  'conn.password': '密码', 'conn.readonly': '只读', 'conn.color': '主题色',
  'conn.test': '测试连接', 'conn.testOk': '连接成功', 'conn.testFail': '连接失败',
  'conn.deleteConfirm': '确定删除这个连接吗？', 'conn.empty': '尚未配置连接。',
  'conn.semantics': '业务词典（可选 JSON）', 'conn.defaultDb': '留空则使用内置演示数据库',
  'mcp.title': 'MCP 服务', 'mcp.subtitle': '通过 Streamable HTTP 把数据库开放给 Claude、Cursor 及任意 MCP 客户端。',
  'mcp.endpoint': '服务端点', 'mcp.transport': '传输协议', 'mcp.tools': '工具', 'mcp.resources': '资源',
  'mcp.clientConfig': '客户端配置', 'mcp.copyConfig': '复制配置', 'mcp.safety': '安全说明',
  'mcp.safetyText': 'MCP 端点默认只读：写 / DDL 语句会被拒绝，结果行数受限，凭据永不外泄。生产环境请设置 LUMEN_API_TOKEN 开启鉴权。',
  'mcp.probe': 'curl 探测', 'mcp.readOnly': '默认只读',
  'theme.light': '浅色', 'theme.dark': '深色', 'theme.system': '跟随系统',
  'toast.savedQuery': '查询已收藏', 'toast.dashboardSaved': '看板已保存',
  'toast.needConnection': '请先选择连接', 'toast.copied': '已复制到剪贴板',
  'toast.writeDone': '语句已执行', 'toast.errored': '操作失败',
  'chart.bar': '柱状图', 'chart.line': '折线图', 'chart.area': '面积图', 'chart.pie': '饼图',
  'chart.scatter': '散点图', 'chart.metric': '指标卡', 'chart.table': '表格',
  'grid.copyHint': '双击单元格可复制值',
}

export const dictionaries: Record<Lang, Record<string, string>> = { en, zh }

interface I18nValue {
  lang: Lang
  setLang: (l: Lang) => void
  t: (key: string, vars?: Record<string, string | number>) => string
}

const I18nContext = createContext<I18nValue>({ lang: 'en', setLang: () => {}, t: (k) => k })

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const urlLang = new URLSearchParams(window.location.search).get('lang')
    if (urlLang === 'en' || urlLang === 'zh') return urlLang
    const saved = localStorage.getItem('lumendb.lang')
    if (saved === 'en' || saved === 'zh') return saved
    return 'en'  // 默认英文；顶部栏可切换，URL ?lang=zh 可覆盖
  })
  const setLang = (l: Lang) => {
    localStorage.setItem('lumendb.lang', l)
    setLangState(l)
    document.documentElement.lang = l === 'zh' ? 'zh-CN' : 'en'
  }
  useEffect(() => { document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en' }, [lang])
  const value = useMemo<I18nValue>(() => ({
    lang,
    setLang,
    t: (key, vars) => {
      let text = dictionaries[lang][key] ?? dictionaries.en[key] ?? key
      if (vars) for (const [k, v] of Object.entries(vars)) text = text.replace(`{${k}}`, String(v))
      return text
    },
  }), [lang])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export const useI18n = () => useContext(I18nContext)
