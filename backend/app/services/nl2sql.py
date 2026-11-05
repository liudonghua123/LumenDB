"""Offline, schema-aware NL2SQL rule engine.

No API key, no network, no data leaves the machine. The engine builds a weighted
schema index (table/column names + optional Chinese business glossary + sampled
categorical values), detects the aggregation intent, resolves JOIN paths through
the foreign-key graph and emits a single read-only SELECT. It is deterministic so
the demo works offline; configure an OpenAI-compatible LLM for production-grade
natural language coverage.
"""
from __future__ import annotations

import re
from collections import deque
from dataclasses import dataclass, field

from ..db.engine import DatabaseDriver


@dataclass
class Col:
    table: str
    name: str
    type: str
    label: str = ""
    pk: bool = False
    number: bool = False
    date: bool = False
    terms: list[str] = field(default_factory=list)
    values: list[str] = field(default_factory=list)


@dataclass
class SchemaIndex:
    dialect: str
    tables: list[str] = field(default_factory=list)
    table_labels: dict[str, str] = field(default_factory=dict)
    columns: dict[str, list[Col]] = field(default_factory=dict)
    edges: dict[str, list[tuple[str, str]]] = field(default_factory=dict)  # table -> [(other, condition)]

    def all_columns(self) -> list[Col]:
        return [c for cols in self.columns.values() for c in cols]


NUMBER_RE = re.compile(r"INT|DECIMAL|NUMERIC|REAL|FLOAT|DOUBLE|MONEY|SERIAL|NUMBER|BIGINT|SMALLINT", re.IGNORECASE)
DATE_RE = re.compile(r"DATE|TIME|TIMESTAMP|YEAR|MONTH|日期|时间|月份", re.IGNORECASE)
SEPARATORS = re.compile(r"[/、,，|]|\s+")
GROUP_WORDS = re.compile(r"每个|各|按|分组|分布|分别|每种|各类|group by|\bper\b|\bby\b", re.IGNORECASE)
TOTAL_WORDS = re.compile(r"总|合计|整体|一共|是多少|多少|overall|\btotal\b", re.IGNORECASE)


def _terms(*parts: str) -> list[str]:
    out: list[str] = []
    for part in parts:
        if not part:
            continue
        for piece in SEPARATORS.split(str(part)):
            piece = piece.strip().lower()
            if len(piece) >= 2:
                out.append(piece)
    return list(dict.fromkeys(out))


def build_index(driver: DatabaseDriver) -> SchemaIndex:
    idx = SchemaIndex(dialect=driver.dialect)
    semantics = driver._semantics()
    idx.table_labels = semantics.get("tables", {})
    col_labels = semantics.get("columns", {})
    tables = [t for t in driver.list_tables() if t["type"] == "table"]
    idx.tables = [t["name"] for t in tables]
    # Sampling distinct values only for small local schemas keeps remote DBs fast.
    sample_values = driver.dialect == "sqlite" and len(tables) <= 20
    for t in tables:
        name = t["name"]
        try:
            desc = driver.describe_table(name)
        except Exception:
            continue
        cols: list[Col] = []
        for c in desc["columns"]:
            label = col_labels.get(f"{name}.{c['name']}", "")
            ctype = c["type"]
            number = bool(NUMBER_RE.search(ctype)) and not c["primary_key"]
            is_date = bool(DATE_RE.search(ctype)) or bool(DATE_RE.search(c["name"])) or "日期" in label or "月份" in label
            values: list[str] = []
            if sample_values and not number and not is_date and not c["primary_key"]:
                try:
                    raw = driver.execute_raw(
                        f'SELECT DISTINCT "{c["name"]}" FROM "{name}" WHERE "{c["name"]}" IS NOT NULL LIMIT 20', 20
                    )
                    values = [str(v[0]) for v in raw["rows"] if v and v[0] is not None and len(str(v[0])) >= 2]
                except Exception:
                    values = []
            cols.append(
                Col(
                    table=name,
                    name=c["name"],
                    type=ctype,
                    label=label,
                    pk=c["primary_key"],
                    number=number,
                    date=is_date and not number,
                    terms=_terms(c["name"], label, f"{name}.{c['name']}"),
                    values=values,
                )
            )
        idx.columns[name] = cols
        for fk in desc["foreign_keys"]:
            other = fk["referred_table"]
            if not other or not fk["columns"] or not fk["referred_columns"] or other not in idx.tables:
                continue
            cond = f"{other}.{fk['referred_columns'][0]} = {name}.{fk['columns'][0]}"
            idx.edges.setdefault(name, []).append((other, cond))
            idx.edges.setdefault(other, []).append((name, cond))
    return idx


def _score(question: str, terms: list[str]) -> float:
    """Term matching with de-duplicated Chinese bigram fallback ('商品' matches '商品名称')."""
    q = question.lower()
    score = 0.0
    bigram_hits: set[str] = set()
    for term in terms:
        if term in q:
            score += len(term) * 1.0
        elif re.search(r"[\u4e00-\u9fff]", term) and len(term) > 2:
            for i in range(len(term) - 1):
                b = term[i : i + 2]
                if len(b.strip()) == 2 and b in q:
                    bigram_hits.add(b)
    return score + 1.3 * len(bigram_hits)


def _table_score(idx: SchemaIndex, table: str, question: str) -> float:
    score = _score(question, _terms(table, idx.table_labels.get(table, "")))
    score += 0.25 * sum(_score(question, c.terms) for c in idx.columns.get(table, []))
    return score


def _find_path(idx: SchemaIndex, start: str, target: str) -> list[tuple[str, str]] | None:
    """BFS over FK graph: returns [(joined_table, condition), ...]."""
    if start == target:
        return []
    queue = deque([(start, [])])
    seen = {start}
    while queue:
        node, path = queue.popleft()
        for other, cond in idx.edges.get(node, []):
            if other in seen:
                continue
            new_path = [*path, (other, cond)]
            if other == target:
                return new_path
            if len(new_path) < 3:
                seen.add(other)
                queue.append((other, new_path))
    return None


@dataclass
class Intent:
    agg: str = "count"          # count | sum | avg | max | min | list
    limit: int = 20
    ranked: bool = False
    monthly: bool = False
    months: int | None = None
    this_year: bool = False
    this_month: bool = False
    list_mode: bool = False


def parse_intent(question: str) -> Intent:
    q = question.lower()
    it = Intent()
    # Remove time ranges before looking for a Top-N number ('最近 3 个月' != '前 3 名')
    q_no_time = re.sub(r"(最近|过去|近|last|past)\s*\d+\s*(个)?\s*(月|天|年|周)", " ", q)
    m = re.search(r"(?:前\s*|排名前\s*|top\s*)(\d+)|(\d+)\s*(?:个|名|条|位)", q_no_time)
    if m:
        it.limit = min(int(m.group(1) or m.group(2)), 100)
        it.ranked = True
    if re.search(r"最多|最高|最大|前\s*\d|top\s*\d|排名|最少|最低", q):
        it.ranked = True
        if not m:
            it.limit = 10
    if re.search(r"平均|均值|average|avg\b", q):
        it.agg = "avg"
    elif re.search(r"总额|总和|求和|销售额|营收|金额|合计|销量|总计|sum\b|revenue|total|gmv", q):
        it.agg = "sum"
    elif re.search(r"最高|最大|maximum|max\b", q):
        it.agg = "max"
    elif re.search(r"最低|最小|minimum|min\b", q):
        it.agg = "min"
    elif re.search(r"多少|数量|几个|计数|分布|count\b|how many", q):
        it.agg = "count"
    elif re.search(r"列出|明细|显示|查看|所有|清单|list\b|show\b", q):
        it.agg = "list"
        it.list_mode = True
    if re.search(r"按月|每月|月份|月度|趋势|走势|变化|trend|monthly|by month", q):
        it.monthly = True
        it.ranked = False
        if it.agg == "count":
            it.agg = "sum"
    m = re.search(r"最近\s*(\d+)\s*个?月|last\s+(\d+)\s+months?", q)
    if m:
        it.months = int(m.group(1) or m.group(2))
    if re.search(r"今年|本年|this year", q):
        it.this_year = True
    if re.search(r"本月|当月|this month", q):
        it.this_month = True
    return it


def _date_expr(idx: SchemaIndex, alias: str, col: Col) -> str:
    if idx.dialect == "postgresql":
        return f"to_char({alias}.{col.name}::date, 'YYYY-MM')"
    if idx.dialect == "mysql":
        return f"DATE_FORMAT({alias}.{col.name}, '%Y-%m')"
    return f"substr({alias}.{col.name}, 1, 7)"


def _date_filter(idx: SchemaIndex, alias: str, col: Col, it: Intent) -> str | None:
    ref = f"{alias}.{col.name}"
    if idx.dialect == "postgresql":
        if it.months:
            return f"{ref} >= CURRENT_DATE - INTERVAL '{it.months} months'"
        if it.this_year:
            return f"{ref} >= DATE_TRUNC('year', CURRENT_DATE)"
        if it.this_month:
            return f"{ref} >= DATE_TRUNC('month', CURRENT_DATE)"
    elif idx.dialect == "mysql":
        if it.months:
            return f"{ref} >= DATE_SUB(CURDATE(), INTERVAL {it.months} MONTH)"
        if it.this_year:
            return f"{ref} >= MAKEDATE(YEAR(CURDATE()), 1)"
        if it.this_month:
            return f"{ref} >= DATE_FORMAT(CURDATE(), '%Y-%m-01')"
    else:
        if it.months:
            return f"{ref} >= date('now', '-{it.months} months')"
        if it.this_year:
            return f"{ref} >= date('now', 'start of year')"
        if it.this_month:
            return f"{ref} >= date('now', 'start of month')"
    return None


def _categorical_filters(idx: SchemaIndex, question: str) -> list[tuple[Col, str]]:
    """Match literal values mentioned in the question (e.g. '已完成', '小程序')."""
    out = []
    for c in idx.all_columns():
        if c.number or c.date:
            continue
        for v in c.values:
            if len(v) >= 2 and v in question:
                out.append((c, v))
                break
    return out


@dataclass
class Plan:
    dim: Col | None
    dim_score: float
    metric: Col | None
    main_table: str
    filters: list[tuple[Col, str]]


def _plan(idx: SchemaIndex, question: str, it: Intent) -> Plan:
    filters = _categorical_filters(idx, question)
    filtered_cols = {(c.table, c.name) for c, _ in filters}
    cols = [c for c in idx.all_columns() if (c.table, c.name) not in filtered_cols]
    scored = sorted(((_score(question, c.terms), c) for c in cols), key=lambda x: -x[0])

    # dimension: prefer a non-numeric, non-PK column with a label match
    dim, dim_score = None, 0.0
    for s, c in scored:
        if s > 0 and not c.number and not c.pk:
            dim, dim_score = c, s
            break
    date_cols = [c for c in cols if c.date and not c.pk]
    if it.monthly and date_cols:
        # Prefer a date column on the same table as the measure (order_date, not created_at)
        numeric_best = next((c for s, c in scored if s > 0 and c.number and not c.pk), None)
        preferred = next((c for c in date_cols if numeric_best and c.table == numeric_best.table), None)
        dim = preferred or max(date_cols, key=lambda c: _score(question, c.terms))
        dim_score = max(dim_score, 2.0)

    # metric: numeric column with the best term match
    metric = next((c for s, c in scored if s > 0 and c.number and not c.pk), None)
    if metric is None:
        metric = next((c for c in cols if c.number and not c.pk and c.name.lower() != "id"), None)

    if it.agg == "count":
        metric = None  # COUNT(*) needs no measure; keeps '客户数' on the customers table

    best_table = max(idx.tables, key=lambda t: _table_score(idx, t, question), default="")
    if it.agg == "count":
        main_table = dim.table if dim else (best_table or idx.tables[0])
    else:
        main_table = (metric.table if metric else None) or (dim.table if dim else None) or best_table or idx.tables[0]

    # A pure "total / how much" question should not be grouped by a weakly matched column
    top_n = re.search(r"前\s*\d|top\s*\d", question, re.IGNORECASE)
    if (
        dim
        and not GROUP_WORDS.search(question)
        and not it.monthly
        and not top_n
        and dim_score < 2.0
        and (it.agg in ("count", "sum", "avg") or TOTAL_WORDS.search(question))
    ):
        dim = None

    if it.list_mode:
        dim = None
        metric = None
        main_table = best_table or main_table
    return Plan(dim=dim, dim_score=dim_score, metric=metric, main_table=main_table, filters=filters)


def generate_offline_sql(question: str, driver: DatabaseDriver) -> tuple[str, str]:
    """Return (sql, human-readable reasoning)."""
    idx = build_index(driver)
    if not idx.tables:
        return "SELECT 1 AS empty_database", "No tables found in this connection."
    it = parse_intent(question)
    plan = _plan(idx, question, it)
    q = lambda ident: f'"{ident}"'  # noqa: E731 - identifiers come from introspection

    aliases: dict[str, str] = {plan.main_table: "t0"}
    joins: list[str] = []
    dim = plan.dim
    if dim and dim.table != plan.main_table:
        path = _find_path(idx, plan.main_table, dim.table)
        if path:
            for i, (table, _cond) in enumerate(path, start=1):
                alias = f"t{i}"
                aliases[table] = alias
            for i, (table, cond) in enumerate(path, start=1):
                resolved = cond
                for t, a in aliases.items():
                    resolved = resolved.replace(f"{t}.", f"{a}.")
                joins.append(f"JOIN {q(table)} AS t{i} ON {resolved}")
        else:
            dim = None

    def ref(col: Col | None) -> str:
        if col is None:
            return "*"
        return f"{aliases.get(col.table, 't0')}.{col.name}"

    where: list[str] = []
    date_col = next((c for c in idx.columns.get(plan.main_table, []) if c.date), None)
    if date_col and (it.months or it.this_year or it.this_month):
        clause = _date_filter(idx, aliases.get(date_col.table, "t0"), date_col, it)
        if clause:
            where.append(clause)
    for col, value in plan.filters:
        if col.table in aliases:
            where.append(f"{aliases[col.table]}.{col.name} = '{value.replace(chr(39), chr(39) * 2)}'")

    if it.list_mode:
        sql = f"SELECT * FROM {q(plan.main_table)} AS t0"
        if where:
            sql += " WHERE " + " AND ".join(where)
        if date_col and re.search(r"最新|最近|last|latest", question.lower()):
            sql += f" ORDER BY {ref(date_col)} DESC"
        sql += f" LIMIT {it.limit}"
        return sql, "Listed rows from the most relevant table (offline rule engine)."

    agg_map = {
        "count": "COUNT(*)",
        "sum": f"SUM({ref(plan.metric)})",
        "avg": f"AVG({ref(plan.metric)})",
        "max": f"MAX({ref(plan.metric)})",
        "min": f"MIN({ref(plan.metric)})",
    }
    if it.agg != "count" and plan.metric is None:
        it.agg = "count"
    agg_expr = agg_map[it.agg]
    value_alias = {"count": "count", "sum": "total", "avg": "average", "max": "max_value", "min": "min_value"}[it.agg]

    dim_expr = None
    dim_alias = "dimension"
    if dim:
        if it.monthly and dim.date:
            dim_expr = _date_expr(idx, aliases.get(dim.table, "t0"), dim)
            dim_alias = "month"
        else:
            dim_expr = ref(dim)
            dim_alias = dim.name

    select = f"{agg_expr} AS {value_alias}"
    if dim_expr:
        select = f"{dim_expr} AS {dim_alias}, {select}"
    sql = f"SELECT {select} FROM {q(plan.main_table)} AS t0"
    if joins:
        sql += " " + " ".join(joins)
    if where:
        sql += " WHERE " + " AND ".join(where)
    if dim_expr:
        sql += f" GROUP BY {dim_expr}"
        order = dim_alias if (it.monthly and dim.date) else f"{value_alias} DESC"
        sql += f" ORDER BY {order}"
    if it.ranked and not it.monthly and dim_expr:
        sql += f" LIMIT {it.limit}"
    elif not dim_expr:
        sql += " LIMIT 1"
    else:
        sql += f" LIMIT {max(it.limit, 20)}"

    reason = f"Intent: {it.agg}" + (f", grouped by {dim.table}.{dim.name}" if dim else "")
    if joins:
        reason += f", FK join: {', '.join(t for t in aliases if t != plan.main_table)}"
    if plan.filters:
        reason += ", value filters: " + ", ".join(f"{c.name}={v}" for c, v in plan.filters)
    return sql, reason


def suggest_questions(driver: DatabaseDriver) -> list[str]:
    """Context-aware starter questions for the AI panel."""
    try:
        idx = build_index(driver)
    except Exception:
        return ["列出所有表", "统计每个表的行数"]
    tables = set(idx.tables)
    qs: list[str] = []
    if {"orders", "customers"} <= tables:
        qs += [
            "每个城市的客户数量是多少？",
            "按月统计销售额趋势",
            "各渠道的订单数量和销售额对比",
        ]
    if {"order_items", "products"} <= tables:
        qs.append("销量前 5 的商品是哪些？")
    if {"orders"} <= tables:
        qs.append("最近 3 个月已完成订单的总销售额是多少？")
    if {"customers"} <= tables:
        qs.append("不同客户分层的客户数分布")
    for t in idx.tables[:2]:
        qs.append(f"查看 {t} 表的前 20 行数据")
    seen: set[str] = set()
    return [q for q in qs if not (q in seen or seen.add(q))][:8]
