"""Unit tests for raster.utils.osm."""

from __future__ import annotations

import sys

import pytest

from raster import raster_settings as settings
from raster.utils import osm


@pytest.fixture
def run_osmium(monkeypatch):
    """Pretend osmium is installed and record the subprocess commands."""
    commands: list[list[str]] = []

    monkeypatch.setattr(osm.shutil, "which", lambda name: f"/usr/bin/{name}")
    monkeypatch.setattr(
        osm.subprocess,
        "run",
        lambda cmd, check: commands.append(cmd),
    )
    return commands


def test_extract_country_pbf_missing_source_pbf_raises(tmp_path):
    with pytest.raises(FileNotFoundError, match="Missing source PBF"):
        osm.extract_country_pbf(
            source_pbf=tmp_path / "europe.osm.pbf",
            out_pbf=tmp_path / "country.osm.pbf",
            bbox_4326="5,45,15,55",
        )


def test_extract_country_pbf_missing_osmium_raises(tmp_path, monkeypatch):
    source_pbf = tmp_path / "europe.osm.pbf"
    source_pbf.touch()
    monkeypatch.setattr(osm.shutil, "which", lambda name: None)

    with pytest.raises(RuntimeError, match="Missing required executable: osmium"):
        osm.extract_country_pbf(
            source_pbf=source_pbf,
            out_pbf=tmp_path / "country.osm.pbf",
            bbox_4326="5,45,15,55",
        )


def test_extract_country_pbf_builds_osmium_command(tmp_path, run_osmium):
    source_pbf = tmp_path / "europe.osm.pbf"
    source_pbf.touch()
    out_pbf = tmp_path / "country.osm.pbf"

    osm.extract_country_pbf(
        source_pbf=source_pbf, out_pbf=out_pbf, bbox_4326="5,45,15,55"
    )

    command = run_osmium[0]
    assert command[:2] == ["osmium", "extract"]
    assert command[command.index("--bbox") + 1] == "5,45,15,55"
    assert "--set-bounds" in command
    assert "--strategy=complete_ways" in command
    assert command[command.index("-o") + 1] == str(out_pbf)
    assert "--overwrite" in command
    assert command[-1] == str(source_pbf)


def test_filter_osm_pbf_missing_input_raises(tmp_path):
    with pytest.raises(FileNotFoundError, match="Missing OSM PBF input"):
        osm.filter_osm_pbf(
            osm_latest=tmp_path / "latest.osm.pbf",
            osm_filtered=tmp_path / "filtered.osm.pbf",
        )


def test_filter_osm_pbf_builds_osmium_command(tmp_path, run_osmium):
    osm_latest = tmp_path / "latest.osm.pbf"
    osm_latest.touch()
    osm_filtered = tmp_path / "filtered.osm.pbf"

    osm.filter_osm_pbf(osm_latest=osm_latest, osm_filtered=osm_filtered)

    command = run_osmium[0]
    assert command[:2] == ["osmium", "tags-filter"]
    assert "w/highway" in command
    assert "w/railway" in command
    assert command[command.index("-o") + 1] == str(osm_filtered)


def test_source_roads_pbf_path_derives_from_pbf_name(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "osm_dir", tmp_path)
    monkeypatch.setattr(settings, "europe_pbf_name", "europe-123.osm.pbf")

    assert osm._source_roads_pbf_path() == tmp_path / "europe-123-roads.osm.pbf"


def test_create_roads_gpkg_missing_input_raises(tmp_path):
    with pytest.raises(FileNotFoundError, match="Missing filtered OSM PBF"):
        osm.create_roads_gpkg(
            osm_filtered=tmp_path / "filtered.osm.pbf",
            roads_gpkg=tmp_path / "roads.gpkg",
        )


def test_create_roads_gpkg_builds_expected_pipeline(tmp_path, gdal_run_calls):
    osm_filtered = tmp_path / "filtered.osm.pbf"
    osm_filtered.touch()
    roads_gpkg = tmp_path / "roads.gpkg"

    osm.create_roads_gpkg(osm_filtered=osm_filtered, roads_gpkg=roads_gpkg)

    command, pipeline = gdal_run_calls[0]
    assert command == "vector pipeline"
    assert f"! read {osm_filtered.as_posix()} --if OSM --layer lines" in pipeline
    assert f'! filter --where "{osm.OSM_WHERE}"' in pipeline
    assert f"! reproject --dst-crs {settings.target_epsg}" in pipeline
    assert "--lco SPATIAL_INDEX=NO" in pipeline


def test_rasterize_roads_missing_gpkg_raises(tmp_path):
    with pytest.raises(FileNotFoundError, match="Missing roads GeoPackage"):
        osm.rasterize_roads(
            roads_gpkg=tmp_path / "roads.gpkg",
            roads_rasterized=tmp_path / "roads.tif",
        )


def test_rasterize_roads_uses_given_bbox(tmp_path, gdal_run_calls):
    roads_gpkg = tmp_path / "roads.gpkg"
    roads_gpkg.touch()

    osm.rasterize_roads(
        roads_gpkg=roads_gpkg,
        roads_rasterized=tmp_path / "roads.tif",
        bbox="1,2,3,4",
    )

    _, pipeline = gdal_run_calls[0]
    assert "--extent 1,2,3,4" in pipeline
    assert "--burn 4" in pipeline
    assert "--target-aligned-pixels" in pipeline
    assert f"--resolution {settings.resolution}" in pipeline


def test_rasterize_roads_defaults_to_layer_extent(tmp_path, gdal_run_calls):
    import geopandas as gpd
    from shapely.geometry import LineString

    roads_gpkg = tmp_path / "roads.gpkg"
    gpd.GeoDataFrame(
        geometry=[LineString([(4_300_000, 2_700_000), (4_301_000, 2_701_000)])],
        crs="EPSG:3035",
    ).to_file(roads_gpkg, driver="GPKG")

    osm.rasterize_roads(roads_gpkg=roads_gpkg, roads_rasterized=tmp_path / "roads.tif")

    _, pipeline = gdal_run_calls[0]
    assert "--extent 4300000.0,2700000.0,4301000.0,2701000.0" in pipeline


def test_smooth_roads_missing_input_raises(tmp_path):
    with pytest.raises(FileNotFoundError, match="Missing rasterized roads"):
        osm.smooth_roads(
            roads_rasterized=tmp_path / "roads.tif",
            roads_smooth=tmp_path / "smooth.tif",
        )


def test_smooth_roads_builds_expected_pipeline(tmp_path, gdal_run_calls):
    roads_rasterized = tmp_path / "roads.tif"
    roads_rasterized.touch()
    roads_smooth = tmp_path / "smooth.tif"

    osm.smooth_roads(roads_rasterized=roads_rasterized, roads_smooth=roads_smooth)

    _, pipeline = gdal_run_calls[0]
    assert "! neighbours --method mean --size 5 --kernel gaussian" in pipeline
    assert "! reproject --resolution 100,100 -r sum" in pipeline
    assert "--src-min 0 --src-max 10 --dst-min 1 --dst-max 10" in pipeline
    assert "--exponent 0.25" in pipeline
    assert roads_smooth.as_posix() in pipeline


def test_build_roads_rasterized_missing_source_roads_pbf_raises(tmp_path):
    with pytest.raises(
        FileNotFoundError,
        match=r"uv run python -m raster\.utils\.osm austria filter",
    ):
        osm.build_roads_rasterized(
            label="austria",
            source_roads_pbf=tmp_path / "europe-123-roads.osm.pbf",
            bbox="1,2,3,4",
            tmp_dir=tmp_path,
            roads_rasterized=tmp_path / "roads.tif",
        )


def test_main_full_chain_extracts_from_shared_roads_pbf(monkeypatch, tmp_path):
    osm_dir = tmp_path / "osm"
    bounds_dir = tmp_path / "bounds"
    temp_dir = tmp_path / "tmp"
    for directory in (osm_dir, bounds_dir, temp_dir):
        directory.mkdir()

    monkeypatch.setattr(sys, "argv", ["osm.py", "austria"])
    monkeypatch.setattr(settings, "osm_dir", osm_dir)
    monkeypatch.setattr(settings, "bounds_dir", bounds_dir)
    monkeypatch.setattr(settings, "temp_dir", temp_dir)
    monkeypatch.setattr(settings, "europe_pbf_name", "europe-123.osm.pbf")
    (bounds_dir / "austria.gpkg").touch()
    monkeypatch.setattr(osm, "configure_gdal", lambda: None)
    monkeypatch.setattr(osm.bounds, "get_bbox", lambda **kwargs: "1,2,3,4")
    filter_calls = []
    monkeypatch.setattr(
        osm, "filter_osm_pbf", lambda **kwargs: filter_calls.append(kwargs)
    )
    build_calls = []
    monkeypatch.setattr(
        osm, "build_roads_rasterized", lambda **kwargs: build_calls.append(kwargs)
    )
    smooth_calls = []
    monkeypatch.setattr(
        osm, "smooth_roads", lambda **kwargs: smooth_calls.append(kwargs)
    )

    osm.main()

    assert filter_calls == []
    assert build_calls[0]["source_roads_pbf"] == osm_dir / "europe-123-roads.osm.pbf"
    assert smooth_calls == [
        {
            "roads_rasterized": build_calls[0]["roads_rasterized"],
            "roads_smooth": osm_dir / "austria_roads_smooth.tif",
        }
    ]
