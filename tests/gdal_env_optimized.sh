#!/usr/bin/env bash
# TiTiler-community recommended GDAL settings for local COG tile serving.
# Source this before a benchmark run to test the optimised configuration:
#
#   source tests/gdal_env_optimized.sh && pytest tests/test_raster_performance.py -s
#
# References:
#   https://developmentseed.org/titiler/advanced/performance_tuning/
#   https://gdal.org/en/stable/drivers/raster/cog.html

# ── Block cache ───────────────────────────────────────────────────────────────
# GDAL's internal tile/block cache, shared across all open files.
# Default is 5% of RAM (~200 MB on a 4 GB machine). 512 MB is a safe floor;
# set to 75% of available RAM if this host is dedicated to tile serving.
export GDAL_CACHEMAX=512

# ── File-open optimisation ────────────────────────────────────────────────────
# COG headers for large files routinely exceed the 16 KB default, causing an
# extra HTTP/disk range read before the first tile can be served.
# 32 KB covers virtually all real-world COG headers in a single read.
export GDAL_INGESTED_BYTES_AT_OPEN=32768

# Prevent GDAL from listing the containing directory on every file open.
# Without this, each dataset open triggers a readdir() that scales with
# directory size and causes unnecessary I/O on network storage.
export GDAL_DISABLE_READDIR_ON_OPEN=EMPTY_DIR

# ── Per-file VSI cache ────────────────────────────────────────────────────────
# A second LRU cache layer on top of GDAL_CACHEMAX, keyed per file handle.
# Keeps recently-read raw (compressed) blocks warm without evicting blocks from
# other files in the block cache.
export VSI_CACHE=TRUE
export VSI_CACHE_SIZE=536870912   # 512 MB

# ── TIFF overview blocksize ───────────────────────────────────────────────────
# Should match the blocksize used when the COG was created.
# Mismatches cause GDAL to decompress and re-tile on every overview access.
export GDAL_TIFF_OVR_BLOCKSIZE=512

# ── HTTP (matters for S3 / HTTP sources; no effect on local files) ────────────
export GDAL_HTTP_MERGE_CONSECUTIVE_RANGES=YES   # merge adjacent byte-range requests
export GDAL_HTTP_MULTIPLEX=YES                  # HTTP/2 multiplexing
export GDAL_HTTP_VERSION=2                      # prefer HTTP/2

# ── Misc ──────────────────────────────────────────────────────────────────────
export CPL_TMPDIR=/tmp

echo "[gdal_env] TiTiler-community optimised GDAL variables set:"
env | grep -E '^(GDAL|CPL|VSI)' | sort | sed 's/^/  /'
