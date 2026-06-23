#!/usr/bin/env bash
uv run --active ruff format .
uv run --active ruff check --fix .
uv run --active ty check . 
npx prettier --write .
uv run --active pytest tests --ignore=tests/benchmark
