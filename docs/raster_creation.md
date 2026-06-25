# Raster Creation

This document describes the full raster pipeline: data sources, configuration, each script's role, and the value-encoding scheme used in the final COG.

## Overview

| Script                                | Description                                                                                                                                                                                        |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `raster/create_raster.sh`             | Full pipeline entry point — runs all five stages below in sequence to build the full-detail 20 m COG                                                                                               |
| `raster/create_coarse_raster.sh`      | Derives the 160/320/640/1280 m overview COGs from the Stage 3/4 intermediates, served by the backend at low zooms (see [Coarse overview rasters](#coarse-overview-rasters-create_coarse_rastersh)) |
| `raster/utils/osm_filter_pbf.sh`      | Pre-filters the OSM PBF to highway and railway ways using osmium-tool, producing a much smaller PBF for GDAL to process                                                                            |
| `raster/utils/osm_create_gpkg.sh`     | Extracts roads, paths, and railways from the filtered OSM PBF into a single GeoPackage                                                                                                             |
| `raster/utils/osm_rasterize_roads.sh` | Rasterizes the GeoPackage and produces a smoothed road-proximity heatmap                                                                                                                           |
| `raster/utils/clc_raster_create.sh`   | Remaps and stacks CLC 2018 land-cover classes into a 5-band one-hot raster                                                                                                                         |
| `raster/utils/cog_info.sh`            | Prints file sizes and `rio cogeo info` for all COGs in `raster/out/`                                                                                                                               |
| `raster/utils/export_bounds.py`       | Geocodes an area name via OSMnx, writes a bounds GeoPackage, and prints the `MINX/MINY/MAXX/MAXY` values for `raster.conf` — run with `AREA=germany uv run raster/utils/export_bounds.py`          |
| `raster/utils/create_germany_mask.py` | Reads `input/bounds/germany.gpkg`, inverts it to a world-minus-Germany mask, simplifies, and writes `frontend/static/germany-mask.geojson` — run with `uv run raster/utils/create_germany_mask.py` |

## Pipeline

The pipeline converts two data sources — OpenStreetMap road/path/railway geometries and the CORINE Land Cover (CLC) 2018 dataset — into a single-band, web-optimized Cloud Optimized GeoTIFF (COG). Each pixel encodes both a land-cover class and a road-proximity score in a compact `Byte` value, so the frontend needs only one tile request per viewport instead of one per layer.

Entry point: `raster/create_raster.sh`

```
OSM .pbf
    └─ osm_filter_pbf.sh            → <AREA>-filtered.osm.pbf
         └─ osm_create_gpkg.sh      → roads .gpkg
              └─ osm_rasterize_roads.sh  → smoothed roads heatmap .tif
CLC 2018 .tif
    └─ clc_raster_create.sh     → 5-band one-hot land-cover stack .tif
                                         ↓
                               gdal_calc  (value encoding)
                                         ↓
                               clip + reproject to EPSG:3857
                                         ↓
                               rio cogeo  → web-optimized COG
```

---

## Prerequisites

### Input data

| File            | Expected location                               | Source                                                                               |
| --------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------ |
| OSM PBF extract | `raster/input/osm/<AREA>-latest.osm.pbf`        | [Geofabrik](https://download.geofabrik.de/)                                          |
| CLC 2018 raster | `raster/input/clc/U2018_CLC2018_V2020_20u1.tif` | [Copernicus Land Service](https://land.copernicus.eu/pan-european/corine-land-cover) |
| Area boundary   | `raster/input/bounds/<AREA>.gpkg`               | Manually prepared GeoPackage                                                         |

### System tools

`osmium-tool` is required for the OSM pre-filtering step and must be installed separately:

```bash
# Debian / Ubuntu
sudo apt install osmium-tool

```

### Python / GDAL environment

```bash
uv sync
source .venv/bin/activate   # Linux / macOS
# or on Windows:
.venv\Scripts\activate
```

The venv provides `gdal` (≥ 3.10, for the pipeline sub-commands), `rio-cogeo`, and their dependencies.

---

## Configuration (`raster/raster.conf`)

All scripts source `raster/raster.conf` (or `$RASTER_CONFIG_FILE`) before running.

```bash
# raster/raster.conf — annotated example
AREA="germany"              # Area name: drives file naming throughout the pipeline
OVERWRITE="--overwrite"     # Remove to protect existing intermediate files

TARGET_EPSG="EPSG:3035"    # Processing CRS (ETRS89-LAEA for metric accuracy over Europe)
WEB_EPSG="EPSG:3857"       # Output CRS for the final COG (Web Mercator)

RASTER_RESOLUTION="20,20"  # Pixel size in meters for the road raster
RASTER_NODATA="255"        # NoData sentinel used across all intermediate rasters
RASTER_DATA_TYPE="Byte"    # Output data type (0–254 usable values; 255 = NoData)

# GDAL/OSM memory and temporary file settings.
# Allow GDAL to use up to 2GB RAM for block caching.
GDAL_CACHEMAX="2048"
# Keep OSM node indexing in memory up to 2GB.
OSM_MAX_TMPFILE_SIZE="2048"
# Redirect temporary files to WSL native /tmp.
CPL_TMPDIR="/tmp"

# Bounding box in TARGET_EPSG.
# Align to a 100 m grid to avoid sub-pixel clipping when mixing 20 m and 100 m rasters.
MINX="4031300"
MINY="2684000"
MAXX="4672600"
MAXY="3556600"

GTIFF_WRITE_OPTIONS=(
  "--of=GTiff"
  "--co=TILED=YES"
  "--co=COMPRESS=DEFLATE"
  "--co=PREDICTOR=2"
  "--co=BIGTIFF=IF_SAFER"
)
```

---

## Stage 1 — OSM pre-filtering (`utils/osm_filter_pbf.sh`)

**Input:** `input/osm/<AREA>-latest.osm.pbf`  
**Output:** `input/osm/<AREA>-filtered.osm.pbf`

Uses `osmium-tool` to pre-filter the raw OSM PBF to only contain lines/ways with `highway` or `railway` tags, producing a much smaller PBF file for subsequent GDAL processing.

---

## Stage 2 — GeoPackage extraction (`utils/osm_create_gpkg.sh`)

**Input:** `input/osm/<AREA>-filtered.osm.pbf`  
**Output:** `input/osm/<AREA>_roads.gpkg`

Reads the pre-filtered OSM PBF using the GDAL OSM driver and writes a single GeoPackage containing roads, paths, and railways, all reprojected to `TARGET_EPSG`.

### Feature filters

Roads, paths, and railways are extracted based on the following combined query:

- **Roads**: motorized carriageways and bicycle/pedestrian infrastructure sharing space with traffic (`residential`, `secondary`, `primary`, `tertiary`, `service`, `living_street`, `primary_link`, `secondary_link`, `tertiary_link`, `unclassified`, `trunk`, `motorway_link`, `trunk_link`, `motorway`, `road`, `ramp`, `pedestrian`, `cycleway`, `proposed`, `construction`)
- **Paths**: off-carriageway routes (`footway`, `path`, `track`, `bridleway`, `trail`)
- **Railways**: track-bearing lines (`rail`, `light_rail`, `tram`, `subway`, `narrow_gauge`, `funicular`, `monorail`, `miniature`, `preserved`, `construction`, `proposed`)

### Performance and Size Optimizations

To keep the GeoPackage file size minimal:

- Only the geometry column is retained (`--fields _ogr_geometry_`).
- Spatial index creation is disabled (`--lco SPATIAL_INDEX=NO`) since the rasterization step processes the vector layers line-by-line and does not require a spatial query index.

---

## Stage 3 — Rasterization and smoothing (`utils/osm_rasterize_roads.sh`)

**Input:** `input/osm/<AREA>_roads.gpkg` from Stage 2  
**Output:** `input/osm/<AREA>_roads_smooth.tif` (20 m pixels, scaled 1–10)

### Rasterization

The GeoPackage is rasterized at `RASTER_RESOLUTION` (default 20 m) within the bounding box. `--all-touched` ensures that thin lines always hit at least one pixel. Every pixel touched by a feature is burned to `4`; untouched pixels are initialized to `0`.

```
<AREA>_roads.gpkg → <AREA>_roads_rasterized.tif (burn=4)
```

### Smoothing pipeline

The rasterized output is then smoothed through a sequence of GDAL raster pipeline steps:

```
<AREA>_roads_rasterized.tif
  │
  ├─ neighbours --method mean --size 5 --kernel gaussian
  │     Gaussian blur at 20 m resolution to spread road presence outward
  │
  ├─ reproject --resolution 100,100 -r sum
  │     Downscale to 100 m, summing pixel values — accumulates road length/density
  │
  ├─ resize --resolution 20,20 -r bilinear
  │     Upsample back to 20 m with smooth bilinear interpolation
  │
  ├─ neighbours --method mean --size 5 --kernel gaussian --nodata 255
  │     Second Gaussian pass to remove upsampling artefacts
  │
  └─ scale --src-min 0 --src-max 10 --dst-min 1 --dst-max 10
           --ot Byte --exponent 0.25
        Power-curve rescale to 1–10 (exponent < 1 boosts low-road-density areas)
        → <AREA>_roads_smooth.tif
```

The resulting raster has values `1`–`10` where **1 = low road proximity** (remote) and **10 = high road proximity** (dense network).

---

## Stage 4 — CLC land-cover stack (`utils/clc_raster_create.sh`)

**Input:** `input/clc/U2018_CLC2018_V2020_20u1.tif`  
**Output:** `input/clc/<AREA>_clc_classes_stack.tif` (5-band, one-hot encoded)

### CLC class remapping

The 44 original CLC classes are remapped to five custom classes using `input/clc/custom_classes.txt`:

| CLC values   | Custom class | Code |
| ------------ | ------------ | ---- |
| 1–9          | urban        | 4    |
| 10–11        | park         | 3    |
| 12–17, 19–22 | farm         | 2    |
| 18, 23–39    | nature       | 1    |
| 40–44        | water        | 5    |
| 48, DEFAULT  | no data      | 0    |

The full CLC-to-class mapping is in `input/clc/clc_classes_overview.csv`.

### One-hot stack

For each of the five classes (nature=1, farm=2, park=3, urban=4, water=5), a virtual reclassify is computed in GDALG (lazy/streamed) format:

```
<AREA>_clc_classes.tif
  ├─ band: nature  (1 where class=1, else 0)
  ├─ band: farm    (1 where class=2, else 0)
  ├─ band: park    (1 where class=3, else 0)
  ├─ band: urban   (1 where class=4, else 0)
  └─ band: water   (1 where class=5, else 0)
  → <AREA>_clc_classes_stack.tif  (resampled to RASTER_RESOLUTION)
```

Each band is a binary mask: `1` = pixel belongs to that class, `0` = it does not.

---

## Stage 5 — Value encoding and COG assembly (`create_raster.sh`)

**Inputs:**

- `input/osm/<AREA>_roads_smooth.tif` — road heatmap (A, values 1–10)
- `input/clc/<AREA>_clc_classes_stack.tif` — 5-band one-hot stack (B–F)
- `input/bounds/<AREA>.gpkg` — area boundary for clipping

**Output:** `out/<AREA>_20m_v<N>.tif`

### Value encoding formula

```
where(F==1, 200, A*B + (A+10)*C + (A+20)*D + (A+30)*E)
```

| Variable | Raster       | Meaning                     |
| -------- | ------------ | --------------------------- |
| A        | roads_smooth | Road-proximity score (1–10) |
| B        | CLC band 1   | Nature mask (0 or 1)        |
| C        | CLC band 2   | Farm mask (0 or 1)          |
| D        | CLC band 3   | Park mask (0 or 1)          |
| E        | CLC band 4   | Urban mask (0 or 1)         |
| F        | CLC band 5   | Water mask (0 or 1)         |

This produces a single `Byte` pixel whose value encodes both the land-cover class and isolation score:

| Pixel range | Class                  | Isolation (lower = more remote) |
| ----------- | ---------------------- | ------------------------------- |
| 0           | No data / unclassified | —                               |
| 1–10        | Nature                 | 1 = remote, 10 = near roads     |
| 11–20       | Farm                   | 1 = remote, 10 = near roads     |
| 21–30       | Park                   | 1 = remote, 10 = near roads     |
| 31–40       | Urban                  | 1 = remote, 10 = near roads     |
| 200         | Water                  | —                               |

### Post-processing

```
raw_calc.tif
  ├─ clip --like <AREA>.gpkg          clip to area boundary
  ├─ reproject -d EPSG:3857           reproject to Web Mercator
  └─ rio cogeo create --web-optimized align tiles to Web Mercator tile matrix,
                                       add overviews with Nearest resampling,
                                       blocksize of 512x512
     → out/<AREA>_20m_v<N>.tif
```

The output version number auto-increments (`v1`, `v2`, …) so existing COGs are never silently overwritten (unless `OVERWRITE` is set in `raster.conf`).

---

## Coarse overview rasters (`create_coarse_raster.sh`)

The full-detail COG is 20 m/pixel. Serving it at wide (low-zoom) views forces TiTiler to read and downsample a large footprint for every tile, which is slow and wasteful. `create_coarse_raster.sh` pre-bakes lower-resolution COGs so each zoom band reads a raster sized for it.

The backend ([`backend/main.py`](../backend/main.py)) maps tile zooms to rasters via `Settings.raster_tiers`, served coarsest-first.

| Tile zoom (`z`) | Raster file (default)  | Resolution |
| --------------- | ---------------------- | ---------- |
| ≤ 6             | `germany_1280m_v3.tif` | 1280 m     |
| 7               | `germany_640m_v3.tif`  | 640 m      |
| 8               | `germany_320m_v3.tif`  | 320 m      |
| ≥ 9 (to 99)     | `germany_20m_v3.tif`   | 20 m       |

> Note: `z` is the WebMercatorQuad tile-matrix zoom TiTiler receives, which is the frontend's slippy zoom minus 1. The `tilejson` endpoint (no `z`) returns the finest tier so its metadata advertises the full data footprint and detail.

The frontend requests a single tiled source and lets the backend pick the tier. A **Source** switch in the panel (shown only when `CONFIG.raster_override` is set) can instead pin that one raster via the `raster=` query param, bypassing tiering — useful for testing a specific COG.

---

## Inspecting the output (`utils/cog_info.sh`)

```bash
bash raster/utils/cog_info.sh
```

Prints file sizes and `rio cogeo info` output for every `.tif` in `raster/out/`, and diffs two named versions for quick before/after comparison.

---

## Running the full pipeline

```bash
# activate the venv first
source .venv/bin/activate

bash raster/create_raster.sh
```

Override the config path:

```bash
RASTER_CONFIG_FILE=/path/to/custom.conf bash raster/create_raster.sh
```

Then build the coarse overview COGs the backend serves at low zooms:

```bash
bash raster/create_coarse_raster.sh
```

Run individual stages manually (useful for debugging):

```bash
bash raster/utils/osm_filter_pbf.sh
bash raster/utils/osm_create_gpkg.sh
bash raster/utils/osm_rasterize_roads.sh
bash raster/utils/clc_raster_create.sh
```
