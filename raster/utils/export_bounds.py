from pathlib import Path
import osmnx as ox
from os import getenv

# get area name from environment variable, default raise exception if not set
area_name = getenv("AREA")
if area_name is None:
    raise ValueError("AREA environment variable not set")

out = Path(f"input_data/bounds/{area_name}.gpkg")
out.parent.mkdir(parents=True, exist_ok=True)

gdf = ox.geocoder.geocode_to_gdf(area_name)
gdf = gdf.to_crs("EPSG:3035")

gdf.to_file(out, layer=area_name, driver="GPKG")

minx, miny, maxx, maxy = gdf.total_bounds
print(f'export MINX="{minx:.0f}"')
print(f'export MINY="{miny:.0f}"')
print(f'export MAXX="{maxx:.0f}"')
print(f'export MAXY="{maxy:.0f}"')

# write bounds to .env file
with open(".env", "a") as f:
    f.write(f'# Bounds for {area_name}\n')
    f.write(f'export MINX="{minx:.0f}"\n')
    f.write(f'export MINY="{miny:.0f}"\n')
    f.write(f'export MAXX="{maxx:.0f}"\n')
    f.write(f'export MAXY="{maxy:.0f}"\n')
