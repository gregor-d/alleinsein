#!/usr/bin/env python3
"""Boundary GeoPackage, bbox, and mask helpers."""

from __future__ import annotations

import argparse
import math
import os
from pathlib import Path

import raster.raster_settings as settings
from raster.utils.helpers import slugify_areas

SCRIPT_DIR = Path(__file__).resolve().parent
RASTER_DIR = SCRIPT_DIR.parent
PROJECT_DIR = RASTER_DIR.parent
BOUNDS_DIR = RASTER_DIR / "input" / "bounds"
DEFAULT_MASK_OUTPUT = PROJECT_DIR / "frontend" / "static" / "raster-data-mask.geojson"

TARGET_CRS = "EPSG:3035"

# EPSG:4326 envelope for bbox, dissolve, and mask operations.
BOUNDS_ENVELOPE_4326 = (-14.5, 34.0, 40.5, 72.0)


def _warn_if_over_envelope(*, area: str, geom_4326) -> None:
    min_lon, min_lat, max_lon, max_lat = geom_4326.bounds
    env_min_lon, env_min_lat, env_max_lon, env_max_lat = BOUNDS_ENVELOPE_4326
    over = []
    if min_lon < env_min_lon:
        over.append(f"west lon {min_lon:.2f} < {env_min_lon}")
    if min_lat < env_min_lat:
        over.append(f"south lat {min_lat:.2f} < {env_min_lat}")
    if max_lon > env_max_lon:
        over.append(f"east lon {max_lon:.2f} > {env_max_lon}")
    if max_lat > env_max_lat:
        over.append(f"north lat {max_lat:.2f} > {env_max_lat}")
    if over:
        print(
            f"WARNING: '{area}' extent exceeds the bounds envelope "
            f"(lon {env_min_lon}..{env_max_lon}, lat {env_min_lat}..{env_max_lat}); "
            f"clipping {', '.join(over)}"
        )


def geocode_area_to_gpkg(area: str) -> Path:
    import osmnx as ox

    BOUNDS_DIR.mkdir(parents=True, exist_ok=True)
    out_gpkg = BOUNDS_DIR / f"{area}.gpkg"

    # File/layer names use underscores; Nominatim needs spaces.
    query = area.replace("_", " ")

    try:
        gdf = ox.geocoder.geocode_to_gdf(query)
    except Exception as exc:
        raise ValueError(f"Could not geocode area '{query}': {exc}") from exc

    if gdf is None or gdf.empty:
        raise ValueError(f"No results found for area '{query}'")

    gdf.to_crs(TARGET_CRS).to_file(out_gpkg, layer=area, driver="GPKG")

    print(f"Wrote {out_gpkg}")
    return out_gpkg


def get_bbox(*, area: str, buffer_m: float = 0.0, snap_m: float = 0.0) -> str:
    """Return a buffered EPSG:3035 bbox for an area boundary.

    Args:
        area: Boundary file and layer name.
        buffer_m: Buffer applied to all bbox sides in metres.
        snap_m: Optional snap grid in metres.

    Returns:
        Bbox string as ``"minx,miny,maxx,maxy"``.

    Raises:
        FileNotFoundError: If the area GeoPackage is missing.
    """
    import geopandas as gpd
    from shapely.geometry import box

    gpkg = BOUNDS_DIR / f"{area}.gpkg"
    if not gpkg.exists():
        raise FileNotFoundError(
            f"Missing {gpkg} - run 'bounds.py area' for '{area}' first"
        )

    # Exclude geometries outside the configured bounds envelope before measuring bounds.
    bounds_env = box(
        BOUNDS_ENVELOPE_4326[0],
        BOUNDS_ENVELOPE_4326[1],
        BOUNDS_ENVELOPE_4326[2],
        BOUNDS_ENVELOPE_4326[3],
    )
    geom_4326 = gpd.read_file(gpkg, layer=area).to_crs("EPSG:4326").union_all()
    _warn_if_over_envelope(area=area, geom_4326=geom_4326)
    clipped = gpd.GeoSeries([geom_4326.intersection(bounds_env)], crs="EPSG:4326")
    minx, miny, maxx, maxy = clipped.to_crs(TARGET_CRS).total_bounds

    minx -= buffer_m
    miny -= buffer_m
    maxx += buffer_m
    maxy += buffer_m

    if snap_m > 0:
        minx = math.floor(minx / snap_m) * snap_m
        miny = math.floor(miny / snap_m) * snap_m
        maxx = math.ceil(maxx / snap_m) * snap_m
        maxy = math.ceil(maxy / snap_m) * snap_m

    return f"{minx:.0f},{miny:.0f},{maxx:.0f},{maxy:.0f}"


def get_bbox_4326(bbox_3035: str) -> str:
    import geopandas as gpd
    from shapely.geometry import box

    minx, miny, maxx, maxy = (float(v) for v in bbox_3035.split(","))
    w, s, e, n = (
        gpd.GeoSeries([box(minx, miny, maxx, maxy)], crs=TARGET_CRS)
        .to_crs("EPSG:4326")
        .total_bounds
    )
    return f"{w:.6f},{s:.6f},{e:.6f},{n:.6f}"


def create_dissolved_bounds(
    *, output_area: str, areas: list[str], simplify_tolerance: int = 0
) -> Path:
    """Dissolve area boundaries into one EPSG:3035 GeoPackage.

    Args:
        output_area: Output file and layer name.
        areas: Boundary file and layer names to union.
        simplify_tolerance: Douglas-Peucker tolerance in metres; 0 disables it.

    Returns:
        Written GeoPackage path.

    Raises:
        FileNotFoundError: If an input area GeoPackage is missing.
    """
    import geopandas as gpd
    from shapely.geometry import box
    from shapely.ops import unary_union

    # Dissolve only geometry inside the configured bounds envelope.
    bounds_env = box(
        BOUNDS_ENVELOPE_4326[0],
        BOUNDS_ENVELOPE_4326[1],
        BOUNDS_ENVELOPE_4326[2],
        BOUNDS_ENVELOPE_4326[3],
    )

    geoms = []

    for area in areas:
        gpkg = BOUNDS_DIR / f"{area}.gpkg"
        if not gpkg.exists():
            raise FileNotFoundError(
                f"Missing {gpkg} - run 'bounds.py area' for '{area}' first"
            )
        geom_4326 = gpd.read_file(gpkg, layer=area).to_crs("EPSG:4326").union_all()
        _warn_if_over_envelope(area=area, geom_4326=geom_4326)
        clipped = geom_4326.intersection(bounds_env)
        geoms.append(
            gpd.GeoSeries([clipped], crs="EPSG:4326").to_crs(TARGET_CRS).iloc[0]
        )

    dissolved = unary_union(geoms)

    if simplify_tolerance > 0:
        dissolved = dissolved.simplify(simplify_tolerance, preserve_topology=True)
        print(f"Simplified dissolved outline @ {simplify_tolerance} m tolerance")

    out = BOUNDS_DIR / f"{output_area}.gpkg"
    gpd.GeoDataFrame(
        {"name": [output_area]}, geometry=[dissolved], crs=TARGET_CRS
    ).to_file(out, layer=output_area, driver="GPKG")

    print(f"Wrote {out} (layer '{output_area}') from: {', '.join(areas)}")
    return out


def _create_geojson_mask(
    *,
    area: str,
    output: Path = DEFAULT_MASK_OUTPUT,
    simplify_tolerance: float = 0.001,  # Degrees; about 100 m.
    coordinate_precision: int = 5,  # <1m precision in EPSG:4326
) -> Path:
    """Create a world-minus-area GeoJSON mask.

    Args:
        area: Boundary file and layer name.
        output: Output GeoJSON path.
        simplify_tolerance: Simplification tolerance in EPSG:4326 degrees.
        coordinate_precision: GeoJSON coordinate precision.

    Returns:
        Written GeoJSON path.

    Raises:
        FileNotFoundError: If the area GeoPackage is missing.
    """
    import geopandas as gpd
    from shapely.geometry import box

    gpkg = BOUNDS_DIR / f"{area}.gpkg"
    if not gpkg.exists():
        raise FileNotFoundError(
            f"Missing {gpkg} - run 'bounds.py area <AREA>' or multiple 'bounds.py dissolved' (uses settings.COUNTRIES)"
        )

    area_geom_4326 = gpd.read_file(gpkg, layer=area).to_crs("EPSG:4326").union_all()
    _warn_if_over_envelope(area=area, geom_4326=area_geom_4326)
    bounds_env = box(
        BOUNDS_ENVELOPE_4326[0],
        BOUNDS_ENVELOPE_4326[1],
        BOUNDS_ENVELOPE_4326[2],
        BOUNDS_ENVELOPE_4326[3],
    )
    area_geom = area_geom_4326.intersection(bounds_env).simplify(
        simplify_tolerance, preserve_topology=True
    )

    world = box(-180, -85.05112878, 180, 85.05112878)
    mask = gpd.GeoDataFrame(
        {"name": [f"{area} mask"]},
        geometry=[world.difference(area_geom)],
        crs="EPSG:4326",
    )

    output.parent.mkdir(parents=True, exist_ok=True)
    mask.to_file(
        output,
        driver="GeoJSON",
        layer_options={"COORDINATE_PRECISION": str(coordinate_precision)},
    )
    print(f"Wrote {output}")
    return output


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Area-boundary helpers.")
    sub = parser.add_subparsers(dest="command", required=True)
    p_area = sub.add_parser(
        "area", help="geocode AREA -> exact boundary gpkg (+ print bbox)"
    )
    p_area.add_argument("area")
    diss = sub.add_parser(
        "dissolved",
        help="union raster_settings.countries -> raster_settings.output_area gpkg",
    )
    diss.add_argument(
        "--simplify",
        type=int,
        default=0,
        metavar="METRES",
        help="simplify the dissolved outline by this tolerance in metres (EPSG:3035); "
        "fewer vertices = faster clip, coarser coastline (default: 0 = exact)",
    )
    p_geojson = sub.add_parser(
        "geojson", help="AREA gpkg -> world-minus-area frontend mask"
    )
    p_geojson.add_argument("area")
    args = parser.parse_args(argv)

    if args.command == "area":
        geocode_area_to_gpkg(args.area)
        bbox_3035 = get_bbox(
            area=args.area,
            buffer_m=float(os.environ.get("BOUNDS_BUFFER_M", "0")),
            snap_m=float(os.environ.get("BOUNDS_SNAP_M", "0")),
        )
        minx, miny, maxx, maxy = bbox_3035.split(",")
        print(f'export MINX="{minx}"')
        print(f'export MINY="{miny}"')
        print(f'export MAXX="{maxx}"')
        print(f'export MAXY="{maxy}"')
    elif args.command == "dissolved":
        create_dissolved_bounds(
            output_area=settings.output_area,
            areas=slugify_areas(settings.countries),
            simplify_tolerance=args.simplify,
        )
    elif args.command == "geojson":
        _create_geojson_mask(area=args.area)


if __name__ == "__main__":
    main()
