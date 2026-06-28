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

# output files
output_dir="${SCRIPT_DIR}/out"
base_name="${AREA}_20m"
# Version is set manually in raster.conf (RASTER_VERSION); bump it there for a new tier.
output_cog="${output_dir}/${base_name}_v${RASTER_VERSION}.tif"

TEMP_DIR="${SCRIPT_DIR}/out/temp"
mkdir -p "$TEMP_DIR"
# uncomment next two lines, to create a temporary directory for intermediate steps, cleaned up automatically on exit
# TEMP_DIR=$(mktemp -d)
# trap 'rm -rf "$TEMP_DIR"' EXIT
raw_calc_raster="${TEMP_DIR}/${AREA}_raster_raw.tif"


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

echo "Finalizing web-optimized COG from the heatmap raster..."
# Shared tail (utils/raster_lib.sh): clip to bounds, reproject to WEB_EPSG, and write
# the web-optimized COG aligned to the Web Mercator tile matrix (fewer reads).
finalize_web_cog "$raw_calc_raster" "$output_cog" "$TEMP_DIR"

echo "Successfully created masked COG raster: $output_cog"
