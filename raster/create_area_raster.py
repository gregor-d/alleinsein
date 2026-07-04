#!/usr/bin/env python3
"""Build the configured multi-country/area web COG."""

from __future__ import annotations

import argparse
import multiprocessing
import os
import tempfile
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

from raster import raster_settings as settings
from raster.utils import bounds, clc, dem, gdal_common, gdal_controller, osm
from raster.utils.helpers import (
    banner,
    format_elapsed,
    slugify_area,
    slugify_areas,
    timed_step,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build the combined multi-country/area COG."
    )
    parser.add_argument(
        "--force-prep",
        action="store_true",
        help="Re-run all per-country prep stages even if outputs already exist.",
    )
    parser.add_argument(
        "--country",
        type=str,
        default=None,
        help="Process only this country and write out/<country>_20m_<version>.tif "
        "instead of the combined multi-country COG.",
    )
    parser.add_argument(
        "-j",
        "--jobs",
        type=int,
        default=4,
        help="Number of countries to process in parallel (default: 4; use 1 for "
        "sequential). Each worker holds its own ~2 GB GDAL cache and gets an equal "
        "share of CPU threads, so raise cautiously on limited RAM.",
    )
    return parser.parse_args()


def _needs_prep(args: argparse.Namespace, *targets: Path) -> bool:
    """Return whether a stage output should be rebuilt.

    Args:
        args: Parsed CLI arguments.
        targets: Output paths produced by the stage.

    Returns:
        True when forced or any target is missing.
    """
    return args.force_prep or any(not target.exists() for target in targets)


def _ensure_area_gpkg(country: str) -> None:
    if (settings.bounds_dir / f"{country}.gpkg").is_file():
        return
    print(f"Geocoding bounds for {country}...")
    bounds.geocode_area_to_gpkg(country)


def _source_roads_pbf_path() -> Path:
    name = settings.europe_pbf_name.replace(".osm.pbf", "-roads.osm.pbf")
    return settings.osm_dir / name


def _ensure_source_roads_pbf(args: argparse.Namespace) -> None:
    source_pbf = settings.osm_dir / settings.europe_pbf_name
    source_roads = _source_roads_pbf_path()
    with timed_step("Filter source PBF to roads/rail"):
        if _needs_prep(args, source_roads):
            print(f"Filtering source PBF to roads/rail -> {source_roads.name}...")
            osm.filter_osm_pbf(osm_latest=source_pbf, osm_filtered=source_roads)
        else:
            print(f"Reusing existing {source_roads} (--force-prep to rebuild)")


def _process_country(*, country: str, args: argparse.Namespace) -> Path:
    """Build or reuse one country's TARGET_EPSG process raster.

    Args:
        country: Normalized country key.
        args: Parsed CLI arguments.

    Returns:
        Path to the 2-band TARGET_EPSG raster.

    Raises:
        FileNotFoundError: If required area CLC or slope rasters are missing.
    """
    banner(f"Country: {country}")

    _ensure_area_gpkg(country)

    buffered_bbox = bounds.get_bbox(
        area=country,
        buffer_m=settings.bounds_buffer_m,
        snap_m=settings.bounds_snap_m,
    )

    roads_rasterized = settings.osm_dir / f"{country}_roads_rasterized.tif"
    if _needs_prep(args, roads_rasterized):
        # PBF and GeoPackage intermediates are deleted after rasterization.
        with tempfile.TemporaryDirectory(
            prefix=f"osm_{country}_", dir=settings.temp_dir
        ) as tmp:
            osm.build_roads_rasterized(
                label=country,
                source_roads_pbf=_source_roads_pbf_path(),
                bbox=buffered_bbox,
                tmp_dir=Path(tmp),
                roads_rasterized=roads_rasterized,
            )
    else:
        print(f"Reusing existing {roads_rasterized} (--force-prep to rebuild)")

    roads_smooth = settings.osm_dir / f"{country}_roads_smooth.tif"
    with timed_step(f"{country}: smooth roads"):
        if _needs_prep(args, roads_smooth):
            print(f"Smoothing roads for {country}...")
            osm.smooth_roads(
                roads_rasterized=roads_rasterized, roads_smooth=roads_smooth
            )
        else:
            print(f"Reusing existing {roads_smooth} (--force-prep to rebuild)")

    country_3035 = settings.pre_out_dir / f"{country}_3035.tif"
    if _needs_prep(args, country_3035) or not gdal_controller.raster_has_band_count(
        path=country_3035, band_count=2
    ):
        eu_clc = settings.eu_clc_classified
        if not eu_clc.is_file():
            raise FileNotFoundError(
                f"Missing {eu_clc} — build it once with: "
                "uv run python -m raster.utils.clc classify"
            )
        eu_slope_classes = settings.eu_slope_classes
        if not eu_slope_classes.is_file():
            raise FileNotFoundError(
                f"Missing {eu_slope_classes} — build it once with: "
                "uv run python -m raster.utils.dem classify"
            )

        with tempfile.TemporaryDirectory(
            prefix="process_country_", dir=settings.temp_dir
        ) as tmp:
            tmp_dir = Path(tmp)
            clipped_clc = tmp_dir / f"{country}_clc_clip.tif"
            stacked_clc = tmp_dir / f"{country}_clc_stack.tif"
            raw_calc = tmp_dir / f"{country}_raw_3035.tif"
            clipped_slope = tmp_dir / f"{country}_slope_classes.tif"
            slope_mod = tmp_dir / f"{country}_slope_mod.tif"

            gdal_common.clip_raster(
                source=eu_clc, bbox=buffered_bbox, output=clipped_clc
            )

            with timed_step(f"{country}: build CLC one-hot stack"):
                clc.build_clc_onehot_stack(
                    classified=clipped_clc,
                    out=stacked_clc,
                    resolution=settings.resolution,
                )

            with timed_step(f"{country}: calculate raw heatmap band"):
                gdal_controller.encode_heatmap(
                    roads=roads_smooth, clc_stack=stacked_clc, out=raw_calc
                )

            gdal_common.clip_raster(
                source=eu_slope_classes,
                bbox=gdal_common.raster_grid_bbox(raw_calc),
                output=clipped_slope,
            )

            with timed_step(f"{country}: calculate slope-modified band"):
                dem.calculate_slope_mod_band(
                    raw_calc=raw_calc, slope_classes=clipped_slope, slope_mod=slope_mod
                )

            with timed_step(f"{country}: stack raw and slope-modified bands"):
                stacked_raw_slope = gdal_controller.stack_raw_and_slope_bands(
                    raw_calc=raw_calc,
                    slope_mod=slope_mod,
                    output_path=tmp_dir / f"{country}_stacked_raw_slope.tif",
                )

            with timed_step(f"{country}: mask country raster to boundary"):
                country_gpkg = settings.bounds_dir / f"{country}.gpkg"
                gdal_controller.mask_raster_to_boundary(
                    src=stacked_raw_slope,
                    output=country_3035,
                    bounds_gpkg=country_gpkg,
                    boundary_name=country,
                )
    else:
        print(f"Reusing existing 2-band {country_3035} (--force-prep to rebuild)")
    return country_3035


def _worker_init(num_threads: int) -> None:
    gdal_common.configure_gdal()
    from osgeo import gdal

    os.environ["GDAL_NUM_THREADS"] = str(num_threads)
    gdal.SetConfigOption("GDAL_NUM_THREADS", str(num_threads))


def _country_task(*, country: str, args: argparse.Namespace) -> Path:
    with timed_step(f"{country}: total country processing"):
        return _process_country(country=country, args=args)


def _process_countries(*, countries: list[str], args: argparse.Namespace) -> list[Path]:
    """Build all country process rasters.

    Args:
        countries: Normalized country keys.
        args: Parsed CLI arguments.

    Returns:
        Per-country TARGET_EPSG rasters in input order.
    """
    jobs = max(1, args.jobs)
    if jobs == 1:
        return [_country_task(country=country, args=args) for country in countries]

    threads_per_worker = max(1, (os.cpu_count() or 1) // jobs)
    banner(
        f"Processing {len(countries)} countries with {jobs} workers "
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
                args=args,
            ): idx
            for idx, country in enumerate(countries)
        }
        for future in as_completed(futures):
            outputs[futures[future]] = future.result()
    return [output for output in outputs if output is not None]


def _run_single_country(args: argparse.Namespace) -> None:
    """Build one country's web COG at out/<country>_20m_<version>.tif.

    Args:
        args: Parsed CLI arguments with `country` set.
    """
    country = slugify_area(args.country)
    banner("Single-country area raster workflow")
    print(f"Country: {country}")

    _ensure_source_roads_pbf(args)

    country_3035 = _country_task(country=country, args=args)

    output_cog = settings.output_dir / f"{country}_20m_{settings.raster_version}.tif"
    if output_cog.exists():
        print(f"Nothing to do, reuse existing {output_cog}")
    else:
        with timed_step(f"Create {country} web COG"):
            gdal_controller.create_web_cog_from_stacked(
                stacked_3035=country_3035,
                output_cog=output_cog,
                bounds_gpkg=settings.bounds_dir / f"{country}.gpkg",
                boundary_name=country,
            )

    banner(f"Successfully created {country} COG: {output_cog}")


def main() -> None:
    args = parse_args()
    workflow_start = time.perf_counter()

    for directory in (
        settings.osm_dir,
        settings.clc_dir,
        settings.dem_dir,
        settings.bounds_dir,
        settings.output_dir,
        settings.temp_dir,
    ):
        directory.mkdir(parents=True, exist_ok=True)

    gdal_common.configure_gdal()

    from osgeo import gdal

    print(f"GDAL cache max configuration: {gdal.GetConfigOption('GDAL_CACHEMAX')} MB")
    print(f"GDAL_CACHEMAX environment variable: {os.environ.get('GDAL_CACHEMAX')}")

    if args.country:
        _run_single_country(args)
        print(
            "[time] Total single-country area raster workflow: "
            f"{format_elapsed(time.perf_counter() - workflow_start)}"
        )
        return

    banner("Multi-country area raster workflow")
    print(f"Output area: {settings.output_area}")
    print(f"Countries: {', '.join(settings.countries)}")

    countries = slugify_areas(settings.countries)

    _ensure_source_roads_pbf(args)

    per_country_outputs = _process_countries(countries=countries, args=args)

    dissolved_gpkg = settings.bounds_dir / f"{settings.output_area}.gpkg"
    banner(f"Build dissolved {settings.output_area} boundary")
    bounds.create_dissolved_bounds(
        output_area=settings.output_area, areas=countries, simplify_tolerance=10
    )

    output_cog = settings.area_output_cog

    if output_cog.exists():
        print(f"Nothing to do, reuse existing {output_cog}")
    else:
        with tempfile.TemporaryDirectory(dir=settings.temp_dir) as tmp:
            stacked_mosaic_vrt = (
                Path(tmp) / f"{settings.output_area}_3035_{settings.raster_version}.vrt"
            )
            with timed_step(f"Mosaic {settings.output_area} 2-band country outputs"):
                gdal_controller.mosaic_rasters(
                    rasters=per_country_outputs, mosaic_vrt=stacked_mosaic_vrt
                )
            with timed_step(f"Create {settings.output_area} web COG"):
                gdal_controller.create_web_cog_from_stacked(
                    stacked_3035=stacked_mosaic_vrt,
                    output_cog=output_cog,
                    bounds_gpkg=dissolved_gpkg,
                    boundary_name=settings.output_area,
                )

    banner(f"Successfully created {settings.output_area} COG: {output_cog}")
    print(
        "[time] Total multi-country area raster workflow: "
        f"{format_elapsed(time.perf_counter() - workflow_start)}"
    )


if __name__ == "__main__":
    main()
