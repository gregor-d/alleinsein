import importlib
import sys
import tomllib
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend._version import __version__

PROJECT_DIR = Path(__file__).resolve().parent.parent

APP_ENV_KEYS = [
    "APP_ENV",
    "APP_ENABLE_DOCS",
    "APP_CORS_ORIGINS",
    "APP_ALLOWED_TMS",
    "APP_RASTER_PATH",
    "APP_ADD_PREVIEW",
    "APP_ADD_PART",
    "APP_ADD_VIEWER",
    "APP_ADD_OGC_MAPS",
]


@pytest.fixture(autouse=True)
def clean_app_env(monkeypatch: pytest.MonkeyPatch):
    for key in APP_ENV_KEYS:
        monkeypatch.delenv(key, raising=False)


def reload_main():
    if "backend.main" in sys.modules:
        return importlib.reload(sys.modules["backend.main"])
    return importlib.import_module("backend.main")


@pytest.mark.parametrize(
    ("env"),
    [
        ("prod"),
        ("dev"),
    ],
)
def test_health_endpoints(env, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("APP_ENV", env)
    main = reload_main()

    with TestClient(main.app, raise_server_exceptions=False) as client:
        response = client.get("/healthz")
        assert response.status_code == 200
        assert response.json()["env"] == env
        assert response.json()["version"] == __version__


def test_backend_version_matches_project_version():
    with (PROJECT_DIR / "pyproject.toml").open("rb") as project_config:
        project_version = tomllib.load(project_config)["project"]["version"]

    assert __version__ == project_version


@pytest.mark.parametrize(
    ("env", "tile", "tileset", "info", "statistics"),
    [
        ("prod", 200, 200, 404, 404),
        ("dev", 200, 200, 200, 200),
    ],
)
def test_environments(
    env, tile, tileset, info, statistics, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setenv("APP_ENV", env)
    main = reload_main()

    with TestClient(main.app, raise_server_exceptions=False) as client:
        assert client.get("/healthz").status_code == 200
        assert (
            client.get(
                "/tiles/WebMercatorQuad/0/0/0?raster=test_raster.tif"
            ).status_code
            == tile
        )
        assert client.get("/WebMercatorQuad/tilejson.json").status_code == tileset
        assert client.get("/info").status_code == info
        assert client.get("/statistics").status_code == statistics


def test_process_env_overrides_env_file(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("APP_ENV", "dev")
    monkeypatch.setenv("APP_ENABLE_DOCS", "false")
    main = reload_main()

    assert main.settings.env == "dev"
    assert main.settings.enable_docs is False

    with TestClient(main.app, raise_server_exceptions=False) as client:
        assert client.get("/docs").status_code == 404


def test_invalid_environment_fails(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("APP_ENV", "stage")

    with pytest.raises(RuntimeError, match="Unknown environment: stage"):
        reload_main()

    monkeypatch.setenv("APP_ENV", "prod")
    reload_main()
