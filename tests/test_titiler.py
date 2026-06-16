import pytest
from fastapi.testclient import TestClient
from backend.main import app


@pytest.fixture(scope="module")
def client():

    with TestClient(app, raise_server_exceptions=False) as client:
        yield client


# @pytest.mark.skip()
def test_raster_default_endpoint(client):
    print("Testing default raster endpoint...")
    response = client.get("/tiles/WebMercatorQuad/0/0/0")
    print(response.headers)
    assert response.status_code == 200
    assert "content-bbox" in response.headers
    assert "content-crs" in response.headers


def test_raster_endpoint(client):
    print("Testing specified raster endpoint...")
    response = client.get("/tiles/WebMercatorQuad/0/0/0?raster=test_raster.tif")
    print(response.headers)
    assert response.status_code == 200
    assert "content-bbox" in response.headers
    assert "content-crs" in response.headers


def test_raster_non_existent_endpoint(client):
    print("Testing non-existent raster endpoint...")
    response = client.get("/tiles/WebMercatorQuad/0/0/0?raster=wrong_test_raster.tif")
    assert response.status_code == 500


def test_raster_secure_endpoint(client):
    print("Testing raster endpoint with directory traversal...")
    response = client.get(
        "/tiles/WebMercatorQuad/0/0/0?raster=../tests/test_raster.tif"
    )
    assert response.status_code == 500


def test_tile_json_info(client):
    print("Testing raster endpoint with directory traversal...")
    response = client.get(
        "/tiles/WebMercatorQuad/0/0/0?raster=../tests/test_raster.tif"
    )
    assert response.status_code == 500
