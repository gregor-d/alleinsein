import importlib

import pytest
from fastapi.testclient import TestClient
import backend.main as main_module

# test different environments prod vs dev
@pytest.mark.parametrize("env", ["prod", "dev"])
def test_environments(env, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("APP_ENV", env)

    # from backend.main import app
    main = importlib.reload(main_module)
    
    with TestClient(main.app, raise_server_exceptions=False) as client:
        response = client.get("/healthz")
        assert response.status_code == 200
        assert response.json()["env"] == env

        resp = client.get("/viewer")
        if env == "prod":
            assert resp.status_code == 404
        else:
            assert resp.status_code == 200
