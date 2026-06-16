#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=load_raster_config.sh
source "${SCRIPT_DIR}/load_raster_config.sh"

OSM_DIR="${RASTER_ROOT_DIR}/input/osm"
FILE="${OSM_DIR}/${AREA}-latest.osm.pbf"
FILTERED="${OSM_DIR}/${AREA}-filtered.osm.pbf"

if [[ ! -r "$FILE" ]]; then
  echo "Missing OSM PBF input: $FILE" >&2
  exit 1
fi

mkdir -p "$OSM_DIR"

echo "=== Filtering OSM PBF ==="
osmium tags-filter "$FILE" \
  w/highway \
  w/railway \
  -o "$FILTERED" \
  --overwrite

echo "Done. Output: $FILTERED"
