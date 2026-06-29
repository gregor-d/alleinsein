#!/usr/bin/env bash
set -euo pipefail

# Build a slope-MODIFIED single-band web COG ("first idea").
#
# Unlike create_hotspot_slope_band.sh (which adds a hotspot-only band 2 shown with
# just the first four ramp colours), this rewrites the WHOLE aloneness band: every
# category pixel's road score A is reduced by its slope class and re-clamped into
# 1..10, so steeper terrain reads as more secluded across the full ramp. The per-class
# points are set in slope_penalty below (0/1/3/5); the worst within-category score
# (10, 20, 30, 40) is never modified, only the second-worst (9, 19, ...) and below:
#
#   Raw A   class1(+0)  class2(+1)  class3(+3)  class4(+5)
#   1       1           1           1           1
#   2       2           1           1           1
#   3       3           2           1           1
#   4       4           3           1           1
#   5       5           4           2           1
#   6       6           5           3           1
#   7       7           6           4           2
#   8       8           7           5           3
#   9       9           8           6           4
#   10      10          10          10          10
#
# The result stays in the exact same per-land-cover encoding (nature 1..10, farm
# 11..20, park 21..30, urban 31..40, water 200), so the frontend renders it with the
# normal full ramp — just slope-adjusted. Water (200) / nodata / unclassified pass
# through unchanged.
#
# Works upstream in TARGET_EPSG: it combines the raw heatmap raster (create_raster.sh)
# with the slope classes (utils/dem_create_raster.sh) on their shared 20m grid, then
# reuses the shared finalize_web_cog tail to clip, reproject and web-optimize.
#
# Usage:
#   bash raster/create_slope_mod_band.sh

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
output_cog="${output_dir}/${base_name}_v${version}_slope.tif"

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

modified_raster="${TEMP_DIR}/${base_name}_v${version}_slope_modified.tif"

echo "======================================================="
echo "Raw: $raw_raster  ->  $(basename "$output_cog")"
echo "======================================================="
echo "Applying slope modifier to the aloneness band (worst score per class kept)..."
# Points subtracted from a category pixel's road score for its slope class
# (1=flat .. 4=steep); slope outside 1..4 (incl. nodata) subtracts nothing.
SLOPE_MOD_CLASS1=0
SLOPE_MOD_CLASS2=2
SLOPE_MOD_CLASS3=3
SLOPE_MOD_CLASS4=4
# Points subtracted from a category pixel's road score for its slope class, from the
# tunables above. Slope outside 1..4 (incl. nodata) subtracts nothing.
slope_penalty="where(G==1, ${SLOPE_MOD_CLASS1}, where(G==2, ${SLOPE_MOD_CLASS2}, where(G==3, ${SLOPE_MOD_CLASS3}, where(G==4, ${SLOPE_MOD_CLASS4}, 0))))"
# Per land cover: extract A, subtract the slope penalty, clamp to >=1, re-offset by
# the class. Category pixels (1..40) are modified; water (200) / nodata pass
# through. muparser is buggy, so this stays in gdal_calc.

# Per land cover: take the within-category score (1..10); the worst (10) is left
# unchanged, the rest have the slope penalty subtracted and are clamped to >=1, then
# re-offset by the class. Water (200) / nodata pass through. muparser is buggy, so
# this stays in gdal_calc.
gdal_calc \
  -P "$raw_raster" --P_band=1 \
  -G "$slope_src" --G_band=1 \
  --calc="where((P>=1)*(P<=40), ((1.0*P-1)//10)*10 + where((1.0*P-1)%10+1 >= 10, 10, maximum((1.0*P-1)%10+1 - (${slope_penalty}), 1)), 1.0*P)" \
  --co=TILED=YES --co=COMPRESS=DEFLATE --co=PREDICTOR=2 --co=BIGTIFF=IF_SAFER \
  --outfile="$modified_raster" \
  --type="$RASTER_DATA_TYPE" \
  --NoDataValue="$RASTER_NODATA" $OVERWRITE
echo "-------------------------------------------------------"

finalize_web_cog "$modified_raster" "$output_cog" "$TEMP_DIR"

echo "Successfully created slope-modified COG: $output_cog"
echo "-------------------------------------------------------"
