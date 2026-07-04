"""Unit tests for raster.create_coarse_raster."""

from __future__ import annotations

import pytest

from raster import create_coarse_raster
from raster import raster_settings as settings


@pytest.fixture
def area_inputs(monkeypatch, tmp_path):
    """Full set of area coarse-build inputs for one resolution and two countries."""
    clc_dir = tmp_path / "clc"
    dem_dir = tmp_path / "dem"
    osm_dir = tmp_path / "osm"
    for directory in (clc_dir, dem_dir, osm_dir):
        directory.mkdir()
    monkeypatch.setattr(settings, "clc_dir", clc_dir)
    monkeypatch.setattr(settings, "dem_dir", dem_dir)
    monkeypatch.setattr(settings, "osm_dir", osm_dir)
    monkeypatch.setattr(settings, "coarse_resolutions", (320,))
    monkeypatch.setattr(settings, "eu_clc_classified", clc_dir / "area_clc_classes.tif")
    monkeypatch.setattr(settings, "eu_slope_classes", dem_dir / "eu_slope_classes.tif")

    files = {
        "area_clc": settings.eu_clc_classified,
        "area_slope": settings.eu_slope_classes,
        "coarse_clc": clc_dir / "eu_320m_clc_classes_stack.tif",
        "coarse_slope": dem_dir / "eu_320m_slope_classes.tif",
        "austria_roads": osm_dir / "austria_roads_smooth.tif",
        "denmark_roads": osm_dir / "denmark_roads_smooth.tif",
        "dissolved": tmp_path / "all_eu.gpkg",
    }
    for path in files.values():
        path.touch()
    return files


def test_check_area_inputs_passes_when_all_present(area_inputs):
    create_coarse_raster._check_area_inputs(
        countries=["austria", "denmark"], dissolved_gpkg=area_inputs["dissolved"]
    )


@pytest.mark.parametrize(
    "missing",
    [
        "area_clc",
        "area_slope",
        "dissolved",
        "coarse_clc",
        "coarse_slope",
        "denmark_roads",
    ],
)
def test_check_area_inputs_missing_input_raises(area_inputs, missing):
    area_inputs[missing].unlink()

    with pytest.raises(FileNotFoundError):
        create_coarse_raster._check_area_inputs(
            countries=["austria", "denmark"], dissolved_gpkg=area_inputs["dissolved"]
        )
