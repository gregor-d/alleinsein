#!/bin/bash
set -euo pipefail

# set env varible area to germany

export AREA="${AREA:-germany}"
# export OVERWRITE=""
export OVERWRITE="--overwrite"

# Shared raster bounds in EPSG:3035.
# to get raster bounds use /input_data/bounds/export_bounds.py or check the .env file for the exported bounds
# need to go to next 100, so we avoid weird clipping behaviour when combining 20m raster and 100m raster
export MINX="4031300"
export MINY="2684000"
export MAXX="4672600"
export MAXY="3556600"

# create paths, road and railways geopackage
# use create_gpkg.sh in input_data/osm to create the gpkg files for roads, paths and railways
echo "Creating GeoPackage files for roads, paths and railways..."
# bash input_data/osm/create_gpkg.sh

echo "Rasterizing roads, paths and railways and creating smoothed combined raster..."
# bash input_data/osm/rasterize_all_road_lengths.sh

echo "Creating CLC raster stack..."
# bash input_data/clc/create_clc_raster.sh

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

clc_classes="${SCRIPT_DIR}/input_data/clc/germany_clc_classes_stack.tif"
roads="${SCRIPT_DIR}/input_data/osm/${AREA}_roads_smooth.tif"                     
output_raster="${SCRIPT_DIR}/raster/${AREA}_raster.tif"

echo "calculating heatmap raster stack..."
echo "using roads: $roads"
echo "using clc classes: $clc_classes"
echo "output raster: $output_raster"

gdal_calc \
  -A $roads --A_band=1 \
  -B $clc_classes --B_band=1 \
  -C $clc_classes --C_band=2 \
  -D $clc_classes --D_band=3 \
  -E $clc_classes --E_band=4 \
  -F $clc_classes --F_band=5 \
  --calc="where(F==1, 200, A*B + (A+10)*C + (A+20)*D + (A+30)*E)" \
  --outfile=$output_raster \
  --type=Byte \
  --NoDataValue=255 \
  --creation-option=TILED=YES \
  --creation-option=COMPRESS=DEFLATE \
  --creation-option=PREDICTOR=2 \
  $OVERWRITE

# create COG and reproject to web mercator
echo "Reprojecting to web mercator..."
gdal raster reproject -d EPSG:3857 $output_raster ${output_raster%.tif}_3857.tif $OVERWRITE
echo "Creating COG..."
rio cogeo create ${output_raster%.tif}_3857.tif ${output_raster%.tif}_web.tif
# rio cogeo create -w germany_raster_3857.tif germany_raster_web_optimized.tif
# rio cogeo create -w --overview-blocksize 512 --blocksize 512 germany_raster_3857.tif germany_raster_web_optimized512.tif
