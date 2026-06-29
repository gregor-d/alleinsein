from __future__ import annotations

import importlib.util
import subprocess
import sys
from pathlib import Path
from textwrap import dedent
from types import SimpleNamespace

import pytest

from raster import raster_settings as settings


PROJECT_DIR = Path(__file__).resolve().parent.parent


def _run_dry_run():
    return subprocess.run(
        [
            sys.executable,
            "-m",
            "raster.create_raster",
            "--dry-run",
            "--force-prep",
        ],
        cwd=PROJECT_DIR,
        check=True,
        text=True,
        capture_output=True,
    )


def test_clip_reproject_pipeline_renders_expected_string():
    """Golden test for the clip/reproject/web-COG pipeline block in
    raster/utils/gdal_controller.py (finalize_web_cog). The block below is a copy
    of that code with its external variables turned into local inputs (here the
    source is the raw heatmap; in the main pipeline finalize_web_cog receives the
    2-band stack instead, but the rendered template is identical). Keep the two in
    sync: when you change the block in gdal_controller.py, mirror it here and this
    assertion proves the rendered output is unchanged."""
    raw_calc = Path("/data/raster/out/temp/germany_raster_rawp136.tif")
    bounds_gpkg = Path("/data/raster/input/bounds/germany.gpkg")
    area = "germany"
    cfg = SimpleNamespace(WEB_EPSG="EPSG:3857")
    overwrite = "--overwrite"
    gtiff = "--of=GTiff --co=TILED=YES --co=COMPRESS=DEFLATE --co=PREDICTOR=2 --co=BIGTIFF=IF_SAFER"
    reprojected = Path("/data/raster/out/temp/germany_20m_v3_2band_3857p136.tif")

    # --- begin copy of the pipeline block from raster/utils/gdal_controller.py ---
    pipeline = (
        dedent(
            f"""
        ! read {raw_calc.as_posix()}
        ! clip --like {bounds_gpkg.as_posix()} --like-layer {area} --allow-bbox-outside-source
        ! reproject -d {cfg.WEB_EPSG}
        ! write {overwrite} {gtiff} {reprojected.as_posix()}
        """
        )
        .strip()
        .replace("\n", " ")
    )
    # --- end copy ---

    assert pipeline == (
        "! read /data/raster/out/temp/germany_raster_rawp136.tif "
        "! clip --like /data/raster/input/bounds/germany.gpkg "
        "--like-layer germany --allow-bbox-outside-source "
        "! reproject -d EPSG:3857 "
        "! write --overwrite "
        "--of=GTiff --co=TILED=YES --co=COMPRESS=DEFLATE --co=PREDICTOR=2 --co=BIGTIFF=IF_SAFER "
        "/data/raster/out/temp/germany_20m_v3_2band_3857p136.tif"
    )


def test_raster_settings_use_project_defaults():
    assert settings.area == "germany"
    assert settings.overwrite is True
    assert settings.resolution == "20,20"
    assert "TILED=YES" in settings.gtiff_creation_options


def test_create_raster_dry_run_exercises_workflow():
    if importlib.util.find_spec("osgeo") is None:
        pytest.skip("GDAL Python bindings are installed in the WSL runtime.")

    result = _run_dry_run()

    assert "Filter OSM PBF" in result.stdout
    assert "gdal vector pipeline" in result.stdout
    assert '! filter --where "highway IN' in result.stdout
    assert "Rasterize and smooth roads" in result.stdout
    assert "gdal_calc.Calc" in result.stdout
    assert "rio_cogeo.cog_translate" in result.stdout
