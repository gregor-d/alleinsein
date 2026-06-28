# pyright: reportMissingImports=false
"""Build the test raster COG (Python pipeline).

Orchestrates the same stages as create_raster.sh, but in Python and with an extra
slope modifier on the roads raster. Each input-data stage lives in its own module
under ``utils/`` (mirroring the shell utils); ``raster_settings.py`` holds config
and derived paths, while this script wires the stages together and runs the final
heatmap + web-COG steps inline.

Configuration defaults live as plain variables in ``raster_settings.py``.
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path

from raster import raster_settings as settings
from raster.utils.clc_raster_create import create_clc_stack
from raster.utils.osm_create_gpkg import create_roads_gpkg
from raster.utils.osm_filter_pbf import filter_osm_pbf
from raster.utils.osm_rasterize_roads import rasterize_and_smooth_roads
from raster.utils.raster_helpers import banner, make_pipeline


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build the test raster COG.")
    parser.add_argument("--force-prep", action="store_true")
    parser.add_argument("--skip-prep", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if args.force_prep and args.skip_prep:
        parser.error("--force-prep and --skip-prep are mutually exclusive")
    return args


def needs_prep(args: argparse.Namespace, *targets: Path) -> bool:
    """Whether a prep stage should run: never with --skip-prep, always with
    --force-prep, otherwise only when an output is missing."""
    if args.skip_prep:
        return False
    return args.force_prep or any(not target.exists() for target in targets)


def check_skip_prep_inputs() -> None:
    """With --skip-prep, fail early if any reused intermediate is missing."""
    for path, label in (
        (settings.osm_filtered, "filtered OSM PBF"),
        (settings.roads_gpkg, "roads GeoPackage"),
        (settings.roads_smooth, "roads smooth raster"),
        (settings.clc_stack, "CLC one-hot stack"),
    ):
        if not path.is_file():
            raise FileNotFoundError(f"Missing {label}: {path}")


def main() -> None:
    args = parse_args()
    settings.dry_run = args.dry_run

    for directory in (
        settings.osm_dir,
        settings.clc_dir,
        settings.output_dir,
        settings.temp_dir,
    ):
        directory.mkdir(parents=True, exist_ok=True)

    # Export the GDAL/OSM settings into the process environment.
    os.environ.update(
        {
            "AREA": settings.area,
            "TARGET_EPSG": settings.target_epsg,
            "WEB_EPSG": settings.web_epsg,
            "RASTER_RESOLUTION": settings.resolution,
            "RASTER_NODATA": str(settings.nodata),
            "RASTER_DATA_TYPE": settings.data_type,
            "GDAL_CACHEMAX": settings.gdal_cachemax,
            "OSM_MAX_TMPFILE_SIZE": settings.osm_max_tmpfile_size,
            "CPL_TMPDIR": settings.cpl_tmpdir,
        }
    )
    if args.dry_run:
        print("Dry run: no GDAL, rio-cogeo or osmium commands will be executed.")
    else:
        from osgeo import gdal  # ty: ignore[unresolved-import]

        for key in ("GDAL_CACHEMAX", "OSM_MAX_TMPFILE_SIZE", "CPL_TMPDIR"):
            gdal.SetConfigOption(key, os.environ[key])

    banner("Raster workflow")
    print(f"AREA: {settings.area}")
    print(f"BBOX: {settings.bbox}")
    print(f"Output: {settings.output_cog}")

    if args.skip_prep:
        check_skip_prep_inputs()

    if needs_prep(args, settings.osm_filtered):
        filter_osm_pbf()
    else:
        print(f"Reusing existing {settings.osm_filtered}")

    if needs_prep(args, settings.roads_gpkg):
        create_roads_gpkg()
    else:
        print(f"Reusing existing {settings.roads_gpkg}")

    if needs_prep(args, settings.roads_smooth):
        rasterize_and_smooth_roads()
    else:
        print(f"Reusing existing {settings.roads_smooth}")

    if needs_prep(args, settings.clc_stack):
        create_clc_stack()
    else:
        print(f"Reusing existing {settings.clc_stack}")

    # Encode the roads heatmap masked per land-cover class into a single band: each
    # class occupies its own value range (nature A, farm A+10, park A+20, urban
    # A+30, water 200). muparser is buggy, so this stays in gdal_calc.
    banner("Calculate heatmap raster")
    if not args.dry_run:
        if not settings.roads_smooth.is_file():
            raise FileNotFoundError(
                f"Missing roads smooth raster: {settings.roads_smooth}"
            )
        if not settings.clc_stack.is_file():
            raise FileNotFoundError(f"Missing CLC one-hot stack: {settings.clc_stack}")
    print(f"gdal_calc.Calc -> {settings.raw_calc}")
    if not args.dry_run:
        from osgeo_utils.gdal_calc import Calc  # ty: ignore[unresolved-import]

        Calc(
            calc="where(F==1, 200, A*B + (A+10)*C + (A+20)*D + (A+30)*E)",
            outfile=str(settings.raw_calc),
            type=settings.data_type,
            NoDataValue=settings.nodata,
            creation_options=list(settings.gtiff_creation_options),
            overwrite=settings.overwrite,
            quiet=False,
            A=str(settings.roads_smooth),
            A_band=1,
            B=str(settings.clc_stack),
            B_band=1,
            C=str(settings.clc_stack),
            C_band=2,
            D=str(settings.clc_stack),
            D_band=3,
            E=str(settings.clc_stack),
            E_band=4,
            F=str(settings.clc_stack),
            F_band=5,
        )

    # Clip to the AREA bounds, reproject to WEB_EPSG, then write a Web Mercator
    # tile-matrix aligned COG with overviews.
    banner("Clip, reproject and create web COG")
    if not args.dry_run and not settings.bounds_gpkg.is_file():
        raise FileNotFoundError(f"Missing bounds GeoPackage: {settings.bounds_gpkg}")

    pipeline = make_pipeline(
        f"""
        ! read {settings.raw_calc.as_posix()}
        ! clip --like {settings.bounds_gpkg.as_posix()} --like-layer {settings.area} --allow-bbox-outside-source
        ! reproject -d {settings.web_epsg}
        ! write {settings.overwrite_arg} {settings.gtiff} {settings.reprojected.as_posix()}
        """
    )
    print(f"$ gdal raster pipeline {pipeline}")
    if not args.dry_run:
        from osgeo import gdal  # ty: ignore[unresolved-import]

        result = gdal.Run("raster pipeline", pipeline=pipeline)
        if hasattr(result, "Finalize"):
            result.Finalize()

    print(f"rio_cogeo.cog_translate -> {settings.output_cog}")
    if not args.dry_run:
        from rio_cogeo.cogeo import cog_translate
        from rio_cogeo.profiles import cog_profiles

        output_profile = cog_profiles.get("deflate")
        output_profile.update(
            {
                "BIGTIFF": "IF_SAFER",
                "blockxsize": settings.cog_blocksize,
                "blockysize": settings.cog_blocksize,
            }
        )
        cog_translate(
            str(settings.reprojected),
            str(settings.output_cog),
            output_profile,
            web_optimized=True,
            resampling="nearest",
            overview_resampling="nearest",
            in_memory=False,
            quiet=False,
            config={"GDAL_TIFF_OVR_BLOCKSIZE": str(settings.cog_blocksize)},
        )

    print(f"Successfully created masked COG raster: {settings.output_cog}")


if __name__ == "__main__":
    main()
