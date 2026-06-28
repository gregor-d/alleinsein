#!/usr/bin/env bash
# Quick check: clip the EU-built raster and the reference single-country raster to
# an inner bbox (germany_bounds.conf shrunk 200 km per side, where the cross-border
# buffer has no effect) and compare them. They should be identical.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="${SCRIPT_DIR}/../out"
TMP_DIR="${OUT_DIR}/temp"
mkdir -p "$TMP_DIR"

# --- hard-coded inputs (edit these two paths) ---
NEW="${OUT_DIR}/dach_20m_v1.tif"        # EU-built output to test
NEW="${OUT_DIR}/temp/germany_raster_raw.tif"        # EU-built output to test
REF="${OUT_DIR}/temp/germany_raster_rawp.tif"     # reference single-country output

# --- hard-coded inner bbox (EPSG:3035) ---
# germany_bounds.conf: MINX=4031317 MINY=2684075 MAXX=4672532 MAXY=3556567
# shrunk by 200000 m on each side:
BBOX="4231317,2884075,4472532,3356567"
BBOX_CRS="EPSG:3035"

NEW_CLIP="${TMP_DIR}/compare_new.tif"
REF_CLIP="${TMP_DIR}/compare_ref.tif"

echo "Clipping NEW ($NEW) -> $NEW_CLIP"
gdal raster pipeline \
  "!" read "$NEW" \
  "!" clip "--bbox=$BBOX" "--bbox-crs=$BBOX_CRS" --allow-bbox-outside-source \
  "!" write --overwrite "$NEW_CLIP"

echo "Clipping REF ($REF) -> $REF_CLIP"
gdal raster pipeline \
  "!" read "$REF" \
  "!" clip "--bbox=$BBOX" "--bbox-crs=$BBOX_CRS" --allow-bbox-outside-source \
  "!" write --overwrite "$REF_CLIP"

echo "Comparing..."
gdal raster compare "$NEW_CLIP" "$REF_CLIP"
