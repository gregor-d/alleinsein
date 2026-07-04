#!/usr/bin/env python3
from __future__ import annotations

import argparse
import shlex
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

from osgeo import gdal

from raster import raster_settings as settings
from raster.utils import bounds
from raster.utils.gdal_common import configure_gdal, make_pipeline
from raster.utils.helpers import banner, format_elapsed, timed_step


def _source_roads_pbf_path() -> Path:
    name = settings.europe_pbf_name.replace(".osm.pbf", "-roads.osm.pbf")
    return settings.osm_dir / name


def extract_country_pbf(*, source_pbf: Path, out_pbf: Path, bbox_4326: str) -> None:
    """Extract a country PBF from the source PBF.

    Args:
        source_pbf: Source PBF (e.g. Europe PBF).
        out_pbf: Output country PBF.
        bbox_4326: Extraction bbox as ``"west,south,east,north"``.

    Raises:
        FileNotFoundError: If the source PBF is missing.
        RuntimeError: If ``osmium`` is not installed.
        subprocess.CalledProcessError: If osmium fails.
    """
    banner(f"Extract OSM PBF: {out_pbf.name}")
    if not source_pbf.is_file():
        raise FileNotFoundError(
            f"Missing source PBF: {source_pbf}\n"
            "Download it once: https://download.geofabrik.de/europe-latest.osm.pbf"
        )

    # Keep cross-border ways complete for the smoothing kernel.
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
        str(source_pbf),
    ]
    print("$ " + " ".join(shlex.quote(part) for part in osmium_cmd))

    if shutil.which("osmium") is None:
        raise RuntimeError("Missing required executable: osmium")
    subprocess.run(osmium_cmd, check=True)


def filter_osm_pbf(*, osm_latest: Path, osm_filtered: Path) -> None:
    """Filter an OSM PBF to highway and railway ways.

    Args:
        osm_latest: Source OSM PBF.
        osm_filtered: Filtered output PBF.

    Raises:
        FileNotFoundError: If the source PBF is missing.
        RuntimeError: If ``osmium`` is not installed.
        subprocess.CalledProcessError: If osmium fails.
    """
    banner("Filter OSM PBF")
    if not osm_latest.is_file():
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

    if shutil.which("osmium") is None:
        raise RuntimeError("Missing required executable: osmium")
    subprocess.run(osmium_cmd, check=True)


OSM_WHERE = (
    "highway IN ('residential','secondary','primary','tertiary','service',"
    "'living_street','primary_link','secondary_link','tertiary_link',"
    "'unclassified','trunk','motorway_link','trunk_link','motorway',"
    "'road','ramp','pedestrian','cycleway','proposed','construction',"
    "'footway','path','track','bridleway','trail') OR "
    "railway IN ('rail','light_rail','tram','subway','narrow_gauge',"
    "'funicular','monorail','miniature','preserved','construction','proposed')"
)


def create_roads_gpkg(*, osm_filtered: Path, roads_gpkg: Path) -> None:
    """Create an EPSG:3035 roads GeoPackage from a filtered PBF.

    Args:
        osm_filtered: Filtered OSM PBF.
        roads_gpkg: Output roads GeoPackage.

    Raises:
        FileNotFoundError: If the filtered PBF is missing.
    """
    banner("Create roads GeoPackage")
    if not osm_filtered.is_file():
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

    result = gdal.Run("vector pipeline", pipeline=pipeline)
    if hasattr(result, "Finalize"):
        result.Finalize()


def rasterize_roads(
    *, roads_gpkg: Path, roads_rasterized: Path, bbox: str | None = None
) -> None:
    """Burn roads onto the target raster grid.

    Args:
        roads_gpkg: Source roads GeoPackage.
        roads_rasterized: Output raster path.
        bbox: Optional target bbox in ``settings.target_epsg``.

    Raises:
        FileNotFoundError: If the roads GeoPackage is missing.
        RuntimeError: If GDAL cannot open the roads GeoPackage.
    """
    banner("Rasterize roads")
    if not roads_gpkg.is_file():
        raise FileNotFoundError(f"Missing roads GeoPackage: {roads_gpkg}")

    if not bbox:
        dataset = gdal.OpenEx(str(roads_gpkg), gdal.OF_VECTOR)
        if dataset is None:
            raise RuntimeError(f"Cannot open roads GeoPackage: {roads_gpkg}")
        minx, maxx, miny, maxy = dataset.GetLayer(0).GetExtent()
        dataset = None
        bbox = f"{minx},{miny},{maxx},{maxy}"
        print(f"No bbox provided; using roads GeoPackage extent: {bbox}")

    start = time.perf_counter()
    pipeline = make_pipeline(
        f"""
        ! read {roads_gpkg.as_posix()}
        ! rasterize --resolution {settings.resolution} --extent {bbox} --burn 4 --target-aligned-pixels --init 0 --nodata {settings.nodata} --datatype {settings.data_type} --all-touched
        ! write {settings.overwrite_arg} {settings.gdal_pipeline_creation_options} {roads_rasterized.as_posix()}
        """
    )
    print(f"$ gdal pipeline {pipeline}")
    result = gdal.Run("pipeline", pipeline=pipeline)
    if hasattr(result, "Finalize"):
        result.Finalize()
    duration = time.perf_counter() - start
    print(f"Elapsed: {format_elapsed(duration)}")


def smooth_roads(*, roads_rasterized: Path, roads_smooth: Path) -> None:
    """Smooth a burned roads raster into a 1..10 proximity heatmap.

    Args:
        roads_rasterized: Burned roads raster.
        roads_smooth: Output proximity heatmap.

    Raises:
        FileNotFoundError: If the burned roads raster is missing.
    """
    banner("Smooth roads into proximity heatmap")
    if not roads_rasterized.is_file():
        raise FileNotFoundError(f"Missing rasterized roads: {roads_rasterized}")

    start = time.perf_counter()
    pipeline = make_pipeline(
        f"""
        ! read {roads_rasterized.as_posix()}
        ! neighbours --method mean --size 5 --kernel gaussian
        ! reproject --resolution 100,100 -r sum
        ! resize --resolution {settings.resolution} -r bilinear
        ! neighbours --method mean --size 5 --kernel gaussian --nodata {settings.nodata}
        ! scale --src-min 0 --src-max 10 --dst-min 1 --dst-max 10 --ot {settings.data_type} --exponent 0.25
        ! write {settings.overwrite_arg} {settings.gdal_pipeline_creation_options} {roads_smooth.as_posix()}
        """
    )
    print(f"$ gdal raster pipeline {pipeline}")
    result = gdal.Run("raster pipeline", pipeline=pipeline)
    if hasattr(result, "Finalize"):
        result.Finalize()
    duration = time.perf_counter() - start
    print(f"Elapsed: {format_elapsed(duration)}")


def build_roads_rasterized(
    *,
    label: str,
    source_roads_pbf: Path,
    bbox: str,
    tmp_dir: Path,
    roads_rasterized: Path,
) -> None:
    """Extract, vectorize, and burn roads into a raster clipped to ``bbox``.

    Args:
        label: Prefix for progress/timing messages and transient file names.
        source_roads_pbf: Filtered roads/rail PBF to extract from.
        bbox: Target bbox in ``settings.target_epsg`` as ``"minx,miny,maxx,maxy"``.
        tmp_dir: Directory for the transient PBF and GeoPackage.
        roads_rasterized: Output path for the burned roads raster.
    """
    if not source_roads_pbf.is_file():
        raise FileNotFoundError(
            f"Missing source roads PBF: {source_roads_pbf}\n"
            f"Build it first with: uv run python -m raster.utils.osm {label} filter"
        )

    area_pbf = tmp_dir / f"{label}.osm.pbf"
    roads_gpkg = tmp_dir / f"{label}_roads.gpkg"
    with timed_step(f"{label}: prepare PBF"):
        extract_country_pbf(
            source_pbf=source_roads_pbf,
            out_pbf=area_pbf,
            bbox_4326=bounds.get_bbox_4326(bbox),
        )
    with timed_step(f"{label}: build roads GeoPackage"):
        print(f"Building roads GeoPackage for {label}...")
        create_roads_gpkg(osm_filtered=area_pbf, roads_gpkg=roads_gpkg)
    with timed_step(f"{label}: rasterize roads"):
        print(f"Rasterizing roads for {label}...")
        rasterize_roads(
            roads_gpkg=roads_gpkg,
            roads_rasterized=roads_rasterized,
            bbox=bbox,
        )


def main() -> None:
    common = argparse.ArgumentParser(add_help=False)
    parser = argparse.ArgumentParser(
        parents=[common],
        description=(
            "OSM road-proximity heatmap stage for AREA. Run a single step by name, "
            "or no subcommand to run the full chain (extract -> gpkg -> rasterize "
            "-> smooth), clipped to AREA's bounds. Run `filter` first to build the "
            "shared roads PBF. Remaining paths come from raster_settings."
        ),
    )
    parser.add_argument(
        "area",
        help="Area name; used as the bounds file/layer and output file prefix.",
    )
    sub = parser.add_subparsers(dest="command")
    sub.add_parser(
        "filter", parents=[common], help="filter the PBF to highway/railway ways"
    )
    sub.add_parser("gpkg", parents=[common], help="filtered PBF -> roads GeoPackage")
    sub.add_parser("rasterize", parents=[common], help="roads gpkg -> burned raster")
    sub.add_parser(
        "smooth", parents=[common], help="burned raster -> proximity heatmap"
    )

    args = parser.parse_args()

    settings.osm_dir.mkdir(parents=True, exist_ok=True)
    configure_gdal()

    area = args.area
    source_pbf = settings.osm_dir / settings.europe_pbf_name
    source_roads_pbf = _source_roads_pbf_path()
    roads_smooth = settings.osm_dir / f"{area}_roads_smooth.tif"

    if args.command is not None:
        osm_filtered = source_roads_pbf
        roads_gpkg = settings.osm_dir / f"{area}_roads.gpkg"
        roads_rasterized = settings.osm_dir / f"{area}_roads_rasterized.tif"

        if args.command == "filter":
            filter_osm_pbf(osm_latest=source_pbf, osm_filtered=osm_filtered)
        elif args.command == "gpkg":
            create_roads_gpkg(osm_filtered=osm_filtered, roads_gpkg=roads_gpkg)
        elif args.command == "rasterize":
            rasterize_roads(roads_gpkg=roads_gpkg, roads_rasterized=roads_rasterized)
        elif args.command == "smooth":
            smooth_roads(roads_rasterized=roads_rasterized, roads_smooth=roads_smooth)
        return

    # Full chain: intermediates are temporary; only roads_smooth is kept.
    settings.temp_dir.mkdir(parents=True, exist_ok=True)

    # Clip the Europe source to the configured area's buffered bounds.
    if not (settings.bounds_dir / f"{area}.gpkg").is_file():
        print(f"Geocoding bounds for {area}...")
        bounds.geocode_area_to_gpkg(area)
    buffered_bbox = bounds.get_bbox(
        area=area,
        buffer_m=settings.bounds_buffer_m,
        snap_m=settings.bounds_snap_m,
    )

    with tempfile.TemporaryDirectory(
        prefix=f"osm_{area}_", dir=settings.temp_dir
    ) as tmp:
        tmp_dir = Path(tmp)
        roads_rasterized = tmp_dir / f"{area}_roads_rasterized.tif"
        build_roads_rasterized(
            label=area,
            source_roads_pbf=source_roads_pbf,
            bbox=buffered_bbox,
            tmp_dir=tmp_dir,
            roads_rasterized=roads_rasterized,
        )
        smooth_roads(roads_rasterized=roads_rasterized, roads_smooth=roads_smooth)


if __name__ == "__main__":
    main()
