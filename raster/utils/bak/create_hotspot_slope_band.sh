#!/usr/bin/env bash
set -euo pipefail

# Build a 2-band web COG from the raw aloneness heatmap.
#
# Band 1 is the unchanged aloneness encoding (1..40 per land cover, 200 = water).
# Band 2 SEPARATES the slope classes within the most-secluded group: every pixel
# whose road score A is in {1,2} (the "hotspot" buckets) is re-encoded per land cover
# to a distinct value by slope class, so the frontend's "Slope spots" mode (band 2,
# titiler bidx=2) can tell flat from steep among the most-secluded spots. Everything
# else becomes 0 (transparent).
#
# This is the counterpart to create_slope_mod_band.sh: there the slope modifier is
# SUBTRACTED across the whole band (so A=1 collapses regardless of slope); here the
# most-secluded group keeps one distinct value per slope class.
#
# Works upstream in TARGET_EPSG: it combines the raw heatmap raster (create_raster.sh)
# with the slope classes (utils/dem_create_raster.sh) on their shared 20m grid, stacks
# band 1 + band 2, then reuses the shared finalize_web_cog tail to clip, reproject and
# web-optimize.
#
# Usage:
#   bash raster/create_hotspot_slope_band.sh

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=utils/load_raster_config.sh
source "${SCRIPT_DIR}/utils/load_raster_config.sh"
# shellcheck source=utils/raster_lib.sh
source "${SCRIPT_DIR}/utils/raster_lib.sh"

output_dir="${SCRIPT_DIR}/out"
# Raw aloneness heatmap (TARGET_EPSG, 20m) from create_raster.sh, and the slope
# classes (1..4, flat..steep) on the same grid from utils/dem_create_raster.sh.
raw_raster="${output_dir}/temp/${AREA}_raster_raw.tif"
slope_src="${SCRIPT_DIR}/input/dem/${AREA}_slope_classes.tif"

# Name the output after the main COG version (RASTER_VERSION, set in raster.conf).
base_name="${AREA}_20m"
version="$RASTER_VERSION"
output_cog="${output_dir}/${base_name}_v${version}_2band.tif"

if [[ ! -r "$raw_raster" ]]; then
  echo "Missing raw heatmap raster: $raw_raster" >&2
  echo "Run raster/create_raster.sh first." >&2
  exit 1
fi

if [[ ! -r "$slope_src" ]]; then
  echo "Missing slope classes raster: $slope_src" >&2
  echo "Run raster/utils/dem_create_raster.sh first." >&2
  exit 1
fi

TEMP_DIR="${output_dir}/temp"
mkdir -p "$TEMP_DIR"

band2_raster="${TEMP_DIR}/${base_name}_v${version}_band2.tif"
stacked_raster="${TEMP_DIR}/${base_name}_v${version}_2band_stacked.tif"

echo "======================================================="
echo "Raw: $raw_raster  ->  $(basename "$output_cog")"
echo "======================================================="

echo "Computing slope-separated hotspot band (band 2)..."
# Most-secluded group = pixels with road score A in {1,2}, i.e. value v with
# 1<=v<=40 and (v-1)%10 <= 1. Each is re-encoded per land cover to start + (4 - slope
# class), so steeper terrain maps to the lower (darker, colors[0]) value. Everything
# else (A>=3, water 200, nodata, slope outside 1..4 -> treated flat) becomes 0 and so
# renders transparent. muparser is buggy, so this uses gdal_calc.
#
# Slope-class separation in the most-secluded group (value = start + (4 - slopeClass)):
#
#   slope class   nature  farm   park   urban   colour
#   4 (steep)     1       11     21     31      colors[0]  (darkest)
#   3             2       12     22     32      colors[1]
#   2             3       13     23     33      colors[2]
#   1 (flat)      4       14     24     34      colors[3]  (lightest)
#   A>=3 / water / nodata  ->  0  (transparent)
gdal_calc \
  -P "$raw_raster" --P_band=1 \
  -G "$slope_src" --G_band=1 \
  --calc="where((P>=1)*(P<=40)*(((1.0*P-1)%10)<=1), ((1.0*P-1)//10)*10 + 5 - where((G>=1)*(G<=4), 1.0*G, 1.0), 0)" \
  --co=TILED=YES --co=COMPRESS=DEFLATE --co=PREDICTOR=2 --co=BIGTIFF=IF_SAFER \
  --outfile="$band2_raster" \
  --type="$RASTER_DATA_TYPE" \
  --NoDataValue="$RASTER_NODATA" $OVERWRITE
echo "-------------------------------------------------------"

echo "Stacking band 1 (aloneness) + band 2 (slope hotspots)..."
gdal raster stack "$raw_raster" "$band2_raster" "$stacked_raster" \
  "${GTIFF_WRITE_OPTIONS[@]}" $OVERWRITE --dst-nodata "$RASTER_NODATA"
echo "-------------------------------------------------------"

finalize_web_cog "$stacked_raster" "$output_cog" "$TEMP_DIR"

echo "Successfully created 2-band COG: $output_cog"
echo "-------------------------------------------------------"
