#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${REPO_URL:-git@github.com:gregor-d/alleinsein.git}"
APP_DIR="${APP_DIR:-${HOME}/alleinsein}"
SERVICE_NAME="${SERVICE_NAME:-tiler}"
CONTAINER_NAME="${CONTAINER_NAME:-tiler}"

if ! command -v git >/dev/null 2>&1; then
  echo "ERROR: git is not installed." >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is not installed." >&2
  exit 1
fi

if docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE=(docker-compose)
else
  echo "ERROR: Docker Compose is not installed." >&2
  exit 1
fi

if [[ -d "${APP_DIR}/.git" ]]; then
  echo "Repository exists at ${APP_DIR}; pulling latest version..."
  git -C "${APP_DIR}" pull --ff-only
else
  echo "Cloning ${REPO_URL} into ${APP_DIR}..."
  mkdir -p "$(dirname "${APP_DIR}")"
  git clone "${REPO_URL}" "${APP_DIR}"
fi

cd "${APP_DIR}"

container_state() {
  docker inspect -f 'running={{.State.Running}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "${CONTAINER_NAME}" 2>/dev/null || true
}

running="$(docker inspect -f '{{.State.Running}}' "${CONTAINER_NAME}" 2>/dev/null || true)"
health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "${CONTAINER_NAME}" 2>/dev/null || true)"

if [[ "${running}" == "true" && "${health}" == "healthy" ]]; then
  echo "Container ${CONTAINER_NAME} is already running and healthy."
  echo "Pulled code changes are available through the mounted backend folder; uvicorn reload will pick them up."
  exit 0
fi

if [[ "${running}" == "true" && "${health}" == "none" ]]; then
  echo "Container ${CONTAINER_NAME} is running, but no Docker healthcheck status is available."
  echo "Leaving it running."
  exit 0
fi

echo "Container ${CONTAINER_NAME} is not healthy/running. Starting ${SERVICE_NAME}..."
"${COMPOSE[@]}" up -d --build --force-recreate --remove-orphans "${SERVICE_NAME}"

echo "Waiting for ${CONTAINER_NAME} to become healthy..."
for _ in {1..30}; do
  running="$(docker inspect -f '{{.State.Running}}' "${CONTAINER_NAME}" 2>/dev/null || true)"
  health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "${CONTAINER_NAME}" 2>/dev/null || true)"

  if [[ "${running}" == "true" && "${health}" == "healthy" ]]; then
    echo "Container ${CONTAINER_NAME} is running and healthy."
    exit 0
  fi

  if [[ "${running}" == "true" && "${health}" == "none" ]]; then
    echo "Container ${CONTAINER_NAME} is running; no Docker healthcheck status is available."
    exit 0
  fi

  sleep 2
done

echo "ERROR: ${CONTAINER_NAME} did not become healthy. Current status: $(container_state)" >&2
exit 1
