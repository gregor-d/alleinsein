"""Unit tests for raster.utils.helpers and raster.utils.gdal_common."""

from __future__ import annotations

import os

import pytest
from osgeo import gdal

from raster import raster_settings as settings
from raster.utils import gdal_common

CONFIG_KEYS = (
    "GDAL_CACHEMAX",
    "OSM_MAX_TMPFILE_SIZE",
    "CPL_TMPDIR",
    "GDAL_NUM_THREADS",
    "GDAL_DISABLE_READDIR_ON_OPEN",
)


def test_make_pipeline_collapses_template_to_one_line():
    pipeline = gdal_common.make_pipeline(
        """
        ! read input.tif
        ! clip --bbox=1,2,3,4
        ! write out.tif
        """
    )
    assert pipeline == "! read input.tif ! clip --bbox=1,2,3,4 ! write out.tif"


def test_configure_gdal_sets_env_and_gdal_config():
    previous_env = {key: os.environ.get(key) for key in CONFIG_KEYS}
    previous_config = {key: gdal.GetConfigOption(key) for key in CONFIG_KEYS}
    try:
        gdal_common.configure_gdal()

        expected = {
            "GDAL_CACHEMAX": settings.gdal_cachemax,
            "OSM_MAX_TMPFILE_SIZE": settings.osm_max_tmpfile_size,
            "CPL_TMPDIR": settings.cpl_tmpdir,
            "GDAL_NUM_THREADS": settings.gdal_num_threads,
            "GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR",
        }
        for key, value in expected.items():
            assert os.environ[key] == value
            assert gdal.GetConfigOption(key) == value
    finally:
        for key in CONFIG_KEYS:
            env_value = previous_env[key]
            if env_value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = env_value
            gdal.SetConfigOption(key, previous_config[key])


def test_raster_grid_bbox_returns_grid_extent(make_raster):
    raster = make_raster(
        width=10, height=5, pixel_size=20.0, origin=(4_000_000.0, 3_000_000.0)
    )

    bbox = gdal_common.raster_grid_bbox(raster)

    minx, miny, maxx, maxy = (float(value) for value in bbox.split(","))
    assert (minx, miny, maxx, maxy) == (
        4_000_000.0,
        2_999_900.0,
        4_000_200.0,
        3_000_000.0,
    )


def test_raster_grid_bbox_missing_raster_raises(tmp_path):
    # FileNotFoundError without gdal exceptions, RuntimeError with them enabled.
    with pytest.raises((FileNotFoundError, RuntimeError)):
        gdal_common.raster_grid_bbox(tmp_path / "missing.tif")


def test_clip_raster_builds_expected_pipeline(tmp_path, make_raster, gdal_run_calls):
    source = make_raster("src.tif")
    output = tmp_path / "out.tif"

    gdal_common.clip_raster(source=source, bbox="1,2,3,4", output=output)

    command, pipeline = gdal_run_calls[0]
    assert command == "raster pipeline"
    assert f"! read {source.as_posix()}" in pipeline
    assert "! clip --bbox=1,2,3,4 --allow-bbox-outside-source" in pipeline
    assert output.as_posix() in pipeline


def test_downsample_classified_builds_expected_pipeline(tmp_path, gdal_run_calls):
    source = tmp_path / "classified.tif"
    output = tmp_path / "coarse.tif"

    gdal_common.downsample_classified(source=source, resolution=160, output=output)

    _, pipeline = gdal_run_calls[0]
    assert f"! read {source.as_posix()}" in pipeline
    assert "--resolution 160,160" in pipeline
    assert "-r mode" in pipeline
    assert "--target-aligned-pixels" in pipeline
    assert f"--nodata={settings.nodata}" in pipeline
    assert output.as_posix() in pipeline
