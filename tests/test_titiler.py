import os

import pytest
from fastapi.testclient import TestClient

import backend.main as main


@pytest.fixture(scope="module")
def client():

    with TestClient(main.app, raise_server_exceptions=False) as client:
        yield client


@pytest.fixture
def pin_default_raster(monkeypatch):
    """Resolve every zoom tier to the committed fixture raster.

    Endpoints hit without ``?raster=`` (and ``get_raster_path`` called without an
    explicit raster) otherwise resolve the tier files derived from backend/.env's
    area/version, which are not generated in the test environment. Pinning each
    tier to the committed fixture keeps those tests hermetic.
    """
    monkeypatch.setattr(main.settings, "raster_path", "raster/out")
    for attr in (
        "raster_file_z6",
        "raster_file_z7",
        "raster_file_z8",
        "raster_file_z99",
    ):
        monkeypatch.setattr(main.settings, attr, "test_raster.tif")


def test_raster_default_endpoint(client, pin_default_raster):
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
    assert response.status_code == 404


def test_directory_traversal(client):
    print("Testing raster endpoint with directory traversal...")
    response = client.get(
        "/tiles/WebMercatorQuad/0/0/0?raster=../tests/test_raster.tif"
    )
    # Blocked path resolves to 404 (not 500) so file existence is not disclosed.
    assert response.status_code == 404


# ─── RasterTier zoom tiering ───


# The zoom breaks are fixed (6/7/8/99). Tier filenames are derived from
# area/version by default, with optional per-tier file overrides. Synthetic file
# names let the selection logic run independently of real raster files on disk.
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
        (10, "fine.tif"),  # past the last finite break → finest tier
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


def test_settings_raster_tiers_derive_from_area_and_version():
    settings = main.Settings(
        _env_file=None,  # ty: ignore[unknown-argument]
        area="example",
        raster_version="v42",
    )

    assert [tier.raster for tier in settings.raster_tiers] == [
        "example_1280m_v42.tif",
        "example_640m_v42.tif",
        "example_320m_v42.tif",
        "example_20m_v42.tif",
    ]


def test_settings_raster_tiers_allow_per_tier_overrides():
    settings = main.Settings(
        _env_file=None,  # ty: ignore[unknown-argument]
        area="example",
        raster_version="v42",
        raster_file_z6="custom-z6.tif",
        raster_file_z99="custom-z99.tif",
    )

    assert [tier.raster for tier in settings.raster_tiers] == [
        "custom-z6.tif",
        "example_640m_v42.tif",
        "example_320m_v42.tif",
        "custom-z99.tif",
    ]


def test_get_raster_path_tiers_by_zoom(pin_default_raster):
    # A coarse zoom resolves to the coarsest tier file and a fine zoom to the
    # finest; with the tiers pinned to the fixture, both files exist on disk.
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


def test_env_example_sets_all_settings(monkeypatch):
    """.env.example must document every configurable Settings field and load
    cleanly into the expected values. Guards against a new field being added
    (like a new raster tier) without a matching entry in the example file."""
    # Isolate from any APP_* vars in the real environment / loaded .env so the
    # example file is the only source of values.
    for key in list(os.environ):
        if key.startswith("APP_"):
            monkeypatch.delenv(key, raising=False)

    env_example = main.APP_DIR / ".env.example"
    settings = main.Settings(_env_file=env_example)  # ty: ignore[unknown-argument]

    # Every required/base field is set by the example file. The per-tier file
    # settings are optional overrides; .env.example documents the derived naming
    # path through APP_AREA + APP_RASTER_VERSION instead.
    file_keys = {
        line.split("=", 1)[0].strip()
        for line in env_example.read_text().splitlines()
        if "=" in line and not line.lstrip().startswith("#")
    }
    optional_override_fields = {
        "raster_file_z6",
        "raster_file_z7",
        "raster_file_z8",
        "raster_file_z99",
    }
    expected_keys = {
        f"APP_{name.upper()}"
        for name in main.Settings.model_fields
        if name not in optional_override_fields
    }
    assert file_keys == expected_keys

    # Values parse to the documented example values, across every type.
    assert settings.env == "dev"
    assert settings.area == "comb"
    assert settings.raster_version == "v5"
    assert settings.allowed_tms == "WebMercatorQuad"
    assert settings.raster_path == "raster/out"
    assert settings.cors_origins == [
        "https://alleinseinkarte.de",
        "https://www.alleinseinkarte.de",
    ]
    assert settings.raster_file_z6 is None
    assert settings.raster_file_z7 is None
    assert settings.raster_file_z8 is None
    assert settings.raster_file_z99 is None
    assert [tier.raster for tier in settings.raster_tiers] == [
        "comb_1280m_v5.tif",
        "comb_640m_v5.tif",
        "comb_320m_v5.tif",
        "comb_20m_v5.tif",
    ]
    assert settings.enable_docs is True
    assert settings.add_preview is True
    assert settings.add_part is True
    assert settings.add_viewer is True
    assert settings.add_ogc_maps is True
