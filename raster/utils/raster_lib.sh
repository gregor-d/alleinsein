#!/usr/bin/env bash
# Shared raster building blocks, sourced by create_raster.sh and
# eu/create_eu_raster.sh so the value-encoding stays defined in exactly one place.

# heatmap_calc ROADS CLC_STACK OUT
#
# Combine the road-proximity heatmap (single band, A) with the 5-band one-hot CLC
# stack (B-F) into the single-band encoded raster OUT, on the same grid/CRS as the
# inputs (TARGET_EPSG). The heatmap is masked per land-cover class so each class
# occupies its own value range, letting the frontend fetch every layer in one
# request:  nature: A,  farm: A+10,  park: A+20,  urban: A+30,  water: 200.
#
# muparser is buggy, so this stays in gdal_calc rather than the gdal raster
# pipeline. Requires RASTER_DATA_TYPE, RASTER_NODATA and OVERWRITE from the loaded
# raster config.
heatmap_calc() {
  local roads="$1" clc_classes="$2" out="$3"
  gdal_calc \
    -A "$roads" --A_band=1 \
    -B "$clc_classes" --B_band=1 \
    -C "$clc_classes" --C_band=2 \
    -D "$clc_classes" --D_band=3 \
    -E "$clc_classes" --E_band=4 \
    -F "$clc_classes" --F_band=5 \
    --calc="where(F==1, 200, A*B + (A+10)*C + (A+20)*D + (A+30)*E)" \
    --co=TILED=YES --co=COMPRESS=DEFLATE --co=PREDICTOR=2 --co=BIGTIFF=IF_SAFER \
    --outfile="$out" \
    --type="$RASTER_DATA_TYPE" \
    --NoDataValue="$RASTER_NODATA" $OVERWRITE
}

# finalize_web_cog SRC OUT_COG [WORK_DIR]
#
# Turn a raster on the TARGET_EPSG grid into the final web product: clip it to the
# AREA bounds, reproject to WEB_EPSG, and write a web-optimized COG (the tile-matrix
# aligned grid that minimises reads). This is the shared tail of create_raster.sh and
# the slope band scripts, so the reprojection/web-optimization stays in one place.
# WORK_DIR holds the intermediate reprojected file (defaults to OUT_COG's directory).
# Requires AREA, WEB_EPSG, OVERWRITE, GTIFF_WRITE_OPTIONS and RASTER_ROOT_DIR.
finalize_web_cog() {
  local src="$1" out_cog="$2" work_dir="${3:-$(dirname "$out_cog")}"
  local bounds_gpkg="${RASTER_ROOT_DIR}/input/bounds/${AREA}.gpkg"
  local reprojected="${work_dir}/$(basename "${out_cog%.tif}")_3857.tif"

  echo "Clipping to bounds and reprojecting to ${WEB_EPSG}..."
  gdal raster pipeline \
    "!" read "$src" \
    "!" clip --like "$bounds_gpkg" --like-layer "$AREA" --allow-bbox-outside-source \
    "!" reproject -d "$WEB_EPSG" \
    "!" write $OVERWRITE "${GTIFF_WRITE_OPTIONS[@]}" "$reprojected"

  echo "Creating web-optimized COG with overviews -> ${out_cog}"
  rio cogeo create --web-optimized "$reprojected" "$out_cog" \
    --resampling nearest --overview-resampling nearest \
    --blocksize 512 --overview-blocksize 512
}
