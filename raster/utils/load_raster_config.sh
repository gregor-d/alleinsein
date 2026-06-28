#!/usr/bin/env bash

RASTER_UTILS_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
RASTER_ROOT_DIR="$(cd -- "${RASTER_UTILS_DIR}/.." && pwd)"
RASTER_CONFIG_FILE="${RASTER_CONFIG_FILE:-${RASTER_ROOT_DIR}/raster.conf}"

if [[ ! -r "$RASTER_CONFIG_FILE" ]]; then
  echo "Missing raster config file: $RASTER_CONFIG_FILE" >&2
  exit 1
fi

# shellcheck source=/dev/null
source "$RASTER_CONFIG_FILE"

: "${AREA:?AREA is required in $RASTER_CONFIG_FILE}"
: "${RASTER_VERSION:?RASTER_VERSION is required in $RASTER_CONFIG_FILE}"
: "${TARGET_EPSG:?TARGET_EPSG is required in $RASTER_CONFIG_FILE}"
: "${WEB_EPSG:?WEB_EPSG is required in $RASTER_CONFIG_FILE}"
: "${RASTER_RESOLUTION:?RASTER_RESOLUTION is required in $RASTER_CONFIG_FILE}"
: "${RASTER_NODATA:?RASTER_NODATA is required in $RASTER_CONFIG_FILE}"
: "${RASTER_DATA_TYPE:?RASTER_DATA_TYPE is required in $RASTER_CONFIG_FILE}"
: "${GDAL_CACHEMAX:?GDAL_CACHEMAX is required in $RASTER_CONFIG_FILE}"
: "${OSM_MAX_TMPFILE_SIZE:?OSM_MAX_TMPFILE_SIZE is required in $RASTER_CONFIG_FILE}"
: "${CPL_TMPDIR:?CPL_TMPDIR is required in $RASTER_CONFIG_FILE}"
: "${MINX:?MINX is required in $RASTER_CONFIG_FILE}"
: "${MINY:?MINY is required in $RASTER_CONFIG_FILE}"
: "${MAXX:?MAXX is required in $RASTER_CONFIG_FILE}"
: "${MAXY:?MAXY is required in $RASTER_CONFIG_FILE}"

for required_array in GTIFF_WRITE_OPTIONS; do
  if ! declare -p "$required_array" 2>/dev/null | grep -q '^declare \-[^ ]*a'; then
    echo "$required_array is required in $RASTER_CONFIG_FILE" >&2
    exit 1
  fi
done

: "${OVERWRITE?OVERWRITE is required in $RASTER_CONFIG_FILE}"

export AREA RASTER_VERSION OVERWRITE TARGET_EPSG WEB_EPSG RASTER_RESOLUTION
export RASTER_NODATA RASTER_DATA_TYPE GDAL_CACHEMAX OSM_MAX_TMPFILE_SIZE CPL_TMPDIR
export MINX MINY MAXX MAXY
