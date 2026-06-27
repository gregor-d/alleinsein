#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=utils/load_raster_config.sh
source "${SCRIPT_DIR}/utils/load_raster_config.sh"
# shellcheck source=utils/raster_lib.sh
source "${SCRIPT_DIR}/utils/raster_lib.sh"

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

echo "running heatmap_calc to tempfile ${raw_calc_raster}..."

# Encode the roads heatmap masked per land-cover class. The shared heatmap_calc
# (utils/raster_lib.sh) keeps this in lockstep with eu/create_eu_raster.sh.
heatmap_calc "$roads" "$clc_classes" "$raw_calc_raster"

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
