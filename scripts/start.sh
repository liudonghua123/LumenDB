#!/usr/bin/env bash
# LumenDB single-port start: build the SPA, then serve UI + REST + MCP on one port.
# Everything (including the built frontend) is served by FastAPI at http://localhost:8000.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Backend dependencies (uv)"
(cd "$ROOT/backend" && uv sync --no-dev)
echo "==> Frontend dependencies (pnpm)"
(cd "$ROOT/frontend" && pnpm install --frozen-lockfile)
echo "==> Building SPA"
(cd "$ROOT/frontend" && pnpm build)
echo "==> Starting LumenDB at http://localhost:8000"
cd "$ROOT/backend"
exec uv run python -m app.main
