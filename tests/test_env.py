import importlib
import sys

import pytest
from fastapi.testclient import TestClient

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


def test_default_environment_is_prod():
    main = reload_main()

    assert main.settings.env == "prod"
    assert main.settings.enable_docs is False


@pytest.mark.parametrize(
    ("env", "dev_route_status"),
    [
        ("prod", 404),
        ("dev", 200),
    ],
)
def test_environments(env, dev_route_status, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("APP_ENV", env)
    main = reload_main()

    with TestClient(main.app, raise_server_exceptions=False) as client:
        response = client.get("/healthz")
        assert response.status_code == 200
        assert response.json()["env"] == env

        resp = client.get("/map")
        assert resp.status_code == dev_route_status


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

    with pytest.raises(RuntimeError, match="Unknown APP_ENV"):
        reload_main()

    monkeypatch.setenv("APP_ENV", "prod")
    reload_main()
