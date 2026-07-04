#!/usr/bin/env python3
"""Build configured coarse-resolution raster COGs."""

from __future__ import annotations

import argparse
import multiprocessing
import os
import tempfile
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

from raster import raster_settings as settings
from raster.utils import gdal_common, gdal_controller
from raster.utils.helpers import banner, timed_step


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build configured coarse-resolution raster COGs."
    )
    parser.add_argument(
        "-j",
        "--jobs",
        type=int,
        default=4,
        help="Number of countries to process in parallel (default: 4; use 1 for "
        "sequential). Each worker holds its own GDAL cache and gets an equal "
        "share of CPU threads, so raise cautiously on limited RAM.",
    )
    return parser.parse_args()


def _check_area_inputs(*, countries: list[str], dissolved_gpkg: Path) -> None:
    """Validate multi-country coarse-build inputs.

    Args:
        countries: Normalized country keys.
        dissolved_gpkg: Dissolved boundary GeoPackage path.

    Raises:
        FileNotFoundError: If a required area raster, road raster, or boundary is missing.
    """
    for path, label, hint in (
        (
            settings.eu_clc_classified,
            "eu CLC one-hot stack",
            "uv run python -m raster.utils.clc classify",
        ),
        (
            settings.eu_slope_classes,
            "eu slope classes raster",
            "uv run python -m raster.utils.dem classify",
        ),
        (dissolved_gpkg, "dissolved bounds GeoPackage", None),
    ):
        if not path.is_file():
            msg = f"Missing {label}: {path}"
            if hint:
                msg += f" — build it once with: {hint}"
            raise FileNotFoundError(msg)
    for resolution in settings.coarse_resolutions:
        clc_stack = settings.clc_dir / f"eu_{resolution}m_clc_classes_stack.tif"
        if not clc_stack.is_file():
            raise FileNotFoundError(
                f"Missing area {resolution}m CLC one-hot stack: {clc_stack} — "
                "build it once with: uv run python -m raster.utils.clc classify"
            )
        slope_classes = settings.dem_dir / f"eu_{resolution}m_slope_classes.tif"
        if not slope_classes.is_file():
            raise FileNotFoundError(
                f"Missing area {resolution}m slope classes: {slope_classes} — "
                "build it once with: uv run python -m raster.utils.dem classify"
            )
    for country in countries:
        roads_smooth = settings.osm_dir / f"{country}_roads_smooth.tif"
        if not roads_smooth.is_file():
            raise FileNotFoundError(
                f"Missing {country} roads smooth raster: {roads_smooth}"
            )


def _worker_init(num_threads: int) -> None:
    gdal_common.configure_gdal()
    from osgeo import gdal

    os.environ["GDAL_NUM_THREADS"] = str(num_threads)
    gdal.SetConfigOption("GDAL_NUM_THREADS", str(num_threads))


def _job_count(args: argparse.Namespace) -> int:
    return max(1, int(getattr(args, "jobs", 4)))


def _country_task(
    *,
    country: str,
    resolution: int,
    roads_smooth: Path,
    area_coarse_clc: Path,
    area_coarse_slope: Path,
    tmp_dir: Path,
) -> Path:
    with timed_step(f"{country} {resolution}m: total country processing"):
        country_3035 = tmp_dir / f"{country}_{resolution}m_3035.tif"
        banner(f"Country: {country}  ({resolution}m)")
        country_tmp_dir = tmp_dir / f"{country}_{resolution}m"
        country_tmp_dir.mkdir(parents=True, exist_ok=True)

        stacked_raw_slope = gdal_controller.build_coarse_stacked_raster(
            resolution=resolution,
            roads_smooth=roads_smooth,
            clc_classified=area_coarse_clc,
            slope_classes=area_coarse_slope,
            output_dir=country_tmp_dir,
        )
        country_gpkg = settings.bounds_dir / f"{country}.gpkg"
        gdal_controller.mask_raster_to_boundary(
            src=stacked_raw_slope,
            output=country_3035,
            bounds_gpkg=country_gpkg,
            boundary_name=country,
        )
        return country_3035


def _process_resolution_countries(
    *,
    countries: list[str],
    country_roads: dict[str, Path],
    resolution: int,
    area_coarse_clc: Path,
    area_coarse_slope: Path,
    tmp_dir: Path,
    args: argparse.Namespace,
) -> list[Path]:
    """Build all country coarse rasters for one resolution.

    Args:
        countries: Normalized country keys.
        country_roads: Smooth road rasters keyed by country.
        resolution: Output pixel size in metres.
        area_coarse_clc: Area CLC one-hot stack for the resolution.
        area_coarse_slope: Area slope classes for the resolution.
        tmp_dir: Shared temporary workflow directory.
        args: Parsed CLI arguments.

    Returns:
        Per-country TARGET_EPSG rasters in input order.
    """
    jobs = _job_count(args)
    if jobs == 1:
        return [
            _country_task(
                country=country,
                resolution=resolution,
                roads_smooth=country_roads[country],
                area_coarse_clc=area_coarse_clc,
                area_coarse_slope=area_coarse_slope,
                tmp_dir=tmp_dir,
            )
            for country in countries
        ]

    threads_per_worker = max(1, (os.cpu_count() or 1) // jobs)
    banner(
        f"Processing {len(countries)} countries at {resolution}m with {jobs} workers "
        f"({threads_per_worker} GDAL threads each)"
    )
    outputs: list[Path | None] = [None] * len(countries)
    # Spawn avoids inheriting initialized GDAL state.
    with ProcessPoolExecutor(
        max_workers=jobs,
        mp_context=multiprocessing.get_context("spawn"),
        initializer=_worker_init,
        initargs=(threads_per_worker,),
    ) as executor:
        futures = {
            executor.submit(
                _country_task,
                country=country,
                resolution=resolution,
                roads_smooth=country_roads[country],
                area_coarse_clc=area_coarse_clc,
                area_coarse_slope=area_coarse_slope,
                tmp_dir=tmp_dir,
            ): idx
            for idx, country in enumerate(countries)
        }
        for future in as_completed(futures):
            outputs[futures[future]] = future.result()
    return [output for output in outputs if output is not None]


def build_area(args: argparse.Namespace | None = None) -> None:
    if args is None:
        args = argparse.Namespace(jobs=4)

    countries = [c.lower().replace(" ", "_") for c in settings.countries]
    dissolved_gpkg = settings.bounds_dir / f"{settings.output_area}.gpkg"

    banner("Multi-country coarse raster workflow")
    print(f"Output area: {settings.output_area}")
    print(f"Countries: {', '.join(countries)}")
    print(f"Resolutions: {', '.join(f'{r}m' for r in settings.coarse_resolutions)}")

    _check_area_inputs(countries=countries, dissolved_gpkg=dissolved_gpkg)

    country_roads: dict[str, Path] = {}
    for country in countries:
        country_roads[country] = settings.osm_dir / f"{country}_roads_smooth.tif"

    with tempfile.TemporaryDirectory(
        prefix="coarse_area_", dir=settings.temp_dir
    ) as tmp:
        tmp_dir = Path(tmp)
        for resolution in settings.coarse_resolutions:
            area_coarse_slope = settings.dem_dir / f"eu_{resolution}m_slope_classes.tif"
            banner(f"Coarse resolution: {resolution}m")

            area_coarse_clc = (
                settings.clc_dir / f"eu_{resolution}m_clc_classes_stack.tif"
            )

            per_country_outputs = _process_resolution_countries(
                countries=countries,
                country_roads=country_roads,
                resolution=resolution,
                area_coarse_clc=area_coarse_clc,
                area_coarse_slope=area_coarse_slope,
                tmp_dir=tmp_dir,
                args=args,
            )

            base = f"{settings.output_area}_{resolution}m"
            stacked_mosaic_vrt = tmp_dir / f"{base}_3035.vrt"
            gdal_controller.mosaic_rasters(
                rasters=per_country_outputs, mosaic_vrt=stacked_mosaic_vrt
            )

            output_cog = settings.output_dir / f"{base}_{settings.raster_version}.tif"
            gdal_controller.create_web_cog_from_stacked(
                stacked_3035=stacked_mosaic_vrt,
                output_cog=output_cog,
                bounds_gpkg=dissolved_gpkg,
                boundary_name=settings.output_area,
            )
            banner(
                f"Successfully created coarse {settings.output_area} COG: {output_cog}"
            )


def main() -> None:
    args = parse_args()

    for directory in (settings.output_dir, settings.temp_dir):
        directory.mkdir(parents=True, exist_ok=True)

    gdal_common.configure_gdal()
    build_area(args)

    resolutions = ", ".join(f"{r}m" for r in settings.coarse_resolutions)
    banner(
        f"Built {len(settings.coarse_resolutions)} coarse {settings.output_area} rasters: {resolutions}"
    )


if __name__ == "__main__":
    main()
