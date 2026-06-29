# pyright: reportMissingImports=false
"""DEM / slope stage of the raster pipeline.

Clip + reclassify the EPSG:3035 DEM slope onto the shared grid into slope classes
(1..4, flat..steep), and rewrite the aloneness band with a per-class slope penalty
(band 2 of the final COG). Each function takes explicit ``Path`` arguments; config
knobs and ``settings.dry_run`` come from ``raster_settings``.

Run standalone — with no subcommand it builds the slope-classes raster; a subcommand
runs that single step. All paths come from ``raster_settings`` (``modband`` additionally
needs the heatmap ``raw_calc`` from the assembly step):
    uv run python -m raster.utils.dem [--dry-run]
    uv run python -m raster.utils.dem classes
    uv run python -m raster.utils.dem modband
"""

from __future__ import annotations

import argparse
from pathlib import Path

from osgeo import gdal  # ty: ignore[unresolved-import]
from osgeo_utils.gdal_calc import Calc  # ty: ignore[unresolved-import]
from raster import raster_settings as settings
from raster.utils.gdal_common import configure_gdal, make_pipeline
from raster.utils.helpers import banner


# ---------------------------------------------------------------------------
# Clip + reclassify the EU DEM slope into slope classes
# (from utils/dem_create_raster.sh)
#
# Clip + resample the EPSG:3035 slope onto the shared BBOX/20m grid (matching
# roads/CLC by construction: same origin and size), then reclassify into the slope
# classes (1..4, flat..steep). Slope is in odd units, so slope_classes.txt maps it
# back to degree-based classes; nearest keeps the original values intact through the
# resample, so reclassifying afterwards gives the same result.
# ---------------------------------------------------------------------------


def create_slope_classes(
    dem_slope_source: Path, slope_mapping: Path, slope_classes: Path
) -> None:
    banner("Create slope classes raster")
    if not settings.dry_run:
        if not dem_slope_source.is_file():
            raise FileNotFoundError(
                f"Missing DEM slope input raster: {dem_slope_source}"
            )
        if not slope_mapping.is_file():
            raise FileNotFoundError(f"Missing slope mapping file: {slope_mapping}")

    pipeline = make_pipeline(
        f"""
        ! read {dem_slope_source.as_posix()}
        ! reproject -d {settings.target_epsg} --bbox={settings.bbox} --bbox-crs={settings.target_epsg} --resolution={settings.resolution} -r nearest
        ! reclassify --mapping=@{slope_mapping.as_posix()} --ot={settings.data_type}
        ! edit --nodata={settings.nodata}
        ! write {settings.gtiff} {settings.overwrite_arg} {slope_classes.as_posix()}
        """
    )
    print(f"$ gdal raster pipeline {pipeline}")
    if not settings.dry_run:
        result = gdal.Run("raster pipeline", pipeline=pipeline)
        if hasattr(result, "Finalize"):
            result.Finalize()


# ---------------------------------------------------------------------------
# Rewrite the aloneness band with a per-class slope penalty (band 2)
# (from create_slope_mod_band.sh)
#
# Rewrites the WHOLE aloneness band: each category pixel's within-class road score
# (1..10) has the slope penalty for its slope class subtracted and is re-clamped to
# >=1, so steeper terrain reads as more secluded across the full ramp. The worst
# within-category score (10) is never modified. The result stays in the exact same
# per-land-cover encoding (nature 1..10, farm 11..20, park 21..30, urban 31..40,
# water 200); water/nodata/unclassified pass through unchanged. muparser is buggy,
# so this stays in gdal_calc.
# ---------------------------------------------------------------------------

# Points subtracted from a category pixel's road score for its slope class
# (1=flat .. 4=steep); slope outside 1..4 (incl. nodata) subtracts nothing.
SLOPE_PENALTY = {1: 0, 2: 2, 3: 3, 4: 4}


def calculate_slope_mod_band(
    raw_calc: Path, slope_classes: Path, slope_mod_modified: Path
) -> None:
    banner("Calculate slope-modified band")
    if not settings.dry_run:
        if not raw_calc.is_file():
            raise FileNotFoundError(
                f"Missing raw heatmap raster: {raw_calc} (run the heatmap step first)"
            )
        if not slope_classes.is_file():
            raise FileNotFoundError(
                f"Missing slope classes raster: {slope_classes} "
                "(run create_slope_classes first)"
            )

    slope_penalty = (
        f"where(G==1, {SLOPE_PENALTY[1]}, "
        f"where(G==2, {SLOPE_PENALTY[2]}, "
        f"where(G==3, {SLOPE_PENALTY[3]}, "
        f"where(G==4, {SLOPE_PENALTY[4]}, 0))))"
    )
    calc = (
        "where((P>=1)*(P<=40), "
        "((1.0*P-1)//10)*10 + where((1.0*P-1)%10+1 >= 10, 10, "
        f"maximum((1.0*P-1)%10+1 - ({slope_penalty}), 1)), 1.0*P)"
    )
    print(f"gdal_calc.Calc -> {slope_mod_modified}")
    if not settings.dry_run:
        Calc(
            calc=calc,
            outfile=str(slope_mod_modified),
            type=settings.data_type,
            NoDataValue=settings.nodata,
            creation_options=list(settings.gtiff_creation_options),
            overwrite=settings.overwrite,
            quiet=False,
            P=str(raw_calc),
            P_band=1,
            G=str(slope_classes),
            G_band=1,
        )


def main() -> None:
    # --dry-run via a shared parent so it works before or after the subcommand;
    # SUPPRESS keeps the subparser default from clobbering a value set on the parent.
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--dry-run", action="store_true", default=argparse.SUPPRESS)

    parser = argparse.ArgumentParser(
        parents=[common],
        description=(
            "DEM / slope stage. Run a single step by name, or no subcommand to build "
            "the slope-classes raster. All paths come from raster_settings."
        ),
    )
    sub = parser.add_subparsers(dest="command")
    sub.add_parser("classes", parents=[common], help="DEM slope -> slope classes (1..4)")
    sub.add_parser(
        "modband",
        parents=[common],
        help="apply per-class slope penalty to the heatmap (band 2)",
    )

    args = parser.parse_args()
    settings.dry_run = getattr(args, "dry_run", False)

    for directory in (settings.dem_dir, settings.temp_dir):
        directory.mkdir(parents=True, exist_ok=True)
    if not settings.dry_run:
        configure_gdal()

    if args.command == "modband":
        calculate_slope_mod_band(
            settings.raw_calc, settings.slope_classes, settings.slope_mod_modified
        )
    else:  # "classes" or no subcommand: the slope-classes raster
        create_slope_classes(
            settings.dem_slope_source, settings.slope_mapping, settings.slope_classes
        )


if __name__ == "__main__":
    main()
