"""Area-boundary helpers: geocoding and GeoPackage/GeoJSON derivation.

The per-area GeoPackage (``input/bounds/<area>.gpkg``) is the single source of truth
for bounds — there is no bounds.conf. Buffered/snapped processing extents are derived
from the gpkg on demand by ``buffered_bbox``.

Operations, importable as functions and runnable as a CLI (heavy geo deps are imported
lazily inside each function so importing this module stays cheap):

  - geocode_area(area): geocode an area and write its exact boundary gpkg.
  - buffered_bbox(area, buffer_m, snap_m): read the gpkg bounds, buffer + snap them,
    and return the processing bbox (EPSG:3035) and a WGS84 bbox covering it.
  - create_dissolved_bounds(output_area, areas): union several area gpkgs into one
    dissolved-boundary gpkg, used to clip the merged multi-country raster.
  - create_geojson_mask(area, output): invert an area gpkg into a world-minus-area
    GeoJSON mask for the frontend.

CLI (manual workflows):
    AREA=germany uv run raster/utils/bounds.py area      # buffer/snap via env
    uv run raster/utils/bounds.py dissolved dach germany switzerland austria
    AREA=germany uv run raster/utils/bounds.py geojson
"""

from __future__ import annotations

import argparse
import math
import os
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
RASTER_DIR = SCRIPT_DIR.parent
PROJECT_DIR = RASTER_DIR.parent
DEFAULT_RASTER_CONFIG_FILE = RASTER_DIR / "raster.conf"
BOUNDS_DIR = RASTER_DIR / "input" / "bounds"
DEFAULT_MASK_OUTPUT = PROJECT_DIR / "frontend" / "static" / "germany-mask.geojson"

TARGET_CRS = "EPSG:3035"


def geocode_area(area: str) -> Path:
    """Geocode ``area`` and write its exact boundary gpkg (EPSG:3035), returning the
    gpkg path. The gpkg is the single source of truth for bounds; buffered/snapped
    processing extents are derived on demand by ``buffered_bbox``."""
    import osmnx as ox

    BOUNDS_DIR.mkdir(parents=True, exist_ok=True)
    out_gpkg = BOUNDS_DIR / f"{area}.gpkg"

    # Exact boundary polygon, used for the final clip and as the basis for buffered
    # processing extents. Never buffered, so adjacent areas tile against their true
    # borders without overlap when mosaicked.
    ox.geocoder.geocode_to_gdf(area).to_crs(TARGET_CRS).to_file(
        out_gpkg, layer=area, driver="GPKG"
    )

    print(f"Wrote {out_gpkg}")
    return out_gpkg


def buffered_bbox(
    area: str, buffer_m: float = 0.0, snap_m: float = 0.0
) -> tuple[str, str]:
    """Read ``area``'s exact bounds from its gpkg (EPSG:3035), expand by ``buffer_m``
    and snap to ``snap_m``. Returns ``(bbox_3035, bbox_4326)``: the buffered processing
    bbox and a WGS84 bbox covering it (for ``osmium extract --bbox``). ``buffer_m`` /
    ``snap_m`` default to 0, giving the exact, unsnapped single-area extent."""
    import geopandas as gpd
    from shapely.geometry import box

    gpkg = BOUNDS_DIR / f"{area}.gpkg"
    if not gpkg.exists():
        raise FileNotFoundError(
            f"Missing {gpkg} - run 'bounds.py area' for '{area}' first"
        )

    minx, miny, maxx, maxy = gpd.read_file(gpkg, layer=area).to_crs(TARGET_CRS).total_bounds

    # Buffered processing extent: expand so the road-smoothing kernel sees the
    # neighbours' roads, then snap to a shared grid so every area lands on one global
    # pixel grid and the tiles mosaic seamlessly.
    minx -= buffer_m
    miny -= buffer_m
    maxx += buffer_m
    maxy += buffer_m

    if snap_m > 0:
        minx = math.floor(minx / snap_m) * snap_m
        miny = math.floor(miny / snap_m) * snap_m
        maxx = math.ceil(maxx / snap_m) * snap_m
        maxy = math.ceil(maxy / snap_m) * snap_m

    # WGS84 bbox covering the buffered 3035 rectangle, for `osmium extract --bbox`.
    # Reprojecting the rectangle's corners under-covers the curved edges, so bound the
    # reprojected rectangle instead - guaranteeing the extract contains the 3035 box.
    w, s, e, n = (
        gpd.GeoSeries([box(minx, miny, maxx, maxy)], crs=TARGET_CRS)
        .to_crs("EPSG:4326")
        .total_bounds
    )

    return (
        f"{minx:.0f},{miny:.0f},{maxx:.0f},{maxy:.0f}",
        f"{w:.6f},{s:.6f},{e:.6f},{n:.6f}",
    )


def create_dissolved_bounds(output_area: str, areas: list[str]) -> Path:
    """Union the per-area boundary GeoPackages into one dissolved boundary gpkg
    (layer ``output_area``). Returns the written gpkg path."""
    import geopandas as gpd
    from shapely.ops import unary_union

    geoms = []
    for area in areas:
        gpkg = BOUNDS_DIR / f"{area}.gpkg"
        if not gpkg.exists():
            raise FileNotFoundError(
                f"Missing {gpkg} - run 'bounds.py area' for '{area}' first"
            )
        geoms.append(gpd.read_file(gpkg, layer=area).to_crs(TARGET_CRS).union_all())

    dissolved = unary_union(geoms)

    out = BOUNDS_DIR / f"{output_area}.gpkg"
    gpd.GeoDataFrame(
        {"name": [output_area]}, geometry=[dissolved], crs=TARGET_CRS
    ).to_file(out, layer=output_area, driver="GPKG")

    print(f"Wrote {out} (layer '{output_area}') from: {', '.join(areas)}")
    return out


def create_geojson_mask(
    area: str,
    output: Path = DEFAULT_MASK_OUTPUT,
    *,
    simplify_tolerance: float = 0.001,  # degrees, roughly ~100m
    coordinate_precision: int = 5,  # <1m precision in EPSG:4326
) -> Path:
    """Invert ``area``'s boundary gpkg into a world-minus-area GeoJSON mask (EPSG:4326,
    simplified) for the frontend, written to ``output``. Returns the output path."""
    import geopandas as gpd
    from shapely.geometry import box

    gpkg = BOUNDS_DIR / f"{area}.gpkg"
    if not gpkg.exists():
        raise FileNotFoundError(
            f"Missing {gpkg} - run 'bounds.py area' for '{area}' first"
        )

    # For JS-mapping, write GeoJSON in EPSG:4326.
    gdf_4326 = gpd.read_file(gpkg, layer=area).to_crs("EPSG:4326")
    area_geom = gdf_4326.geometry.union_all().simplify(
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


def _area_from_env() -> str:
    """AREA from the environment (set per-country by the EU orchestrator) takes
    precedence; fall back to raster.conf for the single-area workflow."""
    from dotenv import dotenv_values

    area = os.environ.get("AREA") or dotenv_values(DEFAULT_RASTER_CONFIG_FILE).get("AREA")
    if not area:
        raise ValueError(f"AREA is required (env AREA or {DEFAULT_RASTER_CONFIG_FILE})")
    return area


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Area-boundary helpers.")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("area", help="geocode AREA -> exact boundary gpkg (+ print bbox)")
    diss = sub.add_parser("dissolved", help="union area gpkgs -> dissolved gpkg")
    diss.add_argument("output_area")
    diss.add_argument("areas", nargs="+")
    sub.add_parser("geojson", help="AREA gpkg -> world-minus-area frontend mask")
    args = parser.parse_args(argv)

    if args.command == "area":
        area = _area_from_env()
        geocode_area(area)
        bbox_3035, _ = buffered_bbox(
            area,
            float(os.environ.get("BOUNDS_BUFFER_M", "0")),
            float(os.environ.get("BOUNDS_SNAP_M", "0")),
        )
        # Printed for copy/paste into raster_settings.py / raster.conf.
        minx, miny, maxx, maxy = bbox_3035.split(",")
        print(f'export MINX="{minx}"')
        print(f'export MINY="{miny}"')
        print(f'export MAXX="{maxx}"')
        print(f'export MAXY="{maxy}"')
    elif args.command == "dissolved":
        create_dissolved_bounds(args.output_area, args.areas)
    elif args.command == "geojson":
        create_geojson_mask(_area_from_env())


if __name__ == "__main__":
    main()
