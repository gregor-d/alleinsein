from pathlib import Path

import geopandas as gpd
from dotenv import dotenv_values
from shapely.geometry import box

SCRIPT_DIR = Path(__file__).resolve().parent
RASTER_DIR = SCRIPT_DIR.parent
PROJECT_DIR = RASTER_DIR.parent
DEFAULT_RASTER_CONFIG_FILE = RASTER_DIR / "raster.conf"

area_name = dotenv_values(DEFAULT_RASTER_CONFIG_FILE).get("AREA")
if not area_name:
    raise ValueError(f"AREA is required in {DEFAULT_RASTER_CONFIG_FILE}")

INPUT = RASTER_DIR / "input" / "bounds" / f"{area_name}.gpkg"
# OUTPUT = RASTER_DIR / "input" / "bounds" / f"{area_name}_mask.geojson"
OUTPUT = PROJECT_DIR / "frontend" / "static" / "germany-mask.geojson"


gdf = gpd.read_file(INPUT, layer=area_name)
# For JS-mapping, write GeoJSON in EPSG:4326
gdf_4326 = gdf.to_crs("EPSG:4326")
area_geom = gdf_4326.geometry.union_all()

world = box(-180, -85.05112878, 180, 85.05112878)

SIMPLIFY_TOLERANCE = 0.001  # degrees, roughly ~100m
COORDINATE_PRECISION = 5  # <1m precision in EPSG:4326

area_geom = area_geom.simplify(SIMPLIFY_TOLERANCE, preserve_topology=True)

mask = gpd.GeoDataFrame(
    {"name": [f"{area_name} mask"]},
    geometry=[world.difference(area_geom)],
    crs="EPSG:4326",
)

mask.to_file(
    OUTPUT,
    driver="GeoJSON",
    layer_options={"COORDINATE_PRECISION": str(COORDINATE_PRECISION)},
)
