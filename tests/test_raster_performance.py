import asyncio
import os
import random
import time
import urllib.error
import urllib.request
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path

import httpx2
import morecantile
import pyproj
import pytest
import rasterio

from backend.main import PROJECT_DIR, app, settings

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
settings.raster_path = "raster/out/cog_compare"

TITILER_BASE_URL = os.getenv("TITILER_BASE_URL", "http://127.0.0.1:8000").rstrip("/")
TITILER_CONCURRENCY = max(1, int(os.getenv("TITILER_CONCURRENCY", "25")))
TITILER_TILE_COUNT = max(1, int(os.getenv("TITILER_TILE_COUNT", "400")))
TITILER_REQUEST_TIMEOUT = float(os.getenv("TITILER_REQUEST_TIMEOUT", "60"))
BENCHMARK_RUNS = 2
WARMUP_TILES = 50
PROGRESS_INTERVAL = TITILER_TILE_COUNT/4


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------
@dataclass
class RunResult:
    run: int
    filename: str
    latencies: list[float]
    total_s: float
    failures: int
    failure_examples: list[str]

    def stats(self) -> dict[str, float]:
        n = len(self.latencies)
        if n == 0:
            return {k: 0.0 for k in ("avg", "med", "p90", "p95", "min", "max", "rps")}
        s = sorted(self.latencies)
        return {
            "avg": sum(s) / n,
            "med": s[n // 2],
            "p90": s[min(n - 1, int(n * 0.90))],
            "p95": s[min(n - 1, int(n * 0.95))],
            "min": s[0],
            "max": s[-1],
            "rps": n / self.total_s if self.total_s > 0 else 0.0,
        }


# ---------------------------------------------------------------------------
# Tile generation
# ---------------------------------------------------------------------------
def generate_tiles(raster_path: Path, count: int, seed: int = 42) -> list[tuple[int, int, int]]:
    """Generate deterministic tile coords inside the raster's centre 50% bounding box."""
    with rasterio.open(raster_path) as src:
        bounds, crs = src.bounds, src.crs

    if crs.to_epsg() != 4326:
        transformer = pyproj.Transformer.from_crs(crs, "EPSG:4326", always_xy=True)
        lng_min, lat_min = transformer.transform(bounds.left, bounds.bottom)
        lng_max, lat_max = transformer.transform(bounds.right, bounds.top)
    else:
        lng_min, lat_min, lng_max, lat_max = bounds.left, bounds.bottom, bounds.right, bounds.top

    # 25% inset on each side → centre 50% avoids nodata border tiles (which return 404)
    cx, cy = (lng_min + lng_max) / 2, (lat_min + lat_max) / 2
    dx, dy = (lng_max - lng_min) * 0.25, (lat_max - lat_min) * 0.25
    lng_min, lng_max = cx - dx, cx + dx
    lat_min, lat_max = cy - dy, cy + dy

    tms = morecantile.tms.get("WebMercatorQuad")
    rng = random.Random(seed)
    tiles: list[tuple[int, int, int]] = []

    for _ in range(count):
        z = rng.choice([7, 8, 9, 10, 11])
        t0 = tms.tile(lng_min, lat_max, z)
        t1 = tms.tile(lng_max, lat_min, z)
        x = rng.randint(min(t0.x, t1.x), max(t0.x, t1.x))
        y = rng.randint(min(t0.y, t1.y), max(t0.y, t1.y))
        tiles.append((z, x, y))

    return tiles


# ---------------------------------------------------------------------------
# Progress bar
# ---------------------------------------------------------------------------
_BAR_WIDTH = 28


def _progress_bar(done: int, total: int, elapsed_s: float, avg_ms: float) -> str:
    pct = done / total if total else 0
    filled = int(_BAR_WIDTH * pct)
    bar = "=" * filled + (">" if filled < _BAR_WIDTH else "") + " " * max(0, _BAR_WIDTH - filled - 1)
    est_left = (elapsed_s / done) * (total - done) if done > 0 else 0
    return f"  [{bar}] {done:>4}/{total}  avg={avg_ms:>5.0f}ms  ~{est_left:>4.0f}s left"


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------
_COLS = [30, 4, 8, 8, 8, 8, 8, 8, 6, 6]
_HDRS = ["File", "Run", "Avg ms", "Med ms", "P90 ms", "P95 ms", "Min ms", "Max ms", "RPS", "Fails"]
_ROW = "| {:<30} | {:>4} | {:>8} | {:>8} | {:>8} | {:>8} | {:>8} | {:>8} | {:>6} | {:>6} |"
_SEP = "|-" + "-|-".join("-" * w for w in _COLS) + "-|"


def _fmt_row(filename: str, run: str, s: dict[str, float], failures: int) -> str:
    return _ROW.format(
        filename, run,
        f"{s['avg']:.1f}", f"{s['med']:.1f}", f"{s['p90']:.1f}", f"{s['p95']:.1f}",
        f"{s['min']:.1f}", f"{s['max']:.1f}", f"{s['rps']:.1f}", failures,
    )


def _print_header(label: str):
    print(f"\n{'='*80}\n{label}\n{'='*80}", flush=True)
    print(_ROW.format(*_HDRS), flush=True)
    print(_SEP, flush=True)


def print_detail_report(results: list[RunResult], label: str):
    """One row per (file, run), grouped by file."""
    _print_header(f"DETAIL REPORT — {label}")
    sorted_results = sorted(results, key=lambda r: (r.filename, r.run))
    prev = None
    for r in sorted_results:
        if prev and r.filename != prev:
            print(_SEP, flush=True)
        print(_fmt_row(r.filename, str(r.run), r.stats(), r.failures), flush=True)
        prev = r.filename
    print("=" * 80, flush=True)


def print_summary_report(results: list[RunResult], label: str):
    """One row per file, combining latencies across all runs."""
    _print_header(f"SUMMARY REPORT — {label}")
    by_file: dict[str, list[RunResult]] = {}
    for r in results:
        by_file.setdefault(r.filename, []).append(r)
    for filename, runs in by_file.items():
        combined = RunResult(
            run=0,
            filename=filename,
            latencies=[lat for r in runs for lat in r.latencies],
            total_s=sum(r.total_s for r in runs),
            failures=sum(r.failures for r in runs),
            failure_examples=[],
        )
        print(_fmt_row(filename, "ALL", combined.stats(), combined.failures), flush=True)
    print("=" * 80 + "\n", flush=True)


# ---------------------------------------------------------------------------
# External server check
# ---------------------------------------------------------------------------
def external_titiler_is_ready(base_url: str) -> bool:
    try:
        with urllib.request.urlopen(f"{base_url}/healthz", timeout=2.0) as r:
            return r.status == 200
    except (urllib.error.URLError, urllib.error.HTTPError):
        return False


# ---------------------------------------------------------------------------
# Async benchmark engine
# ---------------------------------------------------------------------------
AsyncRequestFn = Callable[[str, int, int, int], Awaitable[int]]


async def run_benchmark(request_tile: AsyncRequestFn, label: str, concurrency: int) -> list[RunResult]:
    raster_dir = PROJECT_DIR / settings.raster_path
    assert raster_dir.exists(), f"Raster directory not found: {raster_dir}"

    raster_files = sorted(raster_dir.glob("*.tif"))
    assert raster_files, "No .tif files found in raster directory"

    print(f"\n\n{'='*80}", flush=True)
    print(f"COG PERFORMANCE BENCHMARK — {label}", flush=True)
    print(f"  Rasters    : {', '.join(f.name for f in raster_files)}", flush=True)
    print(f"  Tiles/file : {TITILER_TILE_COUNT}  |  Warm-up: {WARMUP_TILES}  |  Runs: {BENCHMARK_RUNS}  |  Concurrency: {concurrency}", flush=True)
    print("=" * 80, flush=True)

    semaphore = asyncio.Semaphore(concurrency)
    all_results: list[RunResult] = []

    async def timed(filename: str, z: int, x: int, y: int) -> tuple[int, int, int, int, float, str | None]:
        async with semaphore:
            t0 = time.perf_counter()
            try:
                code = await request_tile(filename, z, x, y)
                err = None
            except Exception as exc:
                code, err = 0, repr(exc)
            return z, x, y, code, (time.perf_counter() - t0) * 1000.0, err

    for run in range(1, BENCHMARK_RUNS + 1):
        order_label = "reversed" if run % 2 == 0 else "normal"
        file_order = list(reversed(raster_files)) if run % 2 == 0 else list(raster_files)
        print(f"\n--- Run {run}/{BENCHMARK_RUNS} ({order_label} order) ---", flush=True)

        for raster_file in file_order:
            filename = raster_file.name
            tiles = generate_tiles(raster_file, TITILER_TILE_COUNT)
            failures: list[str] = []

            # warm-up: fire first WARMUP_TILES concurrently to open dataset and seed OS cache
            print(f"  [{filename}] warming up ({WARMUP_TILES} tiles)...", flush=True)
            warmup_tasks = [asyncio.create_task(timed(filename, z, x, y)) for z, x, y in tiles[:WARMUP_TILES]]
            for coro in asyncio.as_completed(warmup_tasks):
                _, _, _, code, _, err = await coro
                if code != 200:
                    failures.append(f"warm-up {code}" + (f" ({err})" if err else ""))

            # benchmark
            print(f"  [{filename}] benchmarking {TITILER_TILE_COUNT} tiles...", flush=True)
            latencies: list[float] = []
            tasks = [asyncio.create_task(timed(filename, z, x, y)) for z, x, y in tiles]
            total_start = time.perf_counter()

            for idx, coro in enumerate(asyncio.as_completed(tasks), start=1):
                z, x, y, code, lat_ms, err = await coro
                if code == 200:
                    latencies.append(lat_ms)
                else:
                    failures.append(f"{z}/{x}/{y}: {code}" + (f" ({err})" if err else ""))

                if idx % PROGRESS_INTERVAL == 0 or idx == TITILER_TILE_COUNT:
                    elapsed = time.perf_counter() - total_start
                    avg = sum(latencies) / len(latencies) if latencies else 0.0
                    print(_progress_bar(idx, TITILER_TILE_COUNT, elapsed, avg), flush=True)

            total_s = time.perf_counter() - total_start
            result = RunResult(run, filename, latencies, total_s, len(failures), failures[:5])
            s = result.stats()
            print(
                f"  [{filename}] run {run} done — avg={s['avg']:.1f}ms  p90={s['p90']:.1f}ms  rps={s['rps']:.1f}  fails={result.failures}",
                flush=True,
            )
            all_results.append(result)

    return all_results


# ---------------------------------------------------------------------------
# Assertion helper
# ---------------------------------------------------------------------------
def _assert_no_failures(results: list[RunResult]):
    total = sum(r.failures for r in results)
    if total:
        examples = "; ".join(ex for r in results for ex in r.failure_examples)
        pytest.fail(f"{total} tile requests failed — {examples}")


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------
@pytest.mark.skip("only use real endpoint, this messes up the IDE")
def test_cog_performance_fixture_async():
    async def _run() -> list[RunResult]:
        transport = httpx2.ASGITransport(app=app, raise_app_exceptions=False)
        async with httpx2.AsyncClient(
            transport=transport,
            base_url="http://testserver",
            timeout=httpx2.Timeout(TITILER_REQUEST_TIMEOUT),
            trust_env=False,
        ) as client:
            async def request_tile(filename: str, z: int, x: int, y: int) -> int:
                r = await client.get(f"/tiles/WebMercatorQuad/{z}/{x}/{y}", params={"raster": filename})
                return r.status_code

            return await run_benchmark(request_tile, "async ASGI fixture", TITILER_CONCURRENCY)

    results = asyncio.run(_run())
    print_detail_report(results, "async ASGI fixture")
    print_summary_report(results, "async ASGI fixture")
    _assert_no_failures(results)


def test_cog_performance_real_async():
    if not external_titiler_is_ready(TITILER_BASE_URL):
        pytest.skip(f"TiTiler not reachable at {TITILER_BASE_URL}")

    async def _run() -> list[RunResult]:
        limits = httpx2.Limits(
            max_connections=TITILER_CONCURRENCY,
            max_keepalive_connections=TITILER_CONCURRENCY,
        )
        async with httpx2.AsyncClient(
            base_url=TITILER_BASE_URL,
            timeout=httpx2.Timeout(TITILER_REQUEST_TIMEOUT),
            limits=limits,
            trust_env=False,
        ) as client:
            async def request_tile(filename: str, z: int, x: int, y: int) -> int:
                r = await client.get(f"/tiles/WebMercatorQuad/{z}/{x}/{y}", params={"raster": filename})
                return r.status_code

            return await run_benchmark(request_tile, f"async HTTP {TITILER_BASE_URL}", TITILER_CONCURRENCY)

    results = asyncio.run(_run())
    print_detail_report(results, f"async HTTP {TITILER_BASE_URL}")
    print_summary_report(results, f"async HTTP {TITILER_BASE_URL}")
    _assert_no_failures(results)
