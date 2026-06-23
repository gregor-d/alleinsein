import pytest
from fastapi.testclient import TestClient

import backend.main as main


@pytest.fixture(scope="module")
def client():

    with TestClient(main.app, raise_server_exceptions=False) as client:
        yield client


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


def test_directory_traversal(client):
    print("Testing raster endpoint with directory traversal...")
    response = client.get(
        "/tiles/WebMercatorQuad/0/0/0?raster=../tests/test_raster.tif"
    )
    assert response.status_code == 500


# ─── RasterTier zoom tiering ───


# The zoom breaks are fixed (6/7/8/99); only the file per tier is configurable,
# one env var per tier. Synthetic file names — one per break — let the selection
# logic be exercised independently of the real raster files on disk.
@pytest.fixture
def synthetic_tiers(monkeypatch):
    monkeypatch.setattr(main.settings, "raster_file_z6", "coarse.tif")
    monkeypatch.setattr(main.settings, "raster_file_z7", "mid.tif")
    monkeypatch.setattr(main.settings, "raster_file_z8", "midfine.tif")
    monkeypatch.setattr(main.settings, "raster_file_z99", "fine.tif")


@pytest.mark.parametrize(
    "z, expected",
    [
        (0, "coarse.tif"),  # below the first break
        (6, "coarse.tif"),  # exactly on the first break (6)
        (7, "mid.tif"),  # on the second break (7)
        (8, "midfine.tif"),  # on the third break (8)
        (9, "fine.tif"),  # past the last finite break → finest tier
        (99, "fine.tif"),  # on the last break (99)
        (500, "fine.tif"),  # above the last break → still the finest tier
    ],
)
def test_select_tier_raster_by_zoom(synthetic_tiers, z, expected):
    assert main.select_tier_raster(z) == expected


def test_select_tier_raster_none_returns_finest(synthetic_tiers):
    # The tilejson endpoint has no z; it must resolve to the finest tier so its
    # metadata advertises full detail and the complete data footprint.
    assert main.select_tier_raster(None) == "fine.tif"


def test_get_raster_path_tiers_by_zoom():
    # With the real default config, a coarse zoom resolves to the coarsest tier
    # file and a fine zoom to the finest — and both files exist on disk.
    coarse = main.get_raster_path(z=0)
    fine = main.get_raster_path(z=500)
    assert coarse.name == main.settings.raster_tiers[0].raster
    assert fine.name == main.settings.raster_tiers[-1].raster
    assert coarse.is_file()
    assert fine.is_file()


def test_get_raster_path_explicit_raster_overrides_tier():
    # An explicit raster wins and bypasses zoom tiering entirely.
    path = main.get_raster_path(raster="test_raster.tif")
    assert path.name == "test_raster.tif"
