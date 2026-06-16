#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=load_raster_config.sh
source "${SCRIPT_DIR}/load_raster_config.sh"

FILE="${SCRIPT_DIR}/${AREA}-latest.osm.pbf"
OUTPUT_PATH="${SCRIPT_DIR}"

ROADS="highway IN ('residential','secondary','primary','tertiary','service',\
'living_street','primary_link','secondary_link','tertiary_link',\
'unclassified','trunk','motorway_link','trunk_link','motorway',\
'road','ramp','pedestrian','cycleway','proposed','construction')"

PATHS="highway IN ('footway','path','track','bridleway','trail')"

# Track-bearing railway classes. This intentionally excludes platforms, stops,
# and other railway-tagged infrastructure that is not a rail line.
RAILWAYS="railway IN ('rail','light_rail','tram','subway','narrow_gauge',\
'funicular','monorail','miniature','preserved','construction','proposed')"

# ADD THIS COMMENTS TO ITS OWN bash-script
# echo "=== Unique highway types ==="
# gdal vector sql \
#   --if OSM \
#   --oo INTERLEAVED_READING=YES \
#   "$FILE" /vsistdout/ \
#   --format CSV \
#   --sql "SELECT highway FROM lines WHERE highway IS NOT NULL" \
#   --dialect SQLITE \
#   | tail -n +2 \
#   | tr -d '\r' \
#   | LC_ALL=C sort -u
# echo "=== Unique railway types ==="
# gdal vector sql \
#   --if OSM \
#   --oo INTERLEAVED_READING=YES \
#   "$FILE" /vsistdout/ \
#   --format CSV \
#   --sql "SELECT railway FROM lines WHERE railway IS NOT NULL" \
#   --dialect SQLITE \
#   | tail -n +2 \
#   | tr -d '\r' \
#   | LC_ALL=C sort -u

echo "=== Writing roads ==="
gdal vector pipeline \
  ! read "$FILE" --if OSM --oo INTERLEAVED_READING=YES --layer lines \
  ! filter --where "$ROADS" \
  ! select --fields _ogr_geometry_ \
  ! reproject --dst-crs "$TARGET_EPSG" \
  ! write "${OUTPUT_PATH}/${AREA}_roads.gpkg" $OVERWRITE

echo "=== Writing paths ==="
gdal vector pipeline \
  ! read "$FILE" --if OSM --oo INTERLEAVED_READING=YES --layer lines \
  ! filter --where "$PATHS" \
  ! select --fields _ogr_geometry_ \
  ! reproject --dst-crs "$TARGET_EPSG" \
  ! write "${OUTPUT_PATH}/${AREA}_paths.gpkg" $OVERWRITE

echo "=== Writing railways ==="
gdal vector pipeline \
  ! read "$FILE" --if OSM --oo INTERLEAVED_READING=YES --layer lines \
  ! filter --where "$RAILWAYS" \
  ! select --fields _ogr_geometry_ \
  ! reproject --dst-crs "$TARGET_EPSG" \
  ! write "${OUTPUT_PATH}/${AREA}_railways.gpkg" $OVERWRITE

echo "Done."
