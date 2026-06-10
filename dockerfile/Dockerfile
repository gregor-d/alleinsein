# syntax=docker/dockerfile:1

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV UV_COMPILE_BYTECODE=1

COPY --from=ghcr.io/astral-sh/uv:0.11.19 /uv /uvx /bin/

# rio-tiler depends on this 
RUN apt-get update \
    && apt-get install -y --no-install-recommends bash curl libexpat1 \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml . 

RUN uv pip install --system -r pyproject.toml

COPY backend /backend
COPY scripts/smoke-test.sh /scripts/smoke-test.sh

# smoketest to see if the backend can be started
RUN timeout 5s uvicorn backend.main:app --host 127.0.0.1 --port 8000 || test "$?" -eq 124
