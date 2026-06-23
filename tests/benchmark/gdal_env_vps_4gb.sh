#!/usr/bin/env bash
# GDAL settings tuned for: 4 GB RAM · 2-core CPU · 20 GB SSD · ~200 MB raster.
#
# Strategy:
#   The 200 MB compressed raster fits entirely in RAM.  Generous caching
#   eliminates disk reads after the first warm-up pass.  With only 2 cores,
#   every cache hit matters more than on a multi-core machine because there is
#   no spare CPU to absorb decompression work cheaply.
#
# Memory budget (4 GB total):
#   OS + kernel                          ~300 MB
#   uvicorn / Python / TiTiler           ~300 MB
#   GDAL block cache (decompressed)       512 MB  ← GDAL_CACHEMAX
#   VSI cache (compressed file bytes)     256 MB  ← VSI_CACHE_SIZE (> 200 MB raster)
#   OS page cache + headroom            ~2.6 GB
#
# Source before benchmarking:
#   source tests/gdal_env_vps_4gb.sh && pytest tests/test_raster_performance.py -s

# ── Block cache ───────────────────────────────────────────────────────────────
# 512 MB of decompressed tile blocks.  Hot-caches the most-accessed overview
# levels entirely.  Sized to leave ample room for the OS on a 4 GB machine.
# (Default: 5% of RAM → ~205 MB here — barely enough for one overview level.)
export GDAL_CACHEMAX=512

# ── Per-file VSI cache ────────────────────────────────────────────────────────
# 256 MB > 200 MB raster: the whole compressed file fits in RAM after the
# first pass.  Eliminates all SSD reads for subsequent tile requests.
# On a 20 GB SSD, disk latency and write endurance are both limited, so
# keeping the file in RAM is the single highest-value tuning on this hardware.
export VSI_CACHE=TRUE
export VSI_CACHE_SIZE=268435456   # 256 MB

# ── File-open optimisation ────────────────────────────────────────────────────
# Read 32 KB at open to capture the full COG header in one I/O.
# The default 16 KB often falls short, causing a second range read before
# the first tile can be served — noticeable on an SSD with seek latency.
export GDAL_INGESTED_BYTES_AT_OPEN=32768

# Prevent GDAL from scanning the directory on every file open.
# On an SSD this is a fast but unnecessary seek on each tile request.
export GDAL_DISABLE_READDIR_ON_OPEN=EMPTY_DIR

# ── Overview blocksize ────────────────────────────────────────────────────────
# Must match the blocksize the COG was written with (512).
# A mismatch forces GDAL to decompress and re-tile on every overview read —
# especially costly with only 2 CPU cores available for decompression.
export GDAL_TIFF_OVR_BLOCKSIZE=512

# ── Temp files ────────────────────────────────────────────────────────────────
# Write GDAL temp files to RAM-backed tmpfs instead of the SSD.
# Avoids SSD write cycles (important on a 20 GB drive) and removes disk latency
# from any internal GDAL operations that need scratch space.
export CPL_TMPDIR=/tmp

# ── HTTP (no effect on local files; set for parity if moving to S3 later) ─────
export GDAL_HTTP_MERGE_CONSECUTIVE_RANGES=YES
export GDAL_HTTP_MULTIPLEX=YES
export GDAL_HTTP_VERSION=2

echo "[gdal_env] VPS 4 GB / 2-core / 20 GB SSD GDAL variables set:"
env | grep -E '^(GDAL|CPL|VSI)' | sort | sed 's/^/  /'
