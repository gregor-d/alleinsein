#!/usr/bin/env bash
# Generates a matrix of COG variants for tile-serving performance comparison.
# Runs up to MAX_PARALLEL jobs concurrently (default 4).
#
# Outputs go to raster/out/cog_compare/.
# Sensible variants are GDAL/rio pairs with identical settings.
# Worst-case variants use rio-cogeo only (they illustrate pathological settings).
#
# Usage: bash raster/test.sh [MAX_PARALLEL]

set -euo pipefail
export CPL_LOG=/dev/null

# Multi-threaded compression per job. Does not affect output files.
export GDAL_NUM_THREADS=ALL_CPUS

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
out_dir="${SCRIPT_DIR}/out/cog_compare"
input="${SCRIPT_DIR}/out/raw.tif"
MAX_PARALLEL="${1:-4}"

mkdir -p "$out_dir"
[[ -f "$input" ]] || { echo "ERROR: input not found: $input" >&2; exit 1; }

# ─────────────────────────────────────────────────────────────────────────────
# Parallel job throttle (bash 4.3+, available on WSL)
# ─────────────────────────────────────────────────────────────────────────────
_active=0

_bg() {
    "$@" &
    _active=$((_active + 1))
    if (( _active >= MAX_PARALLEL )); then
        wait -n          # block until any one job finishes
        _active=$((_active - 1))
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# COG helpers — each logs [start]/[done] so interleaved output is readable
# ─────────────────────────────────────────────────────────────────────────────

gdal_cog() {
    local name="$1"; shift
    local out="${out_dir}/${name}.tif"
    echo "[start] gdal → ${name}.tif"
    gdal raster pipeline \
        "!" read "$input" \
        "!" write -f COG --overwrite "$@" "$out"
    echo "[ done] gdal → ${name}.tif"
}

rio_cog() {
    local name="$1"; shift
    local out="${out_dir}/${name}.tif"
    echo "[start] rio  → ${name}.tif"
    rio cogeo create "$input" "$out" "$@"
    echo "[ done] rio  → ${name}.tif"
}

# ─────────────────────────────────────────────────────────────────────────────
# Shared base options (GDAL and rio produce the same canvas + overview count)
#
# GDAL: ZOOM_LEVEL=12 → same 29440×37120 canvas as rio --web-optimized
# rio:  --overview-level 7 → matches GDAL's 7 auto-generated levels for
#       zoom 12 + 512-block (rio defaults to 6 for this data size)
# ─────────────────────────────────────────────────────────────────────────────

GDAL_BASE=(
    --co "TILING_SCHEME=GoogleMapsCompatible"
    --co "ZOOM_LEVEL=12"
    --co "BIGTIFF=IF_SAFER"
    --co "WARP_RESAMPLING=NEAREST"
    --co "OVERVIEW_RESAMPLING=MODE"
    --co "ADD_ALPHA=NO"
    --co "NUM_THREADS=ALL_CPUS"
)

RIO_BASE=(
    --web-optimized
    --resampling nearest
    --overview-resampling mode
)

# ─────────────────────────────────────────────────────────────────────────────
# Plan
# ─────────────────────────────────────────────────────────────────────────────

printf '%s\n' "$(printf '=%.0s' {1..72})"
printf 'COG VARIANT GENERATOR  (parallel=%s, threads=ALL_CPUS)\n' "$MAX_PARALLEL"
printf '%s\n\n' "$(printf '=%.0s' {1..72})"
printf '  Sensible pairs (gdal + rio, identical settings):\n'
printf '    gdal_default          rio_default\n'
printf '    gdal_zstd_l1_512      rio_zstd_l1_512      (optimal)\n'
printf '    gdal_zstd_l12_512     rio_zstd_l12_512     (high compression)\n'
printf '    gdal_zstd_l1_256      rio_zstd_l1_256      (small block)\n'
printf '  Worst-case scenarios (rio only):\n'
printf '    worst_no_compression  worst_too_few_overviews\n'
printf '    worst_too_many_overviews  worst_wrong_predictor\n\n'

# ─────────────────────────────────────────────────────────────────────────────
# Launch all jobs
# ─────────────────────────────────────────────────────────────────────────────

# 1/8 — DEFAULT: tool defaults, no custom options
_bg gdal_cog "gdal_default"
_bg rio_cog  "rio_default"

# 2/8 — OPTIMAL: ZSTD L1, 512-block, web-aligned, predictor=2
#   L1 = fastest decompression; 512 matches TiTiler's tile size (1 block = 1 tile)
_bg gdal_cog "gdal_zstd_l1_512" "${GDAL_BASE[@]}" \
    --co "BLOCKSIZE=512" --co "COMPRESS=ZSTD" --co "LEVEL=1" --co "PREDICTOR=2"
_bg rio_cog  "rio_zstd_l1_512"  "${RIO_BASE[@]}" --overview-level 7 \
    --blocksize 512 --co "COMPRESS=ZSTD" --co "LEVEL=1" --co "PREDICTOR=2"

# 3/8 — HIGH COMPRESSION: ZSTD L12, 512-block
#   Smaller file; check if size saving offsets the decompression overhead.
_bg gdal_cog "gdal_zstd_l12_512" "${GDAL_BASE[@]}" \
    --co "BLOCKSIZE=512" --co "COMPRESS=ZSTD" --co "LEVEL=12" --co "PREDICTOR=2"
_bg rio_cog  "rio_zstd_l12_512"  "${RIO_BASE[@]}" --overview-level 7 \
    --blocksize 512 --co "COMPRESS=ZSTD" --co "LEVEL=12" --co "PREDICTOR=2"

# 4/8 — SMALL BLOCK: ZSTD L1, 256-block
#   Half the data per tile, 4× more IFD entries.
_bg gdal_cog "gdal_zstd_l1_256" "${GDAL_BASE[@]}" \
    --co "BLOCKSIZE=256" --co "COMPRESS=ZSTD" --co "LEVEL=1" --co "PREDICTOR=2"
_bg rio_cog  "rio_zstd_l1_256"  "${RIO_BASE[@]}" --overview-level 7 \
    --blocksize 256 --co "COMPRESS=ZSTD" --co "LEVEL=1" --co "PREDICTOR=2"

# 5/8 — WORST: NO COMPRESSION — raw I/O ceiling (~7× larger file)
_bg rio_cog "worst_no_compression" "${RIO_BASE[@]}" --overview-level 7 \
    --blocksize 512 --co "COMPRESS=NONE"

# 6/8 — WORST: TOO FEW OVERVIEWS — z7–z10 tiles force full-res reads
_bg rio_cog "worst_too_few_overviews" "${RIO_BASE[@]}" --overview-level 2 \
    --blocksize 512 --co "COMPRESS=ZSTD" --co "LEVEL=1" --co "PREDICTOR=2"

# 7/8 — WORST: TOO MANY OVERVIEWS — 12 levels down to ~8×10 px; bloated IFD
_bg rio_cog "worst_too_many_overviews" "${RIO_BASE[@]}" --overview-level 12 \
    --blocksize 512 --co "COMPRESS=ZSTD" --co "LEVEL=1" --co "PREDICTOR=2"

# 8/8 — WORST: WRONG PREDICTOR — PREDICTOR=3 (float) on uint8 data
_bg rio_cog "worst_wrong_predictor" "${RIO_BASE[@]}" --overview-level 7 \
    --blocksize 512 --co "COMPRESS=ZSTD" --co "LEVEL=1" --co "PREDICTOR=3"

# Wait for remaining jobs
wait

# ─────────────────────────────────────────────────────────────────────────────
# Summary
# ─────────────────────────────────────────────────────────────────────────────
printf '\n%s\n' "$(printf '=%.0s' {1..72})"
printf 'Done. Files in %s:\n\n' "$out_dir"
ls -lh "$out_dir"/*.tif | awk '{printf "  %-52s %s\n", $9, $5}'
printf '\n'
