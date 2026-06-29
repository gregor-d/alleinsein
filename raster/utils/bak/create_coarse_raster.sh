#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

source "${SCRIPT_DIR}/utils/load_raster_config.sh"

RESOLUTIONS=(160 320 640 1280)

# Version tag shared by the fine raster and the coarse outputs it feeds.
VERSION_TAG="v3"

# input files
roads_smooth="${SCRIPT_DIR}/input/osm/${AREA}_roads_smooth.tif"
clc_classified="${SCRIPT_DIR}/input/clc/${AREA}_clc_classes.tif"
bounds_gpkg="${SCRIPT_DIR}/input/bounds/${AREA}.gpkg"

for f in "$roads_smooth" "$clc_classified" "$bounds_gpkg"; do
  if [[ ! -r "$f" ]]; then
    echo "Missing required input: $f" >&2
    exit 1
  fi
done

output_dir="${SCRIPT_DIR}/out"

# intermediate files, cleaned up on exit
TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT

# CLC one-hot band order (must match clc_raster_create.sh):
# 1 nature  2 farm  3 park  4 urban  5 water
CLASS_CODES=(1 2 3 4 5)

# Build one coarse raster per resolution.
for res in "${RESOLUTIONS[@]}"; do
  res_pair="${res},${res}"

  stem="${AREA}_${res}m_${VERSION_TAG}"
  coarse_roads="${TEMP_DIR}/${stem}_roads.tif"
  coarse_clc="${TEMP_DIR}/${stem}_clc.tif"
  coarse_clc_stack="${TEMP_DIR}/${stem}_clc_stack.tif"
  raw="${TEMP_DIR}/${stem}_raw.tif"
  clipped="${TEMP_DIR}/${stem}_clipped.tif"
  output_cog="${output_dir}/${stem}.tif"

  echo "======================================================="
  echo "Coarse resolution: ${res}m  ->  $(basename "$output_cog")"
  echo "======================================================="

  echo "Resampling roads_smooth to coarse grid (average + restretch)..."
  gdal raster pipeline \
    "!" read "$roads_smooth" \
    "!" reproject --resolution "$res_pair" -r average --target-aligned-pixels \
    "!" scale --dst-min 1 --dst-max 10 --ot "$RASTER_DATA_TYPE" \
    "!" write $OVERWRITE "${GTIFF_WRITE_OPTIONS[@]}" "$coarse_roads"
  echo "-------------------------------------------------------"

  echo "Resampling CLC classes to coarse grid (mode)..."
  gdal raster pipeline \
    "!" read "$clc_classified" \
    "!" reproject --resolution "$res_pair" -r mode --target-aligned-pixels \
    "!" edit "--nodata=$RASTER_NODATA" \
    "!" write $OVERWRITE "${GTIFF_WRITE_OPTIONS[@]}" "$coarse_clc"
  echo "-------------------------------------------------------"

  echo "Rebuilding one-hot CLC stack at ${res}m..."
  BAND_FILES=()
  for class_code in "${CLASS_CODES[@]}"; do
    class_dataset="${TEMP_DIR}/${stem}_clc_${class_code}.gdalg.json"
    gdal raster reclassify \
      "$coarse_clc" \
      "$class_dataset" \
      --of=GDALG \
      "--mapping=${class_code}=1;DEFAULT=0;NO_DATA=NO_DATA" \
      "--ot=$RASTER_DATA_TYPE" \
      $OVERWRITE
    BAND_FILES+=("$class_dataset")
  done

  gdal raster stack "${BAND_FILES[@]}" "$coarse_clc_stack" \
    "${GTIFF_WRITE_OPTIONS[@]}" $OVERWRITE \
    --dst-nodata "$RASTER_NODATA" --resolution "$res_pair"
  echo "-------------------------------------------------------"

  echo "Encoding heatmap raster -> $(basename "$output_cog")..."
  # water (band 5) -> 200, otherwise the roads value modulated per land-cover
  # class (nature: A, farm: A+10, park: A+20, urban: A+30). muparser is buggy,
  # so this stays in gdal_calc rather than the gdal raster pipeline.
  gdal_calc \
    -A "$coarse_roads" --A_band=1 \
    -B "$coarse_clc_stack" --B_band=1 \
    -C "$coarse_clc_stack" --C_band=2 \
    -D "$coarse_clc_stack" --D_band=3 \
    -E "$coarse_clc_stack" --E_band=4 \
    -F "$coarse_clc_stack" --F_band=5 \
    --calc="where(F==1, 200, A*B + (A+10)*C + (A+20)*D + (A+30)*E)" \
    --co=TILED=YES --co=COMPRESS=DEFLATE --co=PREDICTOR=2 --co=BIGTIFF=IF_SAFER \
    --outfile="$raw" \
    --type=$RASTER_DATA_TYPE \
    --NoDataValue=$RASTER_NODATA $OVERWRITE
  echo "-------------------------------------------------------"

  echo "Clipping to bounds..."
  gdal raster pipeline \
    "!" read "$raw" \
    "!" clip --like "$bounds_gpkg" --like-layer "$AREA" --allow-bbox-outside-source \
    "!" write $OVERWRITE "${GTIFF_WRITE_OPTIONS[@]}" "$clipped"
  echo "-------------------------------------------------------"

  echo "Writing web-optimized COG with rio-cogeo..."
  # --web-optimized reprojects to web mercator (${WEB_EPSG}) and aligns to the
  # tiling scheme. nearest everywhere preserves the exact categorical encoding
  # (no averaging of the composite codes); 512 blocks match the frontend tile size.
  rio cogeo create --web-optimized "$clipped" "$output_cog" \
    --resampling nearest --overview-resampling nearest \
    --blocksize 512 --overview-blocksize 512

  echo "Successfully created coarse COG raster: $output_cog"
  echo "-------------------------------------------------------"
done

echo "======================================================="
echo "Built ${#RESOLUTIONS[@]} coarse rasters: ${RESOLUTIONS[*]}"
