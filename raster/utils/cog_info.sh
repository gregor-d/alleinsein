#!/usr/bin/env bash
set -euo pipefail
cd "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
source .venv/bin/activate

COG_DIR="raster/out"



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

diff <(rio cogeo info raster/out/germany_raster_v2.tif) <(rio cogeo info raster/out/germany_raster_v3.tif)

# echo ""
# echo "================================================================================"
# echo "GDAL RASTER INFO"
# echo "================================================================================"
# for f in "$COG_DIR"/*.tif; do
#   echo ""
#   echo "--- $(basename "$f") ---"
#   gdal raster info "$f"
# done

# diff <(rio cogeo info file1.tif) <(rio cogeo info file2.tif)
