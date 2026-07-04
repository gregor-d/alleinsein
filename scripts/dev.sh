#!/usr/bin/env bash
set -euo pipefail

cleanup() {
  trap - EXIT INT TERM
  kill -TERM -"${backend_pid:-}" -"${frontend_pid:-}" 2>/dev/null || true
  for _ in 1 2 3 4 5 6; do
    kill -0 -"${backend_pid:-}" 2>/dev/null || kill -0 -"${frontend_pid:-}" 2>/dev/null || return 0
    sleep 0.5
  done
  kill -KILL -"${backend_pid:-}" -"${frontend_pid:-}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

setsid uv run uvicorn backend.main:app --port 8000 --reload --reload-dir backend &
backend_pid=$!

until curl --silent --fail http://127.0.0.1:8000/healthz &>/dev/null; do
  kill -0 "$backend_pid" 2>/dev/null || { echo "backend exited" >&2; exit 1; }
  sleep 1
done

bash "$(dirname "$0")/smoke-test.sh"

setsid npx --yes browser-sync start \
  --server frontend/static \
  --files "frontend/static/**/*" \
  --port 5173 --host 127.0.0.1 &
frontend_pid=$!

wait
