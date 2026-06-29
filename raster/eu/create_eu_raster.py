"""Build one combined multi-country COG (e.g. DACH) — workflow coordinator.

Each country in ``settings.eu_countries`` is processed individually with the existing
per-area stages on a *buffered* extent (so the road-smoothing kernel sees cross-border
roads), kept in TARGET_EPSG. The per-country rasters are mosaicked on a shared grid,
clipped ONCE to the exact dissolved boundary (discarding the buffer rings), then
reprojected and written as a single web COG.

Like ``create_raster.py`` this module only coordinates: it parses CLI flags, prepares
directories and the GDAL config, decides which per-country prep stages to (re)run, and
calls into the per-domain GDAL/osmium stage modules (``osm``, ``clc``) and the assembly
steps in ``gdal_controller``. The geocoding and dissolved-boundary steps
(geopandas/osmnx) are imported and called directly from ``raster.utils.bounds``.
Configuration defaults live in ``raster_settings.py``.

The per-country PBFs are cut from the Europe-wide PBF automatically when missing, so the
only prerequisite is placing that PBF at ``input/osm/<eu_europe_pbf_name>`` (download
once from https://download.geofabrik.de/europe-latest.osm.pbf).
"""

from __future__ import annotations

import argparse
from pathlib import Path

from raster import raster_settings as settings
from raster.utils import bounds, clc, gdal_common, gdal_controller, osm
from raster.utils.helpers import banner


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build the combined multi-country COG."
    )
    # Re-run the (slow) per-country prep even when its outputs already exist.
    parser.add_argument("--force-prep", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def needs_prep(force_prep: bool, *targets: Path) -> bool:
    """Whether a per-country prep stage should run: always with --force-prep,
    otherwise only when an output is missing."""
    return force_prep or any(not target.exists() for target in targets)


def ensure_area_gpkg(country: str) -> None:
    """Geocode the exact boundary gpkg if missing (the single source of truth for
    bounds), reused on later runs."""
    if (settings.bounds_dir / f"{country}.gpkg").is_file():
        return
    print(f"Geocoding bounds for {country}...")
    if not settings.dry_run:
        bounds.geocode_area(country)


def country_bboxes(country: str) -> tuple[str, str]:
    """Buffered (bbox_3035, bbox_4326) for a country, derived from its gpkg."""
    if settings.dry_run and not (settings.bounds_dir / f"{country}.gpkg").is_file():
        return settings.bbox, "0,0,0,0"  # placeholders; a real run geocodes first
    return bounds.buffered_bbox(
        country, settings.eu_bounds_buffer_m, settings.eu_bounds_snap_m
    )


def next_versioned_cog(base_name: str) -> Path:
    """Auto-increment the output version so existing COGs are never silently
    overwritten (matches create_raster.sh)."""
    version = 1
    while (settings.output_dir / f"{base_name}_v{version}.tif").is_file():
        version += 1
    return settings.output_dir / f"{base_name}_v{version}.tif"


def process_country(country: str, force_prep: bool) -> Path:
    """Run the per-country prep + heatmap encode on the buffered grid; returns the
    encoded per-country raster (TARGET_EPSG) to feed the mosaic."""
    banner(f"Country: {country}")

    # 1. Exact boundary gpkg (geocoded once) drives the buffered processing extents.
    ensure_area_gpkg(country)
    bbox_3035, bbox_4326 = country_bboxes(country)
    settings.bbox = bbox_3035

    # 2. Per-country PBF, cut from the Europe-wide PBF on the buffered bbox when missing.
    europe_pbf = settings.osm_dir / settings.eu_europe_pbf_name
    pbf = settings.osm_dir / f"{country}-latest.osm.pbf"
    if not pbf.is_file():
        osm.extract_country_pbf(europe_pbf, pbf, bbox_4326)
    else:
        print(f"Reusing existing {pbf}")

    # Per-country paths (the shell pointed the sub-scripts here via a runtime conf).
    osm_filtered = settings.osm_dir / f"{country}-filtered.osm.pbf"
    roads_gpkg = settings.osm_dir / f"{country}_roads.gpkg"
    settings.roads_rasterized = settings.osm_dir / f"{country}_roads_rasterized.tif"
    roads_smooth = settings.osm_dir / f"{country}_roads_smooth.tif"
    clc_classified = settings.clc_dir / f"{country}_clc_classes.tif"
    clc_stack = settings.clc_dir / f"{country}_clc_classes_stack.tif"

    # 3. OSM roads heatmap (filter -> gpkg -> rasterize + smooth).
    if needs_prep(force_prep, roads_smooth):
        print(f"Building OSM roads heatmap for {country}...")
        osm.filter_osm_pbf(pbf, osm_filtered)
        osm.create_roads_gpkg(osm_filtered, roads_gpkg)
        osm.rasterize_and_smooth_roads(roads_gpkg, roads_smooth)
    else:
        print(f"Reusing existing {roads_smooth} (--force-prep to rebuild)")

    # 4. CLC one-hot land-cover stack.
    if needs_prep(force_prep, clc_stack):
        print(f"Building CLC stack for {country}...")
        clc.create_clc_stack(
            settings.clc_source, settings.clc_mapping, clc_classified, clc_stack
        )
    else:
        print(f"Reusing existing {clc_stack} (--force-prep to rebuild)")

    # 5. Encode the heatmap on this country's buffered grid (TARGET_EPSG). No clip
    #    or reproject yet - those run once on the merged mosaic.
    country_3035 = settings.temp_dir / f"{settings.eu_output_area}_{country}_3035.tif"
    gdal_controller.calculate_heatmap(roads_smooth, clc_stack, country_3035)
    return country_3035


def main() -> None:
    args = parse_args()
    settings.dry_run = args.dry_run

    for directory in (
        settings.osm_dir,
        settings.clc_dir,
        settings.bounds_dir,
        settings.output_dir,
        settings.temp_dir,
    ):
        directory.mkdir(parents=True, exist_ok=True)

    if args.dry_run:
        print("Dry run: no GDAL, osmium, rio-cogeo or geocoding operations will run.")
    else:
        gdal_common.configure_gdal()

    banner("Multi-country raster workflow")
    print(f"Output area: {settings.eu_output_area}")
    print(f"Countries: {', '.join(settings.eu_countries)}")

    per_country_3035 = [
        process_country(country, args.force_prep) for country in settings.eu_countries
    ]

    # Dissolved exact boundary for the final clip (union of the country polygons).
    dissolved_gpkg = settings.bounds_dir / f"{settings.eu_output_area}.gpkg"
    banner(f"Build dissolved {settings.eu_output_area} boundary")
    if not settings.dry_run:
        bounds.create_dissolved_bounds(
            settings.eu_output_area, list(settings.eu_countries)
        )

    # Mosaic the per-country rasters on the shared grid, then clip to the exact
    # dissolved outline, reproject to Web Mercator and write the web-optimized COG.
    mosaic_vrt = settings.temp_dir / f"{settings.eu_output_area}_3035.vrt"
    gdal_controller.mosaic_rasters(per_country_3035, mosaic_vrt)

    reprojected = settings.temp_dir / f"{settings.eu_output_area}_3857.tif"
    output_cog = next_versioned_cog(f"{settings.eu_output_area}_20m")
    gdal_controller.clip_reproject_web_cog(
        mosaic_vrt,
        output_cog,
        reprojected,
        dissolved_gpkg,
        layer=settings.eu_output_area,
    )

    banner(f"Successfully created {settings.eu_output_area} COG: {output_cog}")


if __name__ == "__main__":
    main()
