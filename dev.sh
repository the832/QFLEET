#!/usr/bin/env bash
# Hot-reload development: API on :8787, Vite UI on :5173 (proxies /api).
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -d frontend/node_modules ]; then (cd frontend && npm install); fi
(cd backend && uv run uvicorn app.main:app --port 8787 --reload) &
API=$!
trap 'kill $API 2>/dev/null' EXIT
cd frontend && npx vite --port 5173
