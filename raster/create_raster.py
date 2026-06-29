"""Build the test raster COG (Python pipeline) — workflow coordinator.

Orchestrates the same stages as create_raster.sh, but in Python, and stacks an extra
slope-modified band onto the aloneness raster: the final COG carries two bands (band
1 raw aloneness, band 2 the same encoding re-scored by slope class). This module only
coordinates: it parses CLI flags, prepares directories and the process environment,
decides which prep stages to (re)run, and calls into the per-domain stage modules
(``osm``, ``clc``, ``dem``) and the assembly steps in ``raster.utils.gdal_controller``,
which perform the actual GDAL/osmium work. Configuration defaults live as plain
variables in ``raster_settings.py``.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from raster import raster_settings as settings
from raster.utils import clc, dem, gdal_common, gdal_controller, osm
from raster.utils.helpers import banner


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build the test raster COG.")
    parser.add_argument(
        "--force-prep",
        action="store_true",
        help="Re-run all prep stages even if outputs already exist.",
    )
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def needs_prep(args: argparse.Namespace, *targets: Path) -> bool:
    """Run stage if --force-prep or any output is missing; skip otherwise."""
    return args.force_prep or any(not target.exists() for target in targets)


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
        gdal_common.configure_gdal()

    banner("Raster workflow")
    print(f"AREA: {settings.area}")
    print(f"BBOX: {settings.bbox}")
    print(f"Output: {settings.output_cog}")

    if needs_prep(args, settings.osm_filtered):
        osm.filter_osm_pbf(settings.osm_latest, settings.osm_filtered)
    else:
        print(f"Reusing existing {settings.osm_filtered}")

    if needs_prep(args, settings.roads_gpkg):
        osm.create_roads_gpkg(settings.osm_filtered, settings.roads_gpkg)
    else:
        print(f"Reusing existing {settings.roads_gpkg}")

    if needs_prep(args, settings.roads_smooth):
        osm.rasterize_and_smooth_roads(settings.roads_gpkg, settings.roads_smooth)
    else:
        print(f"Reusing existing {settings.roads_smooth}")

    if needs_prep(args, settings.clc_stack):
        clc.create_clc_stack(
            settings.clc_source,
            settings.clc_mapping,
            settings.clc_classified,
            settings.clc_stack,
        )
    else:
        print(f"Reusing existing {settings.clc_stack}")

    if needs_prep(args, settings.slope_classes):
        dem.create_slope_classes(
            settings.dem_slope_source, settings.slope_mapping, settings.slope_classes
        )
    else:
        print(f"Reusing existing {settings.slope_classes}")

    gdal_controller.calculate_heatmap(  # band 1: raw aloneness
        settings.roads_smooth, settings.clc_stack, settings.raw_calc
    )
    dem.calculate_slope_mod_band(  # band 2: slope-modified aloneness
        settings.raw_calc, settings.slope_classes, settings.slope_mod
    )
    gdal_controller.create_web_cog(  # stack both bands -> 2-band web COG
        settings.raw_calc,
        settings.slope_mod,
        settings.output_cog,
        settings.bounds_gpkg,
    )


if __name__ == "__main__":
    main()
