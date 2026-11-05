"""Central configuration, driven by environment variables (prefix ``LUMEN_``)."""
from __future__ import annotations

import hashlib
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
WORKSPACE_DIR = BACKEND_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(str(BACKEND_DIR / ".env"), ".env"),
        env_prefix="LUMEN_",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # Server
    host: str = "0.0.0.0"
    port: int = 8000
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    api_token: str = ""
    data_dir: str = str(BACKEND_DIR / "data")
    public_base_url: str = ""
    docs_enabled: bool = True

    # Query safety: REST writes require confirm_write=true; MCP is always read-only.
    allow_write: bool = True
    max_rows: int = 1000
    query_timeout: int = 30

    # MCP
    mcp_path: str = "/mcp"
    mcp_max_rows: int = 100

    # LLM (any OpenAI-compatible endpoint, including Ollama / vLLM / DeepSeek)
    llm_base_url: str = ""
    llm_api_key: str = ""
    llm_model: str = ""
    llm_timeout: int = 90
    llm_temperature: float = 0.0
    llm_max_schema_tables: int = 20

    # Storage encryption
    secret: str = "lumendb-local-dev-secret-change-me"

    @property
    def data_path(self) -> Path:
        p = Path(self.data_dir).expanduser().resolve()
        p.mkdir(parents=True, exist_ok=True)
        return p

    @property
    def meta_db_path(self) -> Path:
        return self.data_path / "lumendb.sqlite"

    @property
    def demo_db_path(self) -> Path:
        return self.data_path / "demo.sqlite"

    @property
    def origins(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def effective_llm_base_url(self) -> str:
        if self.llm_base_url:
            return self.llm_base_url.rstrip("/")
        if self.llm_api_key:
            return "https://api.openai.com/v1"
        return ""

    @property
    def effective_llm_model(self) -> str:
        return self.llm_model or ("gpt-4o-mini" if self.llm_api_key and not self.llm_base_url else "qwen2.5-coder:7b")

    @property
    def llm_enabled(self) -> bool:
        """An explicit base URL is enough (local Ollama needs no API key)."""
        return bool(self.effective_llm_base_url)

    @property
    def llm_provider_label(self) -> str:
        if not self.llm_enabled:
            return "offline (rule-based NL2SQL)"
        url = self.effective_llm_base_url.lower()
        if "localhost" in url or "127.0.0.1" in url or "11434" in url:
            return "ollama / local"
        if "deepseek" in url:
            return "deepseek"
        if "openai.com" in url:
            return "openai"
        return "openai-compatible"

    @property
    def fernet_key(self) -> str:
        import base64

        digest = hashlib.sha256(self.secret.encode()).digest()
        return base64.urlsafe_b64encode(digest).decode()


@lru_cache
def get_settings() -> Settings:
    return Settings()
