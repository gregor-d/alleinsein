#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=utils/load_raster_config.sh
source "${SCRIPT_DIR}/utils/load_raster_config.sh"

# input files
clc_classes="${SCRIPT_DIR}/input/clc/${AREA}_clc_classes_stack.tif"
roads="${SCRIPT_DIR}/input/osm/${AREA}_roads_smooth.tif"                     
bounds_gpkg="${SCRIPT_DIR}/input/bounds/${AREA}.gpkg"

# output files
output_dir="${SCRIPT_DIR}/out"
base_name="${AREA}_20m"
version=1
# increase existing version number by 1
while [[ -f "${output_dir}/${base_name}_v${version}.tif" ]]; do
  ((version++))
done
output_cog="${output_dir}/${base_name}_v${version}.tif"

TEMP_DIR="${SCRIPT_DIR}/out/temp"
mkdir -p "$TEMP_DIR"
# uncomment next two lines, to create a temporary directory for intermediate steps, cleaned up automatically on exit
# TEMP_DIR=$(mktemp -d)
# trap 'rm -rf "$TEMP_DIR"' EXIT
raw_calc_raster="${TEMP_DIR}/${AREA}_raster_raw.tif"
calc_reprojected_raster="${TEMP_DIR}/${AREA}_raster_3857.tif"


# create paths, road and railways geopackage
echo "Filter OSM-PBF to have only roads, paths and railways..."
echo "${SCRIPT_DIR}/utils/osm_filter_pbf.sh"
# bash "${SCRIPT_DIR}/utils/osm_filter_pbf.sh"
echo "-------------------------------------------------------"

# use osm_create_gpkg.sh in input_data/osm to create the gpkg files for roads, paths and railways
echo "Creating GeoPackage files for roads, paths and railways..."
echo "${SCRIPT_DIR}/utils/osm_create_gpkg.sh"
# bash "${SCRIPT_DIR}/utils/osm_create_gpkg.sh"
echo "-------------------------------------------------------"

echo "Rasterizing roads, paths and railways and creating smoothed combined raster..."
echo "${SCRIPT_DIR}/utils/osm_rasterize_roads.sh"
# bash "${SCRIPT_DIR}/utils/osm_rasterize_roads.sh"
echo "-------------------------------------------------------"

echo "Creating CLC raster stack..."
echo "${SCRIPT_DIR}/utils/clc_raster_create.sh"
# bash "${SCRIPT_DIR}/utils/clc_raster_create.sh"
echo "-------------------------------------------------------"

echo "calculating heatmap raster stack..."
echo "using roads: $roads"
echo "using clc classes: $clc_classes"
echo "output raster: $output_cog"

echo "running gdal__calc to tempfile ${raw_calc_raster}..."

# CORINE land cover types
# 1       # nature
# 2       # farm
# 3       # park
# 4       # urban
# 5       # water

# This is the main function:
# It uses the roads-heatmap to create virtual layers by masking it with landcover.
# Each layer has a different landcover and its own value-range.
# With this its possible to have only one request to the backend for all layers, and not one per layer.
# because muparser is buggy, can not use the gdal raster pipeline for this
gdal_calc \
  -A "$roads" --A_band=1 \
  -B "$clc_classes" --B_band=1 \
  -C "$clc_classes" --C_band=2 \
  -D "$clc_classes" --D_band=3 \
  -E "$clc_classes" --E_band=4 \
  -F "$clc_classes" --F_band=5 \
  --calc="where(F==1, 200, A*B + (A+10)*C + (A+20)*D + (A+30)*E)" \
  --co=TILED=YES --co=COMPRESS=DEFLATE --co=PREDICTOR=2 --co=BIGTIFF=IF_SAFER \
  --outfile=$raw_calc_raster \
  --type=$RASTER_DATA_TYPE \
  --NoDataValue=$RASTER_NODATA $OVERWRITE
  
echo "Running GDAL pipeline clip to bounds and reproject..."
gdal raster pipeline \
  "!" read "$raw_calc_raster" \
  "!" clip --like "$bounds_gpkg" --like-layer "$AREA" --allow-bbox-outside-source \
  "!" reproject -d "$WEB_EPSG" \
  "!" write $OVERWRITE "${GTIFF_WRITE_OPTIONS[@]}" "$calc_reprojected_raster"
echo "-------------------------------------------------------"


echo "Creating web-optimized COG with overviews..."
# use riotiler web-optimized, this has the tif aligned to Web Mercator tile matrix and this leads to less reads.
rio cogeo create --web-optimized "$calc_reprojected_raster" "$output_cog" --resampling nearest --overview-resampling nearest --blocksize 512 --overview-blocksize 512

# Alternative:
# add overviews and create COG
# gdal raster pipeline \
#   "!" read "$calc_reprojected_raster" \
#   "!" overview add --levels 2,4,8,16,32 --resampling nearest \
#   "!" write -f COG --co COMPRESS=ZSTD --co PREDICTOR=NO --co RESAMPLING=NEAREST --co BIGTIFF=IF_SAFER \
#   --co TILING_SCHEME=GoogleMapsCompatible \
#   --co WARP_RESAMPLING=NEAREST \
#   --co OVERVIEW_RESAMPLING=MODE \
#    --overwrite "gl_${$output_cog}"

echo "Successfully created masked COG raster: $output_cog"
