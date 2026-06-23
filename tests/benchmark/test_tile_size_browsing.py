"""
Simulates realistic map browsing (zoom in → pan → zoom out → zoom in → pan)
against the live TiTiler endpoint. Compares a 256-blocksize vs 512-blocksize COG.

Each step fires all viewport tiles concurrently — wall time per step is the key
metric, since that's what the user perceives waiting for tiles to appear.

Configuration via env vars:
  TITILER_BASE_URL   default: https://titiler.alleinseinkarte.de
  TITILER_CONCURRENCY default: 20
  RASTER_256         default: cog_blocksize256.tif
  RASTER_512         default: cog_blocksize512.tif
  RASTER_LOCAL_DIR   default: raster/out  (used only to read bounds)
"""

import asyncio
import os
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

import httpx2
import morecantile
import pyproj
import pytest
import rasterio

BASE_URL = os.getenv("TITILER_BASE_URL", "https://titiler.alleinseinkarte.de").rstrip(
    "/"
)
CONCURRENCY = int(os.getenv("TITILER_CONCURRENCY", "20"))
REQUEST_TIMEOUT = float(os.getenv("TITILER_REQUEST_TIMEOUT", "30"))
RASTER_256 = os.getenv("RASTER_256", "cog_blocksize256.tif")
RASTER_512 = os.getenv("RASTER_512", "cog_blocksize512.tif")
RASTER_LOCAL_DIR = Path(os.getenv("RASTER_LOCAL_DIR", "raster/out"))

VIEWPORT_W = 5  # tiles across
VIEWPORT_H = 4  # tiles tall


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------
@dataclass
class StepResult:
    action: str
    zoom: int
    tile_count: int
    latencies: list[float] = field(default_factory=list)
    failures: int = 0
    wall_s: float = 0.0

    def stats(self) -> dict[str, float]:
        s = sorted(self.latencies)
        n = len(s)
        if n == 0:
            return {"avg": 0.0, "p90": 0.0, "max": 0.0}
        return {
            "avg": sum(s) / n,
            "p90": s[min(n - 1, int(n * 0.9))],
            "max": s[-1],
        }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def raster_wgs84_bounds(name: str) -> tuple[float, float, float, float]:
    """Return (lng_min, lat_min, lng_max, lat_max) in WGS84 for a local raster."""
    with rasterio.open(RASTER_LOCAL_DIR / name) as src:
        b, crs = src.bounds, src.crs
    if crs.to_epsg() != 4326:
        t = pyproj.Transformer.from_crs(crs, "EPSG:4326", always_xy=True)
        lng_min, lat_min = t.transform(b.left, b.bottom)
        lng_max, lat_max = t.transform(b.right, b.top)
    else:
        lng_min, lat_min, lng_max, lat_max = b.left, b.bottom, b.right, b.top
    return lng_min, lat_min, lng_max, lat_max


def browsing_scenario(
    lng_min: float, lat_min: float, lng_max: float, lat_max: float
) -> list[tuple[str, int, float, float]]:
    """Sequence of (action_label, zoom, center_lng, center_lat) mimicking a user session."""
    cx, cy = (lng_min + lng_max) / 2, (lat_min + lat_max) / 2
    pan_x = (lng_max - lng_min) * 0.15
    pan_y = (lat_max - lat_min) * 0.15
    return [
        ("start z=8", 8, cx, cy),
        ("zoom in z=9", 9, cx, cy),
        ("zoom in z=10", 10, cx, cy),
        ("pan right z=10", 10, cx + pan_x, cy),
        ("zoom out z=8", 8, cx + pan_x, cy),
        ("zoom in z=10", 10, cx, cy),
        ("pan down z=10", 10, cx, cy - pan_y),
    ]


def viewport_tiles(zoom: int, cx: float, cy: float) -> list[tuple[int, int, int]]:
    """All (z, x, y) tiles visible in a VIEWPORT_W × VIEWPORT_H grid centred on cx/cy."""
    ct = morecantile.tms.get("WebMercatorQuad").tile(cx, cy, zoom)
    hw, hh = VIEWPORT_W // 2, VIEWPORT_H // 2
    return [
        (zoom, ct.x + dx, ct.y + dy)
        for dx in range(-hw, hw + 1)
        for dy in range(-hh, hh + 1)
    ]


# ---------------------------------------------------------------------------
# Benchmark engine
# ---------------------------------------------------------------------------
async def run_scenario(
    client: httpx2.AsyncClient,
    raster: str,
    scenario: list[tuple[str, int, float, float]],
    sem: asyncio.Semaphore,
    tilesize: int | None = None,
) -> list[StepResult]:
    async def fetch(z: int, x: int, y: int) -> tuple[int, float]:
        async with sem:
            t0 = time.perf_counter()
            try:
                params = {"raster": raster}
                if tilesize is not None:
                    params["tilesize"] = str(tilesize)
                r = await client.get(
                    f"/tiles/WebMercatorQuad/{z}/{x}/{y}", params=params
                )
                return r.status_code, (time.perf_counter() - t0) * 1000
            except Exception:
                return 0, (time.perf_counter() - t0) * 1000

    results = []
    for action, zoom, cx, cy in scenario:
        tiles = viewport_tiles(zoom, cx, cy)
        tasks = [asyncio.create_task(fetch(z, x, y)) for z, x, y in tiles]
        latencies: list[float] = []
        failures = 0
        t0 = time.perf_counter()
        for coro in asyncio.as_completed(tasks):
            code, lat = await coro
            if code == 200:
                latencies.append(lat)
            else:
                failures += 1
        results.append(
            StepResult(
                action, zoom, len(tiles), latencies, failures, time.perf_counter() - t0
            )
        )
    return results


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------
def print_report(
    ra: list[StepResult],
    rb: list[StepResult],
    label_a: str = "256",
    label_b: str = "512",
) -> None:
    la, lb = label_a[:9], label_b[:9]
    header = (
        f"{'Action':<18} {'Z':>2} | "
        f"{la + ' wall':>9} {la + ' avg':>8} {la + ' p90':>8} | "
        f"{lb + ' wall':>9} {lb + ' avg':>8} {lb + ' p90':>8} | "
        f"{'faster':>6}"
    )
    sep = "-" * len(header)
    print(f"\n{sep}\n{header}\n{sep}")
    for a, b in zip(ra, rb):
        sa, sb = a.stats(), b.stats()
        faster = label_a if a.wall_s <= b.wall_s else label_b
        print(
            f"{a.action:<18} {a.zoom:>2} | "
            f"{a.wall_s:>8.2f}s {sa['avg']:>7.0f}ms {sa['p90']:>7.0f}ms | "
            f"{b.wall_s:>8.2f}s {sb['avg']:>7.0f}ms {sb['p90']:>7.0f}ms | "
            f"{faster:>6}"
        )
    total_a = sum(r.wall_s for r in ra)
    total_b = sum(r.wall_s for r in rb)
    print(sep)
    print(
        f"{'TOTAL':<18}    | "
        f"{total_a:>8.2f}s {'':>8} {'':>8} | "
        f"{total_b:>8.2f}s {'':>8} {'':>8} | "
        f"{label_a if total_a <= total_b else label_b:>6}"
    )
    print(f"{sep}\n")


# ---------------------------------------------------------------------------
# Test
# ---------------------------------------------------------------------------
def test_browsing_simulation():
    try:
        with urllib.request.urlopen(f"{BASE_URL}/healthz", timeout=3) as r:
            if r.status != 200:
                pytest.skip(f"TiTiler not reachable at {BASE_URL}")
    except (urllib.error.URLError, urllib.error.HTTPError):
        pytest.skip(f"TiTiler not reachable at {BASE_URL}")

    bounds = raster_wgs84_bounds(RASTER_256)
    scenario = browsing_scenario(*bounds)

    sem = asyncio.Semaphore(CONCURRENCY)
    limits = httpx2.Limits(
        max_connections=CONCURRENCY, max_keepalive_connections=CONCURRENCY
    )

    async def _run() -> tuple[list[StepResult], list[StepResult]]:
        async with httpx2.AsyncClient(
            base_url=BASE_URL,
            timeout=httpx2.Timeout(REQUEST_TIMEOUT),
            limits=limits,
            trust_env=False,
        ) as client:
            # warm up: open each dataset with one tile before measuring
            action, zoom, cx, cy = scenario[0]
            z0, x0, y0 = viewport_tiles(zoom, cx, cy)[0]
            for raster in (RASTER_256, RASTER_512):
                await client.get(
                    f"/tiles/WebMercatorQuad/{z0}/{x0}/{y0}", params={"raster": raster}
                )

            r256 = await run_scenario(client, RASTER_256, scenario, sem)
            r512 = await run_scenario(client, RASTER_512, scenario, sem)
            return r256, r512

    r256, r512 = asyncio.run(_run())
    print_report(r256, r512, label_a="blk256", label_b="blk512")

    failures = sum(r.failures for r in r256 + r512)
    if failures:
        examples = [
            ex
            for r in r256 + r512
            for ex in ([f"{r.action}: {r.failures} fails"] if r.failures else [])
        ]
        pytest.fail(f"{failures} tile requests failed — {'; '.join(examples)}")


def test_tilesize_comparison():
    """Compare tilesize=256 vs tilesize=512 output tiles against the same COG."""
    try:
        with urllib.request.urlopen(f"{BASE_URL}/healthz", timeout=3) as r:
            if r.status != 200:
                pytest.skip(f"TiTiler not reachable at {BASE_URL}")
    except (urllib.error.URLError, urllib.error.HTTPError):
        pytest.skip(f"TiTiler not reachable at {BASE_URL}")

    bounds = raster_wgs84_bounds(RASTER_256)
    scenario = browsing_scenario(*bounds)

    sem = asyncio.Semaphore(CONCURRENCY)
    limits = httpx2.Limits(
        max_connections=CONCURRENCY, max_keepalive_connections=CONCURRENCY
    )

    async def _run() -> tuple[list[StepResult], list[StepResult]]:
        async with httpx2.AsyncClient(
            base_url=BASE_URL,
            timeout=httpx2.Timeout(REQUEST_TIMEOUT),
            limits=limits,
            trust_env=False,
        ) as client:
            action, zoom, cx, cy = scenario[0]
            z0, x0, y0 = viewport_tiles(zoom, cx, cy)[0]
            for ts in (256, 512):
                await client.get(
                    f"/tiles/WebMercatorQuad/{z0}/{x0}/{y0}",
                    params={"raster": RASTER_256, "tilesize": str(ts)},
                )

            r_ts256 = await run_scenario(
                client, RASTER_256, scenario, sem, tilesize=256
            )
            r_ts512 = await run_scenario(
                client, RASTER_256, scenario, sem, tilesize=512
            )
            return r_ts256, r_ts512

    r_ts256, r_ts512 = asyncio.run(_run())
    print_report(r_ts256, r_ts512, label_a="ts256", label_b="ts512")

    failures = sum(r.failures for r in r_ts256 + r_ts512)
    if failures:
        examples = [
            ex
            for r in r_ts256 + r_ts512
            for ex in ([f"{r.action}: {r.failures} fails"] if r.failures else [])
        ]
        pytest.fail(f"{failures} tile requests failed — {'; '.join(examples)}")
