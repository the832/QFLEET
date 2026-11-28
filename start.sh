#!/usr/bin/env bash
# QFleet · Team Nonchalant — one-command production run (single port).
set -euo pipefail
cd "$(dirname "$0")"
PORT="${PORT:-8787}"
if [ ! -d frontend/node_modules ]; then (cd frontend && npm install); fi
echo "▸ Building frontend…"
(cd frontend && npm run build >/dev/null)
echo "▸ Starting QFleet on http://localhost:${PORT}"
cd backend && exec uv run uvicorn app.main:app --host 0.0.0.0 --port "${PORT}"
