#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=load_raster_config.sh
source "${SCRIPT_DIR}/load_raster_config.sh"

OSM_DIR="${RASTER_ROOT_DIR}/input/osm"
FILE="${OSM_DIR}/${AREA}-filtered.osm.pbf"
OUTPUT_FILE="${OSM_DIR}/${AREA}_roads.gpkg"

if [[ ! -r "$FILE" ]]; then
  echo "Missing OSM PBF input: $FILE" >&2
  exit 1
fi

COMBINED="highway IN ('residential','secondary','primary','tertiary','service',\
'living_street','primary_link','secondary_link','tertiary_link',\
'unclassified','trunk','motorway_link','trunk_link','motorway',\
'road','ramp','pedestrian','cycleway','proposed','construction',\
'footway','path','track','bridleway','trail') OR \
railway IN ('rail','light_rail','tram','subway','narrow_gauge',\
'funicular','monorail','miniature','preserved','construction','proposed')"

echo "=== Writing roads, paths and railways ==="
# no need for spatial index, because in the next step it will get rasterizes line by line anyway
gdal vector pipeline \
  ! read "$FILE" --if OSM --layer lines \
  ! filter --where "$COMBINED" \
  ! select --fields _ogr_geometry_ \
  ! reproject --dst-crs "$TARGET_EPSG" \
  ! write $OUTPUT_FILE --lco SPATIAL_INDEX=NO $OVERWRITE
