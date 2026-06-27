#!/usr/bin/env bash
# One-time helper: cut each country in eu.conf out of the Europe-wide PBF, with a
# buffered bbox so the downstream road-smoothing kernel sees cross-border roads.
# Outputs raster/input/osm/<country>-latest.osm.pbf, which the existing
# osm_*.sh scripts then consume unchanged. Re-run only when the source PBF or the
# country list changes (FORCE=1 to re-extract existing files).
set -euo pipefail

EU_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
RASTER_DIR="$(cd -- "${EU_DIR}/.." && pwd)"
PROJECT_DIR="$(cd -- "${RASTER_DIR}/.." && pwd)"
UTILS_DIR="${RASTER_DIR}/utils"
OSM_DIR="${RASTER_DIR}/input/osm"
BOUNDS_DIR="${RASTER_DIR}/input/bounds"

# shellcheck source=eu.conf
source "${EU_DIR}/eu.conf"

EUROPE_PBF="${OSM_DIR}/${EUROPE_PBF_NAME}"
FORCE="${FORCE:-0}"

if [[ ! -r "$EUROPE_PBF" ]]; then
  echo "Missing Europe PBF: $EUROPE_PBF" >&2
  echo "Download it once: https://download.geofabrik.de/europe-latest.osm.pbf" >&2
  exit 1
fi

if ! command -v osmium >/dev/null 2>&1; then
  echo "osmium-tool not found (sudo apt install osmium-tool)" >&2
  exit 1
fi

for country in "${COUNTRIES[@]}"; do
  bounds_conf="${BOUNDS_DIR}/${country}_bounds.conf"
  bounds_gpkg="${BOUNDS_DIR}/${country}.gpkg"

  # Buffered bounds are the source of the extract bbox. Regenerate when the gpkg
  # is missing or the conf predates buffering (no OSM_BBOX) - e.g. a leftover from
  # the single-country, unbuffered workflow.
  OSM_BBOX=""
  # shellcheck disable=SC1090
  [[ -r "$bounds_conf" ]] && source "$bounds_conf"
  if [[ ! -r "$bounds_gpkg" || -z "${OSM_BBOX}" ]]; then
    echo "=== Generating buffered bounds for ${country} ==="
    ( cd "$PROJECT_DIR" && AREA="$country" \
        BOUNDS_BUFFER_M="$BOUNDS_BUFFER_M" BOUNDS_SNAP_M="$BOUNDS_SNAP_M" \
        uv run "${UTILS_DIR}/bounds_create_area.py" )
    OSM_BBOX=""
    # shellcheck disable=SC1090
    source "$bounds_conf"
  fi
  if [[ -z "${OSM_BBOX}" ]]; then
    echo "OSM_BBOX missing in ${bounds_conf} after regeneration" >&2
    exit 1
  fi

  out="${OSM_DIR}/${country}-latest.osm.pbf"
  if [[ -r "$out" && "$FORCE" != "1" ]]; then
    echo "=== ${country}: ${out} exists, skipping (FORCE=1 to re-extract) ==="
    continue
  fi

  echo "=== Extracting ${country}  (bbox ${OSM_BBOX})  ->  ${out} ==="
  osmium extract --bbox="$OSM_BBOX" --set-bounds --strategy=complete_ways \
    --overwrite -o "$out" "$EUROPE_PBF"
done

echo "Done. Per-country PBFs are in ${OSM_DIR}/<country>-latest.osm.pbf"
