"""Unit tests for raster.utils.clc."""

from __future__ import annotations

import pytest

from raster import raster_settings as settings
from raster.utils import clc


def test_create_eu_clc_classified_missing_source_raises(tmp_path):
    with pytest.raises(FileNotFoundError, match="Missing CLC input raster"):
        clc._create_source_clc_classified(
            clc_source=tmp_path / "clc.tif", clc_mapping=tmp_path / "mapping.txt"
        )


def test_create_eu_clc_classified_missing_mapping_raises(tmp_path):
    clc_source = tmp_path / "clc.tif"
    clc_source.touch()

    with pytest.raises(FileNotFoundError, match="Missing CLC mapping file"):
        clc._create_source_clc_classified(
            clc_source=clc_source, clc_mapping=tmp_path / "mapping.txt"
        )


def test_build_clc_onehot_stack_builds_one_band_per_class(
    tmp_path, gdal_run_calls, settings_temp_dir
):
    classified = tmp_path / "classified.tif"
    out = tmp_path / "stack.tif"

    clc.build_clc_onehot_stack(classified=classified, out=out)

    # One reclassify per class, then one stack call.
    assert len(gdal_run_calls) == len(clc.CLASS_CODES) + 1
    for class_code, (_, pipeline) in zip(clc.CLASS_CODES, gdal_run_calls, strict=False):
        assert f'--mapping "{class_code}=1;DEFAULT=0;NO_DATA=NO_DATA"' in pipeline
        assert "--of=GDALG" in pipeline

    _, stack_pipeline = gdal_run_calls[-1]
    assert stack_pipeline.startswith("! stack ")
    assert stack_pipeline.count(".gdalg.json") == len(clc.CLASS_CODES)
    assert f"--dst-nodata {settings.nodata}" in stack_pipeline
    assert f"--resolution {settings.resolution}" in stack_pipeline
    assert out.as_posix() in stack_pipeline


def test_build_clc_onehot_stack_accepts_coarse_resolution(
    tmp_path, gdal_run_calls, settings_temp_dir
):
    clc.build_clc_onehot_stack(
        classified=tmp_path / "classified.tif",
        out=tmp_path / "stack.tif",
        resolution="320,320",
    )

    _, stack_pipeline = gdal_run_calls[-1]
    assert "--resolution 320,320" in stack_pipeline
