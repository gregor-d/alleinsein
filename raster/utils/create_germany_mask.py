from __future__ import annotations

import json
from pathlib import Path

try:
    import geopandas as gpd
    from shapely.geometry import MultiPolygon, Polygon, box, mapping
    from shapely.validation import make_valid
except ImportError as exc:
    raise SystemExit(
        "Missing geospatial Python dependency. Install the project's dev environment "
        "or run this with the Windows env, for example: "
        ".\\.wenv\\Scripts\\python.exe raster\\utils\\create_germany_mask.py"
    ) from exc


SCRIPT_DIR = Path(__file__).resolve().parent
RASTER_DIR = SCRIPT_DIR.parent
PROJECT_DIR = RASTER_DIR.parent

INPUT = RASTER_DIR / "input" / "bounds" / "germany.gpkg"
OUTPUT = PROJECT_DIR / "frontend" / "static" / "germany-mask.geojson"
SIMPLIFY_TOLERANCE = 0.001
COORDINATE_PRECISION = 7
WORLD_BOUNDS = (-180.0, -90.0, 180.0, 90.0)
GEOJSON_CRS84 = {
    "type": "name",
    "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"},
}


def make_valid_geometry(geometry):
    fixed = make_valid(geometry)
    if fixed.is_empty:
        raise ValueError("Germany geometry is empty after validity repair")
    return fixed


def as_multipolygon(geometry) -> MultiPolygon:
    if isinstance(geometry, MultiPolygon):
        return geometry
    if isinstance(geometry, Polygon):
        return MultiPolygon([geometry])

    polygons: list[Polygon] = []
    for part in getattr(geometry, "geoms", []):
        if isinstance(part, Polygon):
            polygons.append(part)
        elif isinstance(part, MultiPolygon):
            polygons.extend(part.geoms)

    if not polygons:
        raise ValueError(f"Mask result does not contain polygons: {geometry.geom_type}")

    return MultiPolygon(polygons)


def round_coordinates(value, precision: int):
    if isinstance(value, float):
        return round(value, precision)
    if isinstance(value, list | tuple):
        return [round_coordinates(item, precision) for item in value]
    return value


if __name__ == "__main__":
    layer = INPUT.stem

    gdf = gpd.read_file(INPUT, layer=layer)
    gdf = gdf[gdf.geometry.notna() & ~gdf.geometry.is_empty].to_crs("EPSG:4326")
    germany = make_valid_geometry(gdf.geometry.union_all())
    germany = make_valid_geometry(
        germany.simplify(SIMPLIFY_TOLERANCE, preserve_topology=True)
    )

    mask = as_multipolygon(make_valid_geometry(box(*WORLD_BOUNDS).difference(germany)))
    mask_mapping = mapping(mask)
    mask_mapping["coordinates"] = round_coordinates(
        mask_mapping["coordinates"], COORDINATE_PRECISION
    )

    feature_collection = {
        "type": "FeatureCollection",
        "name": "germany-mask",
        "crs": GEOJSON_CRS84,
        "features": [{"type": "Feature", "properties": {}, "geometry": mask_mapping}],
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT.open("w", encoding="utf-8") as f:
        json.dump(feature_collection, f, ensure_ascii=True, separators=(",", ":"))
        f.write("\n")

    print(f"Wrote Germany mask GeoJSON: {OUTPUT}")
