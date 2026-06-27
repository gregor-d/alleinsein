import math
import os
from pathlib import Path

import geopandas as gpd
import osmnx as ox
from dotenv import dotenv_values
from shapely.geometry import box

SCRIPT_DIR = Path(__file__).resolve().parent
RASTER_DIR = SCRIPT_DIR.parent
DEFAULT_RASTER_CONFIG_FILE = RASTER_DIR / "raster.conf"
OUT_DIR = RASTER_DIR / "input/bounds"

TARGET_CRS = "EPSG:3035"

# AREA from the environment (set per-country by the EU orchestrator) takes
# precedence; fall back to raster.conf for the single-area workflow.
area_name = os.environ.get("AREA") or dotenv_values(DEFAULT_RASTER_CONFIG_FILE).get(
    "AREA"
)
if not area_name:
    raise ValueError(f"AREA is required (env AREA or {DEFAULT_RASTER_CONFIG_FILE})")

# Cross-border buffer and grid snap (meters, in TARGET_CRS). Both default to 0,
# which reproduces the original exact, unsnapped single-area behaviour.
buffer_m = float(os.environ.get("BOUNDS_BUFFER_M", "0"))
snap_m = float(os.environ.get("BOUNDS_SNAP_M", "0"))

OUT_DIR.mkdir(parents=True, exist_ok=True)
out_gpkg = OUT_DIR / f"{area_name}.gpkg"

gdf = ox.geocoder.geocode_to_gdf(area_name)
gdf_3035 = gdf.to_crs(TARGET_CRS)

# Exact boundary polygon, used for the final clip. Never buffered, so adjacent
# areas tile against their true borders without overlap when mosaicked.
gdf_3035.to_file(out_gpkg, layer=area_name, driver="GPKG")

minx, miny, maxx, maxy = gdf_3035.total_bounds

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
# reprojected rectangle instead — guaranteeing the extract contains the 3035 box.
buffered_box = gpd.GeoSeries([box(minx, miny, maxx, maxy)], crs=TARGET_CRS)
w, s, e, n = buffered_box.to_crs("EPSG:4326").total_bounds

# Printed for copy/paste into raster.conf in the single-area workflow.
print(f'export MINX="{minx:.0f}"')
print(f'export MINY="{miny:.0f}"')
print(f'export MAXX="{maxx:.0f}"')
print(f'export MAXY="{maxy:.0f}"')

bounds_conf = OUT_DIR / f"{area_name}_bounds.conf"
with bounds_conf.open("w") as f:
    f.write(
        f"# Bounds for {area_name} "
        f"(buffer {buffer_m:.0f}m, snap {snap_m:.0f}m, {TARGET_CRS})\n"
    )
    f.write(f'MINX="{minx:.0f}"\n')
    f.write(f'MINY="{miny:.0f}"\n')
    f.write(f'MAXX="{maxx:.0f}"\n')
    f.write(f'MAXY="{maxy:.0f}"\n')
    f.write("# WGS84 bbox for: osmium extract --bbox=$OSM_BBOX\n")
    f.write(f'OSM_BBOX="{w:.6f},{s:.6f},{e:.6f},{n:.6f}"\n')

print(f"Wrote {out_gpkg}")
print(f"Wrote {bounds_conf}")
