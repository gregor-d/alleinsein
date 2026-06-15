#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=load_raster_config.sh
source "${SCRIPT_DIR}/load_raster_config.sh"

INPUT_RASTER="${SCRIPT_DIR}/U2018_CLC2018_V2020_20u1.tif"
MAPPING_FILE="${SCRIPT_DIR}/clc_custom_classes.reclass.txt"
OUTPUT_RASTER_CLASSIFIED="${SCRIPT_DIR}/germany_clc_classes.tif"
OUTPUT_RASTER_STACK="${SCRIPT_DIR}/germany_clc_classes_stack.tif"

# Output band order:
# 1 nature
# 2 farm
# 3 park
# 4 urban
# 5 water
CLASS_NAMES=(nature farm park urban water)
CLASS_CODES=(1 2 3 4 5)

BBOX="${MINX},${MINY},${MAXX},${MAXY}"
TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT

printf 'Running gdal raster pipeline -> %s\n' "$OUTPUT_RASTER_CLASSIFIED"
gdal raster pipeline \
  "!" read "$INPUT_RASTER" \
  "!" clip "--bbox=$BBOX" "--bbox-crs=$TARGET_EPSG" --allow-bbox-outside-source \
  "!" reclassify "--mapping=@$MAPPING_FILE" "--ot=$RASTER_DATA_TYPE" \
  "!" edit "--nodata=$RASTER_NODATA" \
  "!" write "${GTIFF_WRITE_OPTIONS[@]}" ${OVERWRITE:-} "$OUTPUT_RASTER_CLASSIFIED"

printf 'Writing streamed one-hot class descriptors in %s\n' "$TEMP_DIR"
BAND_FILES=()
for class_code in "${CLASS_CODES[@]}"; do
  
  class_dataset="${TEMP_DIR}/clc_${class_code}.gdalg.json"

  printf 'Creating band %s \n'  "$class_dataset"
  gdal raster reclassify \
    "$OUTPUT_RASTER_CLASSIFIED" \
    "$class_dataset" \
    --of=GDALG \
    "--mapping=${class_code}=1;DEFAULT=0;NO_DATA=NO_DATA" \
    "--ot=$RASTER_DATA_TYPE" \
    ${OVERWRITE:-}

  BAND_FILES+=("$class_dataset")
done

printf 'Stacking one-hot class rasters -> %s\n' "$OUTPUT_RASTER_STACK"
gdal raster stack "${BAND_FILES[@]}" "$OUTPUT_RASTER_STACK" "${GTIFF_WRITE_OPTIONS[@]}" ${OVERWRITE:-} --dst-nodata "$RASTER_NODATA" --resolution "$RASTER_RESOLUTION"
