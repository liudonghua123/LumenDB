"""AI 问数: natural language -> SQL -> execution -> interpretation -> chart."""
from __future__ import annotations

import asyncio
import json
import re
from typing import Any

from ..db.engine import DriverError, classify_sql, get_driver, jsonable
from ..models import AiAskRequest, AiAskResponse, ChartSpec, QueryResult
from ..store import get_store, now, uid
from .llm import LLMError, extract_sql, get_llm
from .nl2sql import generate_offline_sql, suggest_questions
from .viz import recommend

SQL_SYSTEM_PROMPT = """You are a senior data analyst and SQL expert. Convert the user's question into ONE read-only SQL query.

Rules:
- Use ONLY tables and columns from the provided schema. Never invent names.
- Return ONLY a single SELECT (or WITH ... SELECT) statement. No DDL/DML, no multiple statements, no prose.
- Prefer explicit column aliases in English (e.g. AS month, AS total, AS count).
- Add a LIMIT when returning raw rows. Do not add LIMIT to aggregated results unless asked.
- Respect the dialect: {dialect}. Use dialect-correct date functions.
- If the question cannot be answered from the schema, return a SELECT that best approximates it.
- Output the SQL inside a ```sql fenced block.

SCHEMA
------
{schema}
"""

ANSWER_SYSTEM_PROMPT = """You are a concise data analyst. Answer the user's question in {lang}, based ONLY on the SQL and query results provided.
- 2 to 4 short sentences, state the key numbers, no speculation, no markdown headers.
- Mention the row count and any truncation.
- Then output a JSON object on a new line: {{"followups": ["...", "...", "..."]}} with 3 short suggested follow-up questions in {lang}.
Do not wrap the whole answer in JSON."""


class AIService:
    def __init__(self) -> None:
        self.llm = get_llm()
        self.store = get_store()

    # -------------------------------------------------------------- sql gen
    async def _schema(self, connection_id: str) -> tuple[str, str, Any]:
        driver = get_driver(connection_id)
        schema = await asyncio.to_thread(driver.schema_context)
        return schema, driver.dialect, driver

    async def generate_sql(self, connection_id: str, question: str, history: list[dict] | None = None) -> dict[str, Any]:
        schema, dialect, driver = await self._schema(connection_id)
        if self.llm.enabled:
            messages: list[dict[str, str]] = [
                {"role": "system", "content": SQL_SYSTEM_PROMPT.format(dialect=dialect, schema=schema)}
            ]
            for h in (history or [])[-4:]:
                if h.get("role") == "user":
                    messages.append({"role": "user", "content": h.get("content", "")})
                elif h.get("sql"):
                    messages.append({"role": "assistant", "content": f"```sql\n{h['sql']}\n```"})
            messages.append({"role": "user", "content": question})
            try:
                raw = await self.llm.chat(messages, max_tokens=1200)
                sql = extract_sql(raw)
                if classify_sql(sql) != "read":
                    raise LLMError("LLM produced a non-read statement")
                return {"sql": sql, "engine": f"llm:{self.llm.model}", "reason": "Generated from live schema context."}
            except LLMError:
                pass  # graceful degradation to the offline engine
        sql, reason = await asyncio.to_thread(generate_offline_sql, question, driver)
        return {"sql": sql, "engine": "offline-heuristic", "reason": reason}

    # ------------------------------------------------------------- answering
    async def _answer(self, question: str, sql: str, result: QueryResult) -> tuple[str, list[str]]:
        lang = "中文" if re.search(r"[\u4e00-\u9fff]", question) else "English"
        sample = {
            "columns": result.columns,
            "rows": result.rows[:20],
            "row_count": result.row_count,
            "truncated": result.truncated,
        }
        if self.llm.enabled:
            try:
                raw = await self.llm.chat(
                    [
                        {"role": "system", "content": ANSWER_SYSTEM_PROMPT.format(lang=lang)},
                        {
                            "role": "user",
                            "content": f"Question: {question}\nSQL: {sql}\nResult: {json.dumps(sample, ensure_ascii=False, default=jsonable)[:6000]}",
                        },
                    ],
                    max_tokens=700,
                )
                followups: list[str] = []
                m = re.search(r'\{\s*"followups"\s*:\s*\[[\s\S]*?\]\s*\}', raw)
                if m:
                    try:
                        followups = json.loads(m.group(0)).get("followups", [])[:3]
                        raw = raw.replace(m.group(0), "").strip()
                    except json.JSONDecodeError:
                        pass
                return raw.strip(), followups or self._fallback_followups(question, result)
            except LLMError:
                pass
        return self._offline_answer(question, result, lang), self._fallback_followups(question, result)

    @staticmethod
    def _offline_answer(question: str, result: QueryResult, lang: str) -> str:
        if not result.rows or not result.columns:
            return "查询已执行，但没有返回数据。可以尝试放宽筛选条件。" if lang == "中文" else "The query ran but returned no rows."
        cols = result.columns
        numeric_idx = [
            i for i in range(len(cols))
            if any(isinstance(r[i], (int, float)) and not isinstance(r[i], bool) for r in result.rows if i < len(r))
        ]
        dim_idx = next((i for i in range(len(cols)) if i not in numeric_idx), None)
        n = result.row_count
        if len(result.rows) == 1 and numeric_idx:
            i = numeric_idx[0]
            value = result.rows[0][i]
            text = f"{cols[i]} 为 {value:,.2f}" if isinstance(value, float) else f"{cols[i]} 为 {value}"
            return (
                f"查询返回 1 行结果：{text}。{'结果已按上限截断。' if result.truncated else ''}"
                if lang == "中文"
                else f"The query returned one value: {cols[i]} = {value}."
            )
        parts = [f"共返回 {n} 行数据" if lang == "中文" else f"Returned {n} rows"]
        if dim_idx is not None and numeric_idx:
            i = numeric_idx[0]
            try:
                best = max((r for r in result.rows if i < len(r)), key=lambda r: float(r[i] or 0))
                total = sum(float(r[i] or 0) for r in result.rows if i < len(r))
                parts.append(f"按 {cols[dim_idx]} 统计，{cols[i]} 合计约 {total:,.2f}，其中 {best[dim_idx]} 最高（{best[i]}）")
            except (TypeError, ValueError):
                pass
        if result.truncated:
            parts.append("结果已按行数上限截断")
        return "；".join(parts) + "。" if lang == "中文" else ". ".join(parts) + "."

    @staticmethod
    def _fallback_followups(question: str, result: QueryResult) -> list[str]:
        dim = next((c for c in result.columns if c not in ("count", "total", "value", "average")), result.columns[0] if result.columns else "")
        return [
            "把时间范围限定到最近 3 个月再统计一次",
            f"按 {dim} 升序排列并只看前 10 条",
            "把这次结果保存为图表看板卡片",
        ]

    # ------------------------------------------------------------------- ask
    async def ask(self, req: AiAskRequest) -> AiAskResponse:
        session_id = req.session_id or uid("s_")
        session = self.store.get_session(session_id) or {"messages": [], "title": "", "connection_id": req.connection_id}
        history = session.get("messages", [])
        gen = await self.generate_sql(req.connection_id, req.question, history)
        sql = gen["sql"]

        if classify_sql(sql) != "read":
            return AiAskResponse(
                session_id=session_id,
                answer="检测到非只读语句，出于安全考虑未执行。AI 问数仅允许 SELECT / WITH 查询。",
                sql=sql,
                needs_confirmation=True,
                engine=gen["engine"],
            )

        driver = get_driver(req.connection_id)
        result: QueryResult | None = None
        error: str | None = None
        if req.auto_run:
            try:
                raw = await asyncio.to_thread(
                    driver.execute, sql, req.limit, enforce_readonly=True, allow_write=False
                )
                result = QueryResult(**raw)
                self.store.add_history(
                    {
                        "connection_id": req.connection_id,
                        "sql": sql,
                        "statement_type": "read",
                        "row_count": result.row_count,
                        "duration_ms": result.duration_ms,
                        "status": "ok",
                    }
                )
            except DriverError as exc:
                error = str(exc)
                # One LLM self-repair attempt
                if self.llm.enabled:
                    try:
                        fixed = await self.fix_sql(req.connection_id, sql, error)
                        fixed_sql = fixed["sql"]
                        if classify_sql(fixed_sql) == "read":
                            raw2 = await asyncio.to_thread(
                                driver.execute, fixed_sql, req.limit, enforce_readonly=True, allow_write=False
                            )
                            sql, result, error = fixed_sql, QueryResult(**raw2), None
                    except (DriverError, LLMError):
                        pass
                if error:
                    self.store.add_history(
                        {"connection_id": req.connection_id, "sql": sql, "status": "error", "error": error}
                    )

        if result is None and error:
            answer = f"已生成 SQL，但执行失败：{error}\n你可以在 SQL 工作台中手动调整后运行。"
            followups: list[str] = []
        else:
            answer, followups = await self._answer(req.question, sql, result)  # type: ignore[arg-type]

        chart: ChartSpec | None = None
        if req.include_chart and result and result.rows:
            specs = recommend(result.columns, result.rows, result.column_types, title=req.question[:40])
            if specs:
                chart = ChartSpec(**specs[0])

        answer_text = answer
        if error:
            answer_text = answer
        else:
            answer_text = f"{answer}\n\n```sql\n{sql}\n```" if not self.llm.enabled else answer

        meta = {"engine": gen["engine"], "reason": gen["reason"], "error": error}
        message_id = uid("m_")
        user_msg = {"role": "user", "content": req.question, "created_at": now(), "meta": {}}
        bot_msg = {
            "role": "assistant",
            "content": answer_text,
            "sql": sql,
            "result": (result.model_dump() if result else None),
            "chart": (chart.model_dump() if chart else None),
            "followups": followups,
            "meta": meta,
            "created_at": now(),
            "id": message_id,
        }
        if bot_msg["result"]:
            bot_msg["result"]["rows"] = bot_msg["result"]["rows"][:50]
        messages = [*history, user_msg, bot_msg]
        title = session.get("title") or req.question[:36]
        self.store.save_session(session_id, title, req.connection_id, messages)

        return AiAskResponse(
            session_id=session_id,
            answer=answer_text,
            sql=sql,
            result=result,
            chart=chart,
            followups=followups,
            engine=gen["engine"],
            message_id=message_id,
        )

    # ------------------------------------------------------------- utilities
    async def explain_sql(self, connection_id: str, sql: str) -> dict[str, Any]:
        schema, dialect, _ = await self._schema(connection_id)
        if self.llm.enabled:
            try:
                return {
                    "explanation": await self.llm.chat(
                        [
                            {"role": "system", "content": "You are a SQL tutor. Explain the query step by step in the user's language, briefly (5-8 bullet points). Include performance hints when obvious."},
                            {"role": "user", "content": f"Dialect: {dialect}\nSchema:\n{schema[:6000]}\n\nSQL:\n{sql}"},
                        ],
                        max_tokens=900,
                    ),
                    "engine": f"llm:{self.llm.model}",
                }
            except LLMError:
                pass
        return {"explanation": self._offline_explain(sql), "engine": "offline-heuristic"}

    @staticmethod
    def _offline_explain(sql: str) -> str:
        flat = " ".join(sql.split())
        def grab(pattern: str) -> str:
            m = re.search(pattern, flat, re.IGNORECASE)
            return m.group(1).strip() if m else ""
        lines = ["**SQL 结构解读（离线规则引擎）**", ""]
        select = grab(r"SELECT\s+([\s\S]*?)\s+FROM\s")
        from_ = grab(r"FROM\s+([^\s,]+(?:\s+(?:AS\s+)?\w+)?)")
        where = grab(r"WHERE\s+([\s\S]*?)(?=\s+GROUP BY|\s+ORDER BY|\s+LIMIT|$)")
        group = grab(r"GROUP BY\s+([\s\S]*?)(?=\s+ORDER BY|\s+LIMIT|$)")
        order = grab(r"ORDER BY\s+([\s\S]*?)(?=\s+LIMIT|$)")
        limit = grab(r"LIMIT\s+(\d+)")
        if select:
            lines.append(f"- 输出列：{select[:300]}")
        if from_:
            lines.append(f"- 数据来源：{from_}")
        for join in re.findall(r"(?:LEFT |INNER |RIGHT )?JOIN\s+[^\s]+\s+(?:AS\s+)?\w+\s+ON\s+([\s\S]*?)(?=\s+(?:JOIN|WHERE|GROUP|ORDER|LIMIT)|$)", flat, re.IGNORECASE):
            lines.append(f"- 关联条件：{join.strip()[:200]}")
        if where:
            lines.append(f"- 过滤条件：{where[:300]}")
        if group:
            lines.append(f"- 分组维度：{group[:200]}")
        if order:
            lines.append(f"- 排序方式：{order[:200]}")
        if limit:
            lines.append(f"- 返回上限：{limit} 行")
        lines += ["", "提示：配置 LLM 后可获得逐行语义解释与索引优化建议。"]
        return "\n".join(lines)

    async def fix_sql(self, connection_id: str, sql: str, error: str) -> dict[str, Any]:
        if self.llm.enabled:
            schema, dialect, _ = await self._schema(connection_id)
            raw = await self.llm.chat(
                [
                    {"role": "system", "content": "Fix the SQL for the given dialect. Return ONLY the corrected SQL in a ```sql fenced block, no explanation."},
                    {"role": "user", "content": f"Dialect: {dialect}\nSchema:\n{schema[:6000]}\n\nSQL:\n{sql}\n\nError:\n{error[:1000]}"},
                ],
                max_tokens=900,
            )
            return {"sql": extract_sql(raw), "engine": f"llm:{self.llm.model}"}
        return {"sql": sql, "engine": "offline-heuristic", "note": "Offline engine cannot repair SQL; configure an LLM for auto-repair."}

    async def suggestions(self, connection_id: str) -> list[str]:
        driver = get_driver(connection_id)
        return await asyncio.to_thread(suggest_questions, driver)


def get_ai_service() -> AIService:
    return AIService()
