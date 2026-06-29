"""Build the test raster COG (Python pipeline) — workflow coordinator.

Orchestrates the same stages as create_raster.sh, but in Python, and stacks an extra
slope-modified band onto the aloneness raster: the final COG carries two bands (band
1 raw aloneness, band 2 the same encoding re-scored by slope class). This module only
coordinates: it parses CLI flags, prepares directories and the process environment,
decides which prep stages to (re)run, and calls into ``raster.utils.gdal_controller``,
which performs all the actual GDAL/osmium work. Configuration defaults live as plain
variables in ``raster_settings.py``.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from raster import raster_settings as settings
from raster.utils import gdal_controller as gdal_ctl
from raster.utils.helpers import banner


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
        (settings.slope_classes, "slope classes raster"),
    ):
        if not path.is_file():
            raise FileNotFoundError(f"Missing {label}: {path}")


def main() -> None:
    args = parse_args()
    settings.dry_run = args.dry_run

    for directory in (
        settings.osm_dir,
        settings.clc_dir,
        settings.dem_dir,
        settings.output_dir,
        settings.temp_dir,
    ):
        directory.mkdir(parents=True, exist_ok=True)

    if args.dry_run:
        print("Dry run: no GDAL, rio-cogeo or osmium commands will be executed.")
    else:
        gdal_ctl.configure_gdal()

    banner("Raster workflow")
    print(f"AREA: {settings.area}")
    print(f"BBOX: {settings.bbox}")
    print(f"Output: {settings.output_cog}")

    if args.skip_prep:
        check_skip_prep_inputs()

    if needs_prep(args, settings.osm_filtered):
        gdal_ctl.filter_osm_pbf(settings.osm_latest, settings.osm_filtered)
    else:
        print(f"Reusing existing {settings.osm_filtered}")

    if needs_prep(args, settings.roads_gpkg):
        gdal_ctl.create_roads_gpkg(settings.osm_filtered, settings.roads_gpkg)
    else:
        print(f"Reusing existing {settings.roads_gpkg}")

    if needs_prep(args, settings.roads_smooth):
        gdal_ctl.rasterize_and_smooth_roads(settings.roads_gpkg, settings.roads_smooth)
    else:
        print(f"Reusing existing {settings.roads_smooth}")

    if needs_prep(args, settings.clc_stack):
        gdal_ctl.create_clc_stack(
            settings.clc_source,
            settings.clc_mapping,
            settings.clc_classified,
            settings.clc_stack,
        )
    else:
        print(f"Reusing existing {settings.clc_stack}")

    if needs_prep(args, settings.slope_classes):
        gdal_ctl.create_slope_classes(
            settings.dem_slope_source, settings.slope_mapping, settings.slope_classes
        )
    else:
        print(f"Reusing existing {settings.slope_classes}")

    gdal_ctl.calculate_heatmap(  # band 1: raw aloneness
        settings.roads_smooth, settings.clc_stack, settings.raw_calc
    )
    gdal_ctl.calculate_slope_mod_band(  # band 2: slope-modified aloneness
        settings.raw_calc, settings.slope_classes, settings.slope_mod_modified
    )
    gdal_ctl.create_web_cog(  # stack both bands -> 2-band web COG
        settings.raw_calc,
        settings.slope_mod_modified,
        settings.output_cog,
        settings.bounds_gpkg,
    )


if __name__ == "__main__":
    main()
