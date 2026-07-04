"""Unit tests for raster.utils.dem."""

from __future__ import annotations

import numpy as np
import pytest
from osgeo import gdal

from raster import raster_settings as settings
from raster.utils import dem


@pytest.fixture
def downsample_calls(monkeypatch):
    """Record downsample_classified calls made by _create_slope_classes."""
    calls: list[dict] = []
    monkeypatch.setattr(
        dem, "downsample_classified", lambda **kwargs: calls.append(kwargs)
    )
    return calls


def test_create_slope_classes_missing_dem_raises(tmp_path):
    with pytest.raises(FileNotFoundError, match="Missing DEM slope input raster"):
        dem._create_slope_classes(
            dem_slope_source=tmp_path / "slope.tif",
            slope_mapping=tmp_path / "mapping.txt",
            output=tmp_path / "classes.tif",
        )


def test_create_slope_classes_missing_mapping_raises(tmp_path):
    dem_slope = tmp_path / "slope.tif"
    dem_slope.touch()

    with pytest.raises(FileNotFoundError, match="Missing slope mapping file"):
        dem._create_slope_classes(
            dem_slope_source=dem_slope,
            slope_mapping=tmp_path / "mapping.txt",
            output=tmp_path / "classes.tif",
        )


def test_create_slope_classes_with_bbox_skips_coarse_builds(
    tmp_path, gdal_run_calls, downsample_calls
):
    dem_slope = tmp_path / "slope.tif"
    dem_slope.touch()
    mapping = tmp_path / "mapping.txt"
    mapping.touch()
    output = tmp_path / "classes.tif"

    dem._create_slope_classes(
        dem_slope_source=dem_slope,
        slope_mapping=mapping,
        output=output,
        bbox="1,2,3,4",
    )

    _, pipeline = gdal_run_calls[0]
    assert f"--bbox=1,2,3,4 --bbox-crs={settings.target_epsg}" in pipeline
    assert f"--mapping=@{mapping.as_posix()}" in pipeline
    assert "-r nearest" in pipeline
    assert downsample_calls == []


def test_create_slope_classes_without_bbox_builds_coarse_tiers(
    tmp_path, gdal_run_calls, downsample_calls
):
    dem_slope = tmp_path / "slope.tif"
    dem_slope.touch()
    mapping = tmp_path / "mapping.txt"
    mapping.touch()
    output = tmp_path / "classes.tif"

    dem._create_slope_classes(
        dem_slope_source=dem_slope, slope_mapping=mapping, output=output
    )

    assert [call["resolution"] for call in downsample_calls] == list(
        settings.coarse_resolutions
    )
    assert all(call["source"] == output for call in downsample_calls)


def test_calculate_slope_mod_band_missing_raw_raises(tmp_path):
    with pytest.raises(FileNotFoundError, match="Missing raw heatmap raster"):
        dem.calculate_slope_mod_band(
            raw_calc=tmp_path / "raw.tif",
            slope_classes=tmp_path / "classes.tif",
            slope_mod=tmp_path / "mod.tif",
        )


def test_calculate_slope_mod_band_missing_slope_classes_raises(tmp_path):
    raw = tmp_path / "raw.tif"
    raw.touch()

    with pytest.raises(FileNotFoundError, match="Missing slope classes raster"):
        dem.calculate_slope_mod_band(
            raw_calc=raw,
            slope_classes=tmp_path / "classes.tif",
            slope_mod=tmp_path / "mod.tif",
        )


def test_calculate_slope_mod_band_applies_penalty(tmp_path, make_raster):
    # Encoded aloneness: nature 1..10, farm 11..20, park 21..30, urban 31..40,
    # water 200. Slope classes 1..4 subtract SLOPE_PENALTY, clamped to >=1, and a
    # within-class score of 10 is never modified.
    raw_values = np.array([[5, 15, 10], [23, 200, 40]], dtype=np.uint8)
    slope_values = np.array([[4, 2, 1], [3, 3, 4]], dtype=np.uint8)
    raw = make_raster("raw.tif", width=3, height=2, data=[raw_values])
    slope_classes = make_raster("classes.tif", width=3, height=2, data=[slope_values])
    slope_mod = tmp_path / "mod.tif"

    dem.calculate_slope_mod_band(
        raw_calc=raw, slope_classes=slope_classes, slope_mod=slope_mod
    )

    dataset = gdal.Open(str(slope_mod))
    result = dataset.GetRasterBand(1).ReadAsArray()
    assert dataset.GetRasterBand(1).GetNoDataValue() == settings.nodata
    dataset = None
    expected = np.array(
        [
            # 5 - 4 -> 1; 15: farm score 5 - 2 -> 13; 10: score 10 stays untouched
            [1, 13, 10],
            # 23: park score 3 - 3 clamps to 21; water passes through; 40: score 10
            [21, 200, 40],
        ],
        dtype=np.uint8,
    )
    np.testing.assert_array_equal(result, expected)
