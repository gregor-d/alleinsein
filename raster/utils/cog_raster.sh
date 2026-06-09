#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

source "${SCRIPT_DIR}/../osm/area_config.sh"

input_raster_stack="${SCRIPT_DIR}/${AREA}_raster_stack.tif"
output_raster="${SCRIPT_DIR}/${AREA}_raster.tif"

GTIFF_CREATION_OPTIONS=(
  "--of=GTiff"
  "--co=TILED=YES"
  "--co=COMPRESS=DEFLATE"
  "--co=PREDICTOR=2"
#   "--co=INTERLEAVE=BAND"
#   "--co=BIGTIFF=IF_SAFER"
)

# create only one raster with all the layers stacked together, so that we can easily serve it with TiTiler and do the remapping on the fly in the API
gdal_calc \
  -A $input_raster_stack --A_band=1 \
  -B $input_raster_stack --B_band=2 \
  -C $input_raster_stack --C_band=3 \
  -D $input_raster_stack --D_band=4 \
  -E $input_raster_stack --E_band=5 \
  -F $input_raster_stack --F_band=6 \
  --calc="where(F==1, 200, A*B + (A+10)*C + (A+20)*D + (A+30)*E)" \
  --outfile=$output_raster \
  --type=Byte \
  --NoDataValue=255 \
  --creation-option=TILED=YES \
  --creation-option=COMPRESS=DEFLATE \
  --creation-option=PREDICTOR=2 \
  --overwrite

gdal raster convert \
  -f COG \
  --co COMPRESS=ZSTD \
  --co PREDICTOR=NO \
  --co OVERVIEWS=AUTO \
  --co RESAMPLING=NEAREST \
  --co BIGTIFF=IF_SAFER \
  $output_raster \
  ${output_raster%.tif}_cog.tif \
  --overwrite

gdal raster reproject -d EPSG:3857 sachsen_raster.tif temp_3857.tif --overwrite
rio cogeo create temp_3857.tif sachsen_raster_web.tif
gdal raster reproject -d EPSG:3857 sachsen_raster_stack.tif temp_3857.tif --overwrite
rio cogeo create temp_3857.tif sachsen_raster_stack_web.tif


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


