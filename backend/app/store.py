"""Lightweight metadata store (connections, history, saved queries, dashboards, AI sessions).

Kept on a local SQLite file so the whole app is zero-config: no external database is
required to *run* LumenDB, only to *query* one.
"""
from __future__ import annotations

import base64
import json
import sqlite3
import uuid
from datetime import UTC, datetime
from typing import Any

from .config import get_settings

try:
    from cryptography.fernet import Fernet, InvalidToken

    _HAS_FERNET = True
except ImportError:  # pragma: no cover - optional hardening
    _HAS_FERNET = False


def now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def uid(prefix: str = "") -> str:
    return f"{prefix}{uuid.uuid4().hex[:16]}"


# Chinese/English business glossary injected into the demo connection. It makes the
# offline NL2SQL engine (and LLM prompts) understand Chinese questions such as
# "每个城市的客户数" without any API key.
DEMO_SEMANTICS: dict[str, Any] = {
    "tables": {
        "customers": "客户 / 用户 / 顾客",
        "products": "商品 / 产品 / SKU",
        "categories": "品类 / 分类",
        "orders": "订单 / 销售 / 销售额",
        "order_items": "订单明细 / 明细 / 销量",
    },
    "columns": {
        "customers.name": "客户姓名 / 名称",
        "customers.city": "城市 / 地区",
        "customers.country": "国家",
        "customers.segment": "客户分层 / 客户等级",
        "customers.created_at": "注册时间 / 创建时间",
        "products.name": "商品名称",
        "products.price": "单价 / 价格",
        "products.stock": "库存",
        "categories.name": "品类名称",
        "orders.order_date": "下单日期 / 日期 / 月份 / 时间",
        "orders.total_amount": "销售额 / 金额 / 营收 / 总额",
        "orders.status": "订单状态",
        "orders.channel": "渠道",
        "order_items.quantity": "销量 / 数量 / 件数",
        "order_items.unit_price": "成交单价",
    },
}


class Store:
    def __init__(self) -> None:
        self.path = get_settings().meta_db_path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._init()

    # ------------------------------------------------------------------ infra
    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path, timeout=15)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    def _init(self) -> None:
        with self._conn() as c:
            c.executescript(
                """
                CREATE TABLE IF NOT EXISTS connections (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL UNIQUE,
                    dialect TEXT NOT NULL,
                    host TEXT DEFAULT '',
                    port INTEGER,
                    database TEXT DEFAULT '',
                    username TEXT DEFAULT '',
                    password_enc TEXT DEFAULT '',
                    readonly INTEGER DEFAULT 1,
                    color TEXT DEFAULT '#6366f1',
                    options TEXT DEFAULT '{}',
                    created_at TEXT,
                    updated_at TEXT
                );
                CREATE TABLE IF NOT EXISTS query_history (
                    id TEXT PRIMARY KEY,
                    connection_id TEXT,
                    connection_name TEXT DEFAULT '',
                    sql TEXT,
                    statement_type TEXT DEFAULT 'read',
                    row_count INTEGER DEFAULT 0,
                    duration_ms REAL DEFAULT 0,
                    status TEXT DEFAULT 'ok',
                    error TEXT,
                    created_at TEXT
                );
                CREATE TABLE IF NOT EXISTS saved_queries (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    sql TEXT NOT NULL,
                    connection_id TEXT DEFAULT '',
                    created_at TEXT
                );
                CREATE TABLE IF NOT EXISTS dashboards (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    description TEXT DEFAULT '',
                    cards TEXT DEFAULT '[]',
                    created_at TEXT,
                    updated_at TEXT
                );
                CREATE TABLE IF NOT EXISTS ai_sessions (
                    id TEXT PRIMARY KEY,
                    title TEXT DEFAULT '',
                    connection_id TEXT DEFAULT '',
                    messages TEXT DEFAULT '[]',
                    created_at TEXT,
                    updated_at TEXT
                );
                CREATE TABLE IF NOT EXISTS settings (
                    key TEXT PRIMARY KEY,
                    value TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_history_created ON query_history(created_at DESC);
                """
            )

    # --------------------------------------------------------------- encryption
    @property
    def _cipher(self):
        if not _HAS_FERNET:
            return None
        return Fernet(get_settings().fernet_key.encode())

    def encrypt(self, plain: str) -> str:
        if not plain:
            return ""
        if self._cipher:
            return "f:" + self._cipher.encrypt(plain.encode()).decode()
        return "b:" + base64.urlsafe_b64encode(plain.encode()).decode()

    def decrypt(self, value: str) -> str:
        if not value:
            return ""
        try:
            if value.startswith("f:") and self._cipher:
                return self._cipher.decrypt(value[2:].encode()).decode()
            if value.startswith("b:"):
                return base64.urlsafe_b64decode(value[2:].encode()).decode()
            return value  # legacy plain text
        except (InvalidToken, ValueError, UnicodeDecodeError):  # type: ignore[possibly-undefined]
            return ""

    # -------------------------------------------------------------- connections
    def _row_to_connection(self, row: sqlite3.Row, *, secret: bool = False) -> dict[str, Any]:
        d = dict(row)
        d["options"] = json.loads(d.get("options") or "{}")
        d["readonly"] = bool(d.get("readonly", 1))
        enc = d.pop("password_enc", "")
        d["has_password"] = bool(enc)
        if secret:
            d["password"] = self.decrypt(enc)
            d["password_enc"] = enc
        return d

    def list_connections(self) -> list[dict[str, Any]]:
        with self._conn() as c:
            rows = c.execute("SELECT * FROM connections ORDER BY created_at").fetchall()
        return [self._row_to_connection(r) for r in rows]

    def get_connection(self, id_or_name: str, *, secret: bool = False) -> dict[str, Any] | None:
        with self._conn() as c:
            row = c.execute(
                "SELECT * FROM connections WHERE id = ? OR name = ?", (id_or_name, id_or_name)
            ).fetchone()
        return self._row_to_connection(row, secret=secret) if row else None

    def create_connection(self, payload: dict[str, Any]) -> dict[str, Any]:
        cid = uid("c_")
        ts = now()
        with self._conn() as c:
            c.execute(
                """INSERT INTO connections
                   (id,name,dialect,host,port,database,username,password_enc,readonly,color,options,created_at,updated_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    cid,
                    payload["name"],
                    payload["dialect"],
                    payload.get("host", ""),
                    payload.get("port"),
                    payload.get("database", ""),
                    payload.get("username", ""),
                    self.encrypt(payload.get("password", "")),
                    1 if payload.get("readonly", True) else 0,
                    payload.get("color", "#6366f1"),
                    json.dumps(payload.get("options") or {}, ensure_ascii=False),
                    ts,
                    ts,
                ),
            )
        return self.get_connection(cid)  # type: ignore[return-value]

    def update_connection(self, cid: str, patch: dict[str, Any]) -> dict[str, Any] | None:
        current = self.get_connection(cid, secret=True)
        if not current:
            return None
        merged = {**current, **patch}
        with self._conn() as c:
            c.execute(
                """UPDATE connections SET name=?,dialect=?,host=?,port=?,database=?,username=?,
                   password_enc=?,readonly=?,color=?,options=?,updated_at=? WHERE id=?""",
                (
                    merged["name"],
                    merged["dialect"],
                    merged.get("host", ""),
                    merged.get("port"),
                    merged.get("database", ""),
                    merged.get("username", ""),
                    self.encrypt(merged.get("password", "")) if "password" in patch else current["password_enc"],
                    1 if merged.get("readonly", True) else 0,
                    merged.get("color", "#6366f1"),
                    json.dumps(merged.get("options") or {}, ensure_ascii=False),
                    now(),
                    current["id"],
                ),
            )
        return self.get_connection(current["id"])

    def delete_connection(self, cid: str) -> bool:
        with self._conn() as c:
            cur = c.execute("DELETE FROM connections WHERE id = ? OR name = ?", (cid, cid))
            return cur.rowcount > 0

    # ----------------------------------------------------------------- history
    def add_history(self, entry: dict[str, Any]) -> None:
        with self._conn() as c:
            c.execute(
                """INSERT INTO query_history
                   (id,connection_id,connection_name,sql,statement_type,row_count,duration_ms,status,error,created_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?)""",
                (
                    uid("h_"),
                    entry.get("connection_id", ""),
                    entry.get("connection_name", ""),
                    entry.get("sql", ""),
                    entry.get("statement_type", "read"),
                    entry.get("row_count", 0),
                    entry.get("duration_ms", 0),
                    entry.get("status", "ok"),
                    entry.get("error"),
                    now(),
                ),
            )
            c.execute(
                "DELETE FROM query_history WHERE id IN (SELECT id FROM query_history ORDER BY created_at DESC LIMIT -1 OFFSET 500)"
            )

    def list_history(self, limit: int = 100) -> list[dict[str, Any]]:
        with self._conn() as c:
            rows = c.execute(
                "SELECT * FROM query_history ORDER BY created_at DESC, rowid DESC LIMIT ?", (limit,)
            ).fetchall()
        return [dict(r) for r in rows]

    def clear_history(self) -> None:
        with self._conn() as c:
            c.execute("DELETE FROM query_history")

    # ----------------------------------------------------------- saved queries
    def list_saved(self) -> list[dict[str, Any]]:
        with self._conn() as c:
            return [dict(r) for r in c.execute("SELECT * FROM saved_queries ORDER BY created_at DESC")]

    def create_saved(self, name: str, sql: str, connection_id: str = "") -> dict[str, Any]:
        sid = uid("q_")
        with self._conn() as c:
            c.execute(
                "INSERT INTO saved_queries (id,name,sql,connection_id,created_at) VALUES (?,?,?,?,?)",
                (sid, name, sql, connection_id, now()),
            )
        return {"id": sid, "name": name, "sql": sql, "connection_id": connection_id}

    def delete_saved(self, sid: str) -> bool:
        with self._conn() as c:
            return c.execute("DELETE FROM saved_queries WHERE id=?", (sid,)).rowcount > 0

    # -------------------------------------------------------------- dashboards
    def list_dashboards(self) -> list[dict[str, Any]]:
        with self._conn() as c:
            rows = c.execute("SELECT * FROM dashboards ORDER BY updated_at DESC").fetchall()
        out = []
        for r in rows:
            d = dict(r)
            d["cards"] = json.loads(d.get("cards") or "[]")
            out.append(d)
        return out

    def get_dashboard(self, did: str) -> dict[str, Any] | None:
        with self._conn() as c:
            r = c.execute("SELECT * FROM dashboards WHERE id=?", (did,)).fetchone()
        if not r:
            return None
        d = dict(r)
        d["cards"] = json.loads(d.get("cards") or "[]")
        return d

    def save_dashboard(self, payload: dict[str, Any], did: str | None = None) -> dict[str, Any]:
        ts = now()
        did = did or uid("d_")
        cards = [c if isinstance(c, dict) else c.model_dump() for c in payload.get("cards", [])]
        with self._conn() as c:
            c.execute(
                """INSERT INTO dashboards (id,name,description,cards,created_at,updated_at)
                   VALUES (?,?,?,?,?,?)
                   ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description,
                   cards=excluded.cards, updated_at=excluded.updated_at""",
                (
                    did,
                    payload["name"],
                    payload.get("description", ""),
                    json.dumps(cards, ensure_ascii=False),
                    ts,
                    ts,
                ),
            )
        return self.get_dashboard(did)  # type: ignore[return-value]

    def delete_dashboard(self, did: str) -> bool:
        with self._conn() as c:
            return c.execute("DELETE FROM dashboards WHERE id=?", (did,)).rowcount > 0

    # ------------------------------------------------------------- ai sessions
    def list_sessions(self) -> list[dict[str, Any]]:
        with self._conn() as c:
            rows = c.execute("SELECT id,title,connection_id,created_at,updated_at FROM ai_sessions ORDER BY updated_at DESC").fetchall()
        return [dict(r) for r in rows]

    def get_session(self, sid: str) -> dict[str, Any] | None:
        with self._conn() as c:
            r = c.execute("SELECT * FROM ai_sessions WHERE id=?", (sid,)).fetchone()
        if not r:
            return None
        d = dict(r)
        d["messages"] = json.loads(d.get("messages") or "[]")
        return d

    def save_session(self, sid: str, title: str, connection_id: str, messages: list[dict[str, Any]]) -> None:
        with self._conn() as c:
            c.execute(
                """INSERT INTO ai_sessions (id,title,connection_id,messages,created_at,updated_at)
                   VALUES (?,?,?,?,?,?)
                   ON CONFLICT(id) DO UPDATE SET title=excluded.title,
                   connection_id=excluded.connection_id, messages=excluded.messages,
                   updated_at=excluded.updated_at""",
                (sid, title, connection_id, json.dumps(messages, ensure_ascii=False, default=str), now(), now()),
            )

    def delete_session(self, sid: str) -> bool:
        with self._conn() as c:
            return c.execute("DELETE FROM ai_sessions WHERE id=?", (sid,)).rowcount > 0

    def delete_all_sessions(self) -> None:
        with self._conn() as c:
            c.execute("DELETE FROM ai_sessions")

    # ---------------------------------------------------------------- settings
    def get_setting(self, key: str, default: Any = None) -> Any:
        with self._conn() as c:
            r = c.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
        return json.loads(r["value"]) if r else default

    def set_setting(self, key: str, value: Any) -> None:
        with self._conn() as c:
            c.execute(
                "INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (key, json.dumps(value, ensure_ascii=False)),
            )


_default_store: Store | None = None


def get_store() -> Store:
    global _default_store
    if _default_store is None:
        _default_store = Store()
    return _default_store
