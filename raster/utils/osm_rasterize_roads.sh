#!/usr/bin/env bash

set -euo pipefail

SECONDS=0

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=load_raster_config.sh
source "${SCRIPT_DIR}/load_raster_config.sh"

OSM_DIR="${RASTER_ROOT_DIR}/input/osm"

ROADS_INPUT="${OSM_DIR}/${AREA}_roads.gpkg"
RASTERIZED_OUTPUT="${OSM_DIR}/${AREA}_roads_rasterized.tif"
SMOOTH_OUTPUT="${OSM_DIR}/${AREA}_roads_smooth.tif"
RASTER_BBOX="${MINX},${MINY},${MAXX},${MAXY}"

mkdir -p "$OSM_DIR"

echo "Using raster bounds: $RASTER_BBOX"

echo "=== Rasterizing roads ==="
echo "Reading vector data from $ROADS_INPUT"
echo "Writing raster data to $RASTERIZED_OUTPUT"
gdal vector rasterize "$ROADS_INPUT" "$RASTERIZED_OUTPUT" --resolution "$RASTER_RESOLUTION" --extent "$RASTER_BBOX" --burn 4 --target-aligned-pixels $OVERWRITE --init 0 --nodata "$RASTER_NODATA" --datatype "$RASTER_DATA_TYPE" --all-touched

duration=$SECONDS
echo "$((duration / 60)) minutes and $((duration % 60)) seconds elapsed."

echo "=== Smoothing road raster ==="
SECONDS=0
gdal raster pipeline \
  "!" read "$RASTERIZED_OUTPUT" \
  "!" neighbours --method mean --size 5 --kernel gaussian \
  "!" reproject --resolution 100,100 -r sum \
  "!" resize --resolution 20,20 -r bilinear \
  "!" neighbours --method mean --size 5 --kernel gaussian --nodata 255 \
  "!" scale --src-min 0 --src-max 10 --dst-min 1 --dst-max 10 --ot Byte --exponent 0.25 \
  "!" write $OVERWRITE "$SMOOTH_OUTPUT"

duration=$SECONDS
echo "$((duration / 60)) minutes and $((duration % 60)) seconds elapsed."
