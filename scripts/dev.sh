#!/usr/bin/env bash
set -euo pipefail

cleanup() { kill "$backend_pid" "$frontend_pid" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

uv run uvicorn backend.main:app --port 8000 --reload --reload-dir backend &
backend_pid=$!

until curl --silent --fail http://127.0.0.1:8000/healthz &>/dev/null; do
  kill -0 "$backend_pid" 2>/dev/null || { echo "backend exited" >&2; exit 1; }
  sleep 1
done

bash "$(dirname "$0")/smoke-test.sh"

npx --yes browser-sync start \
  --server frontend/static \
  --files "frontend/static/**/*" \
  --port 5173 --host 127.0.0.1 &
frontend_pid=$!

wait
