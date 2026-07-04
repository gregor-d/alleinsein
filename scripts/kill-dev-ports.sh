#!/usr/bin/env bash
# Kill processes listening on the dev ports (backend 8000, frontend 5174).
set -euo pipefail

PORTS=(8000 5174)

kill_port() {
  local port="$1"
  # Collect PIDs listening on the port. Try lsof first, fall back to fuser/ss.
  local pids=""
  if command -v lsof >/dev/null 2>&1; then
    pids="$(lsof -ti "tcp:${port}" -sTCP:LISTEN 2>/dev/null || true)"
  elif command -v fuser >/dev/null 2>&1; then
    pids="$(fuser "${port}/tcp" 2>/dev/null || true)"
  else
    pids="$(ss -tlnpH "sport = :${port}" 2>/dev/null \
      | grep -oP 'pid=\K[0-9]+' | sort -u || true)"
  fi

  if [[ -z "${pids// }" ]]; then
    echo "port ${port}: nothing listening"
    return 0
  fi

  echo "port ${port}: killing PID(s) ${pids//$'\n'/ }"
  # Graceful first, then force any survivors.
  kill $pids 2>/dev/null || true
  sleep 1
  for pid in $pids; do
    if kill -0 "$pid" 2>/dev/null; then
      echo "port ${port}: force killing ${pid}"
      kill -9 "$pid" 2>/dev/null || true
    fi
  done
}

for port in "${PORTS[@]}"; do
  kill_port "$port"
done
