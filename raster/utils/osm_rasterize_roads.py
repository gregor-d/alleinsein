# pyright: reportMissingImports=false
"""Step 3 - rasterize the roads, smooth them, then apply the slope modifier.

Python counterpart of utils/osm_rasterize_roads.sh, plus the extra slope modifier
that only the Python pipeline applies.

Order matters: the road network is burned onto the shared grid and smoothed into a
1..10 proximity heatmap *first* (the proven, unmodified pipeline), and only then is
the slope modifier applied - masked so it touches **off-road pixels only**. Road
pixels keep their full proximity value, while steeper off-road terrain reads as more
secluded. Applying the modifier before smoothing instead erased road pixels in steep
terrain (the burn value 4 minus a penalty of up to 6 clamps to 0), which then spread
through the blur and made actual roads look secluded.

The rasterize + smooth executions are currently disabled (commented out) so the slope
step can be iterated against cached intermediates; re-enable them to regenerate.
"""

from __future__ import annotations

import time

from raster import raster_settings as settings
from raster.utils.raster_helpers import banner, make_pipeline

# Per slope class (1=flat .. 4=steep), how much to subtract from the proximity score.
SLOPE_PENALTY = "where(G==1, 0, where(G==2, 1, where(G==3, 3, where(G==4, 6, 0))))"

# Off-road pixels (R==0) get the slope penalty subtracted and re-clamped into the
# valid 1..10 range (never 0, which downstream reads as unclassified). Road pixels
# (R>0) and nodata (255) pass through unchanged, so roads always keep full proximity.
SLOPE_OFFROAD_CALC = (
    f"where(A==255, 255, where(R>0, A, maximum(A - ({SLOPE_PENALTY}), 1)))"
)


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
        from osgeo import gdal  # ty: ignore[unresolved-import]

        result = gdal.Run("pipeline", pipeline=pipeline)
        if hasattr(result, "Finalize"):
            result.Finalize()
    duration = int(time.monotonic() - start)
    print(f"{duration // 60} minutes and {duration % 60} seconds elapsed.")

    # 2. Smooth the burned roads into the 1..10 proximity heatmap (unmodified).
    start = time.monotonic()
    pipeline = make_pipeline(
        f"""
        ! read {settings.roads_rasterized.as_posix()}
        ! neighbours --method mean --size 5 --kernel gaussian
        ! reproject --resolution 100,100 -r sum
        ! resize --resolution {settings.resolution} -r bilinear
        ! neighbours --method mean --size 5 --kernel gaussian --nodata {settings.nodata}
        ! scale --src-min 0 --src-max 10 --dst-min 1 --dst-max 10 --ot {settings.data_type} --exponent 0.25
        ! write {settings.overwrite_arg} {settings.gtiff} {settings.roads_smooth_base.as_posix()}
        """
    )
    print(f"$ gdal raster pipeline {pipeline}")
    if not settings.dry_run:
        from osgeo import gdal  # ty: ignore[unresolved-import]

        result = gdal.Run("raster pipeline", pipeline=pipeline)
        if hasattr(result, "Finalize"):
            result.Finalize()
    duration = int(time.monotonic() - start)
    print(f"{duration // 60} minutes and {duration % 60} seconds elapsed.")

    # 3. Apply the slope modifier to off-road pixels only (roads keep their value).
    print("Applying slope modifier to off-road pixels...")
    if not settings.dry_run and not settings.slope_classes.is_file():
        raise FileNotFoundError(
            f"Missing slope classes raster: {settings.slope_classes}. "
            "Run raster/utils/dem_create_raster.sh first."
        )

    print(f"gdal_calc.Calc -> {settings.roads_smooth}")
    if not settings.dry_run:
        from osgeo_utils.gdal_calc import Calc  # ty: ignore[unresolved-import]

        Calc(
            calc=SLOPE_OFFROAD_CALC,
            outfile=str(settings.roads_smooth),
            type=settings.data_type,
            NoDataValue=settings.nodata,
            creation_options=list(settings.gtiff_creation_options),
            overwrite=settings.overwrite,
            quiet=False,
            A=str(settings.roads_smooth_base),
            A_band=1,
            G=str(settings.slope_classes),
            G_band=1,
            R=str(settings.roads_rasterized),
            R_band=1,
        )
