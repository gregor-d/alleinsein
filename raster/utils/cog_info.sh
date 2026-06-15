#!/usr/bin/env bash
set -euo pipefail
cd "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
source .venv/bin/activate

COG_DIR="raster/out/cog_compare"

echo "================================================================================"
echo "FILE SIZES"
echo "================================================================================"
ls -lh "$COG_DIR"/*.tif | awk '{print $5, $9}'

echo ""
echo "================================================================================"
echo "RIO COGEO INFO"
echo "================================================================================"
for f in "$COG_DIR"/*.tif; do
  echo ""
  echo "--- $(basename "$f") ---"
  rio cogeo info "$f"
done

echo ""
echo "================================================================================"
echo "GDAL RASTER INFO"
echo "================================================================================"
for f in "$COG_DIR"/*.tif; do
  echo ""
  echo "--- $(basename "$f") ---"
  gdal raster info "$f"
done
