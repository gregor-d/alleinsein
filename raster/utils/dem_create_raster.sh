#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=load_raster_config.sh
source "${SCRIPT_DIR}/load_raster_config.sh"

DEM_DIR="${RASTER_ROOT_DIR}/input/dem"
INPUT_RASTER="${DEM_DIR}/eudem_slop_3035_europe.tif"
MAPPING_FILE="${DEM_DIR}/slope_classes.txt"
# Slope classes (1..4, flat..steep) on the shared TARGET_EPSG 20m grid, so they line
# up pixel-for-pixel with the roads/CLC rasters and the heatmap output and can be
# combined with gdal_calc without any reprojection. Read by the slope band scripts
# (create_hotspot_slope_band.sh, create_slope_mod_band.sh).
OUTPUT_RASTER="${RASTER_ROOT_DIR}/input/transformed/${AREA}_slope_classes.tif"

BBOX="${MINX},${MINY},${MAXX},${MAXY}"

if [[ ! -r "$INPUT_RASTER" ]]; then
  echo "Missing DEM slope input raster: $INPUT_RASTER" >&2
  exit 1
fi

if [[ ! -r "$MAPPING_FILE" ]]; then
  echo "Missing slope mapping file: $MAPPING_FILE" >&2
  exit 1
fi

mkdir -p "$(dirname "$OUTPUT_RASTER")"

# Clip + resample the EPSG:3035 slope onto the shared BBOX/20m grid (the --bbox and
# --resolution match roads/CLC by construction: same origin and size), then
# reclassify into slope classes. Slope is in weird units, so slope_classes.txt maps
# it back to degree-based classes; nearest keeps the original values intact through
# the resample, so reclassifying after it gives the same result as before.
printf 'Running gdal raster pipeline -> %s\n' "$OUTPUT_RASTER"
gdal raster pipeline \
  "!" read "$INPUT_RASTER" \
  "!" reproject -d "$TARGET_EPSG" "--bbox=$BBOX" "--bbox-crs=$TARGET_EPSG" "--resolution=$RASTER_RESOLUTION" -r nearest \
  "!" reclassify "--mapping=@$MAPPING_FILE" "--ot=$RASTER_DATA_TYPE" \
  "!" edit "--nodata=$RASTER_NODATA" \
  "!" write "${GTIFF_WRITE_OPTIONS[@]}" $OVERWRITE "$OUTPUT_RASTER"

printf 'Wrote %s\n' "$OUTPUT_RASTER"

# slope is in weird units so we need to reclassify with this mapping, back to degrees:
# acos(249/250)*180/!pi
# 249, 5
# 246 10
# 235 20


# Class	Slope (°)	Name
# 1	0–5	gentle to flat
# 2	5–10	moderate
# 3	10–20	hilly
# 4	20+	steep
