"""Pydantic request/response schemas shared by REST and MCP layers."""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

Dialect = Literal["sqlite", "postgresql", "mysql"]


class ConnectionBase(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    dialect: Dialect = "sqlite"
    host: str = ""
    port: int | None = None
    database: str = ""
    username: str = ""
    password: str = ""
    readonly: bool = True
    color: str = "#6366f1"
    options: dict[str, Any] = Field(default_factory=dict)


class ConnectionCreate(ConnectionBase):
    pass


class ConnectionUpdate(BaseModel):
    name: str | None = None
    dialect: Dialect | None = None
    host: str | None = None
    port: int | None = None
    database: str | None = None
    username: str | None = None
    password: str | None = None
    readonly: bool | None = None
    color: str | None = None
    options: dict[str, Any] | None = None


class ConnectionOut(BaseModel):
    id: str
    name: str
    dialect: Dialect
    host: str = ""
    port: int | None = None
    database: str = ""
    username: str = ""
    readonly: bool = True
    color: str = "#6366f1"
    has_password: bool = False
    created_at: str = ""
    updated_at: str = ""
    options: dict[str, Any] = Field(default_factory=dict)


class ConnectionTest(BaseModel):
    ok: bool
    dialect: str
    server_version: str = ""
    latency_ms: float = 0.0
    message: str = ""


class QueryRequest(BaseModel):
    connection_id: str
    sql: str
    limit: int | None = None
    database: str | None = None
    schema_name: str | None = Field(default=None, alias="schema")
    confirm_write: bool = False
    multi_statement: bool = False


class ColumnOut(BaseModel):
    name: str
    type: str
    nullable: bool = True
    default: str | None = None
    primary_key: bool = False
    autoincrement: bool = False
    label: str = ""


class QueryResult(BaseModel):
    columns: list[str] = Field(default_factory=list)
    rows: list[list[Any]] = Field(default_factory=list)
    row_count: int = 0
    truncated: bool = False
    duration_ms: float = 0.0
    statement_type: str = "read"
    sql: str = ""
    connection_id: str = ""
    database: str | None = None
    error: str | None = None
    column_types: list[str] = Field(default_factory=list)


class TableInfo(BaseModel):
    name: str
    type: str = "table"
    schema_name: str | None = Field(default=None, alias="schema")
    row_count: int | None = None
    label: str = ""


class TableDescription(BaseModel):
    name: str
    schema_name: str | None = Field(default=None, alias="schema")
    label: str = ""
    columns: list[ColumnOut] = Field(default_factory=list)
    primary_key: list[str] = Field(default_factory=list)
    foreign_keys: list[dict[str, Any]] = Field(default_factory=list)
    indexes: list[dict[str, Any]] = Field(default_factory=list)
    ddl: str = ""
    sample: QueryResult | None = None


class ExplainRequest(BaseModel):
    connection_id: str
    sql: str
    analyze: bool = False


class AiAskRequest(BaseModel):
    connection_id: str
    question: str = Field(min_length=1)
    session_id: str | None = None
    auto_run: bool = True
    include_chart: bool = True
    limit: int = 200


class GenerateSqlRequest(BaseModel):
    connection_id: str
    question: str
    dialect: str | None = None


class ExplainSqlRequest(BaseModel):
    connection_id: str
    sql: str
    question: str = ""


class FixSqlRequest(BaseModel):
    connection_id: str
    sql: str
    error: str


class ChartSpec(BaseModel):
    type: Literal["bar", "line", "area", "pie", "scatter", "metric", "table"] = "bar"
    title: str = ""
    x: str = ""
    y: list[str] = Field(default_factory=list)
    series: list[dict[str, Any]] = Field(default_factory=list)
    reason: str = ""
    options: dict[str, Any] = Field(default_factory=dict)


class VizRecommendRequest(BaseModel):
    columns: list[str]
    rows: list[list[Any]]
    column_types: list[str] = Field(default_factory=list)
    title: str = ""


class CardModel(BaseModel):
    id: str
    title: str = ""
    connection_id: str = ""
    sql: str = ""
    chart: ChartSpec = Field(default_factory=ChartSpec)
    width: int = 6


class DashboardCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: str = ""
    cards: list[CardModel] = Field(default_factory=list)


class DashboardOut(DashboardCreate):
    id: str
    created_at: str = ""
    updated_at: str = ""


class AiMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str
    sql: str | None = None
    result: QueryResult | None = None
    chart: ChartSpec | None = None
    followups: list[str] = Field(default_factory=list)
    meta: dict[str, Any] = Field(default_factory=dict)
    created_at: str = ""


class AiAskResponse(BaseModel):
    session_id: str
    answer: str
    sql: str | None = None
    result: QueryResult | None = None
    chart: ChartSpec | None = None
    followups: list[str] = Field(default_factory=list)
    engine: str = ""
    needs_confirmation: bool = False
    message_id: str = ""
