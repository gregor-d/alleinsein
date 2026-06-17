from pathlib import Path

import osmnx as ox
from dotenv import dotenv_values

SCRIPT_DIR = Path(__file__).resolve().parent
RASTER_DIR = SCRIPT_DIR.parent
DEFAULT_RASTER_CONFIG_FILE = RASTER_DIR / "raster.conf"
OUT_DIR = RASTER_DIR / "input/bounds"


area_name = dotenv_values(DEFAULT_RASTER_CONFIG_FILE).get("AREA")
if not area_name:
    raise ValueError(f"AREA is required in {DEFAULT_RASTER_CONFIG_FILE}")

out = Path(f"{OUT_DIR}/{area_name}.gpkg")
OUT_DIR.mkdir(parents=True, exist_ok=True)

gdf = ox.geocoder.geocode_to_gdf(area_name)

gdf_3035 = gdf.to_crs("EPSG:3035")
gdf_3035.to_file(out, layer=area_name, driver="GPKG")


minx, miny, maxx, maxy = gdf_3035.total_bounds
print(f'export MINX="{minx:.0f}"')
print(f'export MINY="{miny:.0f}"')
print(f'export MAXX="{maxx:.0f}"')
print(f'export MAXY="{maxy:.0f}"')

# write bounds to .env file
bounds_conf = Path(f"{OUT_DIR}/{area_name}_bounds.conf")
with bounds_conf.open("w") as f:
    f.write(f"# Bounds for {area_name}\n")
    f.write(f'MINX="{minx:.0f}"\n')
    f.write(f'MINY="{miny:.0f}"\n')
    f.write(f'MAXX="{maxx:.0f}"\n')
    f.write(f'MAXY="{maxy:.0f}"\n')
