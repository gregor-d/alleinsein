#!/usr/bin/env bash

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/area_config.sh"

OUTPUT_PATH="${SCRIPT_DIR}/../transformed/"


GTIFF_WRITE_OPTIONS=(
  "--of=GTiff"
  "--co=TILED=YES"
  "--co=COMPRESS=DEFLATE"
  "--co=PREDICTOR=2"
  "--co=BIGTIFF=IF_SAFER"
)


files=(roads paths railways)

for file in "${files[@]}"; do
  echo "=== Writing ${file} ==="
  FILE="${SCRIPT_DIR}/${AREA}_${file}_lengths.tif"
  gdal raster pipeline \
  "!" read "$FILE" \
  "!" reproject --resolution 100,100 -r sum \
  "!" neighbours --method mean --size 5 --kernel gaussian \
  "!" set-type --datatype Byte \
  "!" write "${GTIFF_WRITE_OPTIONS[@]}" --overwrite "$OUTPUT_PATH/${AREA}_${file}.tif"
done

echo "Done."
