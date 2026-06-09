import time
import urllib.request
import json
import random
import urllib.parse

cmap = {"1": [68, 1, 84, 230]}
cmap_json = json.dumps(cmap)
# Endpoint for the old EPSG:3035 file
url_old = f"http://167.233.20.236:8000/api/raster/WebMercatorQuad/tilejson.json?raster=sachsen_raster_cog.tif&colormap={urllib.parse.quote(cmap_json)}"
# url_old = f"http://167.233.20.236:8000/api/raster/EuropeanETRS89_LAEAQuad/tilejson.json?raster=sachsen_raster_cog.tif&colormap={urllib.parse.quote(cmap_json)}"

# Endpoint for the new WebMercator file
url_new = f"http://167.233.20.236:8000/api/raster/WebMercatorQuad/tilejson.json?raster=sachsen_raster_web.tif&colormap={urllib.parse.quote(cmap_json)}"
# url_new = f"http://167.233.20.236:8000/api/raster/EuropeanETRS89_LAEAQuad/tilejson.json?raster=sachsen_raster_web.tif&colormap={urllib.parse.quote(cmap_json)}"

# Generate a random tile coordinates to avoid any server-side NGINX/TiTiler caching
x = random.randint(272, 277)
y = random.randint(169, 173)
# y = random.randint(264, 283)
# x = random.randint(278, 305)
z = 9


def fetch_and_time_tile(tilejson_url, label):
    try:
        t0 = time.time()

        # Fetch TileJSON to get the true tiles endpoint
        req = urllib.request.Request(
            tilejson_url, headers={"User-Agent": "Mozilla/5.0"}
        )
        with urllib.request.urlopen(req) as response:
            tj = json.loads(response.read().decode())
            tile_url = (
                tj["tiles"][0]
                .replace("{z}", str(z))
                .replace("{x}", str(x))
                .replace("{y}", str(y))
            )

        t1 = time.time()

        # Fetch the actual tile
        req_tile = urllib.request.Request(
            tile_url, headers={"User-Agent": "Mozilla/5.0"}
        )
        with urllib.request.urlopen(req_tile) as response:
            data = response.read()

        t2 = time.time()

        print(
            f"{label} TileJSON: {(t1 - t0) * 1000:.1f}ms | Tile (z={z}): {(t2 - t1) * 1000:.1f}ms | Size: {len(data) / 1024:.1f} KB"
        )
    except Exception as e:
        print(f"{label} Error: {e}")


if __name__ == "__main__":
    print(f"Benchmarking tile z={z}, x={x}, y={y}...")
    fetch_and_time_tile(url_old, "Old (EPSG:3035) ")
    fetch_and_time_tile(url_new, "New (WebMercator)")
