"""LLM adapter for any OpenAI-compatible chat-completions endpoint.

Supports OpenAI, DeepSeek, OpenRouter, vLLM, Ollama (http://localhost:11434/v1), etc.
When no endpoint is configured the AI layer falls back to the offline rule engine.
"""
from __future__ import annotations

import json
import re
from typing import Any

import httpx

from ..config import get_settings


class LLMError(Exception):
    pass


class LLMClient:
    def __init__(self) -> None:
        self.settings = get_settings()

    @property
    def enabled(self) -> bool:
        return self.settings.llm_enabled

    @property
    def label(self) -> str:
        return self.settings.llm_provider_label if self.enabled else "offline (rule-based NL2SQL)"

    @property
    def model(self) -> str:
        return self.settings.effective_llm_model

    async def chat(self, messages: list[dict[str, str]], *, temperature: float | None = None, max_tokens: int = 1600) -> str:
        if not self.enabled:
            raise LLMError("No LLM endpoint configured")
        base = self.settings.effective_llm_base_url
        url = base + ("" if base.endswith("/chat/completions") else "/chat/completions")
        headers = {"Content-Type": "application/json"}
        if self.settings.llm_api_key:
            headers["Authorization"] = f"Bearer {self.settings.llm_api_key}"
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": self.settings.llm_temperature if temperature is None else temperature,
            "max_tokens": max_tokens,
            "stream": False,
        }
        try:
            async with httpx.AsyncClient(timeout=self.settings.llm_timeout) as client:
                resp = await client.post(url, json=payload, headers=headers)
        except httpx.HTTPError as exc:
            raise LLMError(f"LLM request failed: {exc}") from exc
        if resp.status_code >= 400:
            raise LLMError(f"LLM HTTP {resp.status_code}: {resp.text[:400]}")
        try:
            data = resp.json()
            content = data["choices"][0]["message"]["content"]
            if isinstance(content, list):  # some gateways return content parts
                content = "".join(p.get("text", "") for p in content if isinstance(p, dict))
            return str(content).strip()
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            raise LLMError(f"Unexpected LLM response: {resp.text[:300]}") from exc

    async def chat_json(self, messages: list[dict[str, str]], **kwargs: Any) -> Any:
        raw = await self.chat(messages, **kwargs)
        cleaned = re.sub(r"^```(?:json)?|```$", "", raw.strip(), flags=re.MULTILINE).strip()
        try:
            return json.loads(cleaned)
        except json.JSONDecodeError:
            match = re.search(r"\{[\s\S]*\}|\[[\s\S]*\]", cleaned)
            if match:
                try:
                    return json.loads(match.group(0))
                except json.JSONDecodeError:
                    pass
            raise LLMError("LLM did not return valid JSON") from None


def extract_sql(text: str) -> str:
    """Pull a single SQL statement out of an LLM response."""
    fenced = re.search(r"```(?:sql|SQL)?\s*([\s\S]*?)```", text)
    candidate = fenced.group(1) if fenced else text
    candidate = re.sub(r"^\s*(?:Here is|SQL:?|查询[:：]?)\s*", "", candidate, flags=re.IGNORECASE).strip()
    candidate = candidate.strip().rstrip(";").strip()
    # Drop trailing prose after the statement when obvious
    lines = []
    for line in candidate.splitlines():
        if re.match(r"^\s*(?:--|#)", line):
            continue
        lines.append(line)
    return "\n".join(lines).strip()


def get_llm() -> LLMClient:
    return LLMClient()
