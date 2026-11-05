#!/usr/bin/env bash
# LumenDB development mode: FastAPI (:8000) + Vite (:5173), both with hot reload.
# Prerequisites: `uv sync` in backend/ and `pnpm install` in frontend/ (once).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

(cd "$ROOT/backend" && uv run uvicorn app.main:app --reload --port 8000) &
BACK=$!
(cd "$ROOT/frontend" && pnpm dev) &
FRONT=$!

cleanup() { kill "$BACK" "$FRONT" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

printf '\n  LumenDB dev\n  UI   http://localhost:5173\n  API  http://localhost:8000/docs\n  MCP  http://localhost:8000/mcp\n\n'
wait
