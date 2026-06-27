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
