"""Unit tests for raster.utils.gdal_controller."""

from __future__ import annotations

import numpy as np
import pytest
from osgeo import gdal

from raster import raster_settings as settings
from raster.utils import gdal_controller


def test_encode_heatmap_missing_roads_raises(tmp_path):
    with pytest.raises(FileNotFoundError, match="Missing roads smooth raster"):
        gdal_controller.encode_heatmap(
            roads=tmp_path / "roads.tif",
            clc_stack=tmp_path / "stack.tif",
            out=tmp_path / "out.tif",
        )


def test_encode_heatmap_missing_clc_stack_raises(tmp_path):
    roads = tmp_path / "roads.tif"
    roads.touch()

    with pytest.raises(FileNotFoundError, match="Missing CLC one-hot stack"):
        gdal_controller.encode_heatmap(
            roads=roads, clc_stack=tmp_path / "stack.tif", out=tmp_path / "out.tif"
        )


def test_encode_heatmap_offsets_score_per_land_cover_class(tmp_path, make_raster):
    # Five pixels, each one-hot in a different class band (nature, farm, park,
    # urban, water); a road score of 5 must land in each class's value range.
    roads = make_raster("roads.tif", width=5, height=1, fill=5)
    stack_bands = [
        np.array([[1, 0, 0, 0, 0]], dtype=np.uint8),  # nature
        np.array([[0, 1, 0, 0, 0]], dtype=np.uint8),  # farm
        np.array([[0, 0, 1, 0, 0]], dtype=np.uint8),  # park
        np.array([[0, 0, 0, 1, 0]], dtype=np.uint8),  # urban
        np.array([[0, 0, 0, 0, 1]], dtype=np.uint8),  # water
    ]
    clc_stack = make_raster("stack.tif", width=5, height=1, bands=5, data=stack_bands)
    out = tmp_path / "encoded.tif"

    gdal_controller.encode_heatmap(roads=roads, clc_stack=clc_stack, out=out)

    dataset = gdal.Open(str(out))
    result = dataset.GetRasterBand(1).ReadAsArray()
    dataset = None
    np.testing.assert_array_equal(
        result, np.array([[5, 15, 25, 35, 200]], dtype=np.uint8)
    )


def test_stack_raw_and_slope_bands_missing_input_raises(tmp_path):
    raw = tmp_path / "raw.tif"
    raw.touch()

    with pytest.raises(FileNotFoundError, match="Missing slope-modified band"):
        gdal_controller.stack_raw_and_slope_bands(
            raw_calc=raw, slope_mod=tmp_path / "mod.tif", output_dir=tmp_path
        )


def test_stack_raw_and_slope_bands_builds_expected_pipeline(tmp_path, gdal_run_calls):
    raw = tmp_path / "raw.tif"
    raw.touch()
    slope_mod = tmp_path / "mod.tif"
    slope_mod.touch()

    stacked = gdal_controller.stack_raw_and_slope_bands(
        raw_calc=raw, slope_mod=slope_mod, output_dir=tmp_path
    )

    _, pipeline = gdal_run_calls[0]
    assert pipeline.startswith(f"! stack {raw.as_posix()} {slope_mod.as_posix()}")
    assert f"--dst-nodata {settings.nodata}" in pipeline
    assert f"--resolution {settings.resolution}" in pipeline
    assert stacked.as_posix() in pipeline


def test_stack_raw_and_slope_bands_accepts_coarse_resolution(tmp_path, gdal_run_calls):
    raw = tmp_path / "raw.tif"
    raw.touch()
    slope_mod = tmp_path / "mod.tif"
    slope_mod.touch()

    gdal_controller.stack_raw_and_slope_bands(
        raw_calc=raw,
        slope_mod=slope_mod,
        output_path=tmp_path / "stacked.tif",
        resolution="640,640",
    )

    _, pipeline = gdal_run_calls[0]
    assert "--resolution 640,640" in pipeline


def test_mosaic_rasters_missing_input_raises(tmp_path):
    with pytest.raises(FileNotFoundError, match="Missing per-country raster"):
        gdal_controller.mosaic_rasters(
            rasters=[tmp_path / "a.tif"], mosaic_vrt=tmp_path / "mosaic.vrt"
        )


def test_mosaic_rasters_builds_vrt_spanning_sources(tmp_path, make_raster):
    # Two 4x4 tiles side by side on the same 20 m grid.
    left = make_raster("left.tif", origin=(4_000_000.0, 3_000_000.0), fill=1)
    right = make_raster("right.tif", origin=(4_000_080.0, 3_000_000.0), fill=2)
    mosaic_vrt = tmp_path / "mosaic.vrt"

    gdal_controller.mosaic_rasters(rasters=[left, right], mosaic_vrt=mosaic_vrt)

    dataset = gdal.Open(str(mosaic_vrt))
    assert dataset.RasterXSize == 8
    assert dataset.RasterYSize == 4
    values = dataset.GetRasterBand(1).ReadAsArray()
    dataset = None
    assert set(np.unique(values)) == {1, 2}


def test_create_web_cog_from_stacked_missing_input_raises(tmp_path):
    with pytest.raises(FileNotFoundError, match="Missing stacked raster"):
        gdal_controller.create_web_cog_from_stacked(
            stacked_3035=tmp_path / "stacked.tif",
            output_cog=tmp_path / "out.tif",
            bounds_gpkg=tmp_path / "bounds.gpkg",
            boundary_name="testland",
        )


def test_create_web_cog_from_stacked_clip_to_layer_pipeline(
    tmp_path, gdal_run_calls, settings_temp_dir, monkeypatch
):
    stacked = tmp_path / "stacked.tif"
    stacked.touch()
    bounds_gpkg = tmp_path / "bounds.gpkg"
    output_cog = tmp_path / "out.tif"
    cog_calls = []
    monkeypatch.setattr(
        gdal_controller, "write_web_cog", lambda **kwargs: cog_calls.append(kwargs)
    )

    gdal_controller.create_web_cog_from_stacked(
        stacked_3035=stacked,
        output_cog=output_cog,
        bounds_gpkg=bounds_gpkg,
        boundary_name="testland",
        clip_to_layer=True,
    )

    _, pipeline = gdal_run_calls[0]
    assert (
        f"! clip --like {bounds_gpkg.as_posix()} --like-layer testland "
        "--allow-bbox-outside-source" in pipeline
    )
    assert cog_calls[0]["out_cog"] == output_cog


def test_build_coarse_encoded_resamples_and_encodes(
    tmp_path, gdal_run_calls, settings_temp_dir, monkeypatch
):
    monkeypatch.setattr(gdal_controller, "raster_grid_bbox", lambda path: "10,20,30,40")
    encode_calls = []
    monkeypatch.setattr(
        gdal_controller, "encode_heatmap", lambda **kwargs: encode_calls.append(kwargs)
    )

    raw = gdal_controller._build_coarse_encoded(
        resolution=320,
        roads_smooth=tmp_path / "roads_smooth.tif",
        country_coarse_clc=tmp_path / "area_clc_stack.tif",
        output_dir=tmp_path,
    )

    _, roads_pipeline = gdal_run_calls[0]
    assert "--resolution 320,320 -r average --target-aligned-pixels" in roads_pipeline
    assert "--dst-min 1 --dst-max 10" in roads_pipeline

    _, clc_pipeline = gdal_run_calls[1]
    assert "--bbox=10,20,30,40" in clc_pipeline
    assert "--resolution=320,320 -r nearest" in clc_pipeline

    assert encode_calls[0]["out"] == raw


def test_build_coarse_slope_mod_downsamples_with_mode(
    tmp_path, gdal_run_calls, settings_temp_dir, monkeypatch
):
    monkeypatch.setattr(gdal_controller, "raster_grid_bbox", lambda path: "10,20,30,40")
    calc_calls = []
    monkeypatch.setattr(
        gdal_controller,
        "calculate_slope_mod_band",
        lambda **kwargs: calc_calls.append(kwargs),
    )
    raw = tmp_path / "raw.tif"

    slope_mod = gdal_controller._build_coarse_slope_mod(
        resolution=640,
        slope_classes=tmp_path / "eu_slope_classes.tif",
        raw=raw,
        output_dir=tmp_path,
    )

    _, pipeline = gdal_run_calls[0]
    assert "--bbox=10,20,30,40" in pipeline
    assert "--resolution=640,640 -r mode" in pipeline

    assert calc_calls[0]["raw_calc"] == raw
    assert calc_calls[0]["slope_mod"] == slope_mod


def test_build_coarse_stacked_raster_pipeline(tmp_path, monkeypatch):
    encoded_calls = []
    slope_calls = []
    stack_calls = []

    monkeypatch.setattr(
        gdal_controller,
        "_build_coarse_encoded",
        lambda **kwargs: (encoded_calls.append(kwargs), tmp_path / "raw.tif")[1],
    )
    monkeypatch.setattr(
        gdal_controller,
        "_build_coarse_slope_mod",
        lambda **kwargs: (slope_calls.append(kwargs), tmp_path / "slope_mod.tif")[1],
    )
    monkeypatch.setattr(
        gdal_controller,
        "stack_raw_and_slope_bands",
        lambda **kwargs: (stack_calls.append(kwargs), tmp_path / "stacked.tif")[1],
    )

    stacked = gdal_controller.build_coarse_stacked_raster(
        resolution=640,
        roads_smooth=tmp_path / "roads_smooth.tif",
        clc_classified=tmp_path / "clc.tif",
        slope_classes=tmp_path / "slope.tif",
        output_dir=tmp_path,
    )

    assert stacked == tmp_path / "stacked.tif"
    assert encoded_calls[0] == {
        "resolution": 640,
        "roads_smooth": tmp_path / "roads_smooth.tif",
        "country_coarse_clc": tmp_path / "clc.tif",
        "output_dir": tmp_path,
    }
    assert slope_calls[0] == {
        "resolution": 640,
        "slope_classes": tmp_path / "slope.tif",
        "raw": tmp_path / "raw.tif",
        "output_dir": tmp_path,
    }
    assert stack_calls[0] == {
        "raw_calc": tmp_path / "raw.tif",
        "slope_mod": tmp_path / "slope_mod.tif",
        "output_dir": tmp_path,
        "resolution": "640,640",
    }
