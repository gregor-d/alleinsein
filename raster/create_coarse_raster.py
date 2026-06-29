"""Build coarse-resolution raster COGs (Python pipeline) — workflow coordinator.

Python port of create_coarse_raster.sh: downsamples the fine 20m road-proximity
heatmap and reclassified CLC into a set of coarser COGs (160/320/640/1280m by
default) that share the exact same per-land-cover value encoding as the fine COG, so
the frontend can switch zoom tiers without changing how it reads pixels.

This module only coordinates: it parses CLI flags, prepares directories/GDAL config,
checks the fine pipeline's intermediates exist, and loops over the configured
resolutions calling into ``raster.utils.gdal_controller``. It consumes
``settings.roads_smooth`` and ``settings.clc_classified`` (the reclassified CLC, not
the one-hot stack — the stack is rebuilt per resolution), so run
``python -m raster.create_raster`` first. Defaults live in ``raster_settings.py``.
"""

from __future__ import annotations

import argparse

from raster import raster_settings as settings
from raster.utils import gdal_common, gdal_controller
from raster.utils.helpers import banner


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build coarse raster COGs.")
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def check_inputs() -> None:
    """Fail early if any fine-pipeline intermediate the coarse build needs is missing."""
    for path, label in (
        (settings.roads_smooth, "roads smooth raster"),
        (settings.clc_classified, "classified CLC raster"),
        (settings.bounds_gpkg, "bounds GeoPackage"),
    ):
        if not path.is_file():
            raise FileNotFoundError(f"Missing {label}: {path}")


def main() -> None:
    args = parse_args()
    settings.dry_run = args.dry_run

    for directory in (settings.output_dir, settings.temp_dir):
        directory.mkdir(parents=True, exist_ok=True)

    if args.dry_run:
        print("Dry run: no GDAL or rio-cogeo commands will be executed.")
    else:
        gdal_common.configure_gdal()
        check_inputs()

    banner("Coarse raster workflow")
    print(f"AREA: {settings.area}")
    print(f"Resolutions: {', '.join(f'{r}m' for r in settings.coarse_resolutions)}")

    for resolution in settings.coarse_resolutions:
        stem = f"{settings.area}_{resolution}m_v{settings.raster_version}"
        output_cog = settings.output_dir / f"{stem}.tif"
        gdal_controller.build_coarse_raster(
            resolution,
            settings.roads_smooth,
            settings.clc_classified,
            settings.bounds_gpkg,
            output_cog,
        )

    resolutions = ", ".join(f"{r}m" for r in settings.coarse_resolutions)
    banner(f"Built {len(settings.coarse_resolutions)} coarse rasters: {resolutions}")


if __name__ == "__main__":
    main()
