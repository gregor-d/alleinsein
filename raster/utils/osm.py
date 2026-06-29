# pyright: reportMissingImports=false
"""OSM / road stage of the raster pipeline.

Cut a country PBF out of the Europe-wide extract (multi-country only), pre-filter the
PBF to highway/railway ways, build the roads GeoPackage, then rasterize + smooth the
network into the 1..10 road-proximity heatmap. Each function takes explicit ``Path``
arguments; config knobs and ``settings.dry_run`` come from ``raster_settings``.

Run standalone — with no subcommand it runs the full chain (filter -> gpkg ->
rasterize + smooth -> roads_smooth); a subcommand runs that single step. All paths come
from ``raster_settings`` (``extract_country_pbf`` is multi-country only and is driven by
the EU coordinator, not this CLI):
    uv run python -m raster.utils.osm [--dry-run]
    uv run python -m raster.utils.osm filter [--dry-run]
    uv run python -m raster.utils.osm gpkg
    uv run python -m raster.utils.osm rasterize
"""

from __future__ import annotations

import argparse
import shlex
import shutil
import subprocess
import time
from pathlib import Path

from osgeo import gdal  # ty: ignore[unresolved-import]
from raster import raster_settings as settings
from raster.utils.gdal_common import configure_gdal, make_pipeline
from raster.utils.helpers import banner


# ---------------------------------------------------------------------------
# Step 0 - cut one country out of the Europe-wide PBF with osmium-tool
# (from eu/extract_countries.sh)
#
# Only used by the multi-country pipeline: extracts a per-country PBF on a buffered
# WGS84 bbox so the downstream road-smoothing kernel sees cross-border roads. The
# buffer ring is later discarded by the clip to the dissolved boundary.
# ---------------------------------------------------------------------------


def extract_country_pbf(europe_pbf: Path, out_pbf: Path, bbox_4326: str) -> None:
    banner(f"Extract OSM PBF: {out_pbf.name}")
    if not settings.dry_run and not europe_pbf.is_file():
        raise FileNotFoundError(
            f"Missing Europe PBF: {europe_pbf}\n"
            "Download it once: https://download.geofabrik.de/europe-latest.osm.pbf"
        )

    # complete_ways + set-bounds keep cross-border ways whole so the smoothing kernel
    # sees the neighbours' roads.
    osmium_cmd = [
        "osmium",
        "extract",
        "--bbox",
        bbox_4326,
        "--set-bounds",
        "--strategy=complete_ways",
        "-o",
        str(out_pbf),
        "--overwrite",
        str(europe_pbf),
    ]
    print("$ " + " ".join(shlex.quote(part) for part in osmium_cmd))
    if settings.dry_run:
        return

    if shutil.which("osmium") is None:
        raise RuntimeError("Missing required executable: osmium")
    subprocess.run(osmium_cmd, check=True)


# ---------------------------------------------------------------------------
# Step 1 - pre-filter the OSM PBF to highway/railway ways with osmium-tool
# (from utils/osm_filter_pbf.py)
#
# Shrinks the raw OSM extract so the later GDAL steps have far less to read.
# ---------------------------------------------------------------------------


def filter_osm_pbf(osm_latest: Path, osm_filtered: Path) -> None:
    banner("Filter OSM PBF")
    if not settings.dry_run and not osm_latest.is_file():
        raise FileNotFoundError(f"Missing OSM PBF input: {osm_latest}")

    osmium_cmd = [
        "osmium",
        "tags-filter",
        str(osm_latest),
        "w/highway",
        "w/railway",
        "-o",
        str(osm_filtered),
        "--overwrite",
    ]
    print("$ " + " ".join(shlex.quote(part) for part in osmium_cmd))
    if settings.dry_run:
        return

    if shutil.which("osmium") is None:
        raise RuntimeError("Missing required executable: osmium")
    subprocess.run(osmium_cmd, check=True)


# ---------------------------------------------------------------------------
# Step 2 - extract roads, paths and railways into a single GeoPackage
# (from utils/osm_create_gpkg.py)
#
# Reads the filtered OSM PBF, keeps only the relevant highway/railway classes, drops
# every attribute except geometry, and reprojects to TARGET_EPSG. No spatial index is
# written because the next step rasterizes line-by-line.
# ---------------------------------------------------------------------------

OSM_WHERE = (
    "highway IN ('residential','secondary','primary','tertiary','service',"
    "'living_street','primary_link','secondary_link','tertiary_link',"
    "'unclassified','trunk','motorway_link','trunk_link','motorway',"
    "'road','ramp','pedestrian','cycleway','proposed','construction',"
    "'footway','path','track','bridleway','trail') OR "
    "railway IN ('rail','light_rail','tram','subway','narrow_gauge',"
    "'funicular','monorail','miniature','preserved','construction','proposed')"
)


def create_roads_gpkg(osm_filtered: Path, roads_gpkg: Path) -> None:
    banner("Create roads GeoPackage")
    if not settings.dry_run and not osm_filtered.is_file():
        raise FileNotFoundError(f"Missing filtered OSM PBF: {osm_filtered}")

    where = f'"{OSM_WHERE}"'
    pipeline = make_pipeline(
        f"""
        ! read {osm_filtered.as_posix()} --if OSM --layer lines
        ! filter --where {where}
        ! select --fields _ogr_geometry_
        ! reproject --dst-crs {settings.target_epsg}
        ! write {roads_gpkg.as_posix()} --lco SPATIAL_INDEX=NO {settings.overwrite_arg}
        """
    )
    print(f"$ gdal vector pipeline {pipeline}")
    if settings.dry_run:
        return

    result = gdal.Run("vector pipeline", pipeline=pipeline)
    if hasattr(result, "Finalize"):
        result.Finalize()


# ---------------------------------------------------------------------------
# Step 3 - rasterize the roads and smooth them into a proximity heatmap
# (from utils/osm_rasterize_roads.py)
#
# Burn the road network onto the shared grid, then smooth it into a 1..10
# road-proximity heatmap. (Slope is applied separately by the dem stage, not here.)
# ---------------------------------------------------------------------------


def rasterize_and_smooth_roads(roads_gpkg: Path, roads_smooth: Path) -> None:
    banner("Rasterize and smooth roads")
    if not settings.dry_run and not roads_gpkg.is_file():
        raise FileNotFoundError(f"Missing roads GeoPackage: {roads_gpkg}")

    # 1. Burn the road network onto the shared grid (roads = 4, elsewhere = 0).
    start = time.monotonic()
    pipeline = make_pipeline(
        f"""
        ! read {roads_gpkg.as_posix()}
        ! rasterize --resolution {settings.resolution} --extent {settings.bbox} --burn 4 --target-aligned-pixels --init 0 --nodata {settings.nodata} --datatype {settings.data_type} --all-touched
        ! write {settings.overwrite_arg} {settings.gdal_pipeline_creation_options} {settings.roads_rasterized.as_posix()}
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
        ! write {settings.overwrite_arg} {settings.gdal_pipeline_creation_options} {roads_smooth.as_posix()}
        """
    )
    print(f"$ gdal raster pipeline {pipeline}")
    if not settings.dry_run:
        result = gdal.Run("raster pipeline", pipeline=pipeline)
        if hasattr(result, "Finalize"):
            result.Finalize()
    duration = int(time.monotonic() - start)
    print(f"{duration // 60} minutes and {duration % 60} seconds elapsed.")


def main() -> None:
    # --dry-run via a shared parent so it works before or after the subcommand;
    # SUPPRESS keeps the subparser default from clobbering a value set on the parent.
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--dry-run", action="store_true", default=argparse.SUPPRESS)

    parser = argparse.ArgumentParser(
        parents=[common],
        description=(
            "OSM road-proximity heatmap stage. Run a single step by name, or no "
            "subcommand to run the full chain (filter -> gpkg -> rasterize + smooth). "
            "All paths come from raster_settings."
        ),
    )
    sub = parser.add_subparsers(dest="command")
    sub.add_parser(
        "filter", parents=[common], help="filter the PBF to highway/railway ways"
    )
    sub.add_parser("gpkg", parents=[common], help="filtered PBF -> roads GeoPackage")
    sub.add_parser("rasterize", parents=[common], help="roads gpkg -> smoothed heatmap")

    args = parser.parse_args()
    settings.dry_run = getattr(args, "dry_run", False)

    settings.osm_dir.mkdir(parents=True, exist_ok=True)
    if not settings.dry_run:
        configure_gdal()

    if args.command == "filter":
        filter_osm_pbf(settings.osm_latest, settings.osm_filtered)
    elif args.command == "gpkg":
        create_roads_gpkg(settings.osm_filtered, settings.roads_gpkg)
    elif args.command == "rasterize":
        rasterize_and_smooth_roads(settings.roads_gpkg, settings.roads_smooth)
    else:  # no subcommand: the full chain
        filter_osm_pbf(settings.osm_latest, settings.osm_filtered)
        create_roads_gpkg(settings.osm_filtered, settings.roads_gpkg)
        rasterize_and_smooth_roads(settings.roads_gpkg, settings.roads_smooth)


if __name__ == "__main__":
    main()
