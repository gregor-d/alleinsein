#!/usr/bin/env bash
# Resets all GDAL-relevant env vars so GDAL uses its built-in defaults.
# Source this before a benchmark run to establish a clean baseline:
#
#   source tests/gdal_env_default.sh && pytest tests/test_raster_performance.py -s

unset GDAL_CACHEMAX
unset GDAL_INGESTED_BYTES_AT_OPEN
unset GDAL_DISABLE_READDIR_ON_OPEN
unset GDAL_HTTP_MERGE_CONSECUTIVE_RANGES
unset GDAL_HTTP_MULTIPLEX
unset GDAL_HTTP_VERSION
unset GDAL_TIFF_OVR_BLOCKSIZE
unset VSI_CACHE
unset VSI_CACHE_SIZE
unset CPL_TMPDIR
unset CPL_VSIL_CURL_CACHE_SIZE

# ── What GDAL uses internally when these variables are unset ──────────────────
#
#  GDAL_CACHEMAX                  = 5 % of total RAM (block cache shared across all files)
#  GDAL_INGESTED_BYTES_AT_OPEN    = 16384  (16 KB — often requires a 2nd range read for large COG headers)
#  GDAL_DISABLE_READDIR_ON_OPEN   = <not set>  (GDAL scans the directory on every file open)
#  GDAL_HTTP_MERGE_CONSECUTIVE_RANGES = NO
#  GDAL_HTTP_MULTIPLEX            = NO
#  GDAL_HTTP_VERSION              = 0  (auto-negotiate, typically HTTP/1.1)
#  GDAL_TIFF_OVR_BLOCKSIZE        = 128
#  VSI_CACHE                      = FALSE
#  VSI_CACHE_SIZE                 = 25000000  (25 MB per-file VSI cache)
#  CPL_TMPDIR                     = system temp dir

echo "[gdal_env] GDAL variables unset — GDAL built-in defaults active"
