#!/usr/bin/env bash
# Run the project locally for development:
#   - backend (uvicorn with --reload) on :8000
#   - frontend (vite dev server) on :5173 with API proxy to :8000
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Installing backend deps"
( cd backend && pip install -q -r requirements.txt )

echo "==> Installing frontend deps"
( cd frontend && [ -d node_modules ] || npm install )

echo "==> Starting backend (:8000) and frontend (:5173)"
( cd backend && uvicorn backend.app.main:starlette_app --reload --port 8000 ) &
( cd frontend && npm run dev ) &
wait
