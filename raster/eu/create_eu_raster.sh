#!/usr/bin/env bash
# Build one combined multi-country COG (e.g. DACH) from the countries in eu.conf.
#
# Each country is processed individually with the existing per-area scripts on a
# *buffered* extent (so the road-smoothing kernel sees cross-border roads), kept
# in EPSG:3035. The per-country rasters are mosaicked on a shared grid, clipped
# ONCE to the exact dissolved boundary (discarding the buffer rings), then
# reprojected and written as a single web-optimized COG.
#
# Prerequisite (run once): bash raster/eu/extract_countries.sh
set -euo pipefail

EU_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
RASTER_DIR="$(cd -- "${EU_DIR}/.." && pwd)"
PROJECT_DIR="$(cd -- "${RASTER_DIR}/.." && pwd)"
UTILS_DIR="${RASTER_DIR}/utils"
OSM_DIR="${RASTER_DIR}/input/osm"
CLC_DIR="${RASTER_DIR}/input/clc"
BOUNDS_DIR="${RASTER_DIR}/input/bounds"
OUTPUT_DIR="${RASTER_DIR}/out"

# Shared, country-independent settings (WEB_EPSG, RASTER_NODATA, RASTER_DATA_TYPE,
# GTIFF_WRITE_OPTIONS, OVERWRITE, ...) come from raster.conf via load_raster_config.
# shellcheck source=../utils/load_raster_config.sh
source "${UTILS_DIR}/load_raster_config.sh"
# shellcheck source=../utils/raster_lib.sh
source "${UTILS_DIR}/raster_lib.sh"
# shellcheck source=eu.conf
source "${EU_DIR}/eu.conf"

# Re-run the (slow) per-country prep even when its outputs already exist.
FORCE_PREP="${FORCE_PREP:-0}"

TEMP_DIR="${OUTPUT_DIR}/temp"
mkdir -p "$TEMP_DIR" "$OUTPUT_DIR"

# Write the per-country runtime config the existing sub-scripts read via
# $RASTER_CONFIG_FILE: inherit the shared settings, override AREA + buffered bbox.
make_runtime_conf() {
  local country="$1" conf="$2"
  {
    echo "source \"${RASTER_DIR}/raster.conf\""
    echo "AREA=\"${country}\""
    echo "source \"${BOUNDS_DIR}/${country}_bounds.conf\""
  } >"$conf"
}

per_country_3035=()

for country in "${COUNTRIES[@]}"; do
  echo "======================================================="
  echo "Country: ${country}"
  echo "======================================================="

  bounds_conf="${BOUNDS_DIR}/${country}_bounds.conf"
  bounds_gpkg="${BOUNDS_DIR}/${country}.gpkg"

  # 1. Buffered bounds (geocoded once, reused on later runs). Regenerate when the
  #    gpkg is missing or the conf predates buffering (no OSM_BBOX marker) - e.g.
  #    a leftover from the single-country, unbuffered workflow.
  if [[ ! -r "$bounds_gpkg" || ! -r "$bounds_conf" ]] || ! grep -q '^OSM_BBOX=' "$bounds_conf"; then
    echo "Generating buffered bounds for ${country}..."
    ( cd "$PROJECT_DIR" && AREA="$country" \
        BOUNDS_BUFFER_M="$BOUNDS_BUFFER_M" BOUNDS_SNAP_M="$BOUNDS_SNAP_M" \
        uv run "${UTILS_DIR}/bounds_create_area.py" )
  fi

  # 2. Require the buffered per-country PBF from the one-time extract helper.
  pbf="${OSM_DIR}/${country}-latest.osm.pbf"
  if [[ ! -r "$pbf" ]]; then
    echo "Missing ${pbf}" >&2
    echo "Run the one-time extract first:  bash ${EU_DIR}/extract_countries.sh" >&2
    exit 1
  fi

  # 3. Point the existing sub-scripts at this country's config.
  runtime_conf="${TEMP_DIR}/${country}.runtime.conf"
  make_runtime_conf "$country" "$runtime_conf"
  export RASTER_CONFIG_FILE="$runtime_conf"

  # 4. OSM roads heatmap (filter -> gpkg -> rasterize + smooth).
  roads_smooth="${OSM_DIR}/${country}_roads_smooth.tif"
  if [[ "$FORCE_PREP" == "1" || ! -r "$roads_smooth" ]]; then
    echo "Building OSM roads heatmap for ${country}..."
    bash "${UTILS_DIR}/osm_filter_pbf.sh"
    bash "${UTILS_DIR}/osm_create_gpkg.sh"
    bash "${UTILS_DIR}/osm_rasterize_roads.sh"
  else
    echo "Reusing existing ${roads_smooth} (FORCE_PREP=1 to rebuild)"
  fi

  # 5. CLC one-hot land-cover stack.
  clc_stack="${CLC_DIR}/${country}_clc_classes_stack.tif"
  if [[ "$FORCE_PREP" == "1" || ! -r "$clc_stack" ]]; then
    echo "Building CLC stack for ${country}..."
    bash "${UTILS_DIR}/clc_raster_create.sh"
  else
    echo "Reusing existing ${clc_stack} (FORCE_PREP=1 to rebuild)"
  fi

  # 6. Encode the heatmap on this country's buffered grid (EPSG:3035). No clip or
  #    reproject yet - those run once on the merged mosaic.
  country_3035="${TEMP_DIR}/${OUTPUT_AREA}_${country}_3035.tif"
  echo "Encoding ${country} heatmap -> $(basename "$country_3035")..."
  heatmap_calc "$roads_smooth" "$clc_stack" "$country_3035"
  per_country_3035+=("$country_3035")
  echo "-------------------------------------------------------"
done

# 7. Dissolved exact boundary for the final clip (union of the country polygons).
dissolved_gpkg="${BOUNDS_DIR}/${OUTPUT_AREA}.gpkg"
echo "Building dissolved ${OUTPUT_AREA} boundary..."
( cd "$PROJECT_DIR" && uv run "${EU_DIR}/bounds_create_dissolved.py" \
    "$OUTPUT_AREA" "${COUNTRIES[@]}" )

# 8. Mosaic the per-country rasters on the shared 3035 grid (VRT, no data copy).
mosaic_vrt="${TEMP_DIR}/${OUTPUT_AREA}_3035.vrt"
echo "Mosaicking ${#per_country_3035[@]} countries -> $(basename "$mosaic_vrt")..."
gdalbuildvrt -overwrite \
  -srcnodata "$RASTER_NODATA" -vrtnodata "$RASTER_NODATA" \
  "$mosaic_vrt" "${per_country_3035[@]}"

# 9. Clip the mosaic to the exact dissolved outline, then reproject to Web Mercator.
reprojected="${TEMP_DIR}/${OUTPUT_AREA}_3857.tif"
echo "Clipping mosaic to ${OUTPUT_AREA} boundary and reprojecting to ${WEB_EPSG}..."
gdal raster pipeline \
  "!" read "$mosaic_vrt" \
  "!" clip --like "$dissolved_gpkg" --like-layer "$OUTPUT_AREA" --allow-bbox-outside-source \
  "!" reproject -d "$WEB_EPSG" \
  "!" write $OVERWRITE "${GTIFF_WRITE_OPTIONS[@]}" "$reprojected"

# 10. Web-optimized COG with overviews (auto-incrementing version, matching
#     create_raster.sh so existing COGs are never silently overwritten).
base_name="${OUTPUT_AREA}_20m"
version=1
while [[ -f "${OUTPUT_DIR}/${base_name}_v${version}.tif" ]]; do
  ((version++))
done
output_cog="${OUTPUT_DIR}/${base_name}_v${version}.tif"

echo "Creating web-optimized COG -> $(basename "$output_cog")..."
rio cogeo create --web-optimized "$reprojected" "$output_cog" \
  --resampling nearest --overview-resampling nearest \
  --blocksize 512 --overview-blocksize 512

echo "======================================================="
echo "Successfully created ${OUTPUT_AREA} COG: ${output_cog}"
echo "======================================================="
