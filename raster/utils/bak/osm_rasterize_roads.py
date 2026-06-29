# pyright: reportMissingImports=false
"""Step 3 - rasterize the roads and smooth them into a proximity heatmap.

Python counterpart of utils/osm_rasterize_roads.sh: burn the road network onto the
shared grid, then smooth it into a 1..10 road-proximity heatmap. (Slope is applied
separately/optionally by raster/create_slope_mod_band.sh, not here.)
"""

from __future__ import annotations

import time

from osgeo import gdal  # ty: ignore[unresolved-import]
from raster import raster_settings as settings
from raster.utils.raster_helpers import banner, make_pipeline


def rasterize_and_smooth_roads() -> None:
    banner("Rasterize and smooth roads")
    if not settings.dry_run and not settings.roads_gpkg.is_file():
        raise FileNotFoundError(f"Missing roads GeoPackage: {settings.roads_gpkg}")

    # 1. Burn the road network onto the shared grid (roads = 4, elsewhere = 0).
    start = time.monotonic()
    pipeline = make_pipeline(
        f"""
        ! read {settings.roads_gpkg.as_posix()}
        ! rasterize --resolution {settings.resolution} --extent {settings.bbox} --burn 4 --target-aligned-pixels --init 0 --nodata {settings.nodata} --datatype {settings.data_type} --all-touched
        ! write {settings.overwrite_arg} {settings.gtiff} {settings.roads_rasterized.as_posix()}
        """
    )
    print(f"$ gdal pipeline {pipeline}")
    if not settings.dry_run:
        result = gdal.Run("pipeline", pipeline=pipeline)
        if hasattr(result, "Finalize"):
            result.Finalize()
    duration = int(time.monotonic() - start)
    print(f"{duration // 60} minutes and {duration % 60} seconds elapsed.")

    # 2. Smooth the burned roads into the 1..10 proximity heatmap.
    start = time.monotonic()
    pipeline = make_pipeline(
        f"""
        ! read {settings.roads_rasterized.as_posix()}
        ! neighbours --method mean --size 5 --kernel gaussian
        ! reproject --resolution 100,100 -r sum
        ! resize --resolution {settings.resolution} -r bilinear
        ! neighbours --method mean --size 5 --kernel gaussian --nodata {settings.nodata}
        ! scale --src-min 0 --src-max 10 --dst-min 1 --dst-max 10 --ot {settings.data_type} --exponent 0.25
        ! write {settings.overwrite_arg} {settings.gtiff} {settings.roads_smooth.as_posix()}
        """
    )
    print(f"$ gdal raster pipeline {pipeline}")
    if not settings.dry_run:
        result = gdal.Run("raster pipeline", pipeline=pipeline)
        if hasattr(result, "Finalize"):
            result.Finalize()
    duration = int(time.monotonic() - start)
    print(f"{duration // 60} minutes and {duration % 60} seconds elapsed.")
