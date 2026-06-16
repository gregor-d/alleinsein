#!/usr/bin/env bash

set -euo pipefail

SECONDS=0

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=load_raster_config.sh
source "${SCRIPT_DIR}/load_raster_config.sh"

ROADS_INPUT="${SCRIPT_DIR}/${AREA}_roads.gpkg"
PATHS_INPUT="${SCRIPT_DIR}/${AREA}_paths.gpkg"
RAILWAYS_INPUT="${SCRIPT_DIR}/${AREA}_railways.gpkg"

ROADS_OUTPUT="${SCRIPT_DIR}/${AREA}_roads.tif"
PATHS_OUTPUT="${SCRIPT_DIR}/${AREA}_paths.tif"
RAILWAYS_OUTPUT="${SCRIPT_DIR}/${AREA}_railways.tif"
MERGED_OUTPUT="${SCRIPT_DIR}/${AREA}_roads_merge.tif"
SMOOTH_OUTPUT="${SCRIPT_DIR}/${AREA}_roads_smooth.tif"
RASTER_BBOX="${MINX},${MINY},${MAXX},${MAXY}"

echo "Using raster bounds: $RASTER_BBOX"

echo "=== Rasterizing roads ==="
echo "Reading vector data from $ROADS_INPUT"
echo "Writing raster data to $ROADS_OUTPUT"
gdal vector rasterize "$ROADS_INPUT" "$ROADS_OUTPUT" --resolution "$RASTER_RESOLUTION" --extent "$RASTER_BBOX" --burn 4 --target-aligned-pixels $OVERWRITE --init 0 --nodata "$RASTER_NODATA" --datatype "$RASTER_DATA_TYPE" --all-touched

echo "=== Rasterizing paths ==="
gdal vector rasterize "$PATHS_INPUT" "$PATHS_OUTPUT" --resolution "$RASTER_RESOLUTION" --extent "$RASTER_BBOX" --burn 4 $OVERWRITE --target-aligned-pixels --init 0 --nodata "$RASTER_NODATA" --datatype "$RASTER_DATA_TYPE" --all-touched

echo "=== Rasterizing railways ==="
gdal vector rasterize "$RAILWAYS_INPUT" "$RAILWAYS_OUTPUT" --resolution "$RASTER_RESOLUTION" --extent "$RASTER_BBOX" --burn 4 $OVERWRITE --target-aligned-pixels --init 0 --nodata "$RASTER_NODATA" --datatype "$RASTER_DATA_TYPE" --all-touched

echo "=== Merging road rasters ==="
gdal raster mosaic -i "$ROADS_OUTPUT" -i "$PATHS_OUTPUT" -i "$RAILWAYS_OUTPUT" --pixel-function max -o "$MERGED_OUTPUT" $OVERWRITE "${GTIFF_WRITE_OPTIONS[@]}"

duration=$SECONDS
echo "$((duration / 60)) minutes and $((duration % 60)) seconds elapsed."

echo "=== Smoothing road raster ==="
SECONDS=0
gdal raster pipeline \
! read $MERGED_OUTPUT \
! neighbours --method mean --size 5 --kernel gaussian \
! reproject --resolution 100,100 -r sum \
! resize --resolution 20,20 -r bilinear \
! neighbours --method mean --size 5 --kernel gaussian --nodata 255 \
! scale --src-min 0 --src-max 10 --dst-min 1 --dst-max 10 --ot Byte --exponent 0.25 \
! write $OVERWRITE $SMOOTH_OUTPUT

duration=$SECONDS
echo "$((duration / 60)) minutes and $((duration % 60)) seconds elapsed."
