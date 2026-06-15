#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=load_raster_config.sh
source "${SCRIPT_DIR}/load_raster_config.sh"

slope_classes="${SCRIPT_DIR}/germany_slope_classes.tif"
clc_classes="${SCRIPT_DIR}/germany_clc_classes_stack.tif"
roads="${SCRIPT_DIR}/${AREA}_roads_heat025_src0_10.tif"                     
# roads="${SCRIPT_DIR}/${AREA}_roads_lengths_50.tif"
# paths="${SCRIPT_DIR}/${AREA}_paths_lengths_50.tif"
# railways="${SCRIPT_DIR}/${AREA}_railways_lengths_50.tif"
output_raster_stack="${SCRIPT_DIR}/${AREA}_raster_stack.tif"
output_raster="${SCRIPT_DIR}/${AREA}_raster.tif"

read minx miny maxx maxy < <(
  gdalinfo -json "$roads" |
  jq -r '[
    .cornerCoordinates.upperLeft[0],
    .cornerCoordinates.lowerRight[1],
    .cornerCoordinates.lowerRight[0],
    .cornerCoordinates.upperLeft[1]
  ] | @tsv'
)

echo "minx=$minx miny=$miny maxx=$maxx maxy=$maxy"

gdal raster stack \
  -i "$roads" \
  -i "$clc_classes" \
  -i "$slope_classes" \
  -o "$output_raster_stack" \
  "${GTIFF_WRITE_OPTIONS[@]}" \
  --target-aligned-pixels \
  --resolution "$RASTER_RESOLUTION" \
  --bbox "$minx,$miny,$maxx,$maxy" \
  --dst-nodata "$RASTER_NODATA" \
  ${OVERWRITE:-}

gdal raster overview add \
  -i "$output_raster_stack" \
  --levels 2,4,8,16,32 \
  --resampling nearest 

echo "Raster stack written to $output_raster_stack"
  # "$railways" \
  # "$paths" \

gdal raster convert \
  -f COG \
  "${COG_WRITE_OPTIONS[@]}" \
  $output_raster_stack \
  ${output_raster_stack%.tif}_cog.tif \
  ${OVERWRITE:-}


# remap CORINE land cover types
# 0       # source raster NoData
# 1       # nature
# 2       # farm
# 3       # urban
# 4       # park
# 5       # water

# 1 0-5  gentle to flat
# 2 5-10 moderate
# 3 10-20 hilly
# 4 20+ steep

# roads 0-100
# paths 0-100
# railways 0-100

# quiet place
# 100 0 0 0 park
# 120 0 0 0 nature
# 80 0 0 0 farm
# 50 0 0 0 urban
