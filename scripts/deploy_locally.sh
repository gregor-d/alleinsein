#!/usr/bin/env bash
set -euo pipefail

frontend_pid=""
backend_pid=""

cleanup() {
  if [[ -n "${frontend_pid}" ]] && kill -0 "${frontend_pid}" 2>/dev/null; then
    kill -- -"${frontend_pid}" 2>/dev/null || kill "${frontend_pid}" 2>/dev/null || true
  fi

  if [[ -n "${backend_pid}" ]] && kill -0 "${backend_pid}" 2>/dev/null; then
    kill -- -"${backend_pid}" 2>/dev/null || kill "${backend_pid}" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

check_port() {
  local port="$1"
  if ss -tlnH "sport = :${port}" 2>/dev/null | grep -q .; then
    return 0
  elif command -v lsof &>/dev/null && lsof -iTCP:"${port}" -sTCP:LISTEN -t &>/dev/null; then
    return 0
  fi
  return 1
}

for port in 5173 8000; do
  if check_port "${port}"; then
    echo "ERROR: port ${port} is already in use." >&2
    exit 1
  fi
done

setsid uv run uvicorn backend.main:app --port 8000 &
backend_pid="$!"

echo "Waiting for backend to be ready..."
for i in $(seq 1 30); do
  if curl --silent --output /dev/null --fail "http://127.0.0.1:8000/healthz"; then
    break
  fi
  if ! kill -0 "${backend_pid}" 2>/dev/null; then
    wait "${backend_pid}" && exit_code=0 || exit_code=$?
    echo "Backend exited with code ${exit_code} before becoming ready." >&2
    echo "Hint: run 'uv sync' to install dependencies, or ensure 'uv' is installed and in PATH." >&2
    exit 1
  fi
  sleep 1
done

bash ./scripts/smoke-test.sh

setsid npx --yes browser-sync start \
  --server "frontend/static" \
  --files "frontend/static/*.html" "frontend/static/*.css" "frontend/static/themes/*.css" "frontend/static/*.js" \
  --no-ui \
  --no-open \
  --port 5173 \
  --host 127.0.0.1 &
frontend_pid="$!"

wait -n "${frontend_pid}" "${backend_pid}"
