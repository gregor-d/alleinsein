#!/bin/bash
set -euo pipefail

# set env varible area to germany

export AREA="${AREA:-germany}"
# export OVERWRITE=""
export OVERWRITE="--overwrite"

# Shared raster bounds in EPSG:3035.
# to get raster bounds use /input_data/bounds/export_bounds.py or check the .env file for the exported bounds
# need to go to next 100, so we avoid weird clipping behaviour when combining 20m raster and 100m raste
export MINX="4031300"
export MINY="2684000"
export MAXX="4672600"
export MAXY="3556600"

# create paths, road and railways geopackage
# use create_gpkg.sh in input_data/osm to create the gpkg files for roads, paths and railways
echo "Creating GeoPackage files for roads, paths and railways..."
bash utils/create_gpkg.sh

echo "Rasterizing roads, paths and railways and creating smoothed combined raster..."
bash utils/rasterize_all_road_lengths.sh

echo "Creating CLC raster stack..."
bash utils/create_clc_raster.sh

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

clc_classes="${SCRIPT_DIR}/input/clc/germany_clc_classes_stack.tif"
roads="${SCRIPT_DIR}/input/osm/${AREA}_roads_smooth.tif"                     
bounds_gpkg="${SCRIPT_DIR}/input/bounds/${AREA}.gpkg"
output_web_cog="${SCRIPT_DIR}/${AREA}_raster_web.tif"

echo "calculating heatmap raster stack..."
echo "using roads: $roads"
echo "using clc classes: $clc_classes"
echo "output raster: $output_web_cog"

# Create a temporary directory for intermediate steps, cleaned up automatically on exit
TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT
raw_calc_raster="${TEMP_DIR}/${AREA}_raster_raw.tif"
temp_reprojected_raster="${TEMP_DIR}/${AREA}_raster_3857.tif"

echo "running gdal__calc to tempfile ${raw_calc_raster}..."

# CORINE land cover types
# 1       # nature
# 2       # farm
# 3       # park
# 4       # urban
# 5       # water

gdal_calc \
  -A "$roads" --A_band=1 \
  -B "$clc_classes" --B_band=1 \
  -C "$clc_classes" --C_band=2 \
  -D "$clc_classes" --D_band=3 \
  -E "$clc_classes" --E_band=4 \
  -F "$clc_classes" --F_band=5 \
  --calc="where(F==1, 200, A*B + (A+10)*C + (A+20)*D + (A+30)*E)" \
  --outfile="$raw_calc_raster" \
  --type=Byte \
  --NoDataValue=255 \
  --creation-option=TILED=YES \
  --creation-option=COMPRESS=DEFLATE \
  --creation-option=PREDICTOR=2 \
  --overwrite

# Process the pipeline: read -> clip to exact vector boundary -> reproject -> write temp tiff
echo "Running GDAL pipeline clip to bounds and reproject..."
gdal raster pipeline \
  "!" read "$raw_calc_raster" \
  "!" clip --like "$bounds_gpkg" --like-layer "$AREA" --allow-bbox-outside-source \
  "!" reproject -d EPSG:3857 \
  "!" write --overwrite "$temp_reprojected_raster"

# Create final optimized COG with rio-cogeo using web-optimized tiling
echo "Creating web-optimized COG with overviews..."
rio cogeo create -w "$temp_reprojected_raster" "$output_web_cog"

echo "Successfully created masked COG raster: $output_web_cog"
