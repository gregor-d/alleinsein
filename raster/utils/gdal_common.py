#!/usr/bin/env python3
# pyright: reportMissingImports=false
"""Shared GDAL helper functions."""

from __future__ import annotations

import os
from pathlib import Path
from textwrap import dedent

from osgeo import gdal

from raster import raster_settings as settings
from raster.utils.helpers import banner


def make_pipeline(body: str) -> str:
    return dedent(body).strip().replace("\n", " ")


def raster_grid_bbox(path) -> str:
    dataset = gdal.Open(str(path))
    if dataset is None:
        raise FileNotFoundError(f"Cannot open raster: {path}")
    gt = dataset.GetGeoTransform()
    width, height = dataset.RasterXSize, dataset.RasterYSize
    dataset = None
    minx, maxy = gt[0], gt[3]
    maxx = minx + width * gt[1]
    miny = maxy + height * gt[5]  # gt[5] is negative
    return f"{minx},{miny},{maxx},{maxy}"


def configure_gdal() -> None:
    config = {
        "GDAL_CACHEMAX": settings.gdal_cachemax,
        "OSM_MAX_TMPFILE_SIZE": settings.osm_max_tmpfile_size,
        "CPL_TMPDIR": settings.cpl_tmpdir,
        "GDAL_NUM_THREADS": settings.gdal_num_threads,
        # Avoid directory scans when opening raster inputs.
        "GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR",
    }
    for key, value in config.items():
        os.environ[key] = value
        gdal.SetConfigOption(key, value)

    gdal.UseExceptions()


def clip_raster(
    *, source: Path, bbox: str, output: Path, hint: str | None = None
) -> None:
    """Clip a raster to a bbox.

    Args:
        source: Source raster.
        bbox: Clip bbox in the source CRS.
        output: Output raster.
        hint: Optional build command appended to missing-input errors.

    Raises:
        FileNotFoundError: If the source raster is missing.
    """
    banner(f"Clip {source} to bbox extent")
    if not source.is_file():
        msg = f"Missing raster: {source}"
        if hint:
            msg += f" — build it once with: {hint}"
        raise FileNotFoundError(msg)

    pipeline = make_pipeline(
        f"""
        ! read {source.as_posix()}
        ! clip --bbox={bbox} --allow-bbox-outside-source
        ! write {settings.gdal_pipeline_creation_options} {settings.overwrite_arg} {output.as_posix()}
        """
    )
    print(f"$ gdal raster pipeline {pipeline}")
    result = gdal.Run("raster pipeline", pipeline=pipeline)
    if hasattr(result, "Finalize"):
        result.Finalize()


def downsample_classified(*, source: Path, resolution: int, output: Path) -> None:
    """Downsample a classified raster with mode resampling.

    Args:
        source: Source classified raster.
        resolution: Output pixel size in metres.
        output: Output raster.
    """
    res_pair = f"{resolution},{resolution}"
    pipeline = make_pipeline(
        f"""
        ! read {source.as_posix()}
        ! reproject --resolution {res_pair} -r mode --target-aligned-pixels
        ! edit --nodata={settings.nodata}
        ! write {settings.overwrite_arg} {settings.gdal_pipeline_creation_options} {output.as_posix()}
        """
    )
    print(f"$ gdal raster pipeline {pipeline}")
    result = gdal.Run("raster pipeline", pipeline=pipeline)
    if hasattr(result, "Finalize"):
        result.Finalize()
