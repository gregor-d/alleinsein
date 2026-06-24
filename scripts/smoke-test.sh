#!/usr/bin/env bash
set -euo pipefail

base_url="${1:-${BASE_URL:-http://127.0.0.1:8000}}"
base_url="${base_url%/}"

urls=(
  "${base_url}/healthz"
  "${base_url}/tiles/WebMercatorQuad/0/0/0?raster=test_raster.tif"
  "${base_url}/tiles/WebMercatorQuad/0/0/0"
)

for url in "${urls[@]}"; do
  status="$(curl --silent --show-error --output /dev/null --write-out "%{http_code}" "$url")"

  if [[ "$status" != "200" ]]; then
    echo "FAIL ${url} returned HTTP ${status}" >&2
    exit 1
  fi

  echo "OK ${url} returned HTTP 200"
done

echo "smoke test passed"
