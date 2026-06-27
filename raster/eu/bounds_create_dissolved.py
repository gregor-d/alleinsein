"""Union several area-boundary GeoPackages into one dissolved boundary, used to
clip the merged multi-country raster to its exact outline.

Usage:
    uv run raster/eu/bounds_create_dissolved.py <output_area> <area> [<area> ...]

Example:
    uv run raster/eu/bounds_create_dissolved.py dach germany switzerland austria
"""

import sys
from pathlib import Path

import geopandas as gpd
from shapely.ops import unary_union

SCRIPT_DIR = Path(__file__).resolve().parent
RASTER_DIR = SCRIPT_DIR.parent
BOUNDS_DIR = RASTER_DIR / "input" / "bounds"
TARGET_CRS = "EPSG:3035"

if len(sys.argv) < 3:
    raise SystemExit(__doc__)

output_area = sys.argv[1]
areas = sys.argv[2:]

geoms = []
for area in areas:
    gpkg = BOUNDS_DIR / f"{area}.gpkg"
    if not gpkg.exists():
        raise FileNotFoundError(
            f"Missing {gpkg} - run bounds_create_area.py for '{area}' first"
        )
    geoms.append(gpd.read_file(gpkg, layer=area).to_crs(TARGET_CRS).union_all())

dissolved = unary_union(geoms)

out = BOUNDS_DIR / f"{output_area}.gpkg"
gpd.GeoDataFrame({"name": [output_area]}, geometry=[dissolved], crs=TARGET_CRS).to_file(
    out, layer=output_area, driver="GPKG"
)

print(f"Wrote {out} (layer '{output_area}') from: {', '.join(areas)}")
