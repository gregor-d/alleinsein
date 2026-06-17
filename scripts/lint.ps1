uv run --active ruff format .
uv run --active ruff check --fix .
uv run --active ty check . 
npx prettier --write .
uv run --active pytest tests/test_map_frontend.py tests\test_titiler.py tests\test_env.py
